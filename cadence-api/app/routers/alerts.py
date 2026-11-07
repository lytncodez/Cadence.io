import hmac
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import can_see_finance, current_user, require
from ..models import AlertRead, NotificationLog, NotificationSettings, Pharmacy, User
from ..schemas import AlertOut, DeliveryOut, NotifySettingsIO, SendResult
from ..services import notify, reports
from ..services.analytics import summarize

log = logging.getLogger("cadence.alerts")
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
    fin = await can_see_finance(db, user)
    return [AlertOut(**a, read=a["key"] in read) for a in notify.compute_alerts(s, ns, fin)]


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
    # Only people in this pharmacy can be chosen as recipients.
    team = {str(i) for i in (await db.scalars(select(User.id).where(User.pharmacy_id == user.pharmacy_id))).all()}
    data = body.model_dump()
    for k in ("sms_user_ids", "email_user_ids"):
        data[k] = [i for i in dict.fromkeys(data[k]) if i in team]
    for k, v in data.items():
        setattr(ns, k, v)
    await db.commit()
    return NotifySettingsIO.model_validate(ns)


@router.post("/test-sms", response_model=SendResult)
async def test_sms(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    ns = await settings_for(db, user.pharmacy_id)
    to = [r.address for r in (await notify.recipients(db, ns, user.pharmacy_id))[0]]
    if not to:
        raise HTTPException(400, "Add a phone number or choose team members with a phone on their profile, then save before sending a test.")
    msg = f"Cadence test: SMS alerts for {(await db.get(Pharmacy, user.pharmacy_id)).name} are working."
    status, err = await notify.send_sms(to, msg)
    await notify.log(db, user.pharmacy_id, "sms", ", ".join(to), msg, status, err, "test")
    await db.commit()
    return SendResult(channel="sms", status=status, detail=err or ("Logged only: SMS_PROVIDER is mock." if status == "mock" else f"Sent to {len(to)} number(s)."))


@router.post("/test-email", response_model=SendResult)
async def test_email(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    ns = await settings_for(db, user.pharmacy_id)
    to = [r.address for r in (await notify.recipients(db, ns, user.pharmacy_id))[1]]
    if not to:
        raise HTTPException(400, "Add an email address or choose team members, then save before sending a test.")
    subject, body = "Cadence test email", "Email alerts from Cadence are working. Your daily digest and weekly report will arrive here."
    sent, errors, status = 0, [], "sent"
    for addr in to:
        st, err = await notify.send_email(addr, subject, body)
        await notify.log(db, user.pharmacy_id, "email", addr, body, st, err, "test", subject)
        sent += st == "sent"
        if st == "failed":
            errors.append(f"{addr}: {err}")
        status = "mock" if st == "mock" else status
    await db.commit()
    if errors:
        return SendResult(channel="email", status="failed", detail="; ".join(errors)[:500])
    return SendResult(channel="email", status=status, detail="Logged only: EMAIL_PROVIDER is mock." if status == "mock" else f"Sent to {sent} address(es).")


def _merge(channel: str, outcomes: list[tuple[str, str]]) -> SendResult | None:
    """One result per channel: failed if any send failed, mock if in demo mode, otherwise sent."""
    if not outcomes:
        return None
    errs = [e for st, e in outcomes if st == "failed"]
    status = "failed" if errs else "mock" if any(st == "mock" for st, _ in outcomes) else "sent"
    return SendResult(channel=channel, status=status, detail="; ".join(errs)[:500] if errs else f"{len(outcomes)} message(s)")


async def _claim(db: AsyncSession, pharmacy_id, column, today: date) -> bool:
    """Mark today's send as done BEFORE sending, in one atomic UPDATE, and commit. Only the caller that flips the date
    sends. So if cron-job.org retries, two runs overlap, or something fails after the SMS went out, nobody gets it twice."""
    res = await db.execute(update(NotificationSettings).where(NotificationSettings.pharmacy_id == pharmacy_id,
                                                              or_(column.is_(None), column != today))
                           .values({column.key: today}).execution_options(synchronize_session=False))
    await db.commit()
    return res.rowcount == 1


async def _digest(db: AsyncSession, user: User, force: bool) -> list[SendResult]:
    ns = await settings_for(db, user.pharmacy_id)
    today = date.today()
    if not force and not await _claim(db, user.pharmacy_id, NotificationSettings.last_digest_on, today):
        return []  # already sent today, or another cron run is sending it right now
    s = await summarize(db, user)
    sms_to, email_to = await notify.recipients(db, ns, user.pharmacy_id)
    results: list[SendResult] = []
    if ns.sms_enabled and sms_to:
        out = []
        for fin in (True, False):  # people who can't see finance get the same text without money
            group = [r.address for r in sms_to if r.finance == fin]
            msg = notify.sms_text(s, ns, fin) if group else ""
            if msg:
                st, err = await notify.send_sms(group, msg)
                await notify.log(db, user.pharmacy_id, "sms", ", ".join(group), msg, st, err, "digest")
                out.append((st, err))
        if r := _merge("sms", out):
            results.append(r)
    if ns.email_enabled and email_to:
        note = await reports.priorities(s) if any(r.finance for r in email_to) else ""
        out = []
        for rcp in email_to:
            subject, body = notify.email_body(s, notify.compute_alerts(s, ns, rcp.finance), rcp.finance, note if rcp.finance else "")
            st, err = await notify.send_email(rcp.address, subject, body)
            await notify.log(db, user.pharmacy_id, "email", rcp.address, body, st, err, "digest", subject)
            out.append((st, err))
        if r := _merge("email", out):
            results.append(r)
    ns.last_digest_on = today
    await db.commit()
    return results


async def _weekly(db: AsyncSession, user: User, force: bool) -> list[SendResult]:
    """The weekly AI report goes to the alert email address and chosen team members who can see finance
    (it's about sales and losses)."""
    ns = await settings_for(db, user.pharmacy_id)
    today = date.today()
    if not force and (not ns.weekly_enabled or ns.last_weekly_on == today or today.weekday() != ns.weekly_day):
        return []
    to = [r for r in (await notify.recipients(db, ns, user.pharmacy_id))[1] if r.finance]
    if not to:
        if force:
            raise HTTPException(400, "Add an alert email address, or choose team members who can see finance, then save.")
        return []
    if not force and not await _claim(db, user.pharmacy_id, NotificationSettings.last_weekly_on, today):
        return []
    s = await summarize(db, user)
    subject, body, _ = await reports.weekly_report(s)
    out = []
    for rcp in to:
        st, err = await notify.send_email(rcp.address, subject, body)
        await notify.log(db, user.pharmacy_id, "email", rcp.address, body, st, err, "weekly", subject)
        out.append((st, err))
    ns.last_weekly_on = today
    await db.commit()
    r = _merge("email", out)
    return [r] if r else []


@router.post("/send-digest", response_model=list[SendResult])
async def send_digest_now(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    """Send today's SMS + email digest now (ignores whether it already went out today)."""
    return await _digest(db, user, force=True)


@router.post("/send-weekly", response_model=list[SendResult])
async def send_weekly_now(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    """Send this week's AI report now."""
    return await _weekly(db, user, force=True)


@router.post("/cron", response_model=dict)
async def cron(x_cron_secret: str = Header(default=""), db: AsyncSession = Depends(get_db)):
    """Call every 15 minutes from cron-job.org with header X-Cron-Secret. Sends each pharmacy's digest once a day
    after its digest time (Ghana time = UTC)."""
    secret = get_settings().cron_secret
    if not secret or not hmac.compare_digest(x_cron_secret.encode(), secret.encode()):
        raise HTTPException(403, "Bad or missing X-Cron-Secret.")
    now = datetime.now(timezone.utc).strftime("%H:%M")
    sent = weekly = 0
    # Loop over plain ids: a rollback after one pharmacy's failure expires loaded objects, which then can't reload here.
    for pid in (await db.scalars(select(Pharmacy.id))).all():
        ns = await settings_for(db, pid)
        if ns.digest_time > now:
            continue
        due_digest = ns.last_digest_on != date.today()
        due_weekly = ns.weekly_enabled and ns.last_weekly_on != date.today() and date.today().weekday() == ns.weekly_day
        if not (due_digest or due_weekly):
            continue
        admin = await db.scalar(select(User).where(User.pharmacy_id == pid, User.role == "Admin", User.status == "Active"))
        if not admin:
            continue
        try:  # one pharmacy's problem mustn't stop everyone else's digest
            if due_digest:
                sent += len(await _digest(db, admin, force=False))
            if due_weekly:
                weekly += len(await _weekly(db, admin, force=False))
        except Exception:  # noqa: BLE001
            log.exception("Digest failed for pharmacy %s", pid)
            await db.rollback()
    await db.commit()
    from ..services import hq_digest  # late import: HQ code depends on this module's helpers
    hq = await hq_digest.maybe_send(db)
    return {"messages": sent, "weekly": weekly, "hq_digest": hq}


@router.get("/deliveries", response_model=list[DeliveryOut])
async def deliveries(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    """Digest messages quote stock values, so the log is limited to people who manage alerts."""
    rows = (await db.scalars(select(NotificationLog).where(NotificationLog.pharmacy_id == user.pharmacy_id)
                             .order_by(NotificationLog.created_at.desc()).limit(20))).all()
    return [DeliveryOut(id=str(r.id), channel=r.channel, recipient=r.recipient, subject=r.subject, message=r.message, status=r.status,
                        error=r.error, kind=r.kind, created_at=r.created_at.strftime("%Y-%m-%dT%H:%M")) for r in rows]


@router.delete("/deliveries", status_code=204)
async def clear_deliveries(user: User = Depends(require("manage_alerts")), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(NotificationLog).where(NotificationLog.pharmacy_id == user.pharmacy_id))
    await db.commit()
