/* /signup  A pharmacy creates its own Cadence account. It gets its own data, roles and team; its first admin is signed in. */
import { useEffect, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuCircleAlert, LuEye, LuEyeOff, LuShieldCheck, LuStore, LuUsers, LuSparkles } from "react-icons/lu";
import { auth, USE_MOCK, type SignupInput } from "@/lib/api";
import { Link, navigate } from "@/lib/router";
import { Button, Field, Input, Logo } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/logo.svg";

type Errors = Partial<Record<keyof SignupInput | "confirm", string>>;

export default function Signup() {
  const [f, setF] = useState<SignupInput>({ pharmacyName: "", location: "", licenceNo: "", name: "", position: "Superintendent Pharmacist", email: "", phone: "", password: "", website: "" });
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "Create your pharmacy account · Cadence.io"; }, []);
  const set = (k: keyof SignupInput) => (e: React.ChangeEvent<HTMLInputElement>) => { setF((p) => ({ ...p, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  function validate(): Errors {
    const e: Errors = {};
    if (f.pharmacyName.trim().length < 2) e.pharmacyName = "Add your pharmacy's name";
    if (f.location.trim().length < 2) e.location = "Add the town or area, e.g. Osu, Accra";
    if (f.name.trim().length < 2) e.name = "Add your full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Enter a valid email. You'll log in with it";
    if (f.phone && !/^\+?\d[\d\s]{7,}$/.test(f.phone.trim())) e.phone = "Use +233 format, e.g. +233 24 123 4567";
    if (f.password.length < 10) e.password = "At least 10 characters";
    else if (f.password !== confirm) e.confirm = "The two passwords don't match";
    return e;
  }
  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setErr("");
    const e = validate(); setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await auth.signup(f); navigate("/app", { replace: true }); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_1.15fr]">
      <aside className="mesh-brand grain relative hidden overflow-hidden text-white lg:flex lg:flex-col">
        <div className="hex-lattice absolute inset-0 opacity-70" />
        <img src={logoUrl} alt="" className="pointer-events-none absolute -right-24 -bottom-24 w-[420px] opacity-[.08]" />
        <div className="relative flex flex-1 flex-col justify-between gap-12 p-12">
          <Link to="/" aria-label="Cadence.io home"><Logo onDark /></Link>
          <div className="max-w-md">
            <p className="mb-4 text-xs font-semibold tracking-[.18em] text-[#a9c1ff] uppercase">Your pharmacy's own space</p>
            <h2 className="font-display text-[44px] leading-[1.04] font-bold">Set up Cadence in a few minutes.</h2>
            <ul className="mt-8 grid gap-4 text-[15px] text-[#c9d6f5]">
              {([[LuStore, "Your own account. Your stock, sales and team are visible only to your pharmacy."], [LuUsers, "Invite your pharmacists and dispensers. Each person gets the view their role needs."], [LuSparkles, "Import your Excel stock list, then get alerts and AI reports straight away."]] as const).map(([I, t]) => (
                <li key={t} className="flex gap-3"><span className="hex-clip grid size-9 shrink-0 place-items-center bg-white/10"><I className="size-4" /></span><span>{t}</span></li>
              ))}
            </ul>
          </div>
          <p className="flex items-center gap-2 text-xs text-[#9fb0d6]"><LuShieldCheck className="size-4" />Personal details are encrypted. Passwords are never stored in readable form.</p>
        </div>
      </aside>

      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="lg:invisible" aria-label="Cadence.io home"><Logo /></Link>
          <Link to="/" className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-ink-2 hover:bg-sunken"><LuArrowLeft className="size-4" />Back to website</Link>
        </div>
        <div className="grid flex-1 place-items-center py-8">
          <form onSubmit={submit} noValidate className="relative w-full max-w-[520px] animate-fade-up">
            <h1 className="font-display text-[34px] font-bold">Create your pharmacy account</h1>
            <p className="mt-1.5 text-[15px] text-muted">You'll be the admin. You can invite your team once you're in.</p>
            {USE_MOCK && <p className="mt-4 rounded-xl border border-dashed border-brand/40 bg-brand-soft/40 px-3.5 py-2.5 text-sm text-brand-ink">Demo mode: this creates a new, empty pharmacy in this browser and replaces the sample one. Settings → Data → Reset brings the sample back.</p>}
            {err && <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl bg-critical-soft px-3.5 py-3 text-sm text-critical-ink"><LuCircleAlert className="mt-0.5 size-4 shrink-0" />{err}</div>}

            <fieldset className="mt-6 grid gap-4 sm:grid-cols-2">
              <legend className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Pharmacy</legend>
              <Field label="Pharmacy name" htmlFor="s-ph" error={errors.pharmacyName} className="sm:col-span-2"><Input id="s-ph" autoComplete="organization" autoFocus value={f.pharmacyName} onChange={set("pharmacyName")} invalid={!!errors.pharmacyName} /></Field>
              <Field label="Location" htmlFor="s-loc" error={errors.location}><Input id="s-loc" placeholder="e.g. Osu, Accra" value={f.location} onChange={set("location")} invalid={!!errors.location} /></Field>
              <Field label="Pharmacy Council licence no. (optional)" htmlFor="s-lic"><Input id="s-lic" className="font-mono" value={f.licenceNo} onChange={set("licenceNo")} /></Field>
            </fieldset>

            <fieldset className="mt-6 grid gap-4 sm:grid-cols-2">
              <legend className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">You (admin)</legend>
              <Field label="Full name" htmlFor="s-name" error={errors.name}><Input id="s-name" autoComplete="name" value={f.name} onChange={set("name")} invalid={!!errors.name} /></Field>
              <Field label="Position" htmlFor="s-pos"><Input id="s-pos" value={f.position} onChange={set("position")} /></Field>
              <Field label="Email" htmlFor="s-email" error={errors.email}><Input id="s-email" type="email" autoComplete="username" value={f.email} onChange={set("email")} invalid={!!errors.email} /></Field>
              <Field label="Phone for SMS alerts (optional)" htmlFor="s-phone" error={errors.phone}><Input id="s-phone" inputMode="tel" placeholder="+233 …" value={f.phone} onChange={set("phone")} invalid={!!errors.phone} /></Field>
              <Field label="Password" htmlFor="s-pw" error={errors.password} hint="At least 10 characters">
                <div className="relative">
                  <Input id="s-pw" type={show ? "text" : "password"} autoComplete="new-password" value={f.password} onChange={set("password")} invalid={!!errors.password} className="pr-11" />
                  <button type="button" onClick={() => setShow((x) => !x)} aria-label={show ? "Hide password" : "Show password"} className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink">{show ? <LuEyeOff className="size-4" /> : <LuEye className="size-4" />}</button>
                </div>
              </Field>
              <Field label="Type it again" htmlFor="s-pw2" error={errors.confirm}><Input id="s-pw2" type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setErrors((x) => ({ ...x, confirm: undefined })); }} invalid={!!errors.confirm} /></Field>
            </fieldset>
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden"><label htmlFor="s-web">Website</label><input id="s-web" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></div>

            <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-7 w-full">Create account<LuArrowRight /></Button>
            <p className={cn("mt-4 text-center text-sm text-muted")}>Already using Cadence? <Link to="/login" className="font-medium text-brand-ink hover:underline">Log in</Link></p>
          </form>
        </div>
      </main>
    </div>
  );
}
