"""Cadence HQ: for the team that runs Cadence. Shows which pharmacies use it and how often, and their help requests.
Never returns stock, sales, prices, money, alert recipients or anyone's personal details beyond the pharmacy admin's
name and email (needed to reach them)."""
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import ratelimit
from ..db import get_db
from ..deps import current_hq_admin
from ..models import (AlertRead, Batch, DemoRequest, NotificationLog, NotificationSettings, PasswordReset, Pharmacy, PlatformAdmin, Product,
                      Role, Sale, SupportTicket, UsageEvent, User)
from ..schemas import CamelModel
from ..security import create_hq_token, verify_password
from ..services.notify import hq_log, numbers, send_email, send_sms
from .support import CATEGORIES, TicketOut, ticket_out

router = APIRouter(prefix="/hq", tags=["hq"])
FEATURES = ["login", "ai_question", "import", "item_added", "invite", "help_request"]


# ---------- auth ----------
class HqLoginIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class HqAdminOut(CamelModel):
    name: str
    email: str


class HqLoginOut(BaseModel):  # same shape as the pharmacy login: { access_token, admin }
    access_token: str
    admin: HqAdminOut


@router.post("/auth/login", response_model=HqLoginOut)
async def hq_login(body: HqLoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    key = f"hq:{ratelimit.client_ip(request)}"
    if ratelimit.over(key, 5, 900):
        raise HTTPException(429, "Too many attempts. Wait 15 minutes.")
    admin = await db.scalar(select(PlatformAdmin).where(func.lower(PlatformAdmin.email) == body.email.lower()))
    if not admin or not verify_password(body.password, admin.password_hash):
        ratelimit.hit(key, 5, 900)
        raise HTTPException(401, "That email and password don't match an HQ account.")
    admin.last_login = datetime.now(timezone.utc)
    await db.commit()
    return HqLoginOut(access_token=create_hq_token(str(admin.id)), admin=HqAdminOut(name=admin.name, email=admin.email))


@router.get("/me", response_model=HqAdminOut)
async def hq_me(admin: PlatformAdmin = Depends(current_hq_admin)):
    return HqAdminOut(name=admin.name, email=admin.email)


# ---------- usage ----------
def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d and d.tzinfo is None else d


def _health(created: datetime, last: datetime | None, now: datetime) -> str:
    if last is None:
        return "new" if now - created < timedelta(days=7) else "inactive"
    age = now - last
    return "active" if age <= timedelta(days=3) else "quiet" if age <= timedelta(days=14) else "at_risk"


class PharmacyRow(CamelModel):
    id: str
    name: str
    location: str
    joined: str
    admin_name: str
    admin_email: str
    staff: int
    active_users_week: int
    active_days_month: int
    logins_month: int
    last_active: str
    health: Literal["active", "quiet", "at_risk", "new", "inactive"]
    features_month: dict[str, int]
    sms_on: bool
    email_on: bool
    open_tickets: int
    urgent_open: int
    activity_by_day: list[int]


async def _rows(db: AsyncSession, only: uuid.UUID | None = None) -> list[PharmacyRow]:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)
    q = select(Pharmacy).order_by(Pharmacy.created_at.desc())
    if only:
        q = q.where(Pharmacy.id == only)
    pharmacies = (await db.scalars(q)).all()
    if not pharmacies:
        return []
    ids = [p.id for p in pharmacies]
    ev = (await db.execute(select(UsageEvent.pharmacy_id, UsageEvent.user_id, UsageEvent.kind, UsageEvent.n, UsageEvent.created_at)
                           .where(UsageEvent.pharmacy_id.in_(ids), UsageEvent.created_at >= since))).all()
    last_any = dict((await db.execute(select(UsageEvent.pharmacy_id, func.max(UsageEvent.created_at))
                                      .where(UsageEvent.pharmacy_id.in_(ids)).group_by(UsageEvent.pharmacy_id))).all())
    staff = dict((await db.execute(select(User.pharmacy_id, func.count()).where(User.pharmacy_id.in_(ids), User.status != "Suspended")
                                   .group_by(User.pharmacy_id))).all())
    admins = {}
    for pid, name, email in (await db.execute(select(User.pharmacy_id, User.name, User.email).where(User.pharmacy_id.in_(ids), User.role == "Admin")
                                              .order_by(User.created_at))).all():
        admins.setdefault(pid, (name, email))
    ns = {n.pharmacy_id: n for n in (await db.scalars(select(NotificationSettings).where(NotificationSettings.pharmacy_id.in_(ids)))).all()}
    tickets = (await db.execute(select(SupportTicket.pharmacy_id, SupportTicket.urgency).where(
        SupportTicket.pharmacy_id.in_(ids), SupportTicket.status != "resolved"))).all()
    by_ph = defaultdict(list)
    for pid, uid, kind, n, at in ev:
        by_ph[pid].append((uid, kind, n, _aware(at)))
    today = now.date()
    out = []
    for p in pharmacies:
        events = by_ph[p.id]
        feats = Counter()
        for _, kind, n, _at in events:
            if kind in FEATURES:
                feats[kind] += n
        week = now - timedelta(days=7)
        day_counts = Counter((at.date() for _, k, _, at in events if k in ("active", "login", "signup")))
        last = _aware(last_any.get(p.id))
        a_name, a_email = admins.get(p.id, ("", ""))
        settings = ns.get(p.id)
        open_t = [u for pid, u in tickets if pid == p.id]
        out.append(PharmacyRow(
            id=str(p.id), name=p.name, location=p.location, joined=_aware(p.created_at).strftime("%Y-%m-%d"),
            admin_name=a_name, admin_email=a_email, staff=staff.get(p.id, 0),
            active_users_week=len({uid for uid, k, _, at in events if uid and at >= week}),
            active_days_month=len({at.date() for _, _, _, at in events}),
            logins_month=feats["login"], last_active=last.strftime("%Y-%m-%dT%H:%M") if last else "",
            health=_health(_aware(p.created_at), last, now), features_month={k: feats[k] for k in FEATURES},
            sms_on=bool(settings and settings.sms_enabled and settings.sms_numbers), email_on=bool(settings and settings.email_enabled and settings.email),
            open_tickets=len(open_t), urgent_open=sum(1 for u in open_t if u == "urgent"),
            activity_by_day=[day_counts.get(today - timedelta(days=13 - i), 0) for i in range(14)],
        ))
    return out


@router.get("/pharmacies", response_model=list[PharmacyRow])
async def pharmacies(admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    return await _rows(db)


class PharmacyDetail(CamelModel):
    pharmacy: PharmacyRow
    activity_month: list[dict]
    roles: dict[str, int]
    tickets: list[TicketOut]


@router.get("/pharmacies/{pharmacy_id}", response_model=PharmacyDetail)
async def pharmacy_detail(pharmacy_id: str, admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    try:
        pid = uuid.UUID(pharmacy_id)
    except ValueError:
        raise HTTPException(404, "No such pharmacy.")
    rows = await _rows(db, pid)
    if not rows:
        raise HTTPException(404, "No such pharmacy.")
    now = datetime.now(timezone.utc)
    ev = (await db.execute(select(UsageEvent.kind, UsageEvent.n, UsageEvent.created_at, UsageEvent.user_id).where(
        UsageEvent.pharmacy_id == pid, UsageEvent.created_at >= now - timedelta(days=30)))).all()
    days: dict[date, Counter] = defaultdict(Counter)
    people: dict[date, set] = defaultdict(set)
    for kind, n, at, uid in ev:
        d = _aware(at).date()
        days[d][kind] += n
        if uid:
            people[d].add(uid)
    today = now.date()
    series = []
    for i in range(30):
        d = today - timedelta(days=29 - i)
        series.append({"date": d.isoformat(), "people": len(people[d]), "logins": days[d]["login"], "aiQuestions": days[d]["ai_question"],
                       "stockChanges": days[d]["item_added"] + days[d]["import"]})
    roles = dict((await db.execute(select(User.role, func.count()).where(User.pharmacy_id == pid, User.status != "Suspended")
                                   .group_by(User.role))).all())
    t = (await db.execute(select(SupportTicket, User.name).outerjoin(User, User.id == SupportTicket.user_id)
                          .where(SupportTicket.pharmacy_id == pid).order_by(SupportTicket.created_at.desc()).limit(20))).all()
    return PharmacyDetail(pharmacy=rows[0], activity_month=series, roles=roles, tickets=[ticket_out(x, n or "") for x, n in t])


class DeletePharmacy(CamelModel):
    confirm_name: str = Field(max_length=200)


@router.post("/pharmacies/{pharmacy_id}/delete", status_code=204)
async def delete_pharmacy(pharmacy_id: str, body: DeletePharmacy, admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    """Permanently delete a pharmacy account and everything in it: team, stock, sales, alerts, help requests.
    The caller must type the pharmacy's name exactly, so one mis-click can't wipe an account."""
    try:
        pid = uuid.UUID(pharmacy_id)
    except ValueError:
        raise HTTPException(404, "No such pharmacy.")
    ph = await db.get(Pharmacy, pid)
    if not ph:
        raise HTTPException(404, "No such pharmacy.")
    if body.confirm_name.strip().casefold() != ph.name.strip().casefold():
        raise HTTPException(400, f"Type the pharmacy's name exactly ({ph.name}) to delete it.")
    # Children first, so it works whether or not the database enforces ON DELETE CASCADE (SQLite doesn't by default).
    users = select(User.id).where(User.pharmacy_id == pid)
    products = select(Product.id).where(Product.pharmacy_id == pid)
    for stmt in (
        delete(AlertRead).where(AlertRead.user_id.in_(users)),
        delete(PasswordReset).where(PasswordReset.user_id.in_(users)),
        delete(Sale).where(Sale.pharmacy_id == pid),
        delete(Batch).where(Batch.product_id.in_(products)),
        delete(Product).where(Product.pharmacy_id == pid),
        delete(NotificationLog).where(NotificationLog.pharmacy_id == pid),
        delete(NotificationSettings).where(NotificationSettings.pharmacy_id == pid),
        delete(UsageEvent).where(UsageEvent.pharmacy_id == pid),
        delete(SupportTicket).where(SupportTicket.pharmacy_id == pid),
        delete(User).where(User.pharmacy_id == pid),
        delete(Role).where(Role.pharmacy_id == pid),
        delete(Pharmacy).where(Pharmacy.id == pid),
    ):
        await db.execute(stmt)
    hq_log(db, "system", admin.email, f"Deleted pharmacy {ph.name} ({ph.location or 'no location'}).", "sent", "", "account_deleted",
           "Pharmacy deleted")
    await db.commit()


class Overview(CamelModel):
    pharmacies: int
    new_this_week: int
    active_this_week: int
    at_risk: int
    users: int
    open_tickets: int
    urgent_open: int
    new_leads: int
    signups_by_week: list[int]
    active_pharmacies_by_day: list[int]


@router.get("/overview", response_model=Overview)
async def overview(admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    rows = await _rows(db)
    now = datetime.now(timezone.utc)
    created = [_aware(c) for c in (await db.scalars(select(Pharmacy.created_at))).all()]
    signups = [sum(1 for c in created if now - timedelta(weeks=8 - i) <= c < now - timedelta(weeks=7 - i)) for i in range(8)]
    ev = (await db.execute(select(UsageEvent.pharmacy_id, UsageEvent.created_at).where(UsageEvent.created_at >= now - timedelta(days=14)))).all()
    per_day = defaultdict(set)
    for pid, at in ev:
        per_day[_aware(at).date()].add(pid)
    today = now.date()
    open_t = (await db.execute(select(SupportTicket.urgency).where(SupportTicket.status != "resolved"))).scalars().all()
    return Overview(
        pharmacies=len(rows), new_this_week=sum(1 for c in created if now - c <= timedelta(days=7)),
        active_this_week=sum(1 for r in rows if r.active_users_week > 0), at_risk=sum(1 for r in rows if r.health in ("at_risk", "inactive")),
        users=sum(r.staff for r in rows), open_tickets=len(open_t), urgent_open=sum(1 for u in open_t if u == "urgent"),
        new_leads=await db.scalar(select(func.count()).select_from(DemoRequest).where(DemoRequest.status == "new")) or 0,
        signups_by_week=signups, active_pharmacies_by_day=[len(per_day[today - timedelta(days=13 - i)]) for i in range(14)],
    )


# ---------- help requests ----------
class HqTicket(TicketOut):
    pharmacy_id: str
    pharmacy_name: str
    phone: str
    raised_by_email: str


@router.get("/tickets", response_model=list[HqTicket])
async def tickets(status: str = "open", admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    q = (select(SupportTicket, Pharmacy.name, User.name, User.email).join(Pharmacy, Pharmacy.id == SupportTicket.pharmacy_id)
         .outerjoin(User, User.id == SupportTicket.user_id))
    if status == "open":
        q = q.where(SupportTicket.status != "resolved")
    elif status in ("acknowledged", "resolved"):
        q = q.where(SupportTicket.status == status)
    rows = (await db.execute(q.order_by(SupportTicket.created_at.desc()).limit(200))).all()
    out = []
    for t, ph_name, u_name, u_email in rows:
        base = ticket_out(t, u_name or "").model_dump()
        out.append(HqTicket(**base, pharmacy_id=str(t.pharmacy_id), pharmacy_name=ph_name, phone=t.phone, raised_by_email=u_email or ""))
    # Open and urgent first; newest first within each group (rows already come newest first, and sort is stable)
    rank = {"open": 0, "acknowledged": 1, "resolved": 2}
    return sorted(out, key=lambda x: (rank.get(x.status, 3), x.urgency != "urgent"))


class TicketUpdate(CamelModel):
    status: Literal["open", "acknowledged", "resolved"] | None = None
    reply: str | None = Field(default=None, max_length=2000)
    text_reply: bool = False  # also send the reply by SMS to the callback number


@router.patch("/tickets/{ticket_id}", response_model=HqTicket)
async def update_ticket(ticket_id: str, body: TicketUpdate, admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    try:
        t = await db.get(SupportTicket, uuid.UUID(ticket_id))
    except ValueError:
        t = None
    if not t:
        raise HTTPException(404, "No such request.")
    if body.status:
        t.status = body.status
    new_reply = body.reply is not None and body.reply.strip() and body.reply.strip() != t.reply
    if body.reply is not None:
        t.reply = body.reply.strip()
    t.updated_at = datetime.now(timezone.utc)
    await db.commit()
    ph = await db.get(Pharmacy, t.pharmacy_id)
    user = await db.get(User, t.user_id) if t.user_id else None
    if new_reply and user:  # let the person who asked know
        subject = f"Cadence support: {CATEGORIES.get(t.category, 'your request')}"
        text = f"Hi {user.name.split()[0]},\n\n{t.reply}\n\nYou can also see this in Cadence under Get help.\n\nCadence support"
        st, err = await send_email(user.email, subject, text)
        hq_log(db, "email", user.email, text, st, err, "reply", subject)
    if new_reply and body.text_reply and (to := numbers(t.phone or (user.phone if user else ""))):
        sms = f"Cadence support: {t.reply}"
        sms = sms if len(sms) <= 459 else sms[:400] + "... Full reply in Cadence > Get help."
        st, err = await send_sms(to, sms)
        hq_log(db, "sms", ", ".join(to), sms, st, err, "reply")
    if new_reply:
        await db.commit()
    return HqTicket(**ticket_out(t, user.name if user else "").model_dump(), pharmacy_id=str(t.pharmacy_id), pharmacy_name=ph.name if ph else "",
                    phone=t.phone, raised_by_email=user.email if user else "")


# ---------- leads (Book a demo) ----------
class Lead(CamelModel):
    id: str
    name: str
    pharmacy: str
    phone: str
    email: str
    branches: str
    message: str
    status: str
    created_at: str


@router.get("/leads", response_model=list[Lead])
async def leads(admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(DemoRequest).order_by(DemoRequest.created_at.desc()).limit(200))).all()
    return [Lead(id=str(r.id), name=r.name, pharmacy=r.pharmacy, phone=r.phone, email=r.email, branches=r.branches, message=r.message,
                 status=r.status, created_at=_aware(r.created_at).strftime("%Y-%m-%dT%H:%M")) for r in rows]


class LeadUpdate(CamelModel):
    status: Literal["new", "contacted", "booked", "closed"]


@router.patch("/leads/{lead_id}", response_model=Lead)
async def update_lead(lead_id: str, body: LeadUpdate, admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    try:
        r = await db.get(DemoRequest, uuid.UUID(lead_id))
    except ValueError:
        r = None
    if not r:
        raise HTTPException(404, "No such lead.")
    r.status = body.status
    await db.commit()
    return Lead(id=str(r.id), name=r.name, pharmacy=r.pharmacy, phone=r.phone, email=r.email, branches=r.branches, message=r.message,
                status=r.status, created_at=_aware(r.created_at).strftime("%Y-%m-%dT%H:%M"))
