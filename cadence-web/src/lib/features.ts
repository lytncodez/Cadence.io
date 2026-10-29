/* Alerts, notifications, AI insights, import and pharmacy settings.
   Mock mode mirrors the API's rules (cadence-api/app/services/*) so both behave the same. */
import { z } from "zod";
import { delay, getState, http, set, USE_MOCK, V, type Pharmacy } from "./api";
import { summarize, type Summary } from "./analytics";
import { daysUntil, fmtDate, money, storage } from "./utils";
import type { Item, Status } from "./types";

/* ---------------- Types ---------------- */
export interface AlertItem { key: string; type: "expiry" | "stock"; status: Status; title: string; text: string; itemId: string | null; days: number; read: boolean }
export interface NotifySettings {
  smsEnabled: boolean; smsNumbers: string; emailEnabled: boolean; email: string; digestTime: string;
  onExpired: boolean; onCritical: boolean; onSoon: boolean; onLowStock: boolean;
}
export interface Delivery { id: string; channel: "sms" | "email"; recipient: string; subject: string; message: string; status: "sent" | "mock" | "failed"; error: string; kind: "digest" | "test" | "reset"; createdAt: string }
export interface SendResult { channel: "sms" | "email"; status: "sent" | "mock" | "failed"; detail: string }
export type ItemInput = Omit<Item, "id" | "soldThisMonth" | "reorderLevel"> & { reorderLevel?: number; soldThisMonth?: number };
export interface ParseResult { total: number; rows: ItemInput[]; errors: { row: number; error: string }[] }
export interface Dataset { name: string; rows: ItemInput[]; kept: boolean; file?: File }
export interface ImportResult { dryRun: boolean; total: number; added: number; updated: number; errors: { row: number; error: string }[]; preview: ItemInput[] }
export type AskKind = "report" | "losses" | "margins" | "dashboard" | "reorder" | "text";
export interface AskResult { kind: AskKind; text: string }

const DEFAULT_NOTIFY: NotifySettings = {
  smsEnabled: true, smsNumbers: "+233 24 555 0142, +233 20 555 0198", emailEnabled: true, email: "alerts@harbourview.example",
  digestTime: "07:30", onExpired: true, onCritical: true, onSoon: false, onLowStock: true,
};
const nowStamp = () => { const d = new Date(); return d.toISOString().slice(0, 10) + "T" + d.toTimeString().slice(0, 5); };
const current = () => { const s = getState(); return summarize(s.items, s.monthly, s.thresholds); };

/* ---------------- Alerts ---------------- */
export function computeAlerts(s: Summary, ns: NotifySettings, read: Set<string>): AlertItem[] {
  const out: AlertItem[] = [];
  s.rows.forEach((r) => {
    if (r.status === "expired" || r.status === "critical" || (r.status === "soon" && ns.onSoon)) {
      const text = r.status === "expired"
        ? `Batch ${r.batch} expired ${fmtDate(r.expiry)}. Quarantine ${r.qty} units (${money(r.qty * r.unitCost)} at cost) and record the write-off.`
        : r.status === "critical" ? `Batch ${r.batch} expires in ${r.days} days. ${r.qty} units left; dispense these first.`
        : `Batch ${r.batch} expires in ${r.days} days. ${r.qty} units on hand.`;
      const key = `exp-${r.id}-${r.status}`;
      out.push({ key, type: "expiry", status: r.status, title: r.name, text, itemId: r.id, days: r.days, read: read.has(key) });
    }
  });
  if (ns.onLowStock) s.lowStock.forEach((p) => {
    const key = `low-${p.name}`;
    out.push({ key, type: "stock", status: p.usable === 0 ? "critical" : "soon", title: p.name, text: `Usable stock is ${p.usable} against a reorder level of ${p.reorderLevel}. ${p.sold} sold this month.`, itemId: null, days: 99999, read: read.has(key) });
  });
  const rank: Record<Status, number> = { expired: 0, critical: 1, soon: 2, safe: 3 };
  return out.sort((a, b) => Number(a.type === "stock") - Number(b.type === "stock") || rank[a.status] - rank[b.status] || a.days - b.days);
}

function smsText(s: Summary, ns: NotifySettings, pharmacy: string) {
  const exp = ns.onExpired ? s.rows.filter((r) => r.status === "expired") : [];
  const crit = ns.onCritical ? s.rows.filter((r) => r.status === "critical") : [];
  if (!exp.length && !crit.length) return "";
  const parts = [`Cadence · ${pharmacy}`];
  if (crit.length) parts.push(`${crit.length} critical: ${crit.slice(0, 3).map((r) => `${r.name.split(" ")[0]} ${r.batch} (${r.days}d)`).join(", ")}${crit.length > 3 ? " +more" : ""}.`);
  if (exp.length) parts.push(`${exp.length} expired (${money(exp.reduce((a, r) => a + r.qty * r.unitCost, 0))}). Quarantine today.`);
  return parts.join(" ").slice(0, 459);
}

export const alerts = {
  async list(): Promise<AlertItem[]> {
    if (!USE_MOCK) return http("GET", "/alerts");
    const read = new Set(storage.get<string[]>(V + "alertReads", []));
    return computeAlerts(current(), await alerts.getSettings(), read);
  },
  async markRead(keys: string[]) {
    if (!USE_MOCK) return http("POST", "/alerts/read", keys);
    storage.set(V + "alertReads", [...new Set([...storage.get<string[]>(V + "alertReads", []), ...keys])]);
  },
  async getSettings(): Promise<NotifySettings> {
    if (!USE_MOCK) return http("GET", "/alerts/settings");
    return { ...DEFAULT_NOTIFY, ...storage.get<Partial<NotifySettings>>(V + "notify", {}) };
  },
  async saveSettings(ns: NotifySettings): Promise<NotifySettings> {
    if (!USE_MOCK) return http("PUT", "/alerts/settings", ns);
    await delay(300);
    storage.set(V + "notify", ns);
    return ns;
  },
  async deliveries(): Promise<Delivery[]> {
    if (!USE_MOCK) return http("GET", "/alerts/deliveries");
    return storage.get<Delivery[]>(V + "deliveries", []);
  },
  async clearDeliveries() {
    if (!USE_MOCK) return http("DELETE", "/alerts/deliveries");
    storage.set(V + "deliveries", []);
  },
  async testSms(): Promise<SendResult> {
    if (!USE_MOCK) return http("POST", "/alerts/test-sms");
    await delay(500);
    const ns = await alerts.getSettings();
    if (!ns.smsNumbers.trim()) throw new Error("Add at least one phone number and save before sending a test.");
    logMock({ channel: "sms", recipient: ns.smsNumbers, subject: "", message: `Cadence test: SMS alerts for ${getState().pharmacy.name} are working.`, kind: "test" });
    return { channel: "sms", status: "mock", detail: "Logged only: demo mode doesn't send real SMS." };
  },
  async testEmail(): Promise<SendResult> {
    if (!USE_MOCK) return http("POST", "/alerts/test-email");
    await delay(500);
    const ns = await alerts.getSettings();
    if (!ns.email) throw new Error("Add an email address and save before sending a test.");
    logMock({ channel: "email", recipient: ns.email, subject: "Cadence test email", message: "Email alerts from Cadence are working.", kind: "test" });
    return { channel: "email", status: "mock", detail: "Logged only: demo mode doesn't send real email." };
  },
  async sendDigest(): Promise<SendResult[]> {
    if (!USE_MOCK) return http("POST", "/alerts/send-digest");
    await delay(700);
    const ns = await alerts.getSettings(), s = current(), ph = getState().pharmacy.name, out: SendResult[] = [];
    const sms = smsText(s, ns, ph);
    if (ns.smsEnabled && ns.smsNumbers.trim() && sms) { logMock({ channel: "sms", recipient: ns.smsNumbers, subject: "", message: sms, kind: "digest" }); out.push({ channel: "sms", status: "mock", detail: "" }); }
    if (ns.emailEnabled && ns.email) {
      const list = computeAlerts(s, ns, new Set());
      logMock({ channel: "email", recipient: ns.email, subject: `Cadence daily digest · ${s.counts.critical} critical, ${s.counts.expired} expired`, message: list.map((a) => `[${a.status.toUpperCase()}] ${a.title}: ${a.text}`).join("\n"), kind: "digest" });
      out.push({ channel: "email", status: "mock", detail: "" });
    }
    return out;
  },
};
function logMock(d: Omit<Delivery, "id" | "status" | "error" | "createdAt">) {
  const list = storage.get<Delivery[]>(V + "deliveries", []);
  storage.set(V + "deliveries", [{ ...d, id: Math.random().toString(36).slice(2), status: "mock", error: "", createdAt: nowStamp() }, ...list].slice(0, 20));
}

/* ---------------- AI insights ---------------- */
export function routeQuestion(message: string, s: Summary): AskKind | "product" {
  const m = message.toLowerCase();
  const has = (...w: string[]) => w.some((x) => m.includes(x));
  if (has("loss", "losing", "lose", "lost", "expired", "waste", "write")) return "losses";
  if (has("margin", "profit", "markup")) return "margins";
  if (has("dashboard", "overview", "snapshot", "status")) return "dashboard";
  if (has("reorder", "low stock", "restock", "run out", "order")) return "reorder";
  if (has("report", "summary", "month", "performance", "how did", s.monthly[s.monthly.length - 1].label.toLowerCase())) return "report";
  if (findProduct(message, s)) return "product";
  return "text";
}
export const findProduct = (message: string, s: Summary) => {
  const m = message.toLowerCase();
  return s.products.find((p) => { const f = p.name.split(" ")[0].toLowerCase(); return f.length > 3 && m.includes(f); });
};

function template(kind: AskKind | "product", message: string, s: Summary, criticalDays: number): string {
  const k = s.kpi;
  if (kind === "report") return `${s.monthly[s.monthly.length - 1].label} revenue is ${money(k.revenue)}, ${k.revenueDelta >= 0 ? "up" : "down"} ${Math.abs(k.revenueDelta).toFixed(1)}% on last month, with a ${k.margin.toFixed(1)}% margin. ${s.top[0] ? `${s.top[0].name} led sales with ${s.top[0].sold} units. ` : ""}${money(s.value.expired)} of stock has expired and ${money(s.value.critical)} expires within ${criticalDays} days.`;
  if (kind === "losses") {
    const worst = s.rows.filter((r) => r.status === "expired").sort((a, b) => b.qty * b.unitCost - a.qty * a.unitCost)[0];
    return `Expired stock has cost ${money(s.value.expired)} at purchase price across ${s.counts.expired} batches${worst ? `; the largest is ${worst.name} batch ${worst.batch}, ${money(worst.qty * worst.unitCost)}` : ""}. Another ${money(s.value.critical)} across ${s.counts.critical} batches expires within ${criticalDays} days, so dispense those first and ask suppliers about returns.`;
  }
  if (kind === "margins") {
    const r = [...s.products].sort((a, b) => b.margin - a.margin);
    return `Your blended margin this month is ${k.margin.toFixed(1)}%. Highest: ${r.slice(0, 3).map((p) => `${p.name} ${p.margin.toFixed(0)}%`).join(", ")}. Thinnest: ${r.slice(-3).map((p) => `${p.name} ${p.margin.toFixed(0)}%`).join(", ")}.`;
  }
  if (kind === "dashboard") return `${s.counts.safe} of ${s.rows.length} batches are safe and ${s.counts.critical + s.counts.expired} need action. Usable stock is worth ${money(s.stockValue)} at cost.`;
  if (kind === "reorder") return s.lowStock.length ? `${s.lowStock.length} products are below their reorder level. Usable stock excludes expired batches, so a shelf can look full and still be short.` : "Every product is above its reorder level.";
  if (kind === "product") {
    const p = findProduct(message, s)!;
    const first = [...p.batches].sort((a, b) => a.days - b.days).find((b) => b.status !== "expired");
    return `${p.name}: ${p.usable} usable units across ${p.batches.length} batches.${first ? ` Dispense ${first.batch} first (${first.days} days left).` : ""} ${p.sold} sold this month for ${money(p.revenue)} at a ${p.margin.toFixed(1)}% margin.${p.usable < p.reorderLevel ? ` Stock is below its reorder level of ${p.reorderLevel}.` : ""}`;
  }
  return "I answer from your pharmacy's own records. Ask for this month's report, where expiry losses come from, which medicines have the best margins, what to reorder, or about a product such as Coartem.";
}

/** Analyse an uploaded file on its own: one period of sales, no month-by-month history. */
export function summarizeDataset(d: Dataset): Summary & { hasHistory: false } {
  const items: Item[] = d.rows.map((r, i) => ({ ...r, id: `upload-${i}`, soldThisMonth: r.soldThisMonth ?? 0, reorderLevel: r.reorderLevel ?? 20 }));
  const rev = items.reduce((a, r) => a + r.soldThisMonth * r.unitPrice, 0), cost = items.reduce((a, r) => a + r.soldThisMonth * r.unitCost, 0);
  const now = new Date();
  const label = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][now.getMonth()];
  const monthly = [{ label: "—", year: now.getFullYear(), revenue: 0, cost: 0 }, { label, year: now.getFullYear(), revenue: rev, cost }];
  return { ...summarize(items, monthly, getState().thresholds), hasHistory: false };
}

let aiConnected: boolean | null = null;
/** Whether open questions get a full AI answer (live mode with an AI key on the server). */
export async function aiStatus(): Promise<boolean> {
  if (USE_MOCK) return false;
  if (aiConnected === null) { try { aiConnected = (await http<{ connected: boolean }>("GET", "/ai/status")).connected; } catch { aiConnected = false; } }
  return aiConnected;
}

export async function ask(message: string, opts: { history?: { role: "user" | "ai"; text: string }[]; dataset?: Dataset | null } = {}): Promise<AskResult> {
  const { history = [], dataset = null } = opts;
  if (!USE_MOCK) {
    const r = await http<AskResult>("POST", "/ai/chat", { message, history: history.slice(-10), ...(dataset ? { datasetName: dataset.name, rows: dataset.rows } : {}) });
    return { kind: r.kind, text: r.text };
  }
  await delay(700 + Math.random() * 500);
  const s = dataset ? summarizeDataset(dataset) : current();
  const kind = routeQuestion(message, s);
  let text = template(kind, message, s, getState().thresholds.criticalMax);
  if (dataset && kind === "report") text = `In ${dataset.name}, sales come to ${money(s.kpi.revenue)} at a ${s.kpi.margin.toFixed(1)}% margin across ${s.rows.length} batches. ${s.top[0] ? `${s.top[0].name} sold the most by value. ` : ""}${money(s.value.expired)} of the stock in the file has expired and ${money(s.value.critical)} expires within ${getState().thresholds.criticalMax} days.`;
  if (kind === "text") text = "In demo mode I answer from your records only. Connect the API with an AI key (AI_PROVIDER on the server) and I'll answer any question: medicines, storage, regulation, business or anything else. For now, try a report, losses, margins, reorders or a product name.";
  return { kind: kind === "product" ? "text" : kind, text };
}

/* ---------------- Import ---------------- */
const ALIASES: Record<string, string> = {
  product: "name", product_name: "name", item: "name", drug: "name", batch_no: "batch", batch_number: "batch", lot: "batch",
  expiry_date: "expiry", exp: "expiry", expires: "expiry", expiration: "expiry", quantity: "qty", units: "qty", stock: "qty",
  cost: "unitCost", unit_cost: "unitCost", unitcost: "unitCost", cost_price: "unitCost",
  price: "unitPrice", unit_price: "unitPrice", unitprice: "unitPrice", selling_price: "unitPrice", reorder: "reorderLevel", reorder_level: "reorderLevel",
  sold: "soldThisMonth", units_sold: "soldThisMonth", qty_sold: "soldThisMonth", sales: "soldThisMonth", soldthismonth: "soldThisMonth", sold_this_month: "soldThisMonth",
};
const rowSchema = z.object({
  name: z.string().trim().min(2, "name: enter the product name"),
  category: z.string().trim().default(""),
  barcode: z.string().trim().regex(/^\d{6,14}$/, "barcode: 6–14 digits"),
  batch: z.string().trim().min(1, "batch: missing"),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expiry: use YYYY-MM-DD or DD/MM/YYYY"),
  qty: z.coerce.number().int("qty: whole units").min(0, "qty: can't be negative"),
  unitCost: z.coerce.number().positive("unit_cost: must be above 0"),
  unitPrice: z.coerce.number().positive("unit_price: must be above 0"),
  supplier: z.string().trim().default(""),
  reorderLevel: z.coerce.number().int().min(0).optional(),
  soldThisMonth: z.coerce.number().int().min(0).optional(),
}).refine((r) => r.unitPrice >= r.unitCost, { message: "unit_price: selling price is below cost" });

export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
function normDate(v: string) {
  const s = v.trim();
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return s;
}

async function parseLocal(file: File): Promise<ParseResult> {
  if (!/\.(csv|txt)$/i.test(file.name)) throw new Error("Demo mode reads .csv files. Save your Excel sheet as CSV, or connect the API to read .xlsx directly.");
  const rows = parseCSV(await file.text());
  if (rows.length < 2) throw new Error("The file has no data rows under the header.");
  const head = rows[0].map((h) => { const k = h.trim().toLowerCase().replace(/[\s-]+/g, "_"); return ALIASES[k] ?? k; });
  const good: ItemInput[] = [], errors: ParseResult["errors"] = [];
  rows.slice(1).forEach((r, i) => {
    const o: Record<string, string> = {};
    head.forEach((h, j) => (o[h] = (r[j] ?? "").trim()));
    if (o.expiry) o.expiry = normDate(o.expiry);
    if (!o.reorderLevel) delete o.reorderLevel;
    if (!o.soldThisMonth) delete o.soldThisMonth;
    const p = rowSchema.safeParse(o);
    if (p.success) good.push({ ...p.data, supplier: p.data.supplier || "—" });
    else errors.push({ row: i + 2, error: p.error.issues[0].message });
  });
  return { total: rows.length - 1, rows: good, errors };
}

/** Read and validate a file without saving anything (for one-time analysis). */
export async function parseFile(file: File): Promise<ParseResult> {
  if (!USE_MOCK) { const fd = new FormData(); fd.append("file", file); return http("POST", "/items/parse", fd); }
  await delay(400);
  return parseLocal(file);
}

export async function importFile(file: File, dryRun: boolean): Promise<ImportResult> {
  if (!USE_MOCK) { const fd = new FormData(); fd.append("file", file); return http("POST", `/items/import?dry_run=${dryRun}`, fd); }
  const parsed = await parseLocal(file);
  const good = parsed.rows, errors = parsed.errors;
  let added = 0, updated = 0;
  if (!dryRun) {
    await delay(500);
    let items = [...getState().items];
    good.forEach((g) => {
      const ex = items.find((i) => i.barcode === g.barcode && i.batch.toLowerCase() === g.batch.toLowerCase());
      if (ex) { items = items.map((i) => (i === ex ? { ...i, ...g, soldThisMonth: g.soldThisMonth ?? i.soldThisMonth, reorderLevel: g.reorderLevel ?? i.reorderLevel } : i)); updated++; }
      else { items = [{ ...g, id: "itm_" + Math.random().toString(36).slice(2, 9), soldThisMonth: g.soldThisMonth ?? 0, reorderLevel: g.reorderLevel ?? 20 }, ...items]; added++; }
    });
    set({ items }, ["items"]);
  } else await delay(300);
  return { dryRun, total: parsed.total, added, updated, errors, preview: good.slice(0, 20) };
}

/** A small sales + stock file for trying analysis in AI Insights. */
export const SAMPLE_SALES_CSV = () => {
  const d = (n: number) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
  const rows: [string, string, string, string, number, number, number, number, string, number][] = [
    ["Paracetamol 500mg Tabs ×100", "Analgesics", "6034000112011", "PCM-NEW1", 380, 120, 18.5, 32, "Ernest Chemists", 160],
    ["Amoxicillin 500mg Caps ×21", "Antibiotics", "6034000221004", "AMX-NEW1", 14, 40, 14.9, 28, "Tobinco Pharma", 55],
    ["Coartem 80/480mg ×6", "Antimalarials", "7612797004312", "CTM-NEW1", 60, 70, 42, 68, "Novartis via M&G", 110],
    ["Metformin 500mg Tabs ×28", "Chronic care", "6034000440051", "MET-NEW1", -9, 18, 8.6, 16, "Ernest Chemists", 0],
    ["Ventolin Inhaler 100mcg", "Respiratory", "5000123006417", "VEN-NEW1", 25, 12, 48, 75, "GSK Ghana", 21],
    ["ORS Sachets ×10", "Rehydration", "6034000660014", "ORS-NEW1", 500, 200, 6, 12, "Kinapharma", 90],
    ["Insulin Mixtard 30/70 10ml", "Chronic care", "5701234005671", "INS-NEW1", 45, 6, 118, 165, "Novo Nordisk", 11],
    ["Vitamin C 1000mg Effervescent ×20", "Supplements", "4005800123456", "VTC-NEW1", -30, 9, 19, 35, "Bayer West Africa", 0],
    ["Omeprazole 20mg Caps ×28", "Gastro", "6034000880017", "OMP-NEW1", 210, 64, 9.1, 18, "Letap Pharma", 70],
    ["Augmentin 625mg Tabs ×14", "Antibiotics", "5000123004512", "AUG-NEW1", 8, 15, 96, 145, "GSK Ghana", 26],
  ];
  return "name,category,barcode,batch,expiry,qty,unit_cost,unit_price,supplier,sold\n" + rows.map((r) => [r[0], r[1], r[2], r[3], d(r[4]), r[5], r[6], r[7], r[8], r[9]].join(",")).join("\n") + "\n";
};

export const SAMPLE_CSV = () => {
  const d = (n: number) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
  return "name,category,barcode,batch,expiry,qty,unit_cost,unit_price,supplier\n" +
    `Azithromycin 500mg Tabs ×3,Antibiotics,6034000221066,AZI-2511,${d(150)},40,12.5,24,Tobinco Pharma\n` +
    `Salbutamol 4mg Tabs ×28,Respiratory,6034000550032,SAL-2511,${d(19)},25,3.9,8,Letap Pharma\n` +
    `Coartem 80/480mg ×6,Antimalarials,7612797004312,CTM-2511,${d(330)},60,42,68,Novartis via M&G\n` +
    `Misprinted row,Test,123,X1,soon,5,2,1,\n`;
};

/* ---------------- Pharmacy settings ---------------- */
export async function savePharmacy(data: { name: string; location: string; licenceNo: string; criticalDays: number; soonDays: number }) {
  if (data.soonDays <= data.criticalDays) throw new Error("“Expiring soon” must be longer than “Critical”.");
  if (!USE_MOCK) {
    const ph = await http<Pharmacy & { criticalDays: number; soonDays: number }>("PATCH", "/pharmacy", data);
    set({ pharmacy: ph, thresholds: { criticalMax: ph.criticalDays, soonMax: ph.soonDays } });
    return;
  }
  await delay(350);
  set({ pharmacy: { name: data.name, location: data.location, licenceNo: data.licenceNo }, thresholds: { criticalMax: data.criticalDays, soonMax: data.soonDays } }, ["pharmacy", "thresholds"]);
}
export const daysLeftLabel = (iso: string) => { const d = daysUntil(iso); return d <= 0 ? "expired" : `${d}d`; };

/* ---------------- Website: Book a demo ---------------- */
export interface DemoRequestInput { name: string; pharmacy: string; phone: string; email: string; branches: string; message: string; website: string }
/** Live mode posts to the API (no sign-in needed), which stores it and notifies the Cadence team. Demo mode keeps it in this browser. */
export async function submitDemoRequest(d: DemoRequestInput) {
  if (!USE_MOCK) { await http("POST", "/demo-requests", d); return; }
  await delay(600);
  if (!d.website) storage.set("demoRequests", [...storage.get<DemoRequestInput[]>("demoRequests", []), { ...d, at: new Date().toISOString() }]);
}
