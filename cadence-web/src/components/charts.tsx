import { useId, useMemo, useState } from "react";
import { area, arc, curveMonotoneX, line, pie } from "d3-shape";
import { scaleLinear } from "d3-scale";
import { addDays, cn, daysUntil, fmtDate, money, MONTHS, todayISO } from "@/lib/utils";
import { STATUS_META, STATUS_ORDER } from "@/lib/analytics";
import type { Batch, Month, Status } from "@/lib/types";

const STATUS_VAR: Record<Status, string> = { expired: "var(--expired)", critical: "var(--critical)", soon: "var(--soon)", safe: "var(--safe)" };

/* ---------------- Sparkline ---------------- */
export function Sparkline({ data, color = "var(--brand)", className }: { data: number[]; color?: string; className?: string }) {
  const id = useId();
  const W = 120, H = 36;
  const x = scaleLinear().domain([0, data.length - 1]).range([2, W - 4]);
  const [lo, hi] = [Math.min(...data), Math.max(...data)];
  const y = scaleLinear().domain([lo - (hi - lo) * 0.15, hi]).range([H - 2, 4]);
  const l = line<number>().x((_, i) => x(i)).y((d) => y(d)).curve(curveMonotoneX)(data)!;
  const a = area<number>().x((_, i) => x(i)).y0(H).y1((d) => y(d)).curve(curveMonotoneX)(data)!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-9 w-full", className)} aria-hidden preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={a} fill={`url(#${id})`} />
      <path d={l} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="2.6" fill="var(--surface)" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

/* ---------------- Revenue vs cost area chart ---------------- */
export function RevenueChart({ data }: { data: Month[] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 250, L = 44, R = 12, T = 16, B = 28;
  const max = Math.max(...data.map((d) => d.revenue)), min = Math.min(...data.map((d) => d.cost));
  const y = scaleLinear().domain([Math.floor((min * 0.85) / 5000) * 5000, max * 1.06]).nice(4).range([H - B, T]);
  const x = scaleLinear().domain([0, data.length - 1]).range([L, W - R]);
  const mk = (k: "revenue" | "cost") => line<Month>().x((_, i) => x(i)).y((d) => y(d[k])).curve(curveMonotoneX)(data)!;
  const fill = area<Month>().x((_, i) => x(i)).y0(H - B).y1((d) => y(d.revenue)).curve(curveMonotoneX)(data)!;
  const h = hover ?? data.length - 1;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Revenue and cost, last six months"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(data.length - 1, Math.round(x.invert(px)))));
        }}>
        <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".22" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={L - 8} y={y(t) + 3} textAnchor="end" className="fill-muted text-[10px]">{`${t / 1000}k`}</text>
          </g>
        ))}
        {data.map((d, i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className={cn("text-[10px]", i === h ? "fill-ink font-semibold" : "fill-muted")}>{d.label}</text>)}
        <line x1={x(h)} x2={x(h)} y1={T} y2={H - B} stroke="var(--line-strong)" />
        <path d={fill} fill={`url(#${id})`} />
        <path d={mk("cost")} fill="none" stroke="var(--violet)" strokeWidth="2" strokeDasharray="5 4" />
        <path d={mk("revenue")} fill="none" stroke="var(--brand)" strokeWidth="2.5" />
        <circle cx={x(h)} cy={y(data[h].cost)} r="4" fill="var(--surface)" stroke="var(--violet)" strokeWidth="2" />
        <circle cx={x(h)} cy={y(data[h].revenue)} r="5" fill="var(--surface)" stroke="var(--brand)" strokeWidth="2.5" />
      </svg>
      <div className="pointer-events-none absolute top-1 rounded-xl border border-line bg-surface/95 px-3 py-2 text-xs shadow-card backdrop-blur"
        style={{ left: `clamp(0px, calc(${(x(h) / W) * 100}% - 70px), calc(100% - 150px))` }}>
        <p className="font-semibold text-ink">{data[h].label} {data[h].year}</p>
        <p className="tabular text-ink-2"><span className="mr-1.5 inline-block size-2 rounded-full bg-brand" />Revenue {money(data[h].revenue)}</p>
        <p className="tabular text-ink-2"><span className="mr-1.5 inline-block size-2 rounded-full bg-violet" />Cost {money(data[h].cost)}</p>
      </div>
    </div>
  );
}

/* ---------------- Status donut ---------------- */
export function StatusDonut({ value, center }: { value: Record<Status, number>; center: { label: string; value: string } }) {
  const [active, setActive] = useState<Status | null>(null);
  const data = STATUS_ORDER.map((s) => ({ s, v: value[s] })).filter((d) => d.v > 0);
  const arcs = pie<{ s: Status; v: number }>().value((d) => d.v).sort(null).padAngle(0.025)(data);
  const R = 80, r = 58;
  const total = data.reduce((a, d) => a + d.v, 0);
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <svg viewBox="-90 -90 180 180" className="size-40 shrink-0" role="img" aria-label="Stock value by expiry status">
        {arcs.map((a) => {
          const on = active === a.data.s;
          const path = arc<typeof a>().innerRadius(on ? r - 3 : r).outerRadius(on ? R + 4 : R).cornerRadius(3)(a)!;
          return <path key={a.data.s} d={path} fill={STATUS_VAR[a.data.s]} opacity={active && !on ? 0.35 : 1} className="transition-all duration-200" onMouseEnter={() => setActive(a.data.s)} onMouseLeave={() => setActive(null)} />;
        })}
        <text textAnchor="middle" y="-4" className="fill-muted text-[10px]">{active ? STATUS_META[active].label : center.label}</text>
        <text textAnchor="middle" y="16" className="fill-ink font-display text-[17px] font-bold">{active ? money(value[active], 0) : center.value}</text>
      </svg>
      <ul className="grid w-full min-w-0 flex-1 gap-2.5">
        {STATUS_ORDER.map((s) => (
          <li key={s} className={cn("flex min-w-0 items-center gap-3 rounded-lg px-1 text-sm transition", active === s && "bg-sunken")} onMouseEnter={() => setActive(s)} onMouseLeave={() => setActive(null)}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_VAR[s] }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{STATUS_META[s].label}</span>
            <span className="tabular font-medium text-ink">{money(value[s], 0)}</span>
            <span className="tabular w-9 shrink-0 text-right text-xs text-muted">{total ? Math.round((value[s] / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Expiry calendar heatmap (next 14 weeks) ---------------- */
export function ExpiryHeatmap({ rows, onPick }: { rows: Batch[]; onPick?: (iso: string) => void }) {
  const [hover, setHover] = useState<{ iso: string; list: Batch[] } | null>(null);
  const { weeks, byDay, monthMarks } = useMemo(() => {
    const t = todayISO();
    const dow = (new Date(t + "T00:00:00").getDay() + 6) % 7; // Monday = 0
    const start = addDays(t, -dow - 7); // include last week so recent expiries show
    const byDay = new Map<string, Batch[]>();
    rows.forEach((r) => { const l = byDay.get(r.expiry) ?? []; l.push(r); byDay.set(r.expiry, l); });
    const weeks: string[][] = [];
    const monthMarks: { col: number; label: string }[] = [];
    for (let w = 0; w < 15; w++) {
      const col: string[] = [];
      for (let d = 0; d < 7; d++) col.push(addDays(start, w * 7 + d));
      const m = Number(col[0].slice(5, 7)) - 1;
      if (w === 0 || Number(weeks[w - 1][0].slice(5, 7)) - 1 !== m) monthMarks.push({ col: w, label: MONTHS[m] });
      weeks.push(col);
    }
    return { weeks, byDay, monthMarks };
  }, [rows]);
  const t = todayISO();
  const tone = (iso: string) => {
    const list = byDay.get(iso);
    const d = daysUntil(iso);
    if (!list) return d < 0 ? "bg-sunken/60" : "bg-sunken";
    const worst = list.reduce<Status>((w, b) => (STATUS_ORDER.indexOf(b.status) < STATUS_ORDER.indexOf(w) ? b.status : w), "safe");
    const strong = list.length > 1 || list.some((b) => b.qty * b.unitCost > 300);
    return { expired: "bg-expired", critical: strong ? "bg-critical" : "bg-critical/55", soon: strong ? "bg-soon" : "bg-soon/55", safe: "bg-safe/60" }[worst];
  };
  return (
    <div className="relative">
      <div className="overflow-x-auto pb-1">
        <div className="inline-grid min-w-full gap-1" style={{ gridTemplateColumns: `22px repeat(${weeks.length}, minmax(16px, 1fr))` }}>
          <span />
          {weeks.map((_, w) => <span key={w} className="h-4 text-[10px] text-muted">{monthMarks.find((m) => m.col === w)?.label ?? ""}</span>)}
          {["M", "", "W", "", "F", "", "S"].map((l, d) => (
            <div key={d} className="contents">
              <span className="text-[10px] leading-4 text-muted">{l}</span>
              {weeks.map((col, w) => {
                const iso = col[d];
                const list = byDay.get(iso) ?? [];
                return (
                  <button
                    key={w}
                    type="button"
                    aria-label={`${fmtDate(iso)}: ${list.length ? list.map((b) => `${b.name} ${b.batch}`).join(", ") : "nothing expires"}`}
                    onMouseEnter={() => setHover({ iso, list })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ iso, list })} onBlur={() => setHover(null)}
                    onClick={() => list.length && onPick?.(iso)}
                    className={cn("aspect-square w-full rounded-[5px] transition hover:scale-110 hover:ring-2 hover:ring-brand/50", tone(iso), iso === t && "ring-2 ring-brand ring-offset-1 ring-offset-surface")}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span className="min-h-4">{hover ? (hover.list.length ? <><b className="text-ink">{fmtDate(hover.iso)}</b> · {hover.list.map((b) => `${b.name.split(" ")[0]} ${b.batch}`).join(", ")}</> : <>{fmtDate(hover.iso)} · nothing expires</>) : "Hover a day to see what expires"}</span>
        <span className="flex items-center gap-3">
          {(["expired", "critical", "soon"] as Status[]).map((s) => <span key={s} className="flex items-center gap-1"><i className="size-2.5 rounded-[3px]" style={{ background: STATUS_VAR[s] }} />{STATUS_META[s].short}</span>)}
        </span>
      </div>
    </div>
  );
}
