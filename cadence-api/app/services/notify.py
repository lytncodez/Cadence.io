"""Alerts (computed from stock) and delivery by SMS and email.

SMS_PROVIDER=mock and EMAIL_PROVIDER=mock (defaults) record messages in notification_log without sending,
so the whole flow can be tested before any accounts are set up."""
import asyncio
import re
import smtplib
import uuid
from dataclasses import dataclass
from email.message import EmailMessage

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import HqDelivery, NotificationLog, NotificationSettings, Role, User
from .analytics import Summary, money


def compute_alerts(s: Summary, ns: NotificationSettings, finance: bool = True) -> list[dict]:
    """Same rules as the web app: expired + critical batches, optional expiring-soon, low stock.
    finance=False leaves money out of the wording (for roles without view_finance)."""
    out = []
    for r in s.rows:
        if r.status == "expired" or r.status == "critical" or (r.status == "soon" and ns.on_soon):
            text = ((f"Batch {r.batch} expired {r.expiry:%d %b %Y}. Quarantine {r.qty} units ({money(r.value)} at cost) and record the write-off."
                     if finance else f"Batch {r.batch} expired {r.expiry:%d %b %Y}. Quarantine {r.qty} units and tell the pharmacist.")
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


def sms_text(s: Summary, ns: NotificationSettings, finance: bool = True) -> str:
    exp = [r for r in s.rows if r.status == "expired"] if ns.on_expired else []
    crit = [r for r in s.rows if r.status == "critical"] if ns.on_critical else []
    if not exp and not crit:
        return ""
    parts = [f"Cadence · {s.pharmacy}"]
    if crit:
        first = ", ".join(f"{r.name.split()[0]} {r.batch} ({r.days}d)" for r in crit[:3])
        parts.append(f"{len(crit)} critical: {first}{' +more' if len(crit) > 3 else ''}.")
    if exp:
        parts.append(f"{len(exp)} expired" + (f" ({money(sum(r.value for r in exp))})" if finance else "") + ". Quarantine today.")
    return " ".join(parts)[:459]  # 3 SMS segments


def email_body(s: Summary, alerts: list[dict], finance: bool = True, ai_note: str = "") -> tuple[str, str]:
    subject = f"Cadence daily digest · {s.counts['critical']} critical, {s.counts['expired']} expired"
    lines = [f"Good morning from Cadence. Here's {s.pharmacy} today.", ""]
    if ai_note:
        lines += ["TODAY'S PRIORITIES (Cadence AI)", ai_note, ""]
    for a in alerts:
        lines.append(f"[{a['status'].upper()}] {a['title']}: {a['text']}")
    if not alerts:
        lines.append("Nothing needs attention today.")
    lines += [""] + ([f"Usable stock value: {money(s.stock_value)}."] if finance else []) + ["Open Cadence to act on these."]
    return subject, "\n".join(lines)


@dataclass
class Recipient:
    address: str  # phone number (digits) or email
    finance: bool  # may this person see money figures?
    name: str = ""


async def recipients(db: AsyncSession, ns: NotificationSettings, pharmacy_id) -> tuple[list[Recipient], list[Recipient]]:
    """Who gets this pharmacy's alerts: the numbers and address typed into Alerts, plus chosen team members
    (using the phone and email on their profile). People whose role can't see finance get wording without money."""
    sms = [Recipient(n, True) for n in numbers(ns.sms_numbers)]
    emails = [Recipient(ns.email.strip(), True)] if ns.email and ns.email.strip() else []
    wanted = {str(i) for i in (ns.sms_user_ids or []) + (ns.email_user_ids or [])}
    if wanted:
        ids = []
        for i in wanted:
            try:
                ids.append(uuid.UUID(i))
            except ValueError:
                continue
        users = (await db.scalars(select(User).where(User.pharmacy_id == pharmacy_id, User.id.in_(ids), User.status == "Active"))).all() if ids else []
        roles = {r.name: set(r.perms or []) for r in (await db.scalars(select(Role).where(Role.pharmacy_id == pharmacy_id))).all()}
        for u in users:
            fin = "view_finance" in roles.get(u.role, set())
            if str(u.id) in {str(i) for i in ns.sms_user_ids or []}:
                sms += [Recipient(n, fin, u.name) for n in numbers(u.phone)]
            if str(u.id) in {str(i) for i in ns.email_user_ids or []} and u.email:
                emails.append(Recipient(u.email, fin, u.name))

    def dedupe(rs: list[Recipient]) -> list[Recipient]:
        seen: dict[str, Recipient] = {}
        for r in rs:
            k = r.address.lower()
            # If the same address is listed twice, the stricter (no-finance) version wins.
            seen[k] = r if k not in seen else Recipient(r.address, seen[k].finance and r.finance, seen[k].name or r.name)
        return list(seen.values())
    return dedupe(sms), dedupe(emails)


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
    if problem := sms_problem():
        return "failed", problem
    if not to:
        return "failed", "No valid phone numbers."
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            if s.sms_provider == "arkesel":
                r = await c.post("https://sms.arkesel.com/api/v2/sms/send", headers={"api-key": s.arkesel_api_key},
                                 json={"sender": s.sms_sender_id[:11], "message": message, "recipients": to})
                r.raise_for_status()
                body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
                if str(body.get("status", "success")).lower() not in {"success", "ok"}:
                    return "failed", str(body.get("message") or body)[:300]
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


def _sender() -> str:
    s = get_settings()
    return s.email_from or s.smtp_from or s.smtp_user


def _smtp_send(to: str, subject: str, body: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["From"] = f"{s.email_from_name} <{_sender()}>"
    msg["To"], msg["Subject"] = to, subject
    msg.set_content(body)
    if s.smtp_port == 465:  # implicit TLS
        with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=20) as server:
            if s.smtp_user:
                server.login(s.smtp_user, s.smtp_password)
            server.send_message(msg)
        return
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as server:
        server.starttls()
        if s.smtp_user:
            server.login(s.smtp_user, s.smtp_password)
        server.send_message(msg)


def email_problem() -> str:
    """Why email can't be sent with the current settings, or '' if it's configured."""
    s = get_settings()
    p = s.email_provider
    if p == "mock":
        return ""
    if p not in {"brevo", "resend", "smtp"}:
        return f"Unknown EMAIL_PROVIDER '{p}'. Use brevo, resend or smtp."
    if not _sender():
        return "Set EMAIL_FROM to the sender address you verified with your email provider."
    if p == "brevo" and not s.brevo_api_key:
        return "Set BREVO_API_KEY (Brevo → SMTP & API → API keys)."
    if p == "resend" and not s.resend_api_key:
        return "Set RESEND_API_KEY (resend.com → API Keys)."
    if p == "smtp" and not s.smtp_host:
        return "Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD."
    return ""


async def send_email(to: str, subject: str, body: str) -> tuple[str, str]:
    """Returns (status, error). status: sent | mock | failed."""
    s = get_settings()
    if s.email_provider == "mock":
        return "mock", ""
    if problem := email_problem():
        return "failed", problem
    try:
        if s.email_provider == "smtp":
            await asyncio.to_thread(_smtp_send, to, subject, body)
            return "sent", ""
        async with httpx.AsyncClient(timeout=20) as c:
            if s.email_provider == "brevo":
                r = await c.post("https://api.brevo.com/v3/smtp/email",
                                 headers={"api-key": s.brevo_api_key, "accept": "application/json"},
                                 json={"sender": {"name": s.email_from_name, "email": _sender()}, "to": [{"email": to}],
                                       "subject": subject, "textContent": body})
            else:  # resend
                r = await c.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {s.resend_api_key}"},
                                 json={"from": f"{s.email_from_name} <{_sender()}>", "to": [to], "subject": subject, "text": body})
            r.raise_for_status()
        return "sent", ""
    except httpx.HTTPStatusError as e:
        return "failed", f"{e.response.status_code}: {e.response.text[:300]}"
    except Exception as e:
        return "failed", str(e)[:300]


def sms_problem() -> str:
    s = get_settings()
    p = s.sms_provider
    if p == "mock":
        return ""
    if p == "arkesel" and not s.arkesel_api_key:
        return "Set ARKESEL_API_KEY (Arkesel dashboard → SMS API)."
    if p == "hubtel" and not (s.hubtel_client_id and s.hubtel_client_secret):
        return "Set HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET."
    if p not in {"arkesel", "hubtel"}:
        return f"Unknown SMS_PROVIDER '{p}'. Use arkesel or hubtel."
    if not s.sms_sender_id or len(s.sms_sender_id) > 11:
        return "SMS_SENDER_ID must be 1–11 characters and approved by your SMS provider."
    return ""


async def log(db: AsyncSession, pharmacy_id, channel: str, recipient: str, message: str, status: str, error: str, kind: str, subject: str = ""):
    db.add(NotificationLog(pharmacy_id=pharmacy_id, channel=channel, recipient=recipient, subject=subject,
                           message=message, status=status, error=error, kind=kind))


def hq_log(db: AsyncSession, channel: str, recipient: str, message: str, status: str, error: str, kind: str, subject: str = "") -> None:
    """Record a message HQ sent (tests, HQ digest, help-request alerts, broadcasts, replies). The caller commits."""
    db.add(HqDelivery(channel=channel, recipient=recipient[:2000], subject=subject[:200], message=message[:8000],
                      status=status, error=error[:2000], kind=kind))
