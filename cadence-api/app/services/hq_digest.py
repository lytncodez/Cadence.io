"""The daily email to the Cadence team: sign-ups, who's gone quiet, open help requests and an AI briefing.
Sent by the same external cron that triggers pharmacy digests (POST /alerts/cron), once a day after HQ_DIGEST_TIME (UTC)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import DemoRequest, HqDelivery, Pharmacy
from . import hq_ai
from .notify import hq_log, send_email


def recipient() -> str:
    s = get_settings()
    return s.hq_notify_email or s.demo_notify_email


async def build(db: AsyncSession) -> tuple[str, str]:
    from ..routers.hq import _rows  # late import to avoid a cycle (routers import services)
    rows = [r.model_dump() for r in await _rows(db)]
    b = await hq_ai.briefing(rows)
    f = b["facts"]
    now = datetime.now(timezone.utc)
    new = (await db.scalars(select(Pharmacy.name).where(Pharmacy.created_at >= now - timedelta(days=1)))).all()
    leads = await db.scalar(select(func.count()).select_from(DemoRequest).where(DemoRequest.status == "new")) or 0
    subject = (f"Cadence HQ · {f['active_this_week']}/{f['pharmacies']} active"
               + (f" · {f['urgent_help_requests']} URGENT" if f["urgent_help_requests"] else "")
               + (f" · {f['open_help_requests']} open help" if f["open_help_requests"] else ""))
    lines = [
        f"Good morning. Here's Cadence on {now:%A %d %B}.", "",
        "BRIEFING" + (" (Cadence AI)" if b["ai"] else ""), b["text"], "",
        "NUMBERS",
        f"Pharmacies: {f['pharmacies']} ({', '.join(f'{v} {k.lower()}' for k, v in f['by_status'].items()) or 'none'})",
        f"Active this week: {f['active_this_week']} · people: {f['people']}",
        f"New in the last 24 hours: {', '.join(new) if new else 'none'}",
        f"Open help requests: {f['open_help_requests']} ({f['urgent_help_requests']} urgent)",
        f"New demo requests waiting: {leads}", "",
        "Open Cadence HQ to act on these. This email only contains usage counts, never pharmacy stock or sales.",
    ]
    return subject, "\n".join(lines)


async def send(db: AsyncSession) -> tuple[str, str]:
    to = recipient()
    if not to:
        return "failed", "Set HQ_NOTIFY_EMAIL to receive the HQ digest."
    subject, body = await build(db)
    st, err = await send_email(to, subject, body)
    hq_log(db, "email", to, body, st, err, "digest", subject)
    await db.commit()
    return st, err


async def maybe_send(db: AsyncSession) -> str:
    """Called by the cron. Returns what happened: skipped | sent | mock | failed."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    if not s.hq_digest_enabled or not recipient() or now.strftime("%H:%M") < s.hq_digest_time:
        return "skipped"
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if await db.scalar(select(HqDelivery.id).where(HqDelivery.kind == "digest", HqDelivery.created_at >= start).limit(1)):
        return "skipped"
    try:
        st, _ = await send(db)
        return st
    except Exception:  # noqa: BLE001 - never break the pharmacy cron because of the HQ email
        await db.rollback()
        return "failed"
