"""AI insights. The analytics service computes every number; this module only decides which view
answers the question ("kind") and phrases a short explanation of facts it is handed.

With AI_PROVIDER=mock (default) the wording comes from templates, so the feature works with no API key.
With anthropic/openai:
  - questions about the pharmacy's figures get the computed FACTS and must not invent figures, but may add general advice;
  - any other question (medicines, regulation, business, general knowledge) is answered from the model's own knowledge."""
import json
import logging

import httpx

from ..config import get_settings
from .analytics import Summary, money

log = logging.getLogger("cadence.ai")

SYSTEM_DATA = (
    "You are Cadence AI, the assistant inside Cadence.io, a pharmacy stock and expiry app used in Ghana. "
    "The user asked about their pharmacy's figures. Every figure about their stock, sales, losses or margins must come from FACTS: "
    "never invent, estimate or recalculate those numbers. Explain what the figures mean in 3 to 6 plain sentences, and you may add "
    "practical, widely accepted pharmacy-management advice (FEFO, supplier returns, reorder habits). Use cedis (₵). "
    "Plain text only: no markdown headings, tables or bullet symbols."
)
SYSTEM_GENERAL = (
    "You are Cadence AI, a knowledgeable assistant inside Cadence.io, a pharmacy stock and expiry app used in Ghana. "
    "Answer any question helpfully and accurately from your own knowledge: medicines and how they're stored, drug classes, "
    "pharmacy practice and regulation in Ghana (Pharmacy Council, FDA Ghana), business, finance, technology or general topics. "
    "Be clear and practical. For dosing or clinical decisions about a specific patient, give general information and advise "
    "checking the product information or a prescriber. If the question is about this pharmacy's own figures, use only FACTS for them. "
    "Plain text with short paragraphs; no markdown headings or tables."
)


def route(message: str, s: Summary) -> str:
    m = message.lower()
    has = lambda *w: any(x in m for x in w)  # noqa: E731
    if has("loss", "losing", "lose", "lost", "expired", "waste", "write"):
        return "losses"
    if has("margin", "profit", "markup"):
        return "margins"
    if has("dashboard", "overview", "snapshot", "status"):
        return "dashboard"
    if has("reorder", "low stock", "restock", "run out", "order"):
        return "reorder"
    if has("report", "summary", "month", "performance", "how did", s.months[-1]["label"].lower()):
        return "report"
    if _product(message, s):
        return "product"
    return "text"


def _product(message: str, s: Summary):
    m = message.lower()
    for p in s.products:
        first = p.name.split()[0].lower()
        if len(first) > 3 and first in m:
            return p
    return None


def facts(kind: str, message: str, s: Summary) -> dict:
    k = s.kpi
    base = {"pharmacy": s.pharmacy, "month": k["month"]}
    if kind == "report":
        top = s.top[0] if s.top else None
        return base | {
            "revenue": money(k["revenue"]), "revenue_change_pct": round(k["revenue_delta"], 1),
            "gross_profit": money(k["profit"]), "margin_pct": round(k["margin"], 1),
            "top_seller": top.name if top else None, "top_seller_units": top.sold if top else 0,
            "expired_value": money(s.value["expired"]), "critical_value": money(s.value["critical"]),
            "critical_window_days": s.critical_days, "products_below_reorder": len(s.low_stock), "has_history": s.has_history,
        }
    if kind == "losses":
        worst = max((r for r in s.rows if r.status == "expired"), key=lambda r: r.value, default=None)
        return base | {
            "expired_batches": s.counts["expired"], "expired_value": money(s.value["expired"]),
            "critical_batches": s.counts["critical"], "critical_value": money(s.value["critical"]),
            "critical_window_days": s.critical_days,
            "largest_loss": f"{worst.name} batch {worst.batch}, {money(worst.value)}" if worst else None,
        }
    if kind == "margins":
        ranked = sorted(s.products, key=lambda p: -p.margin)
        return base | {
            "blended_margin_pct": round(k["margin"], 1),
            "highest": [f"{p.name} {p.margin:.0f}%" for p in ranked[:3]],
            "lowest": [f"{p.name} {p.margin:.0f}%" for p in ranked[-3:]],
        }
    if kind == "dashboard":
        return base | {"batches": len(s.rows), "counts": s.counts, "usable_stock_value": money(s.stock_value),
                       "products": len(s.products), "below_reorder": len(s.low_stock)}
    if kind == "reorder":
        return base | {"below_reorder": [f"{p.name}: {p.usable} usable, reorder at {p.reorder_level}" for p in s.low_stock[:8]]}
    if kind == "product":
        p = _product(message, s)
        b = sorted(p.batches, key=lambda r: r.days)
        first = next((r for r in b if r.status != "expired"), None)
        return base | {"product": p.name, "usable_units": p.usable, "batches": len(b), "sold_this_month": p.sold,
                       "revenue_this_month": money(p.revenue), "margin_pct": round(p.margin, 1),
                       "dispense_first": f"{first.batch}, {first.days} days left" if first else "none usable",
                       "below_reorder": p.usable < p.reorder_level, "reorder_level": p.reorder_level}
    return base


def template(kind: str, f: dict) -> str:
    if kind == "report":
        dir_ = "up" if f["revenue_change_pct"] >= 0 else "down"
        lead = (f"{f['month']} revenue is {f['revenue']}, {dir_} {abs(f['revenue_change_pct'])}% on last month, with a {f['margin_pct']}% margin. "
                if f.get("has_history", True) else f"Sales in {f['pharmacy']} come to {f['revenue']} at a {f['margin_pct']}% margin. ")
        return (lead
                + (f"{f['top_seller']} led sales with {f['top_seller_units']} units. " if f["top_seller"] else "")
                + f"{f['expired_value']} of stock has expired and {f['critical_value']} expires within {f['critical_window_days']} days.")
    if kind == "losses":
        return (f"Expired stock has cost {f['expired_value']} at purchase price across {f['expired_batches']} batches"
                + (f"; the largest is {f['largest_loss']}. " if f["largest_loss"] else ". ")
                + f"Another {f['critical_value']} across {f['critical_batches']} batches expires within {f['critical_window_days']} days, so dispense those first and ask suppliers about returns.")
    if kind == "margins":
        return f"Your blended margin this month is {f['blended_margin_pct']}%. Highest: {', '.join(f['highest'])}. Thinnest: {', '.join(f['lowest'])}."
    if kind == "dashboard":
        c = f["counts"]
        return f"{c['safe']} of {f['batches']} batches are safe and {c['critical'] + c['expired']} need action. Usable stock is worth {f['usable_stock_value']} at cost."
    if kind == "reorder":
        return ("These are below their reorder level: " + "; ".join(f["below_reorder"]) + ".") if f["below_reorder"] else "Every product is above its reorder level."
    if kind == "product":
        return (f"{f['product']}: {f['usable_units']} usable units across {f['batches']} batches. Dispense {f['dispense_first']} first. "
                f"{f['sold_this_month']} sold this month for {f['revenue_this_month']} at a {f['margin_pct']}% margin."
                + (f" Stock is below its reorder level of {f['reorder_level']}." if f["below_reorder"] else ""))
    return ("General questions need the AI service to be connected (set AI_PROVIDER and an API key on the server). "
            "Right now I can answer from your records: ask for a report, where expiry losses come from, margins, "
            "what to reorder, or about a product such as Coartem.")


async def _llm(system: str, question: str, f: dict | None, history: list, max_tokens: int) -> str | None:
    s = get_settings()
    content = question if f is None else f"QUESTION: {question}\nFACTS: {json.dumps(f, ensure_ascii=False, default=str)}"
    turns = [{"role": "user" if h.role == "user" else "assistant", "content": h.text} for h in history[-10:] if h.text.strip()]
    # Providers need the conversation to start with a user turn and alternate.
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    msgs, last = [], None
    for t in turns + [{"role": "user", "content": content}]:
        if last == t["role"]:
            msgs[-1]["content"] += "\n\n" + t["content"]
        else:
            msgs.append(dict(t))
        last = t["role"]
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            if s.ai_provider == "anthropic" and s.anthropic_api_key and s.ai_model:
                r = await client.post("https://api.anthropic.com/v1/messages",
                                      headers={"x-api-key": s.anthropic_api_key, "anthropic-version": "2023-06-01"},
                                      json={"model": s.ai_model, "max_tokens": max_tokens, "system": system, "messages": msgs})
                r.raise_for_status()
                return "".join(b.get("text", "") for b in r.json()["content"]).strip() or None
            if s.ai_provider == "openai" and s.openai_api_key and s.ai_model:
                r = await client.post("https://api.openai.com/v1/chat/completions",
                                      headers={"Authorization": f"Bearer {s.openai_api_key}"},
                                      json={"model": s.ai_model, "max_tokens": max_tokens,
                                            "messages": [{"role": "system", "content": system}] + msgs})
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"].strip() or None
    except Exception as e:  # never let the AI provider break the page; fall back to templates
        log.warning("AI provider failed, using template: %s", e)
    return None


def ai_connected() -> bool:
    s = get_settings()
    return (s.ai_provider == "anthropic" and bool(s.anthropic_api_key and s.ai_model)) or \
           (s.ai_provider == "openai" and bool(s.openai_api_key and s.ai_model))


async def answer(message: str, s: Summary, history: list | None = None) -> dict:
    history = history or []
    kind = route(message, s)
    if kind == "text":
        # Open question: the model answers from its own knowledge, with a light summary of the pharmacy as context.
        context = facts("dashboard", message, s)
        text = await _llm(SYSTEM_GENERAL, message, context, history, 900) or template("text", context)
        return {"kind": "text", "text": text, "facts": context}
    f = facts(kind, message, s)
    # A question that names a product may also ask general things about it (storage, uses), so allow general knowledge there.
    system = SYSTEM_GENERAL if kind == "product" else SYSTEM_DATA
    text = await _llm(system, message, f, history, 700) or template(kind, f)
    return {"kind": "text" if kind == "product" else kind, "text": text, "facts": f}
