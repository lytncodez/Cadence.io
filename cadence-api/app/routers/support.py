"""The "Get help" button. Any signed-in pharmacy user can raise a request; Cadence HQ is told straight away."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import ratelimit
from ..config import get_settings
from ..db import get_db
from ..deps import current_user
from ..models import Pharmacy, SupportTicket, User
from ..schemas import CamelModel
from ..services import usage
from ..services.notify import hq_log, numbers, send_email, send_sms

router = APIRouter(prefix="/support", tags=["support"])

CATEGORIES = {
    "cant_dispense": "Can't dispense or see stock",
    "login": "Someone can't log in",
    "alerts": "SMS or email alerts not arriving",
    "data": "Numbers or stock look wrong",
    "bug": "Something is broken",
    "question": "Question or request",
}


class TicketIn(CamelModel):
    category: Literal["cant_dispense", "login", "alerts", "data", "bug", "question"]
    urgency: Literal["normal", "urgent"] = "normal"
    message: str = Field(min_length=3, max_length=2000)
    phone: str = Field(default="", max_length=40)

    @field_validator("phone")
    @classmethod
    def phone_ok(cls, v: str):
        import re
        if v and not re.fullmatch(r"\+?\d[\d\s]{7,}", v.strip()):
            raise ValueError("Enter the phone number in +233 format")
        return v.strip()


class TicketOut(CamelModel):
    id: str
    category: str
    category_label: str
    urgency: str
    message: str
    status: str
    reply: str
    created_at: str
    updated_at: str
    raised_by: str


def ticket_out(t: SupportTicket, raised_by: str = "") -> TicketOut:
    fmt = lambda d: d.strftime("%Y-%m-%dT%H:%M") if d else ""  # noqa: E731
    return TicketOut(id=str(t.id), category=t.category, category_label=CATEGORIES.get(t.category, t.category), urgency=t.urgency,
                     message=t.message, status=t.status, reply=t.reply, created_at=fmt(t.created_at), updated_at=fmt(t.updated_at),
                     raised_by=raised_by)


@router.post("/tickets", response_model=TicketOut, status_code=201)
async def raise_ticket(body: TicketIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    ratelimit.enforce(f"help:{user.id}", 5, 3600, "You've sent several requests in the last hour. We've got them; we'll be in touch.")
    t = SupportTicket(pharmacy_id=user.pharmacy_id, user_id=user.id, category=body.category, urgency=body.urgency,
                      message=body.message.strip(), phone=body.phone or user.phone or "")
    db.add(t)
    usage.record(db, user.pharmacy_id, "help_request", user.id)
    await db.commit()
    await db.refresh(t)
    # Tell HQ. Best effort: the request is saved either way and shows in HQ.
    s = get_settings()
    ph = await db.get(Pharmacy, user.pharmacy_id)
    label = CATEGORIES[body.category]
    to_email, to_sms = s.hq_notify_email or s.demo_notify_email, s.hq_notify_sms or s.demo_notify_sms
    if to_email:
        subject = f"{'URGENT ' if body.urgency == 'urgent' else ''}Help request: {ph.name} · {label}"
        text = (f"{ph.name} ({ph.location}) asked for help.\n\nFrom: {user.name} ({user.role}) <{user.email}> {t.phone}\n"
                f"Type: {label}\nUrgency: {body.urgency}\n\n{t.message}\n\nOpen Cadence HQ to respond.")
        st, err = await send_email(to_email, subject, text)
        hq_log(db, "email", to_email, text, st, err, "help", subject)
    if to_sms and body.urgency == "urgent" and numbers(to_sms):
        sms = f"URGENT Cadence help: {ph.name} · {label}. {user.name} {t.phone}"
        st, err = await send_sms(numbers(to_sms), sms)
        hq_log(db, "sms", to_sms, sms, st, err, "help")
    # Confirm to the person who asked, so they know it landed (best effort).
    if user.email:
        first = (user.name or "there").split()[0]
        conf = (f"Hi {first},\n\nWe've got your help request ({label}) and the Cadence team has been told"
                + (" straight away because you marked it urgent" if body.urgency == "urgent" else "")
                + ".\n\nYou'll see our reply in Cadence under Get help, and we'll email you too.\n\nCadence support")
        await send_email(user.email, f"We've got your request: {label}", conf)
    await db.commit()
    return ticket_out(t, user.name)


@router.get("/tickets", response_model=list[TicketOut])
async def my_tickets(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Your pharmacy's requests and HQ's replies, newest first."""
    rows = (await db.execute(select(SupportTicket, User.name).outerjoin(User, User.id == SupportTicket.user_id)
                             .where(SupportTicket.pharmacy_id == user.pharmacy_id)
                             .order_by(SupportTicket.created_at.desc()).limit(30))).all()
    return [ticket_out(t, name or "") for t, name in rows]
