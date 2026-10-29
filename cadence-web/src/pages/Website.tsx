/* Public marketing website. "Log in" goes to /login; signed-in visitors see "Open dashboard" instead. */
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  LuArrowRight, LuCheck, LuMessageSquare, LuSparkles, LuLayers, LuScanLine, LuBell, LuUpload, LuPercent, LuCoins,
  LuShieldCheck, LuMinus, LuMenu, LuX, LuCircleCheck, LuStore,
} from "react-icons/lu";
import { Avatar, Button, Field, Input, Logo, StatusPill, buttonClass } from "@/components/ui/primitives";
import { Sparkline } from "@/components/charts";
import { ProductTour } from "@/components/site/ProductTour";
import { CountUp, Marquee, Reveal } from "@/components/site/motion";
import { prefersReducedMotion } from "@/lib/hooks";
import { useCurrentUser } from "@/lib/api";
import { statusFor } from "@/lib/analytics";
import { Link } from "@/lib/router";
import { cn, storage } from "@/lib/utils";
import type { Status } from "@/lib/types";

const NAV = [["#tour", "Product tour"], ["#rhythm", "Expiry bands"], ["#features", "Features"], ["#roles", "For your team"], ["#faq", "FAQ"]] as const;

export default function Website() {
  const user = useCurrentUser();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    document.title = "Cadence.io · Expiry tracking and AI insights for pharmacies";
    const on = () => setScrolled(window.scrollY > 10);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault(); setMenu(false);
    document.querySelector(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onHero = !scrolled && !menu;
  const authCta = user
    ? <Link to="/app" className={cn(buttonClass({ variant: "secondary", size: "md" }), "gap-2.5 pl-1.5")}><Avatar name={user.name} photo={user.photo} size={26} />Open dashboard</Link>
    : <Link to="/login" className={cn(buttonClass({ variant: "ghost", size: "md" }), onHero && "text-white hover:bg-white/10 hover:text-white")}>Log in</Link>;

  return (
    <div className="min-h-full bg-bg">
      {/* Nav */}
      <header className={cn("fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] transition-colors duration-300", scrolled || menu ? "glass border-b border-line/70" : "bg-transparent")}>
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5">
          <Link to="/" aria-label="Cadence.io home"><Logo onDark={!scrolled && !menu} /></Link>
          <nav className="hidden gap-1 md:flex" aria-label="Sections">
            {NAV.map(([h, l]) => <a key={h} href={h} onClick={jump(h)} className={cn("rounded-lg px-3 py-2 text-sm font-medium transition", scrolled ? "text-ink-2 hover:bg-sunken hover:text-ink" : "text-white/75 hover:bg-white/10 hover:text-white")}>{l}</a>)}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {authCta}
            <a href="#demo" onClick={jump("#demo")} className={buttonClass({ variant: "primary", size: "md" })}>Book a demo</a>
          </div>
          <button className={cn("ml-auto grid size-10 place-items-center rounded-xl md:hidden", scrolled || menu ? "text-ink hover:bg-sunken" : "text-white hover:bg-white/10")} onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label={menu ? "Close menu" : "Open menu"}>
            {menu ? <LuX className="size-5" /> : <LuMenu className="size-5" />}
          </button>
        </div>
        {menu && (
          <div className="animate-fade-up border-t border-line px-5 pt-2 pb-5 md:hidden">
            {NAV.map(([h, l]) => <a key={h} href={h} onClick={jump(h)} className="block border-b border-line py-3 font-medium">{l}</a>)}
            <div className="mt-4 grid gap-2">
              <Link to={user ? "/app" : "/login"} className={buttonClass({ variant: "secondary", size: "lg" })}>{user ? "Open dashboard" : "Log in"}</Link>
              <a href="#demo" onClick={jump("#demo")} className={buttonClass({ variant: "primary", size: "lg" })}>Book a demo</a>
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="mesh-brand grain relative overflow-hidden text-white" onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`); e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`); }}>
        <div className="hex-lattice absolute inset-0 opacity-70" />
        <div className="pointer-events-none absolute inset-0 hidden transition-opacity duration-500 md:block" style={{ background: "radial-gradient(520px circle at var(--mx, 70%) var(--my, 30%), rgba(143,176,255,.22), transparent 60%)" }} aria-hidden />
        <div className="pointer-events-none absolute -top-40 -right-40 size-[560px] rounded-full border border-white/[.07]" style={{ animation: "orbit 60s linear infinite" }} aria-hidden><span className="absolute top-1/2 -left-1.5 size-3 rounded-full bg-[#8fb0ff] shadow-[0_0_18px_#8fb0ff]" /></div>
        <div className="pointer-events-none absolute -bottom-56 -left-32 size-[460px] rounded-full border border-white/[.06]" style={{ animation: "orbit 45s linear infinite reverse" }} aria-hidden><span className="absolute -top-1 left-1/2 size-2 rounded-full bg-[#5fe0a0] shadow-[0_0_14px_#5fe0a0]" /></div>
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-14 px-5 pt-32 pb-24 lg:grid-cols-[1.05fr_1fr] lg:pt-40 lg:pb-32">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.07] px-3 py-1.5 text-xs font-medium text-[#c9d6f5] backdrop-blur">
              <span className="size-1.5 rounded-full bg-[#5fe0a0]" />Built for pharmacies in Ghana
            </p>
            <h1 className="mt-6 animate-fade-up font-display [animation-delay:80ms] text-[clamp(44px,6.6vw,84px)] leading-[.98] font-extrabold tracking-[-0.035em]">
              Every batch,<br />dispensed <span className="relative whitespace-nowrap text-[#8fb0ff]">on time.<svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" aria-hidden><path d="M2 8 Q 75 2 150 7 T 298 5" fill="none" stroke="#8fb0ff" strokeWidth="3" strokeLinecap="round" strokeDasharray="10 8" /></svg></span>
            </h1>
            <p className="mt-7 max-w-xl animate-fade-up text-lg leading-relaxed text-[#c3cfee] [animation-delay:180ms]">
              Cadence.io tracks every batch on your shelves by its expiry date, tells your team which one to dispense first, and turns your sales and stock into plain-language AI reports.
            </p>
            <div className="mt-9 flex animate-fade-up flex-wrap gap-3 [animation-delay:260ms]">
              <a href="#demo" onClick={jump("#demo")} className={cn(buttonClass({ size: "lg" }), "border-transparent bg-white text-[#0a1640] shadow-xl hover:bg-white/90")}>Book a demo<LuArrowRight /></a>
              <Link to={user ? "/app" : "/login"} className={cn(buttonClass({ size: "lg" }), "border-white/20 bg-white/10 text-white backdrop-blur hover:border-white/35 hover:bg-white/15")}>{user ? "Open your dashboard" : "Log in to your pharmacy"}</Link>
            </div>
            <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#a9b8de]">
              {["Works on counter PCs and phones", "Morning SMS to +233 numbers", "Prices in cedis"].map((t) => <li key={t} className="flex items-center gap-2"><LuCheck className="size-4 text-[#5fe0a0]" />{t}</li>)}
            </ul>
          </div>
          <HeroProduct />
        </div>
        <svg className="absolute -bottom-px left-0 w-full text-bg" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden><path d="M0 60 L0 30 Q 360 0 720 24 T 1440 18 L1440 60Z" fill="currentColor" /></svg>
      </section>

      {/* Ticker */}
      <section className="border-b border-line py-6" aria-label="Highlights">
        <Marquee>
          {([
            [LuCoins, "Cedi pricing, costs and margins"], [LuMessageSquare, "SMS on MTN, Telecel and AT"], [LuShieldCheck, "Pharmacy Council licence fields"],
            [LuUpload, "Import your Excel list"], [LuScanLine, "Barcode scan, FEFO dispensing"], [LuSparkles, "AI reports in plain words"],
            [LuBell, "07:30 expiry SMS"], [LuPercent, "Losses at purchase price"],
          ] as const).map(([Icon, t]) => (
            <span key={t} className="mx-3 inline-flex items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium whitespace-nowrap shadow-hair">
              <Icon className="size-4 text-brand-ink" />{t}
            </span>
          ))}
        </Marquee>
      </section>

      <ProductTour />
      <Rhythm />
      <Features />
      <Roles />
      <FaqDemo />

      {/* Closing band */}
      <section className="mx-auto max-w-[1200px] px-5 pb-20">
        <div className="mesh-brand grain relative overflow-hidden rounded-[28px] px-8 py-14 text-center text-white shadow-float sm:px-14">
          <div className="hex-lattice absolute inset-0 opacity-60" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl font-display text-[clamp(30px,4vw,48px)] leading-[1.05] font-bold">Stop finding expired stock at the back of the shelf.</h2>
            <p className="mx-auto mt-4 max-w-lg text-[#c3cfee]">Set up takes an afternoon. Bring your current stock list and we'll load it with you.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a href="#demo" onClick={jump("#demo")} className={cn(buttonClass({ size: "lg" }), "border-transparent bg-white text-[#0a1640] hover:bg-white/90")}>Book a demo<LuArrowRight /></a>
              <Link to={user ? "/app" : "/login"} className={cn(buttonClass({ size: "lg" }), "border-white/20 bg-white/10 text-white hover:bg-white/15")}>{user ? "Open dashboard" : "Log in"}</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-muted">Expiry tracking and AI insights for pharmacies. Fewer write-offs, clearer decisions.</p>
          </div>
          {[
            ["Product", [["#tour", "Product tour"], ["#features", "Features"], ["#rhythm", "Expiry bands"], ["#roles", "Roles"]]],
            ["Company", [["#demo", "Book a demo"], ["#faq", "FAQ"]]],
          ].map(([h, links]) => (
            <div key={h as string}>
              <p className="mb-3 text-sm font-semibold">{h as string}</p>
              <ul className="grid gap-2 text-sm text-muted">{(links as [string, string][]).map(([href, l]) => <li key={href}><a href={href} onClick={jump(href)} className="hover:text-ink">{l}</a></li>)}</ul>
            </div>
          ))}
          <div>
            <p className="mb-3 text-sm font-semibold">Your pharmacy</p>
            <ul className="grid gap-2 text-sm text-muted"><li><Link to={user ? "/app" : "/login"} className="hover:text-ink">{user ? "Open dashboard" : "Log in"}</Link></li></ul>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-2 border-t border-line px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-xs text-muted">
          <span>© {new Date().getFullYear()} Cadence.io</span><span>Made in Ghana</span>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- Hero product collage ---------------- */
function HeroProduct() {
  const rows: { n: string; b: string; d: string; s: Status }[] = [
    { n: "Diclofenac 50mg ×30", b: "DIC-2410", d: "expired 6 days ago · 9 units", s: "expired" },
    { n: "Amoxicillin 500mg ×21", b: "AMX-2503", d: "12 days left · 26 units", s: "critical" },
    { n: "Coartem 80/480mg ×6", b: "CTM-2502", d: "41 days left · 38 units", s: "soon" },
    { n: "Paracetamol 500mg ×100", b: "PCM-2408", d: "13 months left · 64 units", s: "safe" },
  ];
  // Walk the "dispense next" highlight down the FEFO list, like a dispenser working through the shelf.
  const [hi, setHi] = useState(1);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = window.setInterval(() => setHi((h) => (h % 3) + 1), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative mx-auto mb-20 w-full max-w-[540px] animate-fade-up [animation-delay:150ms] lg:mx-0">
      <div className="dark rounded-[26px] border border-white/12 bg-[#0d1530]/80 p-2 shadow-[0_40px_100px_-20px_rgba(0,0,0,.6)] backdrop-blur-xl">
        <div className="rounded-[20px] border border-white/8 bg-[#0d1427]">
          <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
            <div className="flex items-center gap-2.5 text-sm"><LuStore className="size-4 text-[#8fb0ff]" /><span className="font-semibold text-white">Dispense next</span></div>
            <span className="text-xs text-[#8592b0]">Main dispensary · FEFO</span>
          </div>
          <div className="grid grid-cols-3 gap-2 border-b border-white/8 p-3">
            {([["Critical", 6, (n: number) => String(Math.round(n)), "text-[#ff9e99]"], ["At risk", 1629, (n: number) => "₵" + Math.round(n).toLocaleString("en-GH"), "text-white"], ["Margin", 31.8, (n: number) => n.toFixed(1) + "%", "text-[#6fe3a5]"]] as const).map(([l, v, f, c]) => (
              <div key={l} className="rounded-xl bg-white/[.04] px-3 py-2.5"><p className="text-[11px] text-[#8592b0]">{l}</p><p className={cn("font-display text-lg font-bold", c)}><CountUp value={v} format={f} duration={1600} /></p></div>
            ))}
          </div>
          <ul className="p-2">
            {rows.map((r, i) => (
              <li key={r.b} className={cn("relative flex items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-500", i === hi && "bg-white/[.07]")}>
                {i === hi && <span className="absolute inset-0 animate-scale-in rounded-xl ring-1 ring-[#8fb0ff]/40" />}
                <span className={cn("h-9 w-1 rounded-full", { expired: "bg-[#9aa3b8]", critical: "bg-[#ff6f69]", soon: "bg-[#f5b83d]", safe: "bg-[#3fd486]" }[r.s])} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{r.n}</span><span className="block text-xs text-[#8592b0]"><span className="font-mono">{r.b}</span> · {r.d}</span></span>
                {i === hi ? <span className="animate-scale-in rounded-full bg-[#8fb0ff] px-2 py-0.5 text-[10px] font-bold text-[#0a1640] uppercase">Next</span> : <StatusPill status={r.s} short />}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="animate-float absolute -top-6 -right-3 hidden w-64 rounded-2xl border border-line bg-surface p-3.5 text-ink shadow-float sm:block">
        <div className="flex items-center gap-2 text-xs text-muted"><span className="grid size-6 place-items-center rounded-lg bg-critical-soft text-critical-ink"><LuMessageSquare className="size-3.5" /></span>SMS · 07:30</div>
        <p className="mt-2 text-[13px] leading-snug">Amoxicillin <span className="font-mono">AMX-2503</span> expires in 12 days. 26 units left. Dispense first.</p>
      </div>
      <div className="absolute -bottom-28 -left-8 hidden w-72 rounded-2xl border border-line bg-surface p-4 text-ink shadow-float sm:block" style={{ animation: "float 8s ease-in-out -3s infinite" }}>
        <div className="flex items-center gap-2 text-xs font-semibold text-brand-ink"><span className="grid size-6 place-items-center rounded-lg bg-brand text-on-brand"><LuSparkles className="size-3.5" /></span>AI insight</div>
        <p className="mt-2 text-[13px] leading-snug">Sales are up <b>8.4%</b> this month, led by Coartem. <b>₵1,629</b> expires within 30 days.</p>
        <Sparkline data={[38, 40, 39.5, 42.7, 43.9, 47.6]} className="mt-2 h-8" />
      </div>
    </div>
  );
}

/* ---------------- Expiry bands animation ---------------- */
const MIN = -10, MAX = 170;
const pos = (d: number) => ((Math.max(MIN, Math.min(MAX, d)) - MIN) / (MAX - MIN)) * 100;
const DOT: Record<Status, string> = { expired: "#9aa3b8", critical: "#ff6f69", soon: "#f5b83d", safe: "#3fd486" };
const CODES = ["AMX", "CTM", "LNT", "PCM", "MET", "VEN", "ORS", "IBU", "CET", "OMP"];

function Rhythm() {
  const [day, setDay] = useState(1);
  const [batches, setBatches] = useState(() => [12, 41, 118, 23, 66, 152].map((d, i) => ({ id: i, d, code: `${CODES[i]}-${2503 + i}`, top: [24, 38, 52, 66, 80, 92][i], fresh: false })));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number | undefined, serial = 2600;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !timer) timer = window.setInterval(() => {
        setDay((x) => x + 3);
        setBatches((bs) => bs.map((b) => b.d - 3 < MIN
          ? { ...b, d: 150 + Math.round(Math.random() * 20), code: `${CODES[Math.floor(Math.random() * CODES.length)]}-${serial++}`, fresh: true }
          : { ...b, d: b.d - 3, fresh: false }));
      }, 900);
      if (!e.isIntersecting && timer) { clearInterval(timer); timer = undefined; }
    }, { threshold: 0.25 });
    if (ref.current) io.observe(ref.current);
    return () => { io.disconnect(); clearInterval(timer); };
  }, []);
  return (
    <section id="rhythm" className="scroll-mt-20 bg-navy py-24 text-white">
      <div className="mx-auto max-w-[1200px] px-5">
        <p className="text-xs font-semibold tracking-[.18em] text-[#8fb0ff] uppercase">The cadence of your shelf</p>
        <h2 className="mt-3 max-w-3xl font-display text-[clamp(32px,4.4vw,54px)] leading-[1.04] font-bold">Every batch moves toward its expiry date. Cadence keeps time.</h2>
        <p className="mt-5 max-w-2xl text-lg text-[#a9b8de]">Each day every batch slides one step closer to zero. One fixed rule sorts them into four bands, so the counter, the alerts and the reports always agree on what needs attention.</p>
        <div ref={ref} className="mt-12">
          <div className="mb-3 flex justify-between text-xs text-[#93a5cf]"><span>Simulated shelf · each beat is 3 days</span><span>Day <b className="text-white tabular">{day}</b></span></div>
          <div className="relative flex h-44 overflow-hidden rounded-2xl ring-1 ring-white/10" role="img" aria-label="Batches moving through the expired, critical, expiring soon and safe bands">
            {([["Expired", 10, "rgba(154,163,184,.16)", "#c4cbda"], ["Critical", 30, "rgba(255,111,105,.16)", "#ff9e99"], ["Expiring soon", 60, "rgba(245,184,61,.14)", "#ffd27a"], ["Safe", 80, "rgba(63,212,134,.12)", "#7ee0aa"]] as const).map(([l, f, bg, c]) => (
              <div key={l} className="border-r border-dashed border-white/15 px-3 py-2.5 text-[11px] font-bold tracking-wider uppercase last:border-0" style={{ flex: f, background: bg, color: c }}><span className="block truncate">{l}</span></div>
            ))}
            {batches.map((b) => (
              <div key={b.id} className={cn("absolute", !b.fresh && "transition-[left] duration-[850ms] ease-linear")} style={{ left: `${pos(b.d)}%`, top: `${b.top}%` }}>
                <span className="absolute -mt-[7px] -ml-[7px] block size-3.5 rounded-full border-2 border-white/90 transition-colors duration-500" style={{ background: DOT[statusFor(b.d)] }} />
                <span className={cn("absolute -translate-y-1/2 font-mono text-[11px] whitespace-nowrap text-white/85", pos(b.d) > 62 ? "right-3" : "left-3")}>{b.code} · {b.d <= 0 ? "expired" : `${b.d}d`}</span>
              </div>
            ))}
          </div>
          <div className="relative mt-2 h-5 text-xs text-[#93a5cf] tabular">
            {[[0, "0 days"], [30, "30"], [90, "90"]].map(([d, l]) => <span key={l} className="absolute -translate-x-1/2" style={{ left: `${pos(d as number)}%` }}>{l}</span>)}
            <span className="absolute right-0">170+ days</span>
          </div>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {([["Expired", "0 days or less", "Quarantine and record the write-off.", "#9aa3b8"], ["Critical", "1–30 days", "Dispense first. SMS goes out each morning.", "#ff6f69"], ["Expiring soon", "31–90 days", "Move to the front, slow reorders.", "#f5b83d"], ["Safe", "Over 90 days", "Stock as normal.", "#3fd486"]] as const).map(([t, r, d, c]) => (
            <div key={t} className="border-t-2 pt-4" style={{ borderColor: c }}><p className="font-semibold">{t} <span className="font-normal text-[#93a5cf]">· {r}</span></p><p className="mt-1 text-sm text-[#a9b8de]">{d}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Features bento ---------------- */
function Features() {
  return (
    <section id="features" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-[1200px] px-5">
        <SectionHead eyebrow="What's inside" title="Built around the dispensary counter." body="Everything your team does with stock in a day, from receiving a delivery to answering the owner's question about last month." />
        <div className="mt-14 grid gap-4 md:grid-cols-6">
          <Reveal as="article" className="relative overflow-hidden rounded-3xl border border-line bg-surface p-7 shadow-card md:col-span-4 md:row-span-2">
            <div className="hex-lattice-ink absolute inset-0" />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
              <div>
                <span className="hex-clip grid size-12 place-items-center bg-brand text-on-brand"><LuSparkles className="size-5" /></span>
                <h3 className="mt-5 font-display text-[30px] leading-tight font-bold">Ask your stock a question.</h3>
                <p className="mt-3 text-[15px] text-ink-2">"How did October go?" "Where are we losing money?" "What should I reorder?" Cadence answers with reports, charts and next steps.</p>
                <p className="mt-4 flex items-center gap-2 text-xs text-muted"><LuShieldCheck className="size-4 text-safe" />The AI explains figures Cadence calculated. It never invents numbers.</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-float">
                <p className="ml-auto w-fit rounded-2xl rounded-br-md bg-brand-soft px-3 py-2 text-sm">Generate a report for October.</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[["Revenue", "₵47.6k", "+8.4%"], ["Profit", "₵15.2k", "+12.6%"], ["Margin", "31.8%", "+1.2 pts"]].map(([l, v, d]) => (
                    <div key={l} className="rounded-xl border border-line p-2.5"><p className="text-[11px] text-muted">{l}</p><p className="font-display text-base font-bold tabular">{v}</p><p className="text-[11px] font-semibold text-safe-ink">{d}</p></div>
                  ))}
                </div>
                <Sparkline data={[38240, 40110, 39580, 42760, 43920, 47630]} className="mt-3 h-14" />
                <p className="mt-2 text-xs text-ink-2">Revenue rose 8.4% on September, led by Coartem (97 units).</p>
              </div>
            </div>
          </Reveal>
          <Feature className="md:col-span-2" icon={LuLayers} title="Batch-level inventory" body="One row per batch, not per product, so two batches of the same drug never hide each other's dates." />
          <Feature className="md:col-span-2" icon={LuScanLine} title="Scan, then dispense first-expiry-first-out" body="Scan a pack and see every batch you hold, with the one to hand over first already highlighted." />
          <Feature className="md:col-span-2" icon={LuBell} title="SMS and email alerts" body="A morning SMS for critical and expired batches, and a daily email digest for everything else." />
          <Feature className="md:col-span-2" icon={LuUpload} title="Bring your Excel list" body="Import your current stock sheet in one go. Matching batches update; new ones are added." />
          <Feature className="md:col-span-2" icon={LuPercent} title="Losses and margins" body="See what expiry cost you at purchase price and which medicines earn their shelf space." />
        </div>
      </div>
    </section>
  );
}
function Feature({ icon: Icon, title, body, className }: { icon: typeof LuLayers; title: string; body: string; className?: string }) {
  return (
    <Reveal as="article" delay={80} className={cn("group rounded-3xl border border-line bg-surface p-6 shadow-hair transition hover:-translate-y-0.5 hover:shadow-card", className)}>
      <span className="hex-clip grid size-11 place-items-center bg-brand-soft text-brand-ink transition group-hover:bg-brand group-hover:text-on-brand"><Icon className="size-5" /></span>
      <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </Reveal>
  );
}
function SectionHead({ eyebrow, title, body, center }: { eyebrow: string; title: string; body?: string; center?: boolean }) {
  return (
    <Reveal className={cn("max-w-2xl", center && "mx-auto text-center")}>
      <p className="text-xs font-semibold tracking-[.18em] text-brand-ink uppercase">{eyebrow}</p>
      <h2 className="mt-3 font-display text-[clamp(32px,4.2vw,50px)] leading-[1.05] font-bold">{title}</h2>
      {body && <p className="mt-4 text-lg text-muted">{body}</p>}
    </Reveal>
  );
}

/* ---------------- Roles ---------------- */
function Roles() {
  const roles: { name: string; who: string; yes: string[]; no?: string }[] = [
    { name: "Admin", who: "Owner or pharmacy manager", yes: ["Everything a pharmacist can do", "Invite staff and set roles", "Pharmacy details and alert numbers", "Expiry rules for the pharmacy"] },
    { name: "Pharmacist", who: "Superintendent or pharmacist on duty", yes: ["Receive, edit and import stock", "AI reports, costs and margins", "Manage alert settings"], no: "User management" },
    { name: "Dispenser", who: "Technicians and counter staff", yes: ["View stock and scan barcodes", "Dispense first-expiry-first-out", "See and clear alerts"], no: "Costs, margins and reports" },
  ];
  return (
    <section id="roles" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-[1200px] px-5">
        <SectionHead eyebrow="For your whole team" title="Everyone sees what their job needs." body="Three roles out of the box. Admins can change what each one can do." />
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {roles.map((r, i) => (
            <Reveal as="article" delay={i * 100} key={r.name} className={cn("rounded-3xl border p-7 transition hover:-translate-y-1", i === 0 ? "border-transparent bg-navy text-white shadow-float" : "border-line bg-surface shadow-hair")}>
              <p className="font-display text-2xl font-bold">{r.name}</p>
              <p className={cn("text-sm", i === 0 ? "text-[#a9b8de]" : "text-muted")}>{r.who}</p>
              <ul className="mt-6 grid gap-3 text-[15px]">
                {r.yes.map((y) => <li key={y} className="flex gap-2.5"><LuCircleCheck className={cn("mt-0.5 size-5 shrink-0", i === 0 ? "text-[#6fe3a5]" : "text-safe")} />{y}</li>)}
                {r.no && <li className="flex gap-2.5 text-muted"><LuMinus className="mt-0.5 size-5 shrink-0" /><span className="line-through decoration-muted/40">{r.no}</span></li>}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- FAQ + demo form ---------------- */
const demoSchema = z.object({
  name: z.string().trim().min(2, "Add your name"),
  pharmacy: z.string().trim().min(2, "Add your pharmacy's name"),
  phone: z.string().trim().regex(/^\+?\d[\d\s]{7,}$/, "Enter the number in +233 format"),
  email: z.union([z.literal(""), z.string().email("That email doesn't look right")]),
  branches: z.string(),
});
type Demo = z.infer<typeof demoSchema>;

function FaqDemo() {
  const faqs = [
    ["Do I need special barcode scanners?", "No. Any USB or Bluetooth scanner that types into a text box works, and staff can also type the barcode."],
    ["Can I change the 30 and 90 day bands?", "Yes. Admins set the critical and expiring-soon limits. Slow-moving stock often suits 60 and 180 days."],
    ["Where do the AI's numbers come from?", "Cadence calculates revenue, losses and margins from your own sales and stock. The AI picks which figures answer your question and explains them."],
    ["Can it run across more than one branch?", "Each pharmacy account has its own stock, users and alerts. Tell us about your branches when you book a demo."],
    ["What happens to our existing records?", "Import your Excel or CSV list on day one. Rows matching an existing barcode and batch update instead of duplicating."],
  ];
  const [f, setF] = useState<Demo>({ name: "", pharmacy: "", phone: "", email: "", branches: "1 branch" });
  const [errors, setErrors] = useState<Partial<Record<keyof Demo, string>>>({});
  const [done, setDone] = useState<Demo | null>(null);
  const set = (k: keyof Demo) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = demoSchema.safeParse(f);
    if (!r.success) {
      const errs: Partial<Record<keyof Demo, string>> = {};
      r.error.issues.forEach((i) => { const k = i.path[0] as keyof Demo; errs[k] ??= i.message; });
      setErrors(errs); return;
    }
    // Phase 2: POST to the API's /demo-requests endpoint. Until then the request stays in this browser.
    storage.set("demoRequests", [...storage.get<Demo[]>("demoRequests", []), { ...r.data, at: new Date().toISOString() }]);
    setErrors({}); setDone(r.data);
  }
  return (
    <section id="faq" className="scroll-mt-20 border-t border-line bg-surface py-24">
      <div className="mx-auto grid max-w-[1200px] gap-14 px-5 lg:grid-cols-2">
        <div>
          <SectionHead eyebrow="Questions" title="Good to know" />
          <div className="mt-8 divide-y divide-line border-y border-line">
            {faqs.map(([q, a], i) => (
              <details key={q} open={i === 0} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                  {q}<span className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-brand transition group-open:rotate-45">+</span>
                </summary>
                <p className="pb-5 text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
        <div id="demo" className="scroll-mt-24 self-start rounded-[28px] border border-line bg-bg p-7 shadow-card sm:p-9">
          <p className="text-xs font-semibold tracking-[.18em] text-brand-ink uppercase">Book a demo</p>
          <h2 className="mt-3 font-display text-3xl font-bold">See Cadence with your own stock list.</h2>
          <p className="mt-2 text-muted">A 30-minute walkthrough. Bring an Excel export if you have one.</p>
          {done ? (
            <div role="status" className="mt-7 flex animate-fade-up gap-3 rounded-2xl bg-safe-soft p-5 text-safe-ink">
              <LuCircleCheck className="mt-0.5 size-5 shrink-0" />
              <p>Thanks, {done.name.split(" ")[0]}. Your request for <b>{done.pharmacy}</b> is saved. Requests reach the Cadence team once the API is connected.</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-7 grid gap-4 sm:grid-cols-2">
              <Field label="Your name" htmlFor="d-name" error={errors.name}><Input id="d-name" autoComplete="name" value={f.name} onChange={set("name")} invalid={!!errors.name} /></Field>
              <Field label="Pharmacy" htmlFor="d-ph" error={errors.pharmacy}><Input id="d-ph" autoComplete="organization" value={f.pharmacy} onChange={set("pharmacy")} invalid={!!errors.pharmacy} /></Field>
              <Field label="Phone" htmlFor="d-phone" error={errors.phone}><Input id="d-phone" inputMode="tel" placeholder="+233 …" value={f.phone} onChange={set("phone")} invalid={!!errors.phone} /></Field>
              <Field label="Email (optional)" htmlFor="d-mail" error={errors.email}><Input id="d-mail" type="email" value={f.email} onChange={set("email")} invalid={!!errors.email} /></Field>
              <Field label="Branches" htmlFor="d-br" className="sm:col-span-2">
                <select id="d-br" value={f.branches} onChange={set("branches")} className="h-10 rounded-xl border border-line bg-surface px-3 text-sm focus:border-brand focus:outline-none">
                  {["1 branch", "2–5 branches", "6 or more"].map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <Button type="submit" variant="primary" size="lg" className="sm:col-span-2">Request my demo<LuArrowRight /></Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
