import { useMemo } from "react";
import { LuArrowUpRight, LuArrowDownRight, LuSparkles, LuArrowRight, LuTriangleAlert, LuPackage, LuWallet, LuPercent, LuScanLine, LuPlus } from "react-icons/lu";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, StatusPill, Avatar, buttonClass } from "@/components/ui/primitives";
import { ExpiryHeatmap, RevenueChart, Sparkline, StatusDonut } from "@/components/charts";
import { useCan, useCurrentUser, useStore } from "@/lib/api";
import { summarize } from "@/lib/analytics";
import { useCountUp } from "@/lib/hooks";
import { Link, navigate } from "@/lib/router";
import { cn, compactMoney, greeting, int, money, MONTHS_LONG, relDays } from "@/lib/utils";

export default function Overview() {
  const user = useCurrentUser()!;
  const can = useCan();
  const items = useStore((s) => s.items);
  const monthly = useStore((s) => s.monthly);
  const thresholds = useStore((s) => s.thresholds);
  const a = useMemo(() => summarize(items, monthly, thresholds), [items, monthly, thresholds]);
  const finance = can("view_finance");
  const next = a.rows.filter((r) => r.status !== "expired").slice(0, 6);
  const atRisk = a.value.critical;
  const month = MONTHS_LONG[new Date().getMonth()];

  return (
    <AppShell title="Overview">
      {/* Greeting band */}
      <section className="mesh-brand grain relative mb-6 overflow-hidden rounded-3xl px-6 py-7 text-white shadow-float sm:px-8">
        <div className="hex-lattice absolute inset-0 opacity-60" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} photo={user.photo} size={56} className="ring-0" />
            <div>
              <p className="text-sm text-[#b9c7ea]">{greeting()},</p>
              <h2 className="font-display text-[28px] leading-tight font-bold">{user.name.split(" ")[0]}</h2>
              <p className="mt-1 text-sm text-[#b9c7ea]">
                {a.counts.critical + a.counts.expired > 0
                  ? <><b className="text-white">{a.counts.critical} critical</b> and <b className="text-white">{a.counts.expired} expired</b> batches need you today.</>
                  : "Nothing urgent on the shelf today."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/inventory?status=critical" className={cn(buttonClass({ size: "md" }), "border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:border-white/30")}><LuTriangleAlert />Review critical</Link>
            {can("edit_inventory") && <button onClick={() => navigate("/inventory?add=1")} className={cn(buttonClass({ size: "md" }), "border-transparent bg-white text-[#0a1640] hover:bg-white/90")}><LuPlus />Add stock</button>}
          </div>
        </div>
      </section>

      {/* KPI tiles */}
      <div className={cn("grid grid-cols-2 gap-4", finance && "xl:grid-cols-4")}>
        {finance && <Kpi icon={<LuWallet />} label={`Revenue · ${month}`} value={a.kpi.revenue} format={compactMoney} delta={a.kpi.revenueDelta} spark={a.weekly} delay={0} />}
        {finance && <Kpi icon={<LuPercent />} label="Gross margin" value={a.kpi.margin} format={(n) => n.toFixed(1) + "%"} delta={a.kpi.marginDelta} deltaUnit=" pts" spark={a.weekly.map((v, i) => v * (0.3 + i * 0.002))} delay={1} />}
        <Kpi icon={<LuPackage />} label="Usable stock" value={a.units - a.rows.filter((r) => r.status === "expired").reduce((s, r) => s + r.qty, 0)} format={(n) => int(Math.round(n)) + " units"} sub={`${a.rows.length} batches · ${a.products.length} products`} delay={2} />
        <Kpi icon={<LuTriangleAlert />} tone="critical" label={`At risk · next ${thresholds.criticalMax} days`} value={atRisk} format={(n) => money(n, 0)} sub={`${a.counts.critical} batches · ${money(a.value.expired, 0)} already expired`} delay={3} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* Expiry calendar */}
        <Card className="animate-fade-up [animation-delay:120ms]">
          <CardHeader title="Expiry calendar" subtitle="What leaves the shelf over the next 14 weeks" action={<Link to="/inventory" className="flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">Inventory<LuArrowRight className="size-4" /></Link>} />
          <div className="px-5 pb-5"><ExpiryHeatmap rows={a.rows} onPick={() => navigate("/inventory?status=critical")} /></div>
        </Card>

        {/* Dispense next */}
        <Card className="animate-fade-up [animation-delay:180ms]">
          <CardHeader title="Dispense next" subtitle="First-expiry-first-out, across every product" action={<button onClick={() => navigate("/inventory?scan=1")} className={buttonClass({ variant: "soft", size: "sm" })}><LuScanLine />Scan</button>} />
          <ul className="px-2 pb-3">
            {next.map((b, i) => (
              <li key={b.id}>
                <Link to={`/inventory?batch=${b.id}`} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-sunken">
                  <span className="w-4 text-right font-mono text-xs text-muted tabular">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{b.name}</span>
                    <span className="block text-xs text-muted"><span className="font-mono">{b.batch}</span> · {relDays(b.days)} · {b.qty} units</span>
                  </span>
                  <StatusPill status={b.status} short />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className={cn("mt-4 grid gap-4", finance ? "xl:grid-cols-[1.6fr_1fr]" : "xl:grid-cols-2")}>
        {finance ? (
          <Card className="animate-fade-up [animation-delay:240ms]">
            <CardHeader title="Revenue vs cost" subtitle="Last six months" action={<div className="flex gap-3 text-xs text-muted"><span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-brand" />Revenue</span><span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded border-t-2 border-dashed border-violet" />Cost</span></div>} />
            <div className="px-3 pb-4"><RevenueChart data={a.monthly} /></div>
          </Card>
        ) : null}
        <div className="grid gap-4">
          <Card className="animate-fade-up [animation-delay:300ms]">
            <CardHeader title="Stock value by status" subtitle="At unit cost" />
            <div className="px-5 pb-5"><StatusDonut value={a.value} center={{ label: "Total", value: compactMoney(a.stockValue + a.value.expired) }} /></div>
          </Card>
          {can("view_insights") && (
            <Card className="relative animate-fade-up overflow-hidden [animation-delay:360ms]">
              <div className="hex-lattice-ink absolute inset-0" />
              <div className="relative p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-brand-ink"><span className="grid size-7 place-items-center rounded-lg bg-brand text-on-brand"><LuSparkles className="size-4" /></span>AI insight</div>
                <p className="mt-3 text-[15px] leading-relaxed text-ink">
                  {a.top[0] ? <>Sales are {a.kpi.revenueDelta >= 0 ? "up" : "down"} <b>{Math.abs(a.kpi.revenueDelta).toFixed(1)}%</b> on last month, led by <b>{a.top[0].name.split(" ")[0]}</b>. </> : null}
                  <b>{money(atRisk, 0)}</b> of stock expires within {thresholds.criticalMax} days{a.lowStock.length ? <>, and <b>{a.lowStock.length} products</b> are below reorder level</> : null}.
                </p>
                <Link to="/insights" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline">Ask a follow-up<LuArrowRight className="size-4" /></Link>
              </div>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({ icon, label, value, format, delta, deltaUnit = "%", spark, sub, tone, delay }: {
  icon: React.ReactNode; label: string; value: number; format: (n: number) => string; delta?: number; deltaUnit?: string; spark?: number[]; sub?: string; tone?: "critical"; delay: number;
}) {
  const shown = useCountUp(value);
  const up = (delta ?? 0) >= 0;
  return (
    <Card className="group animate-fade-up p-5 transition hover:-translate-y-0.5 hover:shadow-float" style={{ animationDelay: `${delay * 60}ms` }}>
      <div className="flex items-center justify-between">
        <span className={cn("grid size-9 place-items-center rounded-xl [&_svg]:size-[18px]", tone === "critical" ? "bg-critical-soft text-critical-ink" : "bg-brand-soft text-brand-ink")}>{icon}</span>
        {delta !== undefined && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular", up ? "bg-safe-soft text-safe-ink" : "bg-critical-soft text-critical-ink")}>
            {up ? <LuArrowUpRight className="size-3.5" /> : <LuArrowDownRight className="size-3.5" />}{Math.abs(delta).toFixed(1)}{deltaUnit}
          </span>
        )}
      </div>
      <p className="mt-4 text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 font-display text-[26px] leading-tight font-bold tracking-tight tabular sm:text-[30px]">{format(shown)}</p>
      {spark ? <Sparkline data={spark} color={tone === "critical" ? "var(--critical)" : "var(--brand)"} className="mt-2" /> : <p className="mt-2 text-xs text-muted">{sub}</p>}
    </Card>
  );
}
