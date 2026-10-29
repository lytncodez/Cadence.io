"""Alerts (computed from stock) and delivery by SMS and email.

SMS_PROVIDER=mock and EMAIL_PROVIDER=mock (defaults) record messages in notification_log without sending,
so the whole flow can be tested before any accounts are set up."""
import asyncio
import re
import smtplib
from email.message import EmailMessage

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import NotificationLog, NotificationSettings
from .analytics import Summary, money


def compute_alerts(s: Summary, ns: NotificationSettings) -> list[dict]:
    """Same rules as the web app: expired + critical batches, optional expiring-soon, low stock."""
    out = []
    for r in s.rows:
        if r.status == "expired" or r.status == "critical" or (r.status == "soon" and ns.on_soon):
            text = (f"Batch {r.batch} expired {r.expiry:%d %b %Y}. Quarantine {r.qty} units ({money(r.value)} at cost) and record the write-off."
                    if r.status == "expired" else f"Batch {r.batch} expires in {r.days} days. {r.qty} units left; dispense these first."
                    if r.status == "critical" else f"Batch {r.batch} expires in {r.days} days. {r.qty} units on hand.")
            out.append({"key": f"exp-{r.id}-{r.status}", "type": "expiry", "status": r.status, "title": r.name, "text": text,
                        "itemId": r.id, "days": r.days})
    if ns.on_low_stock:
        for p in s.low_stock:
            out.append({"key": f"low-{p.name}", "type": "stock", "status": "critical" if p.usable == 0 else "soon", "title": p.name,
                        "text": f"Usable stock is {p.usable} against a reorder level of {p.reorder_level}. {p.sold} sold this month.",
                        "itemId": None, "days": 99999})
    rank = {"expired": 0, "critical": 1, "soon": 2, "safe": 3}
    return sorted(out, key=lambda a: (a["type"] == "stock", rank[a["status"]], a["days"]))


def sms_text(s: Summary, ns: NotificationSettings) -> str:
    exp = [r for r in s.rows if r.status == "expired"] if ns.on_expired else []
    crit = [r for r in s.rows if r.status == "critical"] if ns.on_critical else []
    if not exp and not crit:
        return ""
    parts = [f"Cadence · {s.pharmacy}"]
    if crit:
        first = ", ".join(f"{r.name.split()[0]} {r.batch} ({r.days}d)" for r in crit[:3])
        parts.append(f"{len(crit)} critical: {first}{' +more' if len(crit) > 3 else ''}.")
    if exp:
        parts.append(f"{len(exp)} expired ({money(sum(r.value for r in exp))}). Quarantine today.")
    return " ".join(parts)[:459]  # 3 SMS segments


def email_body(s: Summary, alerts: list[dict]) -> tuple[str, str]:
    subject = f"Cadence daily digest · {s.counts['critical']} critical, {s.counts['expired']} expired"
    lines = [f"Good morning from Cadence. Here's {s.pharmacy} today.", ""]
    for a in alerts:
        lines.append(f"[{a['status'].upper()}] {a['title']}: {a['text']}")
    if not alerts:
        lines.append("Nothing needs attention today.")
    lines += ["", f"Usable stock value: {money(s.stock_value)}.", "Open Cadence to act on these."]
    return subject, "\n".join(lines)


def numbers(raw: str) -> list[str]:
    """'+233 24 555 0142, 020 555 0198' -> ['233245550142', '233205550198']"""
    out = []
    for n in re.split(r"[,;\n]+", raw or ""):
        d = re.sub(r"\D", "", n)
        if not d:
            continue
        if d.startswith("0") and len(d) == 10:
            d = "233" + d[1:]
        out.append(d)
    return out


async def send_sms(to: list[str], message: str) -> tuple[str, str]:
    """Returns (status, error). status: sent | mock | failed."""
    s = get_settings()
    if s.sms_provider == "mock":
        return "mock", ""
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            if s.sms_provider == "arkesel":
                r = await c.post("https://sms.arkesel.com/api/v2/sms/send", headers={"api-key": s.arkesel_api_key},
                                 json={"sender": s.sms_sender_id[:11], "message": message, "recipients": to})
            elif s.sms_provider == "hubtel":
                # Hubtel sends one recipient per request.
                for n in to:
                    r = await c.get("https://smsc.hubtel.com/v1/messages/send", params={
                        "clientid": s.hubtel_client_id, "clientsecret": s.hubtel_client_secret,
                        "from": s.sms_sender_id[:11], "to": n, "content": message})
                    r.raise_for_status()
            else:
                return "failed", f"Unknown SMS_PROVIDER '{s.sms_provider}'"
            r.raise_for_status()
        return "sent", ""
    except httpx.HTTPStatusError as e:
        return "failed", f"{e.response.status_code}: {e.response.text[:300]}"
    except Exception as e:
        return "failed", str(e)[:300]


def _smtp_send(to: str, subject: str, body: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from or s.smtp_user, to, subject
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as server:
        server.starttls()
        if s.smtp_user:
            server.login(s.smtp_user, s.smtp_password)
        server.send_message(msg)


async def send_email(to: str, subject: str, body: str) -> tuple[str, str]:
    s = get_settings()
    if s.email_provider == "mock":
        return "mock", ""
    if s.email_provider != "smtp" or not s.smtp_host:
        return "failed", "Email isn't configured. Set EMAIL_PROVIDER=smtp and the SMTP_* variables."
    try:
        await asyncio.to_thread(_smtp_send, to, subject, body)
        return "sent", ""
    except Exception as e:
        return "failed", str(e)[:300]


async def log(db: AsyncSession, pharmacy_id, channel: str, recipient: str, message: str, status: str, error: str, kind: str, subject: str = ""):
    db.add(NotificationLog(pharmacy_id=pharmacy_id, channel=channel, recipient=recipient, subject=subject,
                           message=message, status=status, error=error, kind=kind))
