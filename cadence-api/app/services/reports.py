"""Scheduled reports for pharmacies: the weekly AI report email and the short "today's priorities" note in the daily digest.

As everywhere in Cadence, every figure comes from the analytics Summary. The AI only words them; when AI is off or fails,
the report is written from a template so it always goes out."""
from datetime import date, timedelta

from . import ai
from .analytics import Summary, money

def _n(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 'es' if word.endswith('ch') else 's'}"


DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

SYSTEM_WEEKLY = (
    "You are Cadence AI, writing the weekly report email for a pharmacy in Ghana that uses Cadence.io to track expiry and stock. "
    "Every figure must come from FACTS: never invent, estimate or recalculate numbers. Write for a busy pharmacy owner: "
    "first a two-sentence summary of how the business is doing, then exactly three numbered priorities for the coming week "
    "(each one line, specific, naming products or batches from FACTS where they help), then one closing sentence. "
    "Use cedis (₵). Plain text only, no markdown symbols other than the numbers 1. 2. 3."
)
SYSTEM_PRIORITIES = (
    "You are Cadence AI. From FACTS about a pharmacy's stock today, write two or three short sentences telling the team what to do "
    "first today, most urgent first. Use only figures in FACTS; never invent numbers. Plain text, no lists or markdown."
)


def weekly_facts(s: Summary) -> dict:
    k = s.kpi
    expired = sorted((r for r in s.rows if r.status == "expired"), key=lambda r: -r.value)
    critical = sorted((r for r in s.rows if r.status == "critical"), key=lambda r: r.days)
    return {
        "pharmacy": s.pharmacy, "month": k["month"],
        "revenue_month_to_date": money(k["revenue"]), "revenue_change_vs_last_month_pct": round(k["revenue_delta"], 1),
        "gross_profit": money(k["profit"]), "margin_pct": round(k["margin"], 1), "has_history": s.has_history,
        "top_sellers": [f"{p.name} ({p.sold} units)" for p in s.top[:3] if p.sold],
        "expired_batches": len(expired), "expired_value": money(s.value["expired"]),
        "largest_expired": [f"{r.name} batch {r.batch}, {r.qty} units, {money(r.value)}" for r in expired[:3]],
        "critical_window_days": s.critical_days, "critical_batches": len(critical), "critical_value": money(s.value["critical"]),
        "dispense_first": [f"{r.name} batch {r.batch}, {r.days} days left, {r.qty} units" for r in critical[:5]],
        "expiring_soon_batches": s.counts["soon"], "usable_stock_value": money(s.stock_value),
        "below_reorder": [f"{p.name}: {p.usable} usable, reorder level {p.reorder_level}" for p in s.low_stock[:5]],
    }


def weekly_template(f: dict) -> str:
    lead = (f"{f['month']} sales so far are {f['revenue_month_to_date']} at a {f['margin_pct']}% margin"
            + (f", {'up' if f['revenue_change_vs_last_month_pct'] >= 0 else 'down'} {abs(f['revenue_change_vs_last_month_pct'])}% on last month. "
               if f["has_history"] else ". ")
            + (f"Top seller: {f['top_sellers'][0]}. " if f["top_sellers"] else ""))
    lead += f"{f['expired_value']} of stock has expired and {f['critical_value']} expires within {f['critical_window_days']} days."
    pr = []
    if f["dispense_first"]:
        pr.append(f"Dispense these first: {'; '.join(f['dispense_first'][:3])}.")
    if f["largest_expired"]:
        pr.append(f"Quarantine and write off expired stock, starting with {f['largest_expired'][0]}. Ask the supplier about returns.")
    if f["below_reorder"]:
        pr.append(f"Reorder: {'; '.join(f['below_reorder'][:3])}.")
    if not pr:
        pr.append("Nothing is expired, critical or below its reorder level. Keep receiving stock with expiry dates.")
    return lead + "\n\n" + "\n".join(f"{i}. {p}" for i, p in enumerate(pr, 1))


def week_label(today: date | None = None) -> str:
    today = today or date.today()
    start = today - timedelta(days=today.weekday())
    return f"week of {start:%d %b %Y}"


async def weekly_report(s: Summary) -> tuple[str, str, bool]:
    """Returns (subject, body, written_by_ai)."""
    f = weekly_facts(s)
    text = await ai._llm(SYSTEM_WEEKLY, "Write this week's report.", f, [], 700)
    used_ai = bool(text)
    text = text or weekly_template(f)
    subject = f"Cadence weekly report · {s.pharmacy} · {week_label()}"
    figures = [
        "THE FIGURES",
        f"Sales this month: {f['revenue_month_to_date']} · margin {f['margin_pct']}%",
        f"Expired: {_n(f['expired_batches'], 'batch')}, {f['expired_value']}",
        f"Critical (within {f['critical_window_days']} days): {_n(f['critical_batches'], 'batch')}, {f['critical_value']}",
        f"Expiring soon: {_n(f['expiring_soon_batches'], 'batch')}",
        f"Below reorder level: {_n(len(s.low_stock), 'product')}",
        f"Usable stock value: {f['usable_stock_value']}",
    ]
    footer = ("Written by Cadence AI from your Cadence figures." if used_ai else "Written by Cadence from your figures.") + \
        " Change who gets this in Cadence → Alerts."
    body = f"Hello from Cadence. Here's {s.pharmacy}'s weekly report.\n\n{text}\n\n" + "\n".join(figures) + f"\n\n{footer}"
    return subject, body, used_ai


async def priorities(s: Summary) -> str:
    """A short AI note for the top of the daily digest. Empty when AI is off or there's nothing to act on."""
    if not ai.ai_connected() or not (s.counts["expired"] or s.counts["critical"] or s.low_stock):
        return ""
    f = weekly_facts(s)
    facts = {k: f[k] for k in ("pharmacy", "expired_batches", "expired_value", "largest_expired", "critical_window_days",
                               "critical_batches", "dispense_first", "below_reorder")}
    return await ai._llm(SYSTEM_PRIORITIES, "What should we do first today?", facts, [], 250) or ""
