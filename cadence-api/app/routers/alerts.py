from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import current_user, require
from ..models import AlertRead, NotificationLog, NotificationSettings, Pharmacy, User
from ..schemas import AlertOut, DeliveryOut, NotifySettingsIO, SendResult
from ..services import notify
from ..services.analytics import summarize

router = APIRouter(prefix="/alerts", tags=["alerts"])


async def settings_for(db: AsyncSession, pharmacy_id) -> NotificationSettings:
    ns = await db.get(NotificationSettings, pharmacy_id)
    if ns is None:
        ns = NotificationSettings(pharmacy_id=pharmacy_id)
        db.add(ns)
        await db.flush()
    return ns


@router.get("", response_model=list[AlertOut])
async def list_alerts(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    ns = await settings_for(db, user.pharmacy_id)
    s = await summarize(db, user)
    read = set((await db.scalars(select(AlertRead.key).where(AlertRead.user_id == user.id))).all())
    await db.commit()
    return [AlertOut(**a, read=a["key"] in read) for a in notify.compute_alerts(s, ns)]


@router.post("/read", status_code=204)
async def mark_read(keys: list[str], user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    existing = set((await db.scalars(select(AlertRead.key).where(AlertRead.user_id == user.id, AlertRead.key.in_(keys)))).all())
    for k in set(keys) - existing:
        db.add(AlertRead(user_id=user.id, key=k[:160]))
    await db.commit()


@router.get("/settings", response_model=NotifySettingsIO)
async def get_settings_route(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    ns = await settings_for(db, user.pharmacy_id)
    await db.commit()
    return NotifySettingsIO.model_validate(ns)


@router.put("/settings", response_model=NotifySettingsIO)
async def save_settings(body: NotifySettingsIO, user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    ns = await settings_for(db, user.pharmacy_id)
    for k, v in body.model_dump().items():
        setattr(ns, k, v)
    await db.commit()
    return NotifySettingsIO.model_validate(ns)


@router.post("/test-sms", response_model=SendResult)
async def test_sms(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    ns = await settings_for(db, user.pharmacy_id)
    to = notify.numbers(ns.sms_numbers)
    if not to:
        raise HTTPException(400, "Add at least one phone number and save before sending a test.")
    msg = f"Cadence test: SMS alerts for {(await db.get(Pharmacy, user.pharmacy_id)).name} are working."
    status, err = await notify.send_sms(to, msg)
    await notify.log(db, user.pharmacy_id, "sms", ", ".join(to), msg, status, err, "test")
    await db.commit()
    return SendResult(channel="sms", status=status, detail=err or ("Logged only: SMS_PROVIDER is mock." if status == "mock" else f"Sent to {len(to)} number(s)."))


@router.post("/test-email", response_model=SendResult)
async def test_email(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    ns = await settings_for(db, user.pharmacy_id)
    if not ns.email:
        raise HTTPException(400, "Add an email address and save before sending a test.")
    subject, body = "Cadence test email", "Email alerts from Cadence are working. Your daily digest will arrive here."
    status, err = await notify.send_email(ns.email, subject, body)
    await notify.log(db, user.pharmacy_id, "email", ns.email, body, status, err, "test", subject)
    await db.commit()
    return SendResult(channel="email", status=status, detail=err or ("Logged only: EMAIL_PROVIDER is mock." if status == "mock" else f"Sent to {ns.email}."))


async def _digest(db: AsyncSession, user: User, force: bool) -> list[SendResult]:
    ns = await settings_for(db, user.pharmacy_id)
    today = date.today()
    if not force and ns.last_digest_on == today:
        return []
    s = await summarize(db, user)
    alerts = notify.compute_alerts(s, ns)
    results = []
    if ns.sms_enabled and (to := notify.numbers(ns.sms_numbers)):
        msg = notify.sms_text(s, ns)
        if msg:
            st, err = await notify.send_sms(to, msg)
            await notify.log(db, user.pharmacy_id, "sms", ", ".join(to), msg, st, err, "digest")
            results.append(SendResult(channel="sms", status=st, detail=err))
    if ns.email_enabled and ns.email:
        subject, body = notify.email_body(s, alerts)
        st, err = await notify.send_email(ns.email, subject, body)
        await notify.log(db, user.pharmacy_id, "email", ns.email, body, st, err, "digest", subject)
        results.append(SendResult(channel="email", status=st, detail=err))
    ns.last_digest_on = today
    await db.commit()
    return results


@router.post("/send-digest", response_model=list[SendResult])
async def send_digest_now(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    """Send today's SMS + email digest now (ignores whether it already went out today)."""
    return await _digest(db, user, force=True)


@router.post("/cron", response_model=dict)
async def cron(x_cron_secret: str = Header(default=""), db: AsyncSession = Depends(get_db)):
    """Call every 15 minutes from cron-job.org with header X-Cron-Secret. Sends each pharmacy's digest once a day
    after its digest time (Ghana time = UTC)."""
    secret = get_settings().cron_secret
    if not secret or x_cron_secret != secret:
        raise HTTPException(403, "Bad or missing X-Cron-Secret.")
    now = datetime.now(timezone.utc).strftime("%H:%M")
    sent = 0
    for ph in (await db.scalars(select(Pharmacy))).all():
        ns = await settings_for(db, ph.id)
        if ns.digest_time <= now and ns.last_digest_on != date.today():
            admin = await db.scalar(select(User).where(User.pharmacy_id == ph.id, User.role == "Admin", User.status == "Active"))
            if admin:
                sent += len(await _digest(db, admin, force=False))
    await db.commit()
    return {"messages": sent}


@router.get("/deliveries", response_model=list[DeliveryOut])
async def deliveries(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(NotificationLog).where(NotificationLog.pharmacy_id == user.pharmacy_id)
                             .order_by(NotificationLog.created_at.desc()).limit(20))).all()
    return [DeliveryOut(id=str(r.id), channel=r.channel, recipient=r.recipient, subject=r.subject, message=r.message, status=r.status,
                        error=r.error, kind=r.kind, created_at=r.created_at.strftime("%Y-%m-%dT%H:%M")) for r in rows]


@router.delete("/deliveries", status_code=204)
async def clear_deliveries(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(NotificationLog).where(NotificationLog.pharmacy_id == user.pharmacy_id))
    await db.commit()
