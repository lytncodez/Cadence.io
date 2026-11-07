"""AI insights. The analytics service computes every number; this module only decides which view
answers the question ("kind") and phrases a short explanation of facts it is handed.

With AI_PROVIDER=mock (default) the wording comes from templates, so the feature works with no API key.
With anthropic/openai:
  - questions about the pharmacy's figures get the computed FACTS and must not invent figures, but may add general advice;
  - any other question (medicines, regulation, business, general knowledge) is answered from the model's own knowledge."""
import asyncio
from datetime import date, timedelta
import json
import re
import logging

import httpx

from ..config import env_names_like, get_settings
from .analytics import Summary, money

log = logging.getLogger("cadence.ai")

SYSTEM_DATA = (
    "You are Cadence AI, the assistant inside Cadence.io, a pharmacy stock and expiry app used in Ghana. "
    "The user asked about their pharmacy's figures. Every figure about their stock, sales, losses or margins must come from FACTS: "
    "never invent, estimate or recalculate those numbers. Explain what the figures mean in 3 to 6 plain sentences, and you may add "
    "practical, widely accepted pharmacy-management advice (FEFO, supplier returns, reorder habits). Use cedis (₵). "
    "If FACTS hold forecasts, present them as estimates based on recent sales, not certainties. "
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
    if has("predict", "forecast", "projection", "project ", "next month", "trend", "expect", "coming weeks", "coming months",
           "going to sell", "will we", "will i", "future") and s.history and s.history["units"]:
        return "forecast"
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


def forecast(s: Summary, today: date | None = None, top: int = 12) -> list[dict]:
    """Simple, explainable predictions per medicine from the last 30 days of sales: units next 30 days, days of cover,
    run-out date, how the months are trending, and units likely to expire unsold (oldest batches used first)."""
    today = today or date.today()
    h = s.history or {}
    labels, units, last30 = h.get("labels", []), h.get("units", {}), h.get("last30", {})
    out = []
    for p in s.products:
        hist = units.get(p.barcode)
        if not hist or not any(hist):
            continue
        rate = last30.get(p.barcode, 0) / 30
        full = hist[:-1]  # completed months
        trend = "steady"
        if len(full) >= 2 and full[-2] > 0:
            change = (full[-1] - full[-2]) / full[-2] * 100
            trend = f"up {change:.0f}%" if change >= 10 else f"down {abs(change):.0f}%" if change <= -10 else "steady"
        cover = round(p.usable / rate) if rate > 0 else None
        # FEFO: walk usable batches oldest first; whatever can't be sold before its expiry is at risk.
        at_risk, used = 0, 0.0
        for b in sorted((b for b in p.batches if b.days > 0 and b.qty > 0), key=lambda b: b.days):
            can_sell = max(rate * b.days - used, 0)
            sell = min(b.qty, can_sell)
            used += sell
            at_risk += int(b.qty - sell)
        out.append({
            "medicine": p.name, "units_by_month": dict(zip(labels, hist)), "month_so_far_is_partial": True,
            "trend_last_full_months": trend, "selling_per_day": round(rate, 1), "expected_next_30_days": round(rate * 30),
            "usable_stock": p.usable, "days_of_cover": cover,
            "runs_out_around": (today + timedelta(days=cover)).isoformat() if cover is not None else None,
            "reorder_now": cover is not None and cover <= 21, "units_likely_to_expire_unsold": at_risk,
        })
    out.sort(key=lambda f: -sum(f["units_by_month"].values()))
    return out[:top]


def facts(kind: str, message: str, s: Summary) -> dict:
    k = s.kpi
    base = {"pharmacy": s.pharmacy, "month": k["month"]}
    if kind == "forecast":
        f = forecast(s)
        return base | {"method": "Projected from the last 30 days of sales; monthly units are from Cadence's sales records.",
                       "months": (s.history or {}).get("labels", []), "medicines": f,
                       "reorder_soon": [x["medicine"] for x in f if x["reorder_now"]],
                       "expiry_risk": [f"{x['medicine']}: {x['units_likely_to_expire_unsold']} units" for x in f if x["units_likely_to_expire_unsold"]]}
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
    if kind == "forecast":
        meds = f["medicines"]
        if not meds:
            return "There isn't enough sales history yet to predict anything. Import past sales or record sales for a few weeks."
        lines = [f"Based on the last 30 days of sales ({', '.join(f['months'])} history):"]
        for x in meds[:6]:
            cover = f"about {x['days_of_cover']} days of stock, running out around {x['runs_out_around']}" if x["days_of_cover"] is not None else "no recent sales"
            lines.append(f"{x['medicine']}: expect about {x['expected_next_30_days']} units in the next 30 days ({x['trend_last_full_months']}); {cover}.")
        if f["reorder_soon"]:
            lines.append("Reorder soon: " + ", ".join(f["reorder_soon"]) + ".")
        if f["expiry_risk"]:
            lines.append("Likely to expire before it sells: " + "; ".join(f["expiry_risk"]) + ". Ask suppliers about returns now.")
        return " ".join(lines)
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
    return ((f"General questions need Cadence AI, which isn't answering: {last_error} " if last_error else
             "General questions need the AI service to be connected (set AI_PROVIDER and an API key on the server). ")
            + "Right now I can answer from your records: ask for a report, where expiry losses come from, margins, "
            "what to reorder, or about a product such as Coartem.")


_auto_model: dict[str, str] = {}
_backups: dict[str, list[str]] = {}  # other Gemini models to try when one is busy
last_error = ""  # why the most recent AI call fell back to built-in wording (shown to the user)


async def model_id(client: httpx.AsyncClient | None = None) -> str:
    """AI_MODEL if it's set; otherwise the newest suitable model on your account (asked once, then remembered)."""
    s = get_settings()
    if s.ai_model:
        return s.ai_model
    key = f"{s.ai_provider}:{_key()[-6:]}"
    if key in _auto_model:
        return _auto_model[key]
    own = client is None
    client = client or httpx.AsyncClient(timeout=20)
    try:
        if s.ai_provider == "anthropic":
            r = await client.get("https://api.anthropic.com/v1/models?limit=100",
                                 headers={"x-api-key": s.anthropic_api_key, "anthropic-version": "2023-06-01"})
            r.raise_for_status()
            ids = [m["id"] for m in r.json().get("data", [])]  # newest first
            pick = next((i for i in ids if "sonnet" in i), None) or next((i for i in ids if "haiku" in i), None) or (ids[0] if ids else "")
        elif s.ai_provider == "gemini":
            r = await client.get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", headers={"x-goog-api-key": s.gemini_api_key})
            r.raise_for_status()
            skip = ("image", "tts", "audio", "live", "embedding", "thinking", "exp", "preview", "vision", "aqa", "learnlm", "gemma", "robotics", "computer")
            names = [m["name"].removeprefix("models/") for m in r.json().get("models", [])
                     if "generateContent" in (m.get("supportedGenerationMethods") or []) and m["name"].startswith("models/gemini")
                     and not any(w in m["name"] for w in skip)]
            ver = lambda n: [int(x) for x in re.findall(r"\d+", n.split("-")[1] if "-" in n else "0")] or [0]  # noqa: E731
            flash = sorted((n for n in names if "flash" in n and "lite" not in n), key=ver, reverse=True)
            lite = sorted((n for n in names if "flash" in n and "lite" in n), key=ver, reverse=True)
            ordered = flash + lite + [n for n in sorted(names, key=ver, reverse=True) if n not in flash and n not in lite]
            pick = (ordered or [""])[0]
            _backups[key] = ordered[1:6]  # tried in turn when the first is overloaded
        else:
            r = await client.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {s.openai_api_key}"})
            r.raise_for_status()
            skip = ("audio", "realtime", "search", "transcribe", "tts", "image", "instruct", "embedding", "moderation", "codex")
            chat = sorted((m for m in r.json().get("data", []) if m["id"].startswith("gpt-") and not any(w in m["id"] for w in skip)),
                          key=lambda m: m.get("created", 0), reverse=True)
            pick = next((m["id"] for m in chat if m["id"].endswith("-mini")), None) or (chat[0]["id"] if chat else "")
    finally:
        if own:
            await client.aclose()
    if not pick:
        raise RuntimeError("Your AI account didn't list any models. Set AI_MODEL to a model id from your provider's docs.")
    _auto_model[key] = pick
    return pick


async def _call(system: str, msgs: list[dict], max_tokens: int) -> str:
    """One request to the configured provider. Raises on any error."""
    s = get_settings()
    async with httpx.AsyncClient(timeout=45) as client:
        model = await model_id(client)
        if s.ai_provider == "anthropic":
            r = await client.post("https://api.anthropic.com/v1/messages",
                                  headers={"x-api-key": s.anthropic_api_key, "anthropic-version": "2023-06-01"},
                                  json={"model": model, "max_tokens": max_tokens, "system": system, "messages": msgs})
            _raise(r)
            return "".join(b.get("text", "") for b in r.json()["content"]).strip()
        if s.ai_provider == "openai":
            # max_completion_tokens replaces the deprecated max_tokens and works with every current chat model.
            r = await client.post("https://api.openai.com/v1/chat/completions",
                                  headers={"Authorization": f"Bearer {s.openai_api_key}"},
                                  json={"model": model, "max_completion_tokens": max_tokens,
                                        "messages": [{"role": "system", "content": system}] + msgs})
            _raise(r)
            return (r.json()["choices"][0]["message"]["content"] or "").strip()
        if s.ai_provider == "gemini":
            contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in msgs]
            # Newer Gemini models "think" before answering and that counts against the output limit, so leave room for it.
            body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
                    "generationConfig": {"maxOutputTokens": max(max_tokens * 4, 2048)}}
            # Free-tier Gemini is often briefly "experiencing high demand" (503) or rate limited (429): wait and retry,
            # then try the next model down rather than giving up.
            plan = [model, model] + [m for m in _backups.get(f"gemini:{_key()[-6:]}", []) if m != model][:3]
            for i, m in enumerate(plan):
                r = await client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent",
                                      headers={"x-goog-api-key": s.gemini_api_key}, json=body)
                if r.status_code not in (429, 500, 503) or i == len(plan) - 1:
                    break
                await asyncio.sleep(1.5 if i == 0 else 0.5)
            _raise(r)
            data = r.json()
            cands = data.get("candidates") or []
            text = "".join(p.get("text", "") for c in cands[:1] for p in (c.get("content") or {}).get("parts", []) if not p.get("thought"))
            if not text.strip():
                why = (data.get("promptFeedback") or {}).get("blockReason") or (cands[0].get("finishReason") if cands else "no answer")
                raise RuntimeError(f"Gemini gave no text ({why}).")
            return text.strip()
    raise RuntimeError("AI isn't configured.")


def _raise(r: httpx.Response) -> None:
    """Turn provider errors into something an admin can act on."""
    if r.status_code < 400:
        return
    try:
        err = r.json().get("error") or {}
        if isinstance(err, list):  # some Google errors come as a list
            err = err[0] if err else {}
        msg = err.get("message", "") or r.text[:200]
    except ValueError:
        msg = r.text[:200]
    hint = {401: "The API key is wrong or was revoked.", 403: "This key isn't allowed to use that model.",
            404: "That model id doesn't exist on your account. Clear AI_MODEL to let Cadence pick one, or fix the spelling.",
            429: "Rate limit or no credit left on the account. On Gemini's free tier, wait a minute and try again.",
            503: "The AI service is busy right now (this passes). Cadence already retried and tried other models; try again in a few minutes.",
            400: "The provider rejected the request."}.get(r.status_code, "")
    raise RuntimeError(f"{r.status_code}: {hint} {msg}".strip())


async def _llm(system: str, question: str, f: dict | None, history: list, max_tokens: int) -> str | None:
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
    global last_error
    if not ai_connected():
        last_error = ai_problem() or "AI isn't set up on the server: set AI_PROVIDER (anthropic or openai) and its API key on Render."
        return None
    try:
        out = await _call(system, msgs, max_tokens) or None
        last_error = "" if out else "The AI service sent back an empty answer."
        return out
    except Exception as e:  # never let the AI provider break the page; fall back to templates
        log.warning("AI provider failed, using template: %s", e)
        last_error = str(e)[:300] or e.__class__.__name__
    return None


def fallback_note() -> str:
    """One line saying why the built-in answer was used instead of the AI, so it never fails silently."""
    if not last_error:
        return ""
    return f"(Cadence AI isn't answering right now: {last_error} This is the built-in answer instead.)"


def ai_problem() -> str:
    s = get_settings()
    if s.ai_provider == "mock":
        return ""
    if s.ai_provider not in PROVIDERS:
        return f"Unknown AI_PROVIDER '{s.ai_provider}'. Use gemini, anthropic or openai."
    if not _key():
        key, where = PROVIDERS[s.ai_provider]
        seen = [n for n in env_names_like("ANTHROPIC", "OPENAI", "CLAUDE", "GEMINI", "GOOGLE", "API_KEY")
                if not n.startswith(("BREVO", "RESEND", "ARKESEL", "AFRICA"))]
        return f"Set {key} ({where}) on the API service in Render." + (f" The server can see: {', '.join(seen)}." if seen else
                                                                       " The server can't see any AI key at all.")
    return ""


def model_label() -> str:
    s = get_settings()
    return s.ai_model or next(iter(_auto_model.values()), "") or "newest model on your account (AI_MODEL not set)"


async def ping() -> tuple[str, str]:
    """Send a tiny request so admins can check the AI key and model. Returns (status, detail)."""
    s = get_settings()
    if s.ai_provider == "mock":
        return "mock", "AI_PROVIDER is mock: stock questions use built-in wording and general questions are switched off."
    if problem := ai_problem():
        return "failed", problem
    try:
        text = await _call("Reply with exactly: OK", [{"role": "user", "content": "Connection test"}], 10)
        return "sent", f"{s.ai_provider} · {await model_id()} answered: {text[:40]}"
    except httpx.HTTPStatusError as e:
        return "failed", f"{e.response.status_code}: {e.response.text[:300]}"
    except Exception as e:
        return "failed", str(e)[:300]


def ai_connected() -> bool:
    s = get_settings()
    return bool(_key()) and s.ai_provider in PROVIDERS


PROVIDERS = {"anthropic": ("ANTHROPIC_API_KEY", "console.anthropic.com → API keys"),
             "openai": ("OPENAI_API_KEY", "platform.openai.com → API keys"),
             "gemini": ("GEMINI_API_KEY", "aistudio.google.com → Get API key (free tier, no card needed)")}


def _key() -> str:
    s = get_settings()
    return {"anthropic": s.anthropic_api_key, "openai": s.openai_api_key, "gemini": s.gemini_api_key}.get(s.ai_provider, "")


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
    text = await _llm(system, message, f, history, 700)
    if not text:
        note = fallback_note()
        text = template(kind, f) + (f"\n\n{note}" if note and ai_connected() else "")
    return {"kind": "text" if kind in ("product", "forecast") else kind, "text": text, "facts": f}
