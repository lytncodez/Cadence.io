/* Auto-playing product tour for the website: four short animated "screens" of the real app.
   Each scene remounts when it becomes active, so its CSS animations replay from the start. */
import { useEffect, useState, type CSSProperties } from "react";
import { LuScanLine, LuSparkles, LuBell, LuUpload, LuPause, LuPlay, LuFileSpreadsheet, LuEye, LuDatabase, LuMail, LuCircleCheck, LuMousePointer2 } from "react-icons/lu";
import { prefersReducedMotion } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { CountUp, Reveal } from "./motion";

const DURATION = 7000;
const SCENES = [
  { key: "inventory", icon: LuScanLine, title: "Scan a pack, hand over the right batch", body: "Scan any barcode and Cadence lists every batch you hold, earliest expiry first, with the one to dispense already marked.", url: "inventory" },
  { key: "ai", icon: LuSparkles, title: "Ask for a report in plain words", body: "Cadence AI turns sales and stock into a monthly report, a losses breakdown or margins by product, with charts.", url: "insights" },
  { key: "alerts", icon: LuBell, title: "Wake up to the shelf that needs you", body: "A morning SMS to any Ghana network and an email digest list what's expired, what's critical and what's running low.", url: "alerts" },
  { key: "upload", icon: LuUpload, title: "Drop in any sales file", body: "Upload an Excel or CSV. Analyse it once without saving, or add it to your inventory. Reports update instantly.", url: "insights?file" },
] as const;

const d = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export function ProductTour() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduce, setReduce] = useState(false);
  useEffect(() => { setReduce(prefersReducedMotion()); }, []);
  const next = () => setActive((a) => (a + 1) % SCENES.length);
  const running = !paused && !reduce;

  return (
    <section id="tour" className="relative scroll-mt-20 overflow-hidden border-y border-line bg-surface py-24">
      <div className="hex-lattice-ink absolute inset-0 opacity-60" />
      <div className="relative mx-auto max-w-[1200px] px-5">
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[.18em] text-brand-ink uppercase">Product tour</p>
            <h2 className="mt-3 font-display text-[clamp(32px,4.2vw,50px)] leading-[1.05] font-bold">A day at the counter, with Cadence.</h2>
            <p className="mt-4 text-lg text-muted">Four things your team does every day, shown in the app itself.</p>
          </div>
          {!reduce && (
            <button onClick={() => setPaused((p) => !p)} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 shadow-hair hover:text-ink" aria-label={paused ? "Play tour" : "Pause tour"}>
              {paused ? <LuPlay className="size-4" /> : <LuPause className="size-4" />}{paused ? "Play" : "Pause"}
            </button>
          )}
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.25fr)] lg:items-center">
          <ol className="grid gap-2">
            {SCENES.map((s, i) => {
              const on = i === active;
              return (
                <Reveal as="li" key={s.key} delay={i * 80}>
                  <button onClick={() => setActive(i)} aria-current={on ? "step" : undefined}
                    className={cn("relative w-full overflow-hidden rounded-2xl border p-4 text-left transition duration-300", on ? "border-brand/30 bg-bg shadow-card" : "border-transparent hover:bg-sunken")}>
                    <span className="flex items-center gap-3">
                      <span className={cn("hex-clip grid size-10 shrink-0 place-items-center transition", on ? "bg-brand text-on-brand" : "bg-brand-soft text-brand-ink")}><s.icon className="size-[18px]" /></span>
                      <span className={cn("font-display text-[17px] font-semibold transition", !on && "text-ink-2")}>{s.title}</span>
                    </span>
                    <span className={cn("grid transition-[grid-template-rows] duration-500", on ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                      <span className="overflow-hidden"><span className="block pt-2 pl-[52px] text-sm text-muted">{s.body}</span></span>
                    </span>
                    {on && (
                      <span className="absolute inset-x-4 bottom-0 h-[3px] overflow-hidden rounded-full bg-line">
                        <span key={`${active}-${running}`} className="block h-full origin-left bg-brand"
                          style={running ? { animation: `progress ${DURATION}ms linear both` } : { transform: "scaleX(1)" }}
                          onAnimationEnd={() => { if (running) next(); }} />
                      </span>
                    )}
                  </button>
                </Reveal>
              );
            })}
          </ol>

          <Reveal delay={120}>
            <div className="relative">
              <div className="absolute -inset-6 -z-10 rounded-[40px] bg-gradient-to-br from-brand/25 via-violet/15 to-transparent blur-2xl" />
              <div className="overflow-hidden rounded-[22px] border border-line bg-bg shadow-float">
                <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
                  <span className="flex gap-1.5">{["#ff6f69", "#f5b83d", "#3fd486"].map((c) => <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />)}</span>
                  <span className="mx-auto rounded-lg bg-sunken px-3 py-1 font-mono text-[11px] text-muted">app.cadence.io/{SCENES[active].url}</span>
                </div>
                <div className="relative h-[400px] overflow-hidden p-5 sm:h-[420px]" aria-live="polite">
                  <div key={active} className="h-full">
                    {active === 0 && <InventoryScene />}
                    {active === 1 && <AiScene />}
                    {active === 2 && <AlertsScene />}
                    {active === 3 && <UploadScene />}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function InventoryScene() {
  const rows = [
    { b: "AMX-2503", e: "12 days left", q: 26, c: "bg-critical", first: true },
    { b: "AMX-2507", e: "3 months left", q: 40, c: "bg-soon" },
    { b: "AMX-2511", e: "14 months left", q: 120, c: "bg-safe" },
  ];
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface px-3 py-2.5">
        <LuScanLine className="size-5 text-brand-ink" />
        <span className="font-mono text-sm" style={{ animation: "typing 1.1s steps(13) both" }}>6034000123456</span>
        <span className="h-4 w-px bg-ink" style={{ animation: "blink 1s step-end infinite" }} />
        <span className="absolute inset-x-0 h-0.5 bg-brand/70 shadow-[0_0_12px_var(--brand)]" style={{ animation: "scan 1.2s ease-in-out both" }} />
      </div>
      <div className="animate-fade-up" style={d(1100)}>
        <p className="font-display text-lg font-semibold">Amoxicillin 500mg ×21</p>
        <p className="text-xs text-muted">3 batches · 186 units · sorted by expiry</p>
      </div>
      <ul className="grid gap-2">
        {rows.map((r, i) => (
          <li key={r.b} className={cn("relative flex animate-fade-up items-center gap-3 rounded-xl border bg-surface px-3 py-3", r.first ? "border-brand/40" : "border-line")} style={d(1400 + i * 180)}>
            <span className={cn("h-8 w-1 rounded-full", r.c)} />
            <span className="min-w-0 flex-1"><span className="block font-mono text-sm font-medium">{r.b}</span><span className="block text-xs text-muted">{r.e}</span></span>
            <span className="text-sm font-semibold tabular">{r.q}</span>
            {r.first && <span className="absolute -top-2.5 right-3 animate-scale-in rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold tracking-wide text-on-brand uppercase shadow-card" style={d(2300)}>Dispense first</span>}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex animate-fade-up items-center gap-2 rounded-xl bg-safe-soft px-3 py-2.5 text-sm text-safe-ink" style={d(3000)}><LuCircleCheck className="size-4" />2 packs dispensed from AMX-2503 · stock updated</div>
    </div>
  );
}

function AiScene() {
  const bars = [52, 61, 58, 70, 74, 88];
  return (
    <div className="flex h-full flex-col gap-3">
      <p className="ml-auto w-fit animate-fade-up rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-on-brand">How did October go?</p>
      <div className="flex gap-2.5">
        <span className="hex-clip grid size-8 shrink-0 animate-scale-in place-items-center bg-gradient-to-br from-brand to-violet text-white" style={d(500)}><LuSparkles className="size-3.5" /></span>
        <p className="rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2 text-sm" style={{ animation: "typing 1.6s steps(60) 700ms both" }}>Revenue rose 8.4% to ₵47.6k, led by Coartem. Margin is 31.8%.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[["Revenue", 47630, (n: number) => `₵${(n / 1000).toFixed(1)}k`, "+8.4%"], ["Profit", 15150, (n: number) => `₵${(n / 1000).toFixed(1)}k`, "+12.6%"], ["Margin", 31.8, (n: number) => `${n.toFixed(1)}%`, "+1.2 pts"]].map(([l, v, f, delta], i) => (
          <div key={l as string} className="animate-fade-up rounded-xl border border-line bg-surface p-2.5" style={d(1800 + i * 120)}>
            <p className="text-[11px] text-muted">{l as string}</p>
            <p className="font-display text-base font-bold"><Delayed ms={1800 + i * 120}><CountUp value={v as number} format={f as (n: number) => string} /></Delayed></p>
            <p className="text-[11px] font-semibold text-safe-ink">{delta as string}</p>
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 animate-fade-up items-stretch gap-2 rounded-xl border border-line bg-surface px-4 pt-4 pb-3" style={d(2300)}>
        {bars.map((h, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full flex-1 items-end"><div className={cn("w-full origin-bottom rounded-t-md", i === bars.length - 1 ? "bg-brand" : "bg-brand/30")} style={{ height: `${h}%`, animation: `grow-y .7s cubic-bezier(.2,.7,.2,1) ${2400 + i * 90}ms both` }} /></div>
            <span className="text-[10px] text-muted">{["May", "Jun", "Jul", "Aug", "Sep", "Oct"][i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertsScene() {
  const sms = [
    "Cadence: 2 batches EXPIRED (₵412). Remove from shelf.",
    "Amoxicillin AMX-2503 expires in 12 days. 26 units. Dispense first.",
    "Low stock: ORS sachets, 8 left (reorder at 30).",
  ];
  return (
    <div className="flex h-full items-center justify-center gap-5">
      <div className="relative h-full w-[210px] shrink-0 rounded-[30px] border-[6px] border-ink/90 bg-sunken p-3 shadow-float">
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-ink/80" />
        <p className="text-center text-[10px] text-muted">Today 07:30</p>
        <div className="mt-2 grid gap-2">
          {sms.map((t, i) => (
            <p key={i} className="w-[92%] rounded-2xl rounded-bl-md bg-surface px-3 py-2 text-[11.5px] leading-snug shadow-hair" style={{ animation: `drop-in .6s cubic-bezier(.2,.7,.2,1) ${400 + i * 700}ms both` }}>{t}</p>
          ))}
        </div>
      </div>
      <div className="hidden w-56 animate-fade-up rounded-2xl border border-line bg-surface p-4 shadow-card sm:block" style={d(2600)}>
        <p className="flex items-center gap-2 text-xs font-semibold text-muted"><LuMail className="size-4 text-brand-ink" />Daily digest · email</p>
        <p className="mt-2 font-display font-semibold">Harbourview Pharmacy</p>
        <ul className="mt-3 grid gap-2 text-xs">
          {[["Expired", "2", "bg-expired"], ["Critical", "6", "bg-critical"], ["Expiring soon", "9", "bg-soon"], ["Low stock", "3", "bg-brand"]].map(([l, n, c], i) => (
            <li key={l} className="flex animate-fade-up items-center gap-2" style={d(2900 + i * 120)}><span className={cn("size-2 rounded-full", c)} /><span className="flex-1">{l}</span><b className="tabular">{n}</b></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function UploadScene() {
  return (
    <div className="flex h-full flex-col gap-3.5">
      <div className="rounded-2xl border-2 border-dashed border-brand/40 bg-brand-soft/40 p-4">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-card" style={{ animation: "drop-in .8s cubic-bezier(.2,.7,.2,1) 200ms both" }}>
          <span className="hex-clip grid size-10 place-items-center bg-violet/15 text-violet"><LuFileSpreadsheet className="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">october_sales.xlsx</span><span className="block text-xs text-muted">214 rows · 38 KB</span></span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full origin-left rounded-full bg-brand" style={{ animation: "grow-x 1.1s ease-out 1000ms both" }} /></div>
      </div>
      <div className="flex animate-fade-up flex-wrap gap-2 text-xs" style={d(2100)}>
        <span className="rounded-full bg-safe-soft px-2.5 py-1 font-semibold text-safe-ink">211 batches ready</span>
        <span className="rounded-full bg-critical-soft px-2.5 py-1 font-semibold text-critical-ink">3 rows can't be read</span>
      </div>
      <div className="relative grid animate-fade-up grid-cols-2 gap-2.5" style={d(2400)}>
        <div className="rounded-xl border-2 border-brand bg-surface p-3" style={{ animation: "scale-in .3s ease-out 3300ms both" }}>
          <LuEye className="size-4 text-brand-ink" /><p className="mt-1.5 text-sm font-semibold">Analyse only</p><p className="text-[11px] text-muted">Nothing is saved</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-3">
          <LuDatabase className="size-4 text-brand-ink" /><p className="mt-1.5 text-sm font-semibold">Add to inventory</p><p className="text-[11px] text-muted">Saves every batch</p>
        </div>
        <LuMousePointer2 className="absolute size-5 fill-ink text-white drop-shadow" style={{ left: "38%", top: "60%", animation: "drop-in .9s cubic-bezier(.2,.7,.2,1) 2700ms both" }} />
      </div>
      <div className="mt-auto flex animate-fade-up items-center gap-2.5 rounded-xl border border-line bg-surface p-3 text-sm" style={d(3700)}>
        <span className="hex-clip grid size-8 shrink-0 place-items-center bg-gradient-to-br from-brand to-violet text-white"><LuSparkles className="size-3.5" /></span>
        <span>Sales in the file come to <b>₵52,180</b> at a <b>33.1%</b> margin. <b>₵1,240</b> has expired.</span>
      </div>
    </div>
  );
}

/** Renders children only after `ms`, so a count-up starts when its card appears. */
function Delayed({ ms, children }: { ms: number; children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), prefersReducedMotion() ? 0 : ms); return () => clearTimeout(t); }, [ms]);
  return on ? <>{children}</> : <span className="opacity-0">0</span>;
}
