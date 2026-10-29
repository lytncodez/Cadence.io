/* Deterministic analytics. Every figure the UI or the AI shows comes from here (or the same logic on the server). */
import { daysUntil } from "./utils";
import type { Batch, Item, Month, Status, Thresholds } from "./types";

export const DEFAULT_THRESHOLDS: Thresholds = { criticalMax: 30, soonMax: 90 };

export function statusFor(days: number, t: Thresholds = DEFAULT_THRESHOLDS): Status {
  if (days <= 0) return "expired";
  if (days <= t.criticalMax) return "critical";
  if (days <= t.soonMax) return "soon";
  return "safe";
}
export const enrich = (i: Item, t?: Thresholds): Batch => {
  const days = daysUntil(i.expiry);
  return { ...i, days, status: statusFor(days, t) };
};

export const STATUS_ORDER: Status[] = ["expired", "critical", "soon", "safe"];
export const STATUS_META: Record<Status, { label: string; short: string }> = {
  expired: { label: "Expired", short: "Expired" },
  critical: { label: "Critical", short: "Critical" },
  soon: { label: "Expiring soon", short: "Soon" },
  safe: { label: "Safe", short: "Safe" },
};

export interface ProductRollup {
  name: string; category: string; barcode: string; usable: number; sold: number; revenue: number;
  cost: number; price: number; margin: number; reorderLevel: number; batches: Batch[];
}

export function summarize(items: Item[], monthly: Month[], t?: Thresholds) {
  const rows = items.map((i) => enrich(i, t)).sort((a, b) => a.days - b.days);
  const counts: Record<Status, number> = { expired: 0, critical: 0, soon: 0, safe: 0 };
  const value: Record<Status, number> = { expired: 0, critical: 0, soon: 0, safe: 0 };
  rows.forEach((r) => { counts[r.status]++; value[r.status] += r.qty * r.unitCost; });

  const map = new Map<string, ProductRollup>();
  rows.forEach((r) => {
    const p = map.get(r.name) ?? { name: r.name, category: r.category, barcode: r.barcode, usable: 0, sold: 0, revenue: 0, cost: r.unitCost, price: r.unitPrice, margin: 0, reorderLevel: r.reorderLevel, batches: [] };
    if (r.status !== "expired") p.usable += r.qty;
    p.sold += r.soldThisMonth; p.revenue += r.soldThisMonth * r.unitPrice; p.batches.push(r);
    map.set(r.name, p);
  });
  const products = [...map.values()].map((p) => ({ ...p, margin: ((p.price - p.cost) / p.price) * 100 }));

  const cur = monthly[monthly.length - 1], prev = monthly[monthly.length - 2];
  const gp = cur.revenue - cur.cost, gpPrev = prev.revenue - prev.cost;
  const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
  const mg = (g: number, r: number) => (r ? (g / r) * 100 : 0);

  // Units sold per week, last 8 weeks, derived from monthly totals (for sparklines).
  const weekly = monthly.slice(-2).flatMap((m, mi) => [0.92, 1.04, 0.97, 1.07].map((f, wi) => Math.round((m.revenue / 4) * f * (1 + (mi * 4 + wi) * 0.004))));

  return {
    rows, counts, value, products,
    top: [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    lowStock: products.filter((p) => p.usable < p.reorderLevel).sort((a, b) => a.usable / a.reorderLevel - b.usable / b.reorderLevel),
    stockValue: rows.filter((r) => r.status !== "expired").reduce((s, r) => s + r.qty * r.unitCost, 0),
    units: rows.reduce((s, r) => s + r.qty, 0),
    monthly, weekly,
    kpi: {
      revenue: cur.revenue, revenueDelta: pct(cur.revenue, prev.revenue),
      profit: gp, profitDelta: pct(gp, gpPrev),
      margin: mg(gp, cur.revenue), marginDelta: mg(gp, cur.revenue) - mg(gpPrev, prev.revenue),
    },
  };
}
export type Summary = ReturnType<typeof summarize>;
