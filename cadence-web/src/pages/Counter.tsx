/* Home for counter staff (roles without view_finance, e.g. Dispenser).
   Everything here is about what to hand over, what to pull and what to report. No money anywhere. */
import { useMemo, useRef, useState } from "react";
import { LuScanLine, LuArrowRight, LuBan, LuTriangleAlert, LuPackageMinus, LuBell, LuCornerDownLeft } from "react-icons/lu";
import { AppShell } from "@/components/layout/AppShell";
import { Avatar, Card, CardHeader, EmptyState, StatusPill, buttonClass, dot } from "@/components/ui/primitives";
import { useCurrentUser, useStore } from "@/lib/api";
import { summarize } from "@/lib/analytics";
import { Link, navigate } from "@/lib/router";
import { cn, fmtDate, greeting, int, money, relDays } from "@/lib/utils";

export default function Counter() {
  const user = useCurrentUser()!;
  const items = useStore((s) => s.items), monthly = useStore((s) => s.monthly), thresholds = useStore((s) => s.thresholds);
  const pharmacy = useStore((s) => s.pharmacy);
  const a = useMemo(() => summarize(items, monthly, thresholds), [items, monthly, thresholds]);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const expired = a.rows.filter((r) => r.status === "expired");
  const next = a.rows.filter((r) => r.status === "critical" || r.status === "soon").slice(0, 8);

  // Look up by barcode, batch or name. Group batches by product, earliest expiry first.
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const match = a.rows.filter((r) => r.barcode === s || r.batch.toLowerCase().includes(s) || r.name.toLowerCase().includes(s));
    const byProduct = new Map<string, typeof match>();
    match.forEach((r) => byProduct.set(r.barcode, [...(byProduct.get(r.barcode) ?? []), r]));
    return [...byProduct.values()].map((bs) => bs.sort((x, y) => x.days - y.days)).slice(0, 5);
  }, [q, a.rows]);
  const firstUsable = (bs: typeof a.rows) => bs.find((b) => b.status !== "expired");

  return (
    <AppShell title="Counter">
      <section className="mesh-brand grain relative mb-6 overflow-hidden rounded-3xl px-6 py-7 text-white shadow-float sm:px-8">
        <div className="hex-lattice absolute inset-0 opacity-60" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} photo={user.photo} size={56} className="ring-0" />
            <div>
              <p className="text-sm text-[#b9c7ea]">{greeting()},</p>
              <h2 className="font-display text-[28px] leading-tight font-bold">{user.name.split(" ")[0]}</h2>
              <p className="mt-1 text-sm text-[#b9c7ea]">{user.position || user.role} · {pharmacy.name}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[[expired.length, "to pull"], [a.counts.critical, "dispense first"], [a.lowStock.length, "running low"]].map(([n, l]) => (
              <div key={l as string} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 backdrop-blur"><p className="font-display text-2xl font-bold tabular">{n}</p><p className="text-xs text-[#c9d6f5]">{l}</p></div>
            ))}
          </div>
        </div>
      </section>

      {/* Look-up */}
      <Card className="relative mb-4 overflow-visible">
        <form onSubmit={(e) => { e.preventDefault(); const f = hits[0] && firstUsable(hits[0]); if (f) navigate(`/app/inventory?batch=${encodeURIComponent(f.id)}`); }} className="flex items-center gap-3 p-3 sm:p-4">
          <span className="hex-clip grid size-11 shrink-0 place-items-center bg-brand text-on-brand"><LuScanLine className="size-5" /></span>
          <label htmlFor="counter-q" className="sr-only">Scan a barcode or type a medicine</label>
          <input id="counter-q" ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
            placeholder="Scan a barcode, or type a medicine or batch number…" className="h-12 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted" />
          <span className="hidden items-center gap-1 text-xs text-muted sm:flex"><LuCornerDownLeft className="size-3.5" />opens first to dispense</span>
        </form>
        {q.trim().length >= 2 && (
          <div className="border-t border-line p-2">
            {hits.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{q}”. Check the barcode or ask the pharmacist to add it.</p> : hits.map((bs) => {
              const f = firstUsable(bs);
              return (
                <div key={bs[0].barcode} className="rounded-2xl px-3 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">{bs[0].name}</p>
                    <p className="text-xs text-muted">{int(bs.filter((b) => b.status !== "expired").reduce((s, b) => s + b.qty, 0))} usable units · {money(bs[0].unitPrice)} each</p>
                  </div>
                  <ul className="mt-2 grid gap-1.5">
                    {bs.map((b) => (
                      <li key={b.id}>
                        <Link to={`/app/inventory?batch=${encodeURIComponent(b.id)}`} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition hover:border-line-strong", f?.id === b.id ? "border-brand bg-brand-soft/50" : "border-line", b.status === "expired" && "opacity-70")}>
                          <span className={cn("size-2 rounded-full", dot[b.status])} />
                          <span className="font-mono">{b.batch}</span>
                          {f?.id === b.id && <span className="text-[11px] font-bold tracking-wide text-brand-ink uppercase">Dispense this one</span>}
                          {b.status === "expired" && <span className="text-[11px] font-bold tracking-wide text-expired-ink uppercase">Don't dispense</span>}
                          <span className="ml-auto text-xs text-muted tabular">{b.qty} units · {fmtDate(b.expiry)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="animate-fade-up">
          <CardHeader title="Dispense these first" subtitle="Closest to expiry, still safe to sell" action={<Link to="/app/inventory?status=critical" className="flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">All critical<LuArrowRight className="size-4" /></Link>} />
          {next.length === 0 ? <EmptyState icon={<LuTriangleAlert />} title="Nothing close to expiry" body="Dispense as normal today." /> : (
            <ul className="px-2 pb-3">
              {next.map((b) => (
                <li key={b.id}>
                  <Link to={`/app/inventory?batch=${encodeURIComponent(b.id)}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-sunken">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{b.name}</span><span className="block text-xs text-muted"><span className="font-mono">{b.batch}</span> · {relDays(b.days)} · {b.qty} units</span></span>
                    <StatusPill status={b.status} short />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-4 self-start">
          <Card className="animate-fade-up [animation-delay:80ms]">
            <CardHeader title="Pull from the shelf" subtitle="Expired. Set aside and tell the pharmacist." />
            {expired.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Nothing expired on the shelf.</p> : (
              <ul className="grid gap-1.5 px-5 pb-5">
                {expired.slice(0, 6).map((b) => (
                  <li key={b.id} className="flex items-center gap-3 rounded-xl bg-expired-soft/60 px-3 py-2 text-sm">
                    <LuBan className="size-4 shrink-0 text-expired-ink" />
                    <span className="min-w-0 flex-1 truncate">{b.name} <span className="font-mono text-xs text-muted">{b.batch}</span></span>
                    <span className="text-xs tabular">{b.qty} units</span>
                  </li>
                ))}
                {expired.length > 6 && <li><Link to="/app/inventory?status=expired" className="text-sm font-medium text-brand-ink hover:underline">See all {expired.length}</Link></li>}
              </ul>
            )}
          </Card>
          <Card className="animate-fade-up [animation-delay:140ms]">
            <CardHeader title="Running low" subtitle="Let the pharmacist know before it runs out" />
            {a.lowStock.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Everything is above its reorder level.</p> : (
              <ul className="grid gap-1.5 px-5 pb-5">
                {a.lowStock.slice(0, 5).map((p) => (
                  <li key={p.name} className="flex items-center gap-3 text-sm"><LuPackageMinus className={cn("size-4 shrink-0", p.usable === 0 ? "text-critical-ink" : "text-soon-ink")} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className={cn("text-xs font-semibold tabular", p.usable === 0 && "text-critical-ink")}>{p.usable} left</span></li>
                ))}
              </ul>
            )}
          </Card>
          <Link to="/app/alerts" className={cn(buttonClass({ variant: "secondary", size: "lg" }), "justify-between")}><span className="flex items-center gap-2"><LuBell />All alerts</span><LuArrowRight /></Link>
        </div>
      </div>
    </AppShell>
  );
}
