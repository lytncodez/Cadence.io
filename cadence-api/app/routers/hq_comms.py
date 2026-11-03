"""Cadence HQ: AI, messaging and system checks.

  /hq/system, /hq/test          is SMS / email / AI live? send yourself a test
  /hq/deliveries                what HQ has sent (tests, digest, help alerts, broadcasts, replies)
  /hq/digest/preview|send       the daily HQ email
  /hq/ai/briefing|chat|draft    Cadence AI over usage counts only (never pharmacy stock or sales)
  /hq/broadcasts                announcements to pharmacies by in-app banner, email and/or SMS to their admins
  /announcements                (pharmacy users) the in-app announcements meant for their pharmacy
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crypto, ratelimit
from ..config import get_settings
from ..db import get_db
from ..deps import current_hq_admin, current_user
from ..models import Announcement, HqDelivery, Pharmacy, PlatformAdmin, User
from ..schemas import CamelModel, ChatTurn, SendResult
from ..services import ai, hq_ai, hq_digest, notify
from .hq import _aware, _rows
from .system import Integration, _row

router = APIRouter(prefix="/hq", tags=["hq"])
pharmacy_router = APIRouter(prefix="/announcements", tags=["announcements"])
Audience = Literal["all", "active", "quiet", "at_risk", "new", "inactive", "selected"]
Channel = Literal["in_app", "email", "sms"]


def _stamp(d: datetime | None) -> str:
    return _aware(d).strftime("%Y-%m-%dT%H:%M") if d else ""


# ---------- system status and tests ----------
class HqSystem(CamelModel):
    sms: Integration
    email: Integration
    ai: Integration
    cron: Integration
    encryption: Integration
    hq_email: Integration
    hq_sms: Integration
    hq_digest: Integration


@router.get("/system", response_model=HqSystem)
async def system(admin: PlatformAdmin = Depends(current_hq_admin)):
    s = get_settings()
    hq_email, hq_sms = hq_digest.recipient(), s.hq_notify_sms or s.demo_notify_sms
    return HqSystem(
        sms=_row(s.sms_provider, notify.sms_problem(), f"Sending as {s.sms_sender_id!r} via {s.sms_provider.title()}.",
                 "Demo mode: texts are logged, not sent. Set SMS_PROVIDER=arkesel, ARKESEL_API_KEY and SMS_SENDER_ID."),
        email=_row(s.email_provider, notify.email_problem(), f"Sending from {s.email_from or s.smtp_from or s.smtp_user} via {s.email_provider.title()}.",
                   "Demo mode: emails are logged, not sent. Set EMAIL_PROVIDER=brevo (or resend), its API key and EMAIL_FROM."),
        ai=_row(s.ai_provider, ai.ai_problem(), f"{s.ai_provider.title()} · {s.ai_model}.",
                "Built-in wording only. Set AI_PROVIDER=anthropic, ANTHROPIC_API_KEY and AI_MODEL."),
        cron=Integration(provider="cron", status="live" if s.cron_secret else "needs_setup",
                         detail="Digests, weekly reports and the HQ email go out when your scheduler calls /alerts/cron." if s.cron_secret
                         else "Set CRON_SECRET and add a cron-job.org job that calls POST /api/v1/alerts/cron every 15 minutes."),
        encryption=Integration(provider="fernet", status="live" if crypto.enabled() else "needs_setup",
                               detail="Personal details are encrypted in the database." if crypto.enabled() else "Set DATA_ENCRYPTION_KEY."),
        hq_email=Integration(provider="email", status="live" if hq_email else "needs_setup",
                             detail=f"Help requests and the HQ digest go to {hq_email}." if hq_email else "Set HQ_NOTIFY_EMAIL to your inbox."),
        hq_sms=Integration(provider="sms", status="live" if hq_sms else "needs_setup",
                           detail=f"Urgent help requests are texted to {hq_sms}." if hq_sms else "Set HQ_NOTIFY_SMS to your phone for urgent help requests."),
        hq_digest=Integration(provider="cron", status="live" if (s.hq_digest_enabled and hq_email and s.cron_secret) else "needs_setup",
                              detail=f"Daily after {s.hq_digest_time} UTC to {hq_email}." if (s.hq_digest_enabled and hq_email and s.cron_secret)
                              else "Needs HQ_NOTIFY_EMAIL and the cron job." if s.hq_digest_enabled else "Off (HQ_DIGEST_ENABLED=false)."),
    )


class TestIn(CamelModel):
    channel: Literal["sms", "email", "ai"]
    to: str = Field(default="", max_length=254)  # optional; defaults to HQ_NOTIFY_EMAIL / HQ_NOTIFY_SMS


@router.post("/test", response_model=SendResult)
async def test(body: TestIn, admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    ratelimit.enforce(f"hqtest:{admin.id}", 20, 3600, "That's a lot of tests. Wait a few minutes.")
    s = get_settings()
    if body.channel == "ai":
        st, detail = await ai.ping()
        notify.hq_log(db, "ai", s.ai_model or "", detail, st, detail if st == "failed" else "", "test")
        await db.commit()
        return SendResult(channel="ai", status=st, detail=detail)
    if body.channel == "email":
        to = body.to.strip() or hq_digest.recipient() or admin.email
        msg = f"This is a test from Cadence HQ. Email is working through {s.email_provider}."
        st, err = await notify.send_email(to, "Cadence HQ test email", msg)
        notify.hq_log(db, "email", to, msg, st, err, "test", "Cadence HQ test email")
        await db.commit()
        return SendResult(channel="email", status=st, detail=err or ("Logged only: EMAIL_PROVIDER is mock." if st == "mock" else f"Sent to {to}."))
    to = notify.numbers(body.to.strip() or s.hq_notify_sms or s.demo_notify_sms)
    if not to:
        raise HTTPException(400, "Enter a phone number, or set HQ_NOTIFY_SMS on the server.")
    msg = "Cadence HQ test: SMS is working."
    st, err = await notify.send_sms(to, msg)
    notify.hq_log(db, "sms", ", ".join(to), msg, st, err, "test")
    await db.commit()
    return SendResult(channel="sms", status=st, detail=err or ("Logged only: SMS_PROVIDER is mock." if st == "mock" else f"Sent to {', '.join(to)}."))


class HqDeliveryOut(CamelModel):
    id: str
    channel: str
    recipient: str
    subject: str
    message: str
    status: str
    error: str
    kind: str
    created_at: str


@router.get("/deliveries", response_model=list[HqDeliveryOut])
async def deliveries(kind: str = "", admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    q = select(HqDelivery).order_by(HqDelivery.created_at.desc()).limit(50)
    if kind:
        q = q.where(HqDelivery.kind == kind)
    return [HqDeliveryOut(id=str(d.id), channel=d.channel, recipient=d.recipient, subject=d.subject, message=d.message, status=d.status,
                          error=d.error, kind=d.kind, created_at=_stamp(d.created_at)) for d in (await db.scalars(q)).all()]


class DigestPreview(CamelModel):
    subject: str
    body: str
    to: str


@router.get("/digest/preview", response_model=DigestPreview)
async def digest_preview(admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    subject, body = await hq_digest.build(db)
    return DigestPreview(subject=subject, body=body, to=hq_digest.recipient())


@router.post("/digest/send", response_model=SendResult)
async def digest_send(admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    if not hq_digest.recipient():
        raise HTTPException(400, "Set HQ_NOTIFY_EMAIL on the server first.")
    st, err = await hq_digest.send(db)
    return SendResult(channel="email", status=st, detail=err or ("Logged only: EMAIL_PROVIDER is mock." if st == "mock" else f"Sent to {hq_digest.recipient()}."))


# ---------- AI ----------
class BriefingOut(CamelModel):
    text: str
    ai: bool
    generated_at: str


@router.post("/ai/briefing", response_model=BriefingOut)
async def ai_briefing(admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    b = await hq_ai.briefing([r.model_dump() for r in await _rows(db)])
    return BriefingOut(text=b["text"], ai=b["ai"], generated_at=_stamp(datetime.now(timezone.utc)))


class HqAskIn(CamelModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)


class HqAskOut(CamelModel):
    text: str
    ai: bool


@router.post("/ai/chat", response_model=HqAskOut)
async def ai_chat(body: HqAskIn, admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    ratelimit.enforce(f"hqai:{admin.id}", 60, 3600, "You've asked a lot of questions this hour. Try again shortly.")
    return HqAskOut(**await hq_ai.chat(body.message, [r.model_dump() for r in await _rows(db)], body.history))


class DraftIn(CamelModel):
    notes: str = Field(min_length=3, max_length=3000)
    audience: str = Field(default="all pharmacies", max_length=80)


class DraftOut(CamelModel):
    title: str
    message: str
    sms: str
    ai: bool


@router.post("/ai/draft", response_model=DraftOut)
async def ai_draft(body: DraftIn, admin: PlatformAdmin = Depends(current_hq_admin)):
    ratelimit.enforce(f"hqai:{admin.id}", 60, 3600, "You've used AI a lot this hour. Try again shortly.")
    return DraftOut(**await hq_ai.draft(body.notes, body.audience))


# ---------- broadcasts ----------
class BroadcastIn(CamelModel):
    title: str = Field(min_length=3, max_length=160)
    message: str = Field(min_length=3, max_length=5000)
    sms_text: str = Field(default="", max_length=459)  # 3 SMS segments
    channels: list[Channel] = Field(min_length=1)
    audience: Audience = "all"
    pharmacy_ids: list[str] = Field(default_factory=list, max_length=500)
    dry_run: bool = False

    @field_validator("channels")
    @classmethod
    def unique(cls, v: list[str]):
        return list(dict.fromkeys(v))


class BroadcastOut(CamelModel):
    id: str
    title: str
    message: str
    sms_text: str
    channels: list[str]
    audience: str
    pharmacies: int
    pharmacy_names: list[str]
    email_recipients: int
    sms_recipients: int
    results: dict
    sent_by: str
    created_at: str
    dry_run: bool = False


async def _targets(db: AsyncSession, audience: str, ids: list[str]) -> list:
    rows = await _rows(db)
    if audience == "all":
        return rows
    if audience == "selected":
        wanted = set(ids)
        return [r for r in rows if r.id in wanted]
    return [r for r in rows if r.health == audience]


async def _admins(db: AsyncSession, pharmacy_ids: list[str]) -> dict[str, list[User]]:
    ids = [uuid.UUID(i) for i in pharmacy_ids]
    out: dict[str, list[User]] = {}
    if not ids:
        return out
    for u in (await db.scalars(select(User).where(User.pharmacy_id.in_(ids), User.role == "Admin", User.status == "Active"))).all():
        out.setdefault(str(u.pharmacy_id), []).append(u)
    return out


def _sms_for(b: BroadcastIn) -> str:
    text = b.sms_text.strip() or f"Cadence: {b.title}. {b.message}"
    return text if len(text) <= 459 else text[:456] + "..."


def _out(a: Announcement, names: list[str], email_n: int, sms_n: int, dry: bool = False) -> BroadcastOut:
    return BroadcastOut(id=str(a.id), title=a.title, message=a.body, sms_text=a.sms_text, channels=a.channels, audience=a.audience,
                        pharmacies=len(a.pharmacy_ids), pharmacy_names=names, email_recipients=email_n, sms_recipients=sms_n,
                        results=a.results or {}, sent_by=a.sent_by, created_at=_stamp(a.created_at) if a.created_at else "", dry_run=dry)


@router.post("/broadcasts", response_model=BroadcastOut)
async def broadcast(body: BroadcastIn, admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    """Send an announcement. With dryRun, only counts who it would reach."""
    targets = await _targets(db, body.audience, body.pharmacy_ids)
    if not targets:
        raise HTTPException(400, "No pharmacies match that audience.")
    admins = await _admins(db, [t.id for t in targets])
    emails = [(t, u) for t in targets for u in admins.get(t.id, []) if u.email] if "email" in body.channels else []
    phones = [(t, u, n) for t in targets for u in admins.get(t.id, []) for n in notify.numbers(u.phone)] if "sms" in body.channels else []
    names = [t.name for t in targets]
    a = Announcement(title=body.title.strip(), body=body.message.strip(), sms_text=_sms_for(body) if "sms" in body.channels else "",
                     channels=body.channels, audience=body.audience, pharmacy_ids=[t.id for t in targets], results={},
                     sent_by=admin.name, created_at=datetime.now(timezone.utc))
    if body.dry_run:
        a.id = uuid.uuid4()
        return _out(a, names[:20], len(emails), len(phones), dry=True)
    ratelimit.enforce(f"broadcast:{admin.id}", 10, 3600, "You've sent several announcements this hour. Wait a little before the next.")

    sem = asyncio.Semaphore(5)  # a few at a time keeps providers happy

    async def mail(t, u):
        first = (u.name or "there").split()[0]
        text = (f"Hi {first},\n\n{a.body}\n\nThe Cadence team\n\n"
                f"You're receiving this as an admin of {t.name} on Cadence.io.")
        async with sem:
            st, err = await notify.send_email(u.email, a.title, text)
        return u.email, text, st, err

    async def text(t, u, n):
        async with sem:
            st, err = await notify.send_sms([n], a.sms_text)
        return n, st, err

    results: dict[str, dict[str, int]] = {}
    for addr, msg, st, err in await asyncio.gather(*(mail(t, u) for t, u in emails)):
        results.setdefault("email", {"sent": 0, "mock": 0, "failed": 0})[st] += 1
        notify.hq_log(db, "email", addr, msg, st, err, "broadcast", a.title)
    for n, st, err in await asyncio.gather(*(text(t, u, n) for t, u, n in phones)):
        results.setdefault("sms", {"sent": 0, "mock": 0, "failed": 0})[st] += 1
        notify.hq_log(db, "sms", n, a.sms_text, st, err, "broadcast")
    if "in_app" in body.channels:
        results["in_app"] = {"pharmacies": len(targets)}
    a.results = results
    db.add(a)
    await db.commit()
    return _out(a, names[:20], len(emails), len(phones))


@router.get("/broadcasts", response_model=list[BroadcastOut])
async def broadcasts(admin: PlatformAdmin = Depends(current_hq_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(Announcement).order_by(Announcement.created_at.desc()).limit(50))).all()
    ids = {i for a in rows for i in a.pharmacy_ids[:20]}
    names = dict((await db.execute(select(Pharmacy.id, Pharmacy.name).where(Pharmacy.id.in_([uuid.UUID(i) for i in ids])))).all()) if ids else {}
    names = {str(k): v for k, v in names.items()}
    out = []
    for a in rows:
        r = a.results or {}
        e, s = r.get("email", {}), r.get("sms", {})
        out.append(_out(a, [names[i] for i in a.pharmacy_ids[:20] if i in names], sum(e.values()), sum(s.values())))
    return out


# ---------- pharmacy side: in-app announcements ----------
class AnnouncementOut(CamelModel):
    id: str
    title: str
    message: str
    created_at: str


@pharmacy_router.get("", response_model=list[AnnouncementOut])
async def my_announcements(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """In-app announcements from the Cadence team for this pharmacy, last 30 days. Dismissing is remembered in the browser."""
    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = (await db.scalars(select(Announcement).where(Announcement.created_at >= since).order_by(Announcement.created_at.desc()).limit(50))).all()
    pid = str(user.pharmacy_id)
    return [AnnouncementOut(id=str(a.id), title=a.title, message=a.body, created_at=_stamp(a.created_at))
            for a in rows if "in_app" in (a.channels or []) and (a.audience == "all" or pid in (a.pharmacy_ids or []))][:5]
