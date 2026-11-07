"""Cadence AI for HQ. It only ever sees what HQ itself can see: each pharmacy's name, town, usage counts, status and
open help requests. Never stock, sales, prices, patients, personal details or the text of anyone's AI questions.

facts() and the templates are plain Python so the briefing works (and is testable) with AI switched off."""
import json
import re
from datetime import date, datetime

from . import ai

LABEL = {"active": "Active", "quiet": "Quiet", "at_risk": "At risk", "new": "New", "inactive": "Never used"}
MAX_PHARMACIES = 150  # keeps the prompt a sensible size; the ones needing attention are listed first

SYSTEM_HQ = (
    "You are Cadence AI inside Cadence HQ, the console for the team that runs Cadence.io, a stock and expiry app for pharmacies "
    "in Ghana. FACTS hold usage counts for each pharmacy (status, last activity, people active, features used) and open help "
    "requests. You never see their stock, sales or patients, so don't speculate about them. Every number you mention must come "
    "from FACTS: never invent or estimate figures. Help the team decide who to call, who needs onboarding help, which features "
    "are under-used and how adoption is going. Be specific: name pharmacies and say why. Plain text, short paragraphs; "
    "a short numbered list is fine. No markdown headings, bold or tables."
)
SYSTEM_BRIEF = SYSTEM_HQ + (
    " Write today's HQ briefing: one or two sentences on the overall picture, then up to five numbered actions for the team "
    "today, most important first (urgent help requests, then pharmacies at risk of leaving, then onboarding help for new or "
    "stuck pharmacies, then quick wins such as switching alerts on). End with one sentence on adoption."
)
SYSTEM_DRAFT = (
    "You write announcements from the Cadence team to the pharmacies that use Cadence.io in Ghana. Friendly, clear, short, "
    "and practical, in plain British English. Do not invent dates, prices, features or figures that aren't in the NOTES. "
    'Reply with JSON only: {"title": "<under 80 characters>", "message": "<the email/in-app text, 2-5 short paragraphs, '
    'no greeting line and no signature>", "sms": "<one SMS under 300 characters, starting with Cadence:>"}'
)


def _days_ago(stamp: str, today: date) -> int | None:
    if not stamp:
        return None
    try:
        return (today - datetime.fromisoformat(stamp[:16]).date()).days
    except ValueError:
        return None


def facts(rows: list[dict], today: date | None = None) -> dict:
    """rows: PharmacyRow.model_dump() dicts from routers/hq.py."""
    today = today or date.today()
    out = []
    for r in rows:
        f = r.get("features_month", {})
        out.append({
            "name": r["name"], "town": r.get("location", ""), "status": LABEL.get(r["health"], r["health"]),
            "joined_days_ago": _days_ago(r.get("joined", ""), today), "last_active_days_ago": _days_ago(r.get("last_active", ""), today),
            "people_active_7d": f"{r.get('active_users_week', 0)} of {r.get('staff', 0)}", "days_used_30d": r.get("active_days_month", 0),
            "logins_30d": f.get("login", 0), "ai_questions_30d": f.get("ai_question", 0), "batches_added_30d": f.get("item_added", 0),
            "rows_imported_30d": f.get("import", 0), "invites_30d": f.get("invite", 0),
            "open_help_requests": r.get("open_tickets", 0), "urgent_help_requests": r.get("urgent_open", 0),
            "sms_alerts_on": bool(r.get("sms_on")), "email_alerts_on": bool(r.get("email_on")),
        })
    urgency = {"At risk": 1, "Never used": 2, "Quiet": 3, "New": 4, "Active": 5}
    out.sort(key=lambda p: (-p["urgent_help_requests"], -p["open_help_requests"], urgency.get(p["status"], 9), p["name"]))
    by_status: dict[str, int] = {}
    for p in out:
        by_status[p["status"]] = by_status.get(p["status"], 0) + 1
    stuck = [p["name"] for p in out if p["status"] in ("New", "Active", "Quiet") and not p["batches_added_30d"] and not p["rows_imported_30d"]]
    return {
        "date": today.isoformat(),
        "pharmacies": len(out), "by_status": by_status,
        "active_this_week": sum(1 for r in rows if r.get("active_users_week", 0) > 0),
        "people": sum(r.get("staff", 0) for r in rows),
        "open_help_requests": sum(p["open_help_requests"] for p in out), "urgent_help_requests": sum(p["urgent_help_requests"] for p in out),
        "urgent_help_at": [p["name"] for p in out if p["urgent_help_requests"]],
        "at_risk_or_never_used": [f"{p['name']} ({p['status']}, last active {_ago(p['last_active_days_ago'])})"
                                  for p in out if p["status"] in ("At risk", "Never used")],
        "new_pharmacies": [p["name"] for p in out if p["status"] == "New"],
        "no_stock_added_30d": stuck,
        "alerts_off": [p["name"] for p in out if not p["sms_alerts_on"] and not p["email_alerts_on"] and p["status"] != "Never used"],
        "not_using_ai": [p["name"] for p in out if p["status"] == "Active" and not p["ai_questions_30d"]],
        "most_engaged": [f"{p['name']} ({p['days_used_30d']} day{'s' if p['days_used_30d'] != 1 else ''} used)" for p in sorted(out, key=lambda p: -p["days_used_30d"])[:3] if p["days_used_30d"]],
        "pharmacy_list": out[:MAX_PHARMACIES],
    }


def _ago(d: int | None) -> str:
    return "never" if d is None else "today" if d <= 0 else "yesterday" if d == 1 else f"{d} days ago"


def _names(xs: list[str], n: int = 4) -> str:
    return ", ".join(xs[:n]) + (f" and {len(xs) - n} more" if len(xs) > n else "")


def template_briefing(f: dict) -> str:
    if not f["pharmacies"]:
        return "No pharmacies have signed up yet. Share the website and follow up on demo requests."
    lead = (f"{f['active_this_week']} of {f['pharmacies']} pharmacies used Cadence this week, with {f['people']} people in total. "
            f"{f['open_help_requests']} help request{'s are' if f['open_help_requests'] != 1 else ' is'} open"
            + (f", {f['urgent_help_requests']} urgent." if f["urgent_help_requests"] else "."))
    acts = []
    if f["urgent_help_at"]:
        acts.append(f"Call {_names(f['urgent_help_at'])} about their urgent help request.")
    if f["at_risk_or_never_used"]:
        acts.append(f"Check in with {_names(f['at_risk_or_never_used'], 3)}: they've gone quiet.")
    if f["no_stock_added_30d"]:
        acts.append(f"Offer import help to {_names(f['no_stock_added_30d'])}: no stock added in 30 days. The CSV/Excel templates make it quick.")
    if f["new_pharmacies"]:
        acts.append(f"Welcome call for {_names(f['new_pharmacies'])}.")
    if f["alerts_off"]:
        acts.append(f"Help {_names(f['alerts_off'])} switch on SMS or email alerts.")
    if not acts:
        acts.append("Nothing needs chasing today. A good day to follow up demo requests.")
    tail = f"Most engaged: {_names(f['most_engaged'], 3)}." if f["most_engaged"] else ""
    return lead + "\n\n" + "\n".join(f"{i}. {a}" for i, a in enumerate(acts[:5], 1)) + (f"\n\n{tail}" if tail else "")


async def briefing(rows: list[dict]) -> dict:
    f = facts(rows)
    text = await ai._llm(SYSTEM_BRIEF, "Write today's briefing.", f, [], 700)
    return {"text": text or template_briefing(f), "ai": bool(text), "facts": f}


async def chat(message: str, rows: list[dict], history: list) -> dict:
    f = facts(rows)
    text = await ai._llm(SYSTEM_HQ, message, f, history, 800)
    if text:
        return {"text": text, "ai": True}
    why = ai.last_error or "AI isn't set up on the server (AI_PROVIDER and its API key)."
    note = f"Cadence AI couldn't answer that: {why} Check HQ → System → AI. Here's today's briefing instead."
    return {"text": note + "\n\n" + template_briefing(f), "ai": False}


def _template_draft(notes: str) -> dict:
    clean = re.sub(r"\s+", " ", notes).strip()
    first = re.split(r"(?<=[.!?])\s", clean, maxsplit=1)[0]
    title = (first[:77] + "…") if len(first) > 78 else first
    sms = f"Cadence: {clean}"
    return {"title": title or "News from Cadence", "message": notes.strip(), "sms": sms[:297] + "…" if len(sms) > 300 else sms}


async def draft(notes: str, audience: str) -> dict:
    """Turn rough notes into a title, message and SMS. Without AI, tidies the notes into the same shape."""
    text = await ai._llm(SYSTEM_DRAFT, f"NOTES: {notes}\nAUDIENCE: {audience}", None, [], 700)
    if text:
        m = re.search(r"\{.*\}", text, re.S)
        try:
            d = json.loads(m.group(0)) if m else {}
            if d.get("title") and d.get("message"):
                sms = str(d.get("sms") or "")[:300]
                return {"title": str(d["title"])[:160], "message": str(d["message"]), "sms": sms, "ai": True}
        except (json.JSONDecodeError, AttributeError):
            pass
    return _template_draft(notes) | {"ai": False}
