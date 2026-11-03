import { useMemo } from "react";
import { LuArrowUpRight, LuArrowDownRight, LuSparkles, LuArrowRight, LuTriangleAlert, LuPackage, LuWallet, LuPercent, LuScanLine, LuPlus, LuPackageMinus, LuUsers, LuCircleCheck, LuCircle } from "react-icons/lu";
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
  const users = useStore((s) => s.users), pharmacy = useStore((s) => s.pharmacy);
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
            <Link to="/app/inventory?status=critical" className={cn(buttonClass({ size: "md" }), "border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:border-white/30")}><LuTriangleAlert />Review critical</Link>
            {can("edit_inventory") && <button onClick={() => navigate("/app/inventory?add=1")} className={cn(buttonClass({ size: "md" }), "border-transparent bg-white text-[#0a1640] hover:bg-white/90")}><LuPlus />Add stock</button>}
          </div>
        </div>
      </section>

      {items.length === 0 && <GettingStarted pharmacy={pharmacy.name} canImport={can("import")} canAdd={can("edit_inventory")} canInvite={can("manage_users")} canAlerts={can("manage_alerts")} />}

      {/* KPI tiles */}
      <div className={cn("grid grid-cols-2 gap-4", finance && "xl:grid-cols-4")}>
        {finance && <Kpi icon={<LuWallet />} label={`Revenue · ${month}`} value={a.kpi.revenue} format={compactMoney} delta={a.kpi.revenueDelta} spark={a.weekly} delay={0} />}
        {finance && <Kpi icon={<LuPercent />} label="Gross margin" value={a.kpi.margin} format={(n) => n.toFixed(1) + "%"} delta={a.kpi.marginDelta} deltaUnit=" pts" spark={a.weekly.map((v, i) => v * (0.3 + i * 0.002))} delay={1} />}
        <Kpi icon={<LuPackage />} label="Usable stock" value={a.units - a.rows.filter((r) => r.status === "expired").reduce((s, r) => s + r.qty, 0)} format={(n) => int(Math.round(n)) + " units"} sub={`${a.rows.length} batches · ${a.products.length} products`} delay={2} />
        {finance
          ? <Kpi icon={<LuTriangleAlert />} tone="critical" label={`At risk · next ${thresholds.criticalMax} days`} value={atRisk} format={(n) => money(n, 0)} sub={`${a.counts.critical} batches · ${money(a.value.expired, 0)} already expired`} delay={3} />
          : <Kpi icon={<LuTriangleAlert />} tone="critical" label={`Critical · next ${thresholds.criticalMax} days`} value={a.counts.critical} format={(n) => int(Math.round(n)) + " batches"} sub={`${a.counts.expired} batches already expired`} delay={3} />}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* Expiry calendar */}
        <Card className="animate-fade-up [animation-delay:120ms]">
          <CardHeader title="Expiry calendar" subtitle="What leaves the shelf over the next 14 weeks" action={<Link to="/app/inventory" className="flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">Inventory<LuArrowRight className="size-4" /></Link>} />
          <div className="px-5 pb-5"><ExpiryHeatmap rows={a.rows} onPick={() => navigate("/app/inventory?status=critical")} /></div>
        </Card>

        {/* Dispense next */}
        <Card className="animate-fade-up [animation-delay:180ms]">
          <CardHeader title="Dispense next" subtitle="First-expiry-first-out, across every product" action={<button onClick={() => navigate("/app/inventory?scan=1")} className={buttonClass({ variant: "soft", size: "sm" })}><LuScanLine />Scan</button>} />
          <ul className="px-2 pb-3">
            {next.map((b, i) => (
              <li key={b.id}>
                <Link to={`/app/inventory?batch=${b.id}`} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-sunken">
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
          {finance && <Card className="animate-fade-up [animation-delay:300ms]">
            <CardHeader title="Stock value by status" subtitle="At unit cost" />
            <div className="px-5 pb-5"><StatusDonut value={a.value} center={{ label: "Total", value: compactMoney(a.stockValue + a.value.expired) }} /></div>
          </Card>}
          {can("view_insights") && (
            <Card className="relative animate-fade-up overflow-hidden [animation-delay:360ms]">
              <div className="hex-lattice-ink absolute inset-0" />
              <div className="relative p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-brand-ink"><span className="grid size-7 place-items-center rounded-lg bg-brand text-on-brand"><LuSparkles className="size-4" /></span>AI insight</div>
                <p className="mt-3 text-[15px] leading-relaxed text-ink">
                  {a.top[0] ? <>Sales are {a.kpi.revenueDelta >= 0 ? "up" : "down"} <b>{Math.abs(a.kpi.revenueDelta).toFixed(1)}%</b> on last month, led by <b>{a.top[0].name.split(" ")[0]}</b>. </> : null}
                  <b>{money(atRisk, 0)}</b> of stock expires within {thresholds.criticalMax} days{a.lowStock.length ? <>, and <b>{a.lowStock.length} products</b> are below reorder level</> : null}.
                </p>
                <Link to="/app/insights" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline">Ask a follow-up<LuArrowRight className="size-4" /></Link>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Role extras: pharmacists manage reorders; admins also look after the team and setup. */}
      {(can("edit_inventory") || can("manage_users")) && (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {can("edit_inventory") && (
            <Card className="animate-fade-up [animation-delay:420ms]">
              <CardHeader title="Reorder soon" subtitle="Usable stock below its reorder level" action={<Link to="/app/inventory" className="flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">Inventory<LuArrowRight className="size-4" /></Link>} />
              {a.lowStock.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Every product is above its reorder level.</p> : (
                <ul className="grid gap-2 px-5 pb-5">
                  {a.lowStock.slice(0, 6).map((p) => (
                    <li key={p.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                      <LuPackageMinus className={cn("size-4", p.usable === 0 ? "text-critical-ink" : "text-soon-ink")} />
                      <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block h-1.5 overflow-hidden rounded-full bg-sunken"><span className={cn("block h-full rounded-full", p.usable === 0 ? "bg-critical" : "bg-soon")} style={{ width: `${Math.min(100, (p.usable / Math.max(1, p.reorderLevel)) * 100)}%` }} /></span></span>
                      <span className="text-xs text-muted tabular"><b className={cn("text-ink", p.usable === 0 && "text-critical-ink")}>{p.usable}</b> / {p.reorderLevel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {can("manage_users") && <AdminCard users={users} pharmacyName={pharmacy.name} licence={pharmacy.licenceNo} itemCount={items.length} />}
        </div>
      )}
    </AppShell>
  );
}

function GettingStarted({ pharmacy, canImport, canAdd, canInvite, canAlerts }: { pharmacy: string; canImport: boolean; canAdd: boolean; canInvite: boolean; canAlerts: boolean }) {
  const steps = [
    canImport && { n: "Bring in your stock list", d: "Upload your Excel or CSV export. Cadence checks every row before saving.", to: "/app/inventory?import=1", cta: "Import stock" },
    canAdd && { n: "Or add batches one by one", d: "Scan the barcode, enter the batch number, expiry date and quantity.", to: "/app/inventory?add=1", cta: "Add a batch" },
    canInvite && { n: "Invite your team", d: "Pharmacists and dispensers each get the view their role needs.", to: "/app/settings?tab=team&invite=1", cta: "Invite people" },
    canAlerts && { n: "Choose who gets alerts", d: "Add the phone numbers and email for the morning expiry digest.", to: "/app/alerts", cta: "Set up alerts" },
  ].filter(Boolean) as { n: string; d: string; to: string; cta: string }[];
  return (
    <Card className="relative mb-6 animate-fade-up overflow-hidden">
      <div className="hex-lattice-ink absolute inset-0" />
      <div className="relative p-6">
        <p className="text-xs font-semibold tracking-[.18em] text-brand-ink uppercase">Getting started</p>
        <h3 className="mt-2 font-display text-2xl font-bold">Welcome to Cadence, {pharmacy}.</h3>
        <p className="mt-1 text-muted">Your account is ready and only your team can see it. Four steps and the dashboard fills in.</p>
        <ol className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.n} className="flex flex-col rounded-2xl border border-line bg-surface p-4">
              <span className="hex-clip grid size-9 place-items-center bg-brand font-display text-sm font-bold text-on-brand">{i + 1}</span>
              <p className="mt-3 font-semibold">{s.n}</p>
              <p className="mt-1 flex-1 text-sm text-muted">{s.d}</p>
              <Link to={s.to} className={cn(buttonClass({ variant: i === 0 ? "primary" : "secondary", size: "sm" }), "mt-4 self-start")}>{s.cta}<LuArrowRight /></Link>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function AdminCard({ users, pharmacyName, licence, itemCount }: { users: { id: string; name: string; photo: string; role: string; status: string; lastLogin: string }[]; pharmacyName: string; licence?: string; itemCount: number }) {
  const active = users.filter((u) => u.status === "Active");
  const steps = [
    { done: !!pharmacyName && !!licence, label: "Pharmacy name and licence number", to: "/app/settings?tab=pharmacy" },
    { done: itemCount > 0, label: "Stock loaded", to: "/app/inventory?import=1" },
    { done: active.length > 1, label: "Team members added", to: "/app/settings?tab=team" },
    { done: users.some((u) => !!u.lastLogin && u.role !== "Admin"), label: "Staff have signed in", to: "/app/settings?tab=team" },
  ];
  return (
    <Card className="animate-fade-up [animation-delay:480ms]">
      <CardHeader title="Your team" subtitle={`${active.length} active · ${users.length - active.length} invited or suspended`} action={<Link to="/app/settings?tab=team" className="flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline"><LuUsers className="size-4" />Manage</Link>} />
      <div className="flex flex-wrap gap-3 px-5">
        {users.slice(0, 6).map((u) => (
          <Link key={u.id} to={`/app/profile/${u.id}`} className="flex items-center gap-2 rounded-full border border-line py-1 pr-3 pl-1 text-sm transition hover:border-line-strong" title={u.lastLogin ? `Last sign-in ${u.lastLogin.replace("T", " ")}` : "Hasn't signed in yet"}>
            <Avatar name={u.name} photo={u.photo} size={26} /><span className="font-medium">{u.name.split(" ")[0]}</span><span className="text-xs text-muted">{u.role}</span>
            {u.status !== "Active" && <span className="rounded-full bg-soon-soft px-1.5 text-[10px] font-semibold text-soon-ink">{u.status}</span>}
          </Link>
        ))}
      </div>
      <div className="mt-4 border-t border-line px-5 py-4">
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Setup</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {steps.map((s) => (
            <li key={s.label}><Link to={s.to} className={cn("flex items-center gap-2 text-sm hover:underline", s.done ? "text-muted" : "text-ink")}>{s.done ? <LuCircleCheck className="size-4 text-safe" /> : <LuCircle className="size-4 text-muted" />}{s.label}</Link></li>
          ))}
        </ul>
      </div>
    </Card>
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
