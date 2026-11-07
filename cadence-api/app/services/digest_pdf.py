"""The daily report as a printable A4 PDF.

It's attached to every daily digest email and can be opened from Alerts → Daily report PDF. It's made to be printed
and used in the dispensary: tick boxes beside every batch, a sign-off box, what to reorder, and a page on what to do
with expired medicines, including Ghana FDA's rules for disposing of them.

Every figure comes from the analytics Summary, like the rest of Cadence. People whose role can't see finance get the
same report with no money in it (finance=False)."""
from __future__ import annotations

import io
from html import escape as e
from math import ceil
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (CondPageBreak, Flowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)

from .analytics import Row, Summary, money

# ---------------------------------------------------------------- look
FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_fonts_ready = False


def _fonts() -> tuple[str, str]:
    """Carlito (bundled, SIL OFL) has the cedi sign ₵, which the built-in PDF fonts don't. Falls back to Helvetica."""
    global _fonts_ready
    if not _fonts_ready:
        try:
            pdfmetrics.registerFont(TTFont("L", str(FONT_DIR / "Carlito-Regular.ttf")))
            pdfmetrics.registerFont(TTFont("L-B", str(FONT_DIR / "Carlito-Bold.ttf")))
            pdfmetrics.registerFontFamily("L", normal="L", bold="L-B")
            _fonts_ready = True
        except Exception:
            return "Helvetica", "Helvetica-Bold"
    return "L", "L-B"


INK, INK2, LINE, CARD = colors.HexColor("#0b1220"), colors.HexColor("#5a6577"), colors.HexColor("#d9dee6"), colors.HexColor("#f1f4f8")
SKY, LIME = colors.HexColor("#1673e6"), colors.HexColor("#d9f86b")
CRIT, CRIT_BG = colors.HexColor("#c0392b"), colors.HexColor("#fdecea")
SOON, SOON_BG = colors.HexColor("#a8650c"), colors.HexColor("#fff4e0")
SAFE, SAFE_BG = colors.HexColor("#16865a"), colors.HexColor("#e6f6ee")
RET, RET_BG = colors.HexColor("#1257a8"), colors.HexColor("#e7f0fc")

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
WIDTH = PAGE_W - 2 * MARGIN
NUMERIC = {"Units", "At cost", "Days left", "Usable now", "Reorder level", "Dispensed this month", "Suggested order"}


def _styles(f: str, b: str) -> dict[str, ParagraphStyle]:
    base = ParagraphStyle("base", fontName=f, fontSize=9.5, leading=12.5, textColor=INK)
    return {
        "base": base,
        "small": ParagraphStyle("small", parent=base, fontSize=8, leading=10, textColor=INK2),
        "cell": ParagraphStyle("cell", parent=base, fontSize=8.6, leading=10.6),
        "cellb": ParagraphStyle("cellb", parent=base, fontName=b, fontSize=8.6, leading=10.6),
        "cellr": ParagraphStyle("cellr", parent=base, fontSize=8.6, leading=10.6, alignment=TA_RIGHT),
        "head": ParagraphStyle("head", parent=base, fontName=b, fontSize=7.6, leading=9, textColor=INK2),
        "headr": ParagraphStyle("headr", parent=base, fontName=b, fontSize=7.6, leading=9, textColor=INK2, alignment=TA_RIGHT),
        "h1": ParagraphStyle("h1", parent=base, fontName=b, fontSize=22, leading=26),
        "h2": ParagraphStyle("h2", parent=base, fontName=b, fontSize=13.5, leading=17, spaceBefore=4, spaceAfter=3),
        "h3": ParagraphStyle("h3", parent=base, fontName=b, fontSize=10.5, leading=13.5, spaceBefore=6, spaceAfter=2),
        "lead": ParagraphStyle("lead", parent=base, fontSize=10.5, leading=14.5, textColor=INK2),
        "kpi": ParagraphStyle("kpi", parent=base, fontName=b, fontSize=17, leading=20),
        "kpil": ParagraphStyle("kpil", parent=base, fontSize=7.8, leading=9.6, textColor=INK2),
        "bullet": ParagraphStyle("bullet", parent=base, leftIndent=11, bulletIndent=1, spaceAfter=2.5),
    }


class TickBox(Flowable):
    """An empty square to tick with a pen."""
    def __init__(self, size: float = 9):
        super().__init__()
        self.size = size
        self.width = self.height = size

    def draw(self):
        self.canv.setStrokeColor(INK)
        self.canv.setLineWidth(0.8)
        self.canv.rect(0, 0, self.size, self.size)


class Band(Flowable):
    """A coloured strip with a section number and title."""
    def __init__(self, num: str, title: str, color, font: str):
        super().__init__()
        self.num, self.title, self.color, self.font = num, title, color, font
        self.width, self.height = WIDTH, 22

    def draw(self):
        c = self.canv
        c.setFillColor(self.color)
        c.roundRect(0, 0, self.width, self.height, 5, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont(self.font, 8.5)
        c.drawString(9, 7.2, self.num)
        c.setFont(self.font, 11.5)
        c.drawString(30, 6.6, self.title)


# ---------------------------------------------------------------- content
@dataclass
class DigestContext:
    location: str = ""
    licence_no: str = ""
    finance: bool = True
    ai_note: str = ""
    recipient: str = ""


def _why_expired(r: Row, s: Summary) -> str:
    """A likely reason this batch ran out of time, from this month's dispensing of the product."""
    prod = next((p for p in s.products if p.name == r.name), None)
    sold = prod.sold if prod else 0
    if sold == 0:
        return "Nothing dispensed this month: stop reordering it, or order much smaller quantities."
    if r.qty > sold:
        return f"Overstocked: {r.qty} left against {sold} dispensed this month. Order less."
    return "Was moving, but this batch wasn't used first (FEFO)."


def _critical_action(r: Row, s: Summary, today: date) -> str:
    """Will this batch be dispensed before it expires, at this month's rate for the medicine?"""
    prod = next((p for p in s.products if p.name == r.name), None)
    rate = (prod.sold if prod else 0) / max(today.day, 7)  # a day's dispensing, steadied early in the month
    if rate * max(r.days, 0) < r.qty:
        likely = int(rate * max(r.days, 0))
        return (f"Unlikely to be used in time (about {likely} of {r.qty} at the current rate). "
                f"Ask {e(r.supplier or 'the supplier')} about a return or swap now.")
    return "Dispense first. On track to be used in time."


def _table(data: list[list], widths: list[float], header_bg=CARD, zebra=True, extra: list | None = None) -> Table:
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINE),
    ]
    if zebra:
        for i in range(2, len(data), 2):
            style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fafbfd")))
    t.setStyle(TableStyle(style + (extra or [])))
    return t


def _fit(widths: list[float]) -> list[float]:
    """Stretch the widest text column so a table always spans the page."""
    i = max(range(len(widths)), key=lambda k: widths[k])
    widths[i] += WIDTH - sum(widths)
    return widths


def build_pdf(s: Summary, ctx: DigestContext, today: date | None = None, now: datetime | None = None) -> bytes:
    f, b = _fonts()
    st = _styles(f, b)
    today = today or date.today()
    now = now or datetime.now()
    P = lambda text, style="cell": Paragraph(text, st[style])  # noqa: E731
    H = lambda h: P(h, "headr" if h in NUMERIC else "head")  # noqa: E731
    fin = ctx.finance
    plural = lambda n, w, ws=None: f"{n} {w if n == 1 else (ws or w + 's')}"  # noqa: E731

    expired = sorted((r for r in s.rows if r.status == "expired" and r.qty > 0), key=lambda r: (-r.value, r.days))
    critical = sorted((r for r in s.rows if r.status == "critical" and r.qty > 0), key=lambda r: r.days)
    soon = sorted((r for r in s.rows if r.status == "soon" and r.qty > 0), key=lambda r: ((r.supplier or "~").lower(), r.days))
    low = s.low_stock
    exp_units, crit_units, soon_units = sum(r.qty for r in expired), sum(r.qty for r in critical), sum(r.qty for r in soon)
    exp_value, crit_value, soon_value = sum(r.value for r in expired), sum(r.value for r in critical), sum(r.value for r in soon)

    story: list = [
        Table([[P("<font color='#1673e6'><b>CADENCE</b></font>", "small"), P(f"{today:%A %d %B %Y} · made {now:%H:%M}", "small")]],
              colWidths=[WIDTH / 2, WIDTH / 2], style=[("ALIGN", (1, 0), (1, 0), "RIGHT"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]),
        Spacer(1, 6),
        P("Daily stock report", "h1"),
        P(" · ".join(e(x) for x in [s.pharmacy, ctx.location, f"Licence {ctx.licence_no}" if ctx.licence_no else ""] if x), "lead"),
        Spacer(1, 10),
    ]

    # ---------- at a glance
    def kpi(value: str, label: str, color=INK, bg=CARD):
        return Table([[Paragraph(f"<font color='{color.hexval().replace('0x', '#')}'>{value}</font>", st["kpi"])], [P(label, "kpil")]],
                     colWidths=[WIDTH / 4 - 4], style=[("BACKGROUND", (0, 0), (-1, -1), bg), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                                        ("TOPPADDING", (0, 0), (0, 0), 7), ("BOTTOMPADDING", (0, -1), (-1, -1), 7)])
    tiles = [
        kpi(str(len(expired)), f"expired batches · {exp_units} units" + (f" · {money(exp_value)} at cost" if fin else ""), CRIT, CRIT_BG),
        kpi(str(len(critical)), f"critical (≤ {s.critical_days} days) · {crit_units} units" + (f" · {money(crit_value)}" if fin else ""), SOON, SOON_BG),
        kpi(str(len(soon)), f"expiring soon (≤ {s.soon_days} days) · {soon_units} units", RET, RET_BG),
        kpi(str(len(low)), "products below reorder level", INK, CARD),
    ]
    story.append(Table([tiles], colWidths=[WIDTH / 4] * 4, style=[("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    if fin:
        story += [Spacer(1, 5), P(f"Usable stock on hand: <b>{money(s.stock_value)}</b> at cost. "
                                  f"Already lost to expiry: <b>{money(exp_value)}</b>. At risk in the next {s.soon_days} days: "
                                  f"<b>{money(crit_value + soon_value)}</b>.", "small")]
    story.append(Spacer(1, 12))

    # ---------- priorities
    pri = []
    if expired:
        pri.append(f"<b>Pull {plural(exp_units, 'expired unit')}</b> ({plural(len(expired), 'batch', 'batches')}) off the shelves before opening, "
                   f"starting with {e(expired[0].name)} batch {e(expired[0].batch)}. Quarantine them and record them.")
    if critical:
        c = critical[0]
        pri.append(f"<b>Dispense {plural(len(critical), 'critical batch', 'critical batches')} first.</b> Most urgent: {e(c.name)} batch {e(c.batch)}, "
                   f"{c.qty} units, {plural(c.days, 'day')} left. Move them to the front of the shelf.")
    stuck = [r for r in critical if "Unlikely" in _critical_action(r, s, today)]
    if stuck:
        pri.append(f"<b>Call suppliers today</b> about {plural(len(stuck), 'batch', 'batches')} unlikely to be dispensed in time. "
                   "Ask for a return, credit or swap while there's still life on them.")
    if low:
        pri.append(f"<b>Reorder {plural(len(low), 'product')}</b> below the reorder level, led by {e(low[0].name)}.")
    if not pri:
        pri.append("Nothing is expired, critical or below its reorder level. Keep checking expiry dates on every delivery.")
    story.append(P("Today's priorities", "h2"))
    if ctx.ai_note:
        story += [Table([[P(f"<b>Cadence AI:</b> {e(ctx.ai_note)}")]], colWidths=[WIDTH],
                        style=[("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f4fbdf")), ("LEFTPADDING", (0, 0), (-1, -1), 9),
                               ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7), ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor("#8db32a"))]),
                  Spacer(1, 5)]
    for i, t in enumerate(pri, 1):
        story.append(Paragraph(t, st["bullet"], bulletText=f"{i}."))
    story.append(Spacer(1, 10))

    # ---------- 01 expired
    story += [CondPageBreak(60 * mm), Band("01", "Expired: pull from the shelf today", CRIT, b), Spacer(1, 6)]
    if expired:
        story += [P("Never dispense, sell or give away any of these. Tick each line as it comes off the shelf.", "small"), Spacer(1, 4)]
        head = ["", "Medicine", "Batch", "Expired", "Units"] + (["At cost"] if fin else []) + ["Supplier", "Likely cause"]
        rows = [[H(h) for h in head]]
        for r in expired:
            rows.append([TickBox(), P(f"<b>{e(r.name)}</b><br/><font size='7.4' color='#5a6577'>{e(r.category)}</font>"), P(e(r.batch)),
                         P(f"{r.expiry:%d %b %Y}<br/><font size='7.4' color='#c0392b'>{'today' if r.days == 0 else plural(abs(r.days), 'day') + ' ago'}</font>"),
                         P(str(r.qty), "cellr")] + ([P(money(r.value), "cellr")] if fin else []) + [P(e(r.supplier or "—")), P(_why_expired(r, s), "small")])
        rows.append(["", P("<b>Total</b>"), "", "", P(f"<b>{exp_units}</b>", "cellr")] + ([P(f"<b>{money(exp_value)}</b>", "cellr")] if fin else []) + ["", ""])
        widths = [14, 100, 46, 56, 30] + ([46] if fin else []) + [64, 130]
        story += [_table(rows, _fit(widths), extra=[("BACKGROUND", (0, -1), (-1, -1), CRIT_BG)]), Spacer(1, 8),
                  _signoff(st, ["Pulled by", "Date / time", "Checked by (pharmacist)"])]
    else:
        story.append(P("Nothing has expired. Well done.", "base"))
    story.append(Spacer(1, 12))

    # ---------- 02 critical
    story += [CondPageBreak(50 * mm), Band("02", f"Critical: dispense first (within {s.critical_days} days)", SOON, b), Spacer(1, 6)]
    if critical:
        story += [P("Move these to the front so they're picked first (first expiry, first out). Where a batch won't be used in time, "
                    "contact the supplier now: returns are easiest while there's still time left on the medicine.", "small"), Spacer(1, 4)]
        head = ["", "Medicine", "Batch", "Expires", "Days left", "Units"] + (["At cost"] if fin else []) + ["What to do"]
        rows = [[H(h) for h in head]]
        for r in critical:
            rows.append([TickBox(), P(f"<b>{e(r.name)}</b>"), P(e(r.batch)), P(f"{r.expiry:%d %b %Y}"),
                         P(f"<font color='{'#c0392b' if r.days <= 7 else '#a8650c'}'><b>{r.days}</b></font>", "cellr"), P(str(r.qty), "cellr")]
                        + ([P(money(r.value), "cellr")] if fin else []) + [P(_critical_action(r, s, today), "small")])
        story.append(_table(rows, _fit([14, 110, 46, 54, 36, 30] + ([46] if fin else []) + [130])))
    else:
        story.append(P(f"Nothing expires within {s.critical_days} days.", "base"))
    story.append(Spacer(1, 12))

    # ---------- 03 soon
    story += [CondPageBreak(45 * mm), Band("03", f"Expiring soon: plan ahead (within {s.soon_days} days)", RET, b), Spacer(1, 6)]
    if soon:
        story += [P("Grouped by supplier, so one call covers several batches. Check these are at the front, and slow down reorders "
                    "of anything that won't be used before it expires.", "small"), Spacer(1, 4)]
        head = ["Supplier", "Medicine", "Batch", "Expires", "Days left", "Units"] + (["At cost"] if fin else [])
        rows = [[H(h) for h in head]]
        for r in soon[:30]:
            rows.append([P(f"<b>{e(r.supplier or 'Not recorded')}</b>"), P(e(r.name)), P(e(r.batch)), P(f"{r.expiry:%d %b %Y}"), P(str(r.days), "cellr"),
                         P(str(r.qty), "cellr")] + ([P(money(r.value), "cellr")] if fin else []))
        story.append(_table(rows, _fit([90, 140, 50, 60, 40, 34] + ([50] if fin else []))))
        if len(soon) > 30:
            story.append(P(f"…and {len(soon) - 30} more. See Inventory in Cadence.", "small"))
    else:
        story.append(P(f"Nothing else expires within {s.soon_days} days.", "base"))
    story.append(Spacer(1, 12))

    # ---------- 04 reorder
    story += [CondPageBreak(40 * mm), Band("04", "Reorder: below the reorder level", INK, b), Spacer(1, 6)]
    if low:
        story += [P("Suggested orders cover about four weeks of this month's dispensing, and at least bring you back up to the reorder level.", "small"), Spacer(1, 4)]
        head = ["", "Medicine", "Usable now", "Reorder level", "Dispensed this month", "Suggested order"]
        rows = [[H(h) for h in head]]
        div = max(today.day, 7)
        for pr in low:
            need = max(max(ceil(pr.sold / div * 28), pr.reorder_level) - pr.usable, 1)
            # nothing dispensed this month: don't push a full reorder of something that isn't moving
            order = P(f"about {need}", "cellr") if pr.sold else P("only if asked for", "small")
            rows.append([TickBox(), P(f"<b>{e(pr.name)}</b>"), P(f"<font color='{'#c0392b' if pr.usable == 0 else '#0b1220'}'>{pr.usable}</font>", "cellr"),
                         P(str(pr.reorder_level), "cellr"), P(str(pr.sold), "cellr"), order])
        story.append(_table(rows, _fit([14, 200, 60, 64, 86, 70])))
    else:
        story.append(P("Every medicine is above its reorder level.", "base"))

    # ---------- what to do with expired medicines
    story += [PageBreak(), P("What to do with expired medicines", "h1"), Spacer(1, 2),
              P("A step-by-step guide for the pharmacy team. Keep it with this report.", "lead"), Spacer(1, 10)]
    steps = [
        ("1  Pull them before you open",
         ["Check every batch in section 01 against the shelves, the store room and the dispensing area, and take every unit out of use.",
          "Check other batches of the same medicine too. Expired packs often sit behind newer stock."]),
        ("2  Quarantine them",
         ["Keep them in one sealed box or locked area away from dispensing stock, clearly labelled <b>EXPIRED: NOT FOR DISPENSING</b>.",
          "Group them by type. Ghana's FDA requires unwholesome products to be stored separately, grouped and clearly labelled so nobody dispenses them by mistake."]),
        ("3  Record them",
         ["Remove them from stock in Cadence so the shelf count stays right and the loss shows in your numbers.",
          "Keep a register of expired products: name, batch, quantity, date and who pulled them. The FDA asks for one, and you'll need it to apply for disposal."]),
        ("4  Try to recover the cost",
         ["Check your agreement with each supplier or wholesaler. Many give a credit or a swap for short-dated or expired stock, especially if you tell them early.",
          "Send them the batch numbers, quantities and the invoice. Section 02 lists batches unlikely to be dispensed in time, which are easier to return now."]),
        ("5  Dispose of them the legal way",
         ["<b>Don't throw them in the bin, flush them, burn them, or give them to anyone.</b> Under the FDA's Guidelines for Safe Disposal of Unwholesome "
          "Products, no one may dispose of unwholesome products without the FDA's permission and supervision.",
          "Apply to the FDA (Chief Executive, Food and Drugs Authority, P.O. Box CT 2783, Cantonments, Accra, or your regional office) with the application "
          "form and a list of the products in print and Excel: description, quantity in kg, and why they're unwholesome. Pay the destruction fee in the FDA fee schedule.",
          "An FDA officer checks the list and you agree a destruction date. You arrange an FDA-approved waste management company and transport the goods to the site.",
          "Keep the <b>certificate of destruction</b> and <b>safe disposal certificate</b> the FDA issues. Breaking these rules is an offence under the Public Health Act, 2012 (Act 851).",
          "Controlled medicines have extra rules. Check with the FDA and the Pharmacy Council before you dispose of any.",
          "Most pharmacies keep quarantined stock together and dispose of it in one go, rather than item by item."]),
    ]
    for title, items in steps:
        story.append(KeepTogether([P(title, "h3")] + [Paragraph(t, st["bullet"], bulletText="•") for t in items]))
    story += [Spacer(1, 8), P("Stop it happening again", "h2")]
    for t, d in [
        ("First expiry, first out (FEFO).", "Put new deliveries behind older stock, and dispense the batch that expires first. Cadence lists batches in expiry order."),
        (f"Act at {s.critical_days} days, not at the last minute.", "Section 02 shows what's critical every morning, while there's still time to use it or send it back."),
        ("Order to what you dispense.", "Order about a month of what you actually dispense, not what a rep suggests. Section 04 does the sum for you."),
        ("Check expiry dates on every delivery.", "Query or refuse stock that arrives with too little shelf life left, and record each batch's expiry when you receive it."),
        ("Watch the slow movers.", "Medicines in section 01 marked \"Nothing dispensed this month\" or \"Overstocked\" need a smaller order or to be stocked on request only."),
    ]:
        story.append(Paragraph(f"<b>{t}</b> {d}", st["bullet"], bulletText="•"))
    story += [Spacer(1, 10), P("Ghana FDA guidance: fdaghana.gov.gh, Guidelines for Safe Disposal of Unwholesome Products. Fees and procedures can change, "
                               "so confirm current requirements with the FDA before you apply.", "small")]

    buf = io.BytesIO()
    who = f" · for {ctx.recipient}" if ctx.recipient else ""

    def on_page(c, doc):
        c.saveState()
        c.setFillColor(SKY)
        c.rect(0, PAGE_H - 5, PAGE_W, 5, stroke=0, fill=1)
        c.setFillColor(LIME)
        c.rect(0, PAGE_H - 5, PAGE_W * 0.18, 5, stroke=0, fill=1)
        c.setFont(f, 7.5)
        c.setFillColor(INK2)
        c.drawString(MARGIN, 10 * mm, f"Cadence daily report · {s.pharmacy} · {today:%d %b %Y}{who}")
        c.drawRightString(PAGE_W - MARGIN, 10 * mm, f"Page {doc.page}")
        c.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=14 * mm, bottomMargin=16 * mm,
                            title=f"Cadence daily report · {s.pharmacy} · {today:%d %b %Y}", author="Cadence", subject="Daily stock report")
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()


def _signoff(st, labels: list[str]) -> Table:
    cells = [[Paragraph(f"{l}<br/><br/>________________________", st["small"]) for l in labels]]
    return Table(cells, colWidths=[WIDTH / len(labels)] * len(labels),
                 style=[("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
                        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (-1, -1), 8)])


def filename(pharmacy: str, today: date | None = None) -> str:
    today = today or date.today()
    slug = "".join(ch if ch.isalnum() else "-" for ch in pharmacy.lower()).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return f"cadence-report-{slug or 'pharmacy'}-{today:%Y-%m-%d}.pdf"
