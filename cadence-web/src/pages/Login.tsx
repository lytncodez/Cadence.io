import { getPrefs } from "@/lib/theme";
import { useState } from "react";
import { LuEye, LuEyeOff, LuArrowRight, LuCircleAlert, LuInfo, LuArrowLeft } from "react-icons/lu";
import { auth, DEMO_PASSWORD, USE_MOCK, useStore } from "@/lib/api";
import { Link, navigate } from "@/lib/router";
import { Avatar, Button, Field, Input, Logo, StatusPill } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/logo.svg";


export default function Login() {
  const users = useStore((s) => s.users);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | false>(false);
  const [msg, setMsg] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  async function signIn(e?: React.FormEvent, as?: { email: string; pw: string; id: string }) {
    e?.preventDefault();
    const em = as?.email ?? email, p = as?.pw ?? pw;
    if (!em.trim() || !p) { setMsg({ tone: "error", text: "Enter your email and password." }); return; }
    setBusy(as?.id ?? "form"); setMsg(null);
    try {
      await auth.login(em, p);
      navigate(getPrefs().startPage, { replace: true });
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
      setPw(""); setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="mesh-brand grain relative hidden overflow-hidden text-white lg:flex lg:flex-col">
        <div className="hex-lattice absolute inset-0 opacity-70" />
        <img src={logoUrl} alt="" className="pointer-events-none absolute -right-24 -bottom-24 w-[420px] opacity-[.08]" />
        <div className="relative flex flex-1 flex-col justify-between gap-12 p-12">
          <Link to="/" aria-label="Cadence.io home"><Logo onDark /></Link>
          <div className="max-w-md">
            <p className="mb-4 text-xs font-semibold tracking-[.18em] text-[#a9c1ff] uppercase">Today at the counter</p>
            <h2 className="font-display text-[44px] leading-[1.04] font-bold">Your shelf, already sorted for today.</h2>
            <p className="mt-4 text-[15px] text-[#b9c7ea]">Sign in to see what to dispense first, what expires this month and how the pharmacy is doing.</p>
          </div>
          <div className="relative max-w-md">
            <div className="animate-float rounded-3xl border border-white/12 bg-white/[.06] p-2 shadow-2xl backdrop-blur-md">
              {[
                { n: "Ferrous Sulphate 200mg", b: "FES-2410", d: "4 days left", s: "critical" as const },
                { n: "Lisinopril 10mg", b: "LIS-2411", d: "8 days left", s: "critical" as const },
                { n: "Insulin Mixtard 30/70", b: "INS-2503", d: "52 days left", s: "soon" as const },
              ].map((r, i) => (
                <div key={r.b} className={cn("flex items-center gap-3 rounded-2xl px-4 py-3", i === 0 && "bg-white/[.06]")}>
                  <span className={cn("h-8 w-1 rounded-full", r.s === "critical" ? "bg-[#ff6f69]" : "bg-[#f5b83d]")} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{r.n}</p><p className="text-xs text-[#9fb0d6]"><span className="font-mono">{r.b}</span> · {r.d}</p></div>
                  <StatusPill status={r.s} short className="dark" />
                </div>
              ))}
            </div>
            <div className="absolute -top-5 -right-4 rounded-2xl border border-white/12 bg-[#0e1d52]/90 px-3.5 py-2.5 text-xs shadow-xl backdrop-blur" style={{ animation: "float 8s ease-in-out -3s infinite" }}>
              <p className="text-[#9fb0d6]">SMS · 07:30</p><p className="font-medium">2 batches critical today</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Form */}
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="lg:invisible" aria-label="Cadence.io home"><Logo /></Link>
          <Link to="/" className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-ink-2 hover:bg-sunken"><LuArrowLeft className="size-4" />Back to website</Link>
        </div>
        <div className="grid flex-1 place-items-center py-10">
          <form onSubmit={signIn} noValidate className="w-full max-w-[400px] animate-fade-up">
            <h1 className="font-display text-[34px] font-bold">Welcome back</h1>
            <p className="mt-1.5 text-[15px] text-muted">Log in with the email your pharmacy admin invited.</p>

            {msg && (
              <div role="alert" className={cn("mt-6 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm", msg.tone === "error" ? "bg-critical-soft text-critical-ink" : "bg-brand-soft text-brand-ink")}>
                {msg.tone === "error" ? <LuCircleAlert className="mt-0.5 size-4 shrink-0" /> : <LuInfo className="mt-0.5 size-4 shrink-0" />}{msg.text}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-4">
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" autoComplete="username" placeholder="you@pharmacy.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
              </Field>
              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-11 pr-11" />
                  <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink">
                    {show ? <LuEyeOff className="size-4" /> : <LuEye className="size-4" />}
                  </button>
                </div>
              </Field>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Shared counter PC? Log out when you leave.</span>
                <button type="button" className="font-medium text-brand-ink hover:underline" onClick={() => setMsg({ tone: "info", text: "Ask your pharmacy admin to reset your password from Settings → Users." })}>Forgot?</button>
              </div>
              <Button type="submit" variant="primary" size="lg" loading={busy === "form"} className="mt-1 w-full">Log in<LuArrowRight /></Button>
            </div>

            {USE_MOCK && (
              <div className="mt-8">
                <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />Demo accounts · password <code className="font-mono text-ink-2">{DEMO_PASSWORD}</code><span className="h-px flex-1 bg-line" /></div>
                <div className="mt-3 grid gap-2">
                  {users.filter((u) => u.status === "Active").map((u) => (
                    <button key={u.id} type="button" disabled={!!busy} onClick={() => signIn(undefined, { email: u.email, pw: DEMO_PASSWORD, id: u.id })}
                      className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 pr-3 text-left shadow-hair transition hover:-translate-y-px hover:border-brand/50 hover:shadow-card disabled:opacity-60">
                      <Avatar name={u.name} photo={u.photo} size={36} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="block truncate text-xs text-muted">{u.position}</span></span>
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">{u.role}</span>
                      {busy === u.id ? <span className="size-4 animate-spin rounded-full border-2 border-brand border-r-transparent" /> : <LuArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>
        <p className="text-center text-xs text-muted">© {new Date().getFullYear()} Cadence.io · Made in Ghana</p>
      </main>
    </div>
  );
}
