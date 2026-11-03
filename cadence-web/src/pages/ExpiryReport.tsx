/* /app/print/expiry?show=expired,critical  A printable A4 report of batches to pull or dispense first.
   Opens the browser's print dialog, where "Save as PDF" also works. Cost values appear only for roles allowed to see finances. */
import { useEffect, useMemo, useState } from "react";
import { LuPrinter, LuArrowLeft } from "react-icons/lu";
import { Button, Logo } from "@/components/ui/primitives";
import { useCan, useCurrentUser, useStore } from "@/lib/api";
import { enrich, STATUS_META } from "@/lib/analytics";
import { navigate, useQuery } from "@/lib/router";
import { cn, fmtDate, int, money, relDays } from "@/lib/utils";
import type { Batch, Status } from "@/lib/types";

const ORDER: Status[] = ["expired", "critical", "soon"];
const ACTION: Record<Status, string> = {
  expired: "Remove from the shelf, quarantine, and record the write-off or supplier return.",
  critical: "Dispense these first. Move to the front of the shelf.",
  soon: "Check stock levels; slow down reorders.",
  safe: "",
};

export default function ExpiryReport() {
  const q = useQuery();
  const user = useCurrentUser()!;
  const can = useCan();
  const finance = can("view_finance");
  const items = useStore((s) => s.items), thresholds = useStore((s) => s.thresholds), pharmacy = useStore((s) => s.pharmacy);
  const [show, setShow] = useState<Status[]>(() => {
    const s = (q.get("show") ?? "expired,critical").split(",").filter((x): x is Status => ORDER.includes(x as Status));
    return s.length ? s : ["expired", "critical"];
  });
  const [signatures, setSignatures] = useState(true);
  const rows = useMemo(() => items.map((i) => enrich(i, thresholds)).filter((r) => show.includes(r.status)).sort((a, b) => a.days - b.days), [items, thresholds, show]);
  const groups = ORDER.filter((s) => show.includes(s)).map((s) => ({ s, rows: rows.filter((r) => r.status === s) }));
  const now = new Date();
  const stamp = `${fmtDate(now.toISOString().slice(0, 10))}, ${now.toTimeString().slice(0, 5)}`;

  useEffect(() => { document.title = `Expiry report · ${pharmacy.name} · ${now.toISOString().slice(0, 10)}`; }, [pharmacy.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (q.get("auto") === "1") { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (s: Status) => setShow((x) => (x.includes(s) ? (x.length > 1 ? x.filter((y) => y !== s) : x) : [...x, s]));
  const label = (s: Status) => s === "critical" ? `${STATUS_META.critical.label} (1–${thresholds.criticalMax} days)` : s === "soon" ? `${STATUS_META.soon.label} (${thresholds.criticalMax + 1}–${thresholds.soonMax} days)` : STATUS_META.expired.label;

  return (
    <div className="min-h-full bg-sunken print:bg-white">
      {/* Controls: hidden on paper */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/inventory")}><LuArrowLeft />Inventory</Button>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Include">
            {ORDER.map((s) => (
              <button key={s} onClick={() => toggle(s)} aria-pressed={show.includes(s)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", show.includes(s) ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-muted")}>{STATUS_META[s].label}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={signatures} onChange={(e) => setSignatures(e.target.checked)} className="size-4 accent-[var(--brand)]" />Sign-off lines</label>
          <Button variant="primary" size="sm" className="ml-auto" onClick={() => window.print()}><LuPrinter />Print or save PDF</Button>
        </div>
      </div>

      {/* The page */}
      <article className="report mx-auto my-6 max-w-[860px] bg-white p-10 text-[#0f1729] shadow-card print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-[#0f1729] pb-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Expiry report</h1>
            <p className="mt-1 text-sm">{pharmacy.name}{pharmacy.location ? ` · ${pharmacy.location}` : ""}</p>
            {pharmacy.licenceNo && <p className="text-xs text-[#4b5563]">Pharmacy Council licence {pharmacy.licenceNo}</p>}
          </div>
          <div className="text-right text-xs text-[#4b5563]">
            <p className="mb-2 flex items-center justify-end gap-1.5 font-display text-sm font-bold text-[#0f1729]"><Logo withText={false} className="[&_img]:size-5" />Cadence.io</p>
            <p>Printed {stamp}</p><p>By {user.name}{user.position ? `, ${user.position}` : ""}</p>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-3 gap-3 text-sm">
          {groups.map(({ s, rows: g }) => (
            <div key={s} className="rounded-lg border border-[#d1d5db] p-3">
              <p className="text-xs text-[#4b5563]">{label(s)}</p>
              <p className="text-xl font-bold">{g.length} <span className="text-sm font-normal">batches</span></p>
              <p className="text-xs">{int(g.reduce((a, r) => a + r.qty, 0))} units{finance ? ` · ${money(g.reduce((a, r) => a + r.qty * r.unitCost, 0), 0)} at cost` : ""}</p>
            </div>
          ))}
        </section>

        {rows.length === 0 && <p className="mt-8 text-center text-sm">Nothing in these categories today.</p>}

        {groups.filter((g) => g.rows.length).map(({ s, rows: g }) => (
          <section key={s} className="mt-6 break-inside-avoid-page">
            <h2 className="text-base font-bold">{label(s)} · {g.length}</h2>
            <p className="mb-2 text-xs text-[#4b5563]">{ACTION[s]}</p>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-y border-[#0f1729] text-left">
                  <th className="w-6 py-1.5 pr-2">✓</th><th className="py-1.5 pr-2">Product</th><th className="py-1.5 pr-2">Batch</th><th className="py-1.5 pr-2">Barcode</th>
                  <th className="py-1.5 pr-2 text-right">Qty</th><th className="py-1.5 pr-2">Expiry</th><th className="py-1.5 pr-2">Supplier</th>
                  {finance && <th className="py-1.5 text-right">Value</th>}
                </tr>
              </thead>
              <tbody>
                {g.map((r: Batch) => (
                  <tr key={r.id} className="border-b border-[#e5e7eb] align-top">
                    <td className="py-1.5 pr-2"><span className="inline-block size-3.5 border border-[#0f1729]" /></td>
                    <td className="py-1.5 pr-2 font-medium">{r.name}</td>
                    <td className="py-1.5 pr-2 font-mono">{r.batch}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px]">{r.barcode}</td>
                    <td className="py-1.5 pr-2 text-right tabular">{r.qty}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDate(r.expiry)}<span className="block text-[11px] text-[#4b5563]">{relDays(r.days)}</span></td>
                    <td className="py-1.5 pr-2">{r.supplier}</td>
                    {finance && <td className="py-1.5 text-right tabular">{money(r.qty * r.unitCost, 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        {signatures && rows.length > 0 && (
          <section className="mt-10 grid grid-cols-3 gap-6 text-xs break-inside-avoid">
            {["Checked by", "Superintendent pharmacist", "Date"].map((l) => <div key={l}><div className="h-10 border-b border-[#0f1729]" /><p className="mt-1 text-[#4b5563]">{l}</p></div>)}
          </section>
        )}
        <footer className="mt-8 border-t border-[#d1d5db] pt-2 text-[10px] text-[#6b7280]">
          Critical = expires within {thresholds.criticalMax} days; expiring soon = within {thresholds.soonMax} days. Generated by Cadence.io from the stock records at the time of printing.
        </footer>
      </article>
    </div>
  );
}
