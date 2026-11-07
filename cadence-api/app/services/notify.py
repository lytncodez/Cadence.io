"""Alerts (computed from stock) and delivery by SMS and email.

SMS_PROVIDER=mock and EMAIL_PROVIDER=mock (defaults) record messages in notification_log without sending,
so the whole flow can be tested before any accounts are set up."""
import asyncio
import base64
import re
import smtplib
import uuid
from dataclasses import dataclass
from email.message import EmailMessage

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import env_names_like, get_settings
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
    """The daily alert as ONE plain text (160 GSM characters), so it arrives as a single SMS and is billed once."""
    exp = [r for r in s.rows if r.status == "expired"] if ns.on_expired else []
    crit = sorted((r for r in s.rows if r.status == "critical"), key=lambda r: r.days) if ns.on_critical else []
    if not exp and not crit:
        return ""
    head = f"Cadence - {s.pharmacy}:"
    tail = []
    if exp:
        tail.append(f"{len(exp)} expired" + (f" ({gsm_money(sum(r.value for r in exp))})" if finance else "") + ", quarantine today.")
    tail.append("Details in Cadence.")
    # List as many critical batches as fit, most urgent first.
    for shown in range(min(3, len(crit)), -1, -1):
        mid = []
        if crit:
            items = ", ".join(f"{r.name.split()[0]} {r.batch} {r.days}d" for r in crit[:shown])
            more = len(crit) - shown
            mid.append(f"{len(crit)} critical" + (f": {items}" if items else "") + (f" +{more} more" if shown and more else "") + ".")
        text = gsm7(" ".join([head] + mid + tail))
        if len(text) <= SMS_ONE:
            return text
    return gsm7(" ".join([head] + mid + tail))[:SMS_ONE]


def email_body(s: Summary, alerts: list[dict], finance: bool = True, ai_note: str = "", pdf: bool = False) -> tuple[str, str]:
    """The digest email. With pdf=True (the daily digest) the full report is the attached PDF, and the email itself is
    a short cover note."""
    subject = f"Cadence daily report · {s.pharmacy} · {s.counts['critical']} critical, {s.counts['expired']} expired"
    if pdf:
        exp, crit = s.counts["expired"], s.counts["critical"]
        lines = [f"Good morning from Cadence.", "",
                 f"Today's full report for {s.pharmacy} is attached as a PDF. Download it, open it on your phone, or print it for the dispensary.", "",
                 "At a glance:",
                 f"- {exp} expired batch{'es' if exp != 1 else ''} to pull from the shelves",
                 f"- {crit} critical batch{'es' if crit != 1 else ''} to dispense first",
                 f"- {s.counts['soon']} expiring soon",
                 f"- {len(s.low_stock)} product{'s' if len(s.low_stock) != 1 else ''} below the reorder level"]
        if finance:
            lines.append(f"- Usable stock value: {money(s.stock_value)}")
        lines += ["", "The PDF lists every batch with tick boxes, what to reorder, and what to do with expired medicines "
                  "(including Ghana FDA's disposal rules).", "", "Open Cadence to act on these."]
        return subject, "\n".join(lines)
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
    """'+233 24 555 0142, 020 555 0198' -> ['233245550142', '233205550198']. Duplicates are dropped, so a number typed
    twice (or as 024... and +23324...) gets one text."""
    out = []
    for n in re.split(r"[,;\n/]+", raw or ""):
        d = re.sub(r"\D", "", n)
        if not d:
            continue
        if d.startswith("00"):
            d = d[2:]
        if d.startswith("0") and len(d) == 10:
            d = "233" + d[1:]
        elif d.startswith("2330") and len(d) == 13:  # +233 024 ... typed with the leading 0
            d = "233" + d[4:]
        elif len(d) == 9 and not d.startswith("0"):
            d = "233" + d
        out.append(d)
    return list(dict.fromkeys(out))


# ---- SMS length: one SMS is 160 plain (GSM-7) characters. A single symbol outside that set (₵, ·, —, curly quotes,
# emoji) switches the whole text to Unicode, where one SMS holds only 70, so a normal alert arrived as 3-7 separate texts.
SMS_ONE, SMS_MAX = 160, 459  # 459 = 3 joined SMS (153 each)
_GSM = set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà")
_SWAP = {"₵": "GHS ", "·": "-", "•": "-", "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "×": "x", "→": "->",
         "≤": "<=", "≥": ">=", "\u00a0": " ", "\t": " "}


def gsm7(text: str) -> str:
    """Make text plain SMS characters so it isn't billed as Unicode."""
    out = "".join(_SWAP.get(ch, ch) for ch in text)
    out = "".join(ch if ch in _GSM else "" for ch in out)
    return re.sub(r" {2,}", " ", out).strip()


def gsm_money(n: float) -> str:
    return f"GHS {n:,.0f}" if abs(n) >= 100 else f"GHS {n:,.2f}"


async def send_sms(to: list[str], message: str, max_len: int = SMS_MAX) -> tuple[str, str]:
    """Returns (status, error). status: sent | mock | failed. The text is made plain-SMS safe and capped at max_len
    (default 3 joined SMS), and each number gets it once."""
    s = get_settings()
    message = gsm7(message)
    if len(message) > max_len:
        message = message[: max_len - 3].rstrip() + "..."
    to = list(dict.fromkeys(to))
    if s.sms_provider == "mock":
        return "mock", ""
    if problem := sms_problem():
        return "failed", problem
    if not to:
        return "failed", "No valid phone numbers."
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            if s.sms_provider == "africastalking":
                return await _send_africastalking(c, to, message)
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


AT_OK = {100, 101, 102}  # Processed, Sent, Queued


async def _send_africastalking(c: httpx.AsyncClient, to: list[str], message: str) -> tuple[str, str]:
    """Africa's Talking bulk SMS. Numbers go as +233..., comma-separated. The username "sandbox" uses their simulator."""
    s = get_settings()
    sandbox = s.africastalking_username.strip().lower() == "sandbox"
    url = f"https://api.{'sandbox.' if sandbox else ''}africastalking.com/version1/messaging"
    form = {"username": s.africastalking_username.strip(), "to": ",".join("+" + n.lstrip("+") for n in to), "message": message}
    if s.sms_sender_id.strip():
        form["from"] = s.sms_sender_id.strip()[:11]
    r = await c.post(url, data=form, headers={"apiKey": s.africastalking_api_key, "Accept": "application/json"})
    if r.status_code >= 400:
        return "failed", f"{r.status_code}: {r.text[:300]}"
    try:
        data = r.json().get("SMSMessageData", {})
    except ValueError:
        return "failed", f"Unexpected reply from Africa's Talking: {r.text[:300]}"
    recipients = data.get("Recipients") or []
    bad = [f"{x.get('number', '?')}: {x.get('status', 'failed')}" for x in recipients if int(x.get("statusCode", 0) or 0) not in AT_OK]
    if not recipients:  # e.g. "InvalidSenderId" or "Invalid phone numbers" with no recipients at all
        return "failed", str(data.get("Message") or r.text)[:300]
    if bad:
        sent = len(recipients) - len(bad)
        return ("failed" if not sent else "sent"), ("; ".join(bad) + (f" ({sent} of {len(recipients)} sent)" if sent else ""))[:300]
    return "sent", ""


def _sender() -> str:
    s = get_settings()
    return s.email_from or s.smtp_from or s.smtp_user


Attachment = tuple[str, bytes, str]  # (filename, content, mime type)


def _smtp_send(to: str, subject: str, body: str, attachments: list[Attachment] | None = None) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["From"] = f"{s.email_from_name} <{_sender()}>"
    msg["To"], msg["Subject"] = to, subject
    msg.set_content(body)
    for name, data, mime in attachments or []:
        main, _, sub = mime.partition("/")
        msg.add_attachment(data, maintype=main, subtype=sub or "octet-stream", filename=name)
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


async def send_email(to: str, subject: str, body: str, attachments: list[Attachment] | None = None) -> tuple[str, str]:
    """Returns (status, error). status: sent | mock | failed."""
    s = get_settings()
    if s.email_provider == "mock":
        return "mock", ""
    if problem := email_problem():
        return "failed", problem
    try:
        if s.email_provider == "smtp":
            await asyncio.to_thread(_smtp_send, to, subject, body, attachments)
            return "sent", ""
        async with httpx.AsyncClient(timeout=20) as c:
            if s.email_provider == "brevo":
                r = await c.post("https://api.brevo.com/v3/smtp/email",
                                 headers={"api-key": s.brevo_api_key, "accept": "application/json"},
                                 json={"sender": {"name": s.email_from_name, "email": _sender()}, "to": [{"email": to}],
                                       "subject": subject, "textContent": body,
                                       **({"attachment": [{"name": n, "content": base64.b64encode(d).decode()} for n, d, _ in attachments]} if attachments else {})})
            else:  # resend
                r = await c.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {s.resend_api_key}"},
                                 json={"from": f"{s.email_from_name} <{_sender()}>", "to": [to], "subject": subject, "text": body,
                                       **({"attachments": [{"filename": n, "content": base64.b64encode(d).decode()} for n, d, _ in attachments]} if attachments else {})})
            r.raise_for_status()
        return "sent", ""
    except httpx.HTTPStatusError as e:
        return "failed", f"{e.response.status_code}: {e.response.text[:300]}"
    except Exception as e:
        return "failed", str(e)[:300]


def sms_live_detail() -> str:
    s = get_settings()
    name = {"africastalking": "Africa's Talking", "arkesel": "Arkesel", "hubtel": "Hubtel"}.get(s.sms_provider, s.sms_provider)
    if s.sms_provider == "africastalking" and s.africastalking_username.strip().lower() == "sandbox":
        return "Africa's Talking SANDBOX: texts go to the simulator at simulator.africastalking.com, not real phones."
    who = f"as {s.sms_sender_id.strip()!r}" if s.sms_sender_id.strip() else "with the provider's default sender ID"
    return f"Sending {who} via {name}."


SMS_DEMO_DETAIL = "Demo mode: texts are logged, not sent. Set SMS_PROVIDER=africastalking, AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY."


def sms_problem() -> str:
    s = get_settings()
    p = s.sms_provider
    if p == "mock":
        return ""
    if p == "africastalking":
        missing = [n for n, v in (("AFRICASTALKING_USERNAME", s.africastalking_username), ("AFRICASTALKING_API_KEY", s.africastalking_api_key)) if not v]
        if missing:
            seen = env_names_like("AFRICA", "AT_")
            return (f"The server can't see {' or '.join(missing)}. Add {'them' if len(missing) > 1 else 'it'} under Environment on the "
                    "cadence-api service in Render (not the .env file on your computer), then save and redeploy. "
                    "The username is your Africa's Talking app's username (or 'sandbox'); the key is under Settings → API Key. "
                    + (f"Variables it can see: {', '.join(seen)}." if seen else "It can't see any Africa's Talking variables at all."))
        if len(s.sms_sender_id.strip()) > 11:
            return "SMS_SENDER_ID must be at most 11 characters (or blank to use Africa's Talking's default)."
        return ""
    if p == "arkesel" and not s.arkesel_api_key:
        return "Set ARKESEL_API_KEY (Arkesel dashboard → SMS API)."
    if p == "hubtel" and not (s.hubtel_client_id and s.hubtel_client_secret):
        return "Set HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET."
    if p not in {"arkesel", "hubtel"}:
        return f"Unknown SMS_PROVIDER '{p}'. Use africastalking, arkesel or hubtel."
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
