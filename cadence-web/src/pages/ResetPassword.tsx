/* /reset-password?token=…  Opened from the reset email (or a link an admin shared). Works signed in or out. */
import { useEffect, useMemo, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuCircleAlert, LuCircleCheck, LuEye, LuEyeOff, LuLink2Off } from "react-icons/lu";
import { auth, type ResetCheck } from "@/lib/api";
import { Link, navigate, usePath } from "@/lib/router";
import { Button, Field, HexLoader, Input, Logo } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const LABELS = ["Too short", "Weak", "Okay", "Good", "Strong"];
const COLORS = ["bg-critical", "bg-critical", "bg-soon", "bg-safe", "bg-safe"];

export default function ResetPassword() {
  const path = usePath();
  const token = useMemo(() => new URLSearchParams((path.split("?")[1] ?? "") || location.search.slice(1)).get("token") ?? "", [path]);
  const [check, setCheck] = useState<ResetCheck | null>(null);
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [show, setShow] = useState(false);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);

  useEffect(() => {
    document.title = "Reset password · Cadence.io";
    if (!token) { setCheck({ valid: false, name: "", email: "" }); return; }
    auth.checkReset(token).then(setCheck, (e) => { setErr((e as Error).message); setCheck({ valid: false, name: "", email: "" }); });
  }, [token]);

  const score = pw.length < 10 ? 0 : strength(pw);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (pw.length < 10) return setErr("Use at least 10 characters.");
    if (pw !== pw2) return setErr("The two passwords don't match.");
    if (check?.email && pw.toLowerCase().includes(check.email.split("@")[0].toLowerCase())) return setErr("Don't use your email name in your password.");
    setBusy(true);
    try { await auth.resetPassword(token, pw); setDone(true); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-full flex-col bg-bg px-5 py-6 sm:px-10">
      <div className="flex items-center justify-between">
        <Link to="/" aria-label="Cadence.io home"><Logo /></Link>
        <Link to="/login" className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-ink-2 hover:bg-sunken"><LuArrowLeft className="size-4" />Log in</Link>
      </div>
      <main className="grid flex-1 place-items-center py-10">
        <div className="w-full max-w-[420px] animate-fade-up">
          {!check ? <HexLoader label="Checking your link" /> : done ? (
            <div>
              <span className="hex-clip grid size-14 place-items-center bg-safe-soft text-safe-ink"><LuCircleCheck className="size-6" /></span>
              <h1 className="mt-5 font-display text-[34px] font-bold">Password updated</h1>
              <p className="mt-2 text-[15px] text-muted">You've been signed out everywhere else. Log in with your new password.</p>
              <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => navigate("/login", { replace: true })}>Log in<LuArrowRight /></Button>
            </div>
          ) : !check.valid ? (
            <div>
              <span className="hex-clip grid size-14 place-items-center bg-critical-soft text-critical-ink"><LuLink2Off className="size-6" /></span>
              <h1 className="mt-5 font-display text-[34px] font-bold">This link doesn't work</h1>
              <p className="mt-2 text-[15px] text-muted">{err || "Reset links work once and expire after 60 minutes. Asking for a new link also cancels older ones."}</p>
              <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => navigate("/login?forgot=1")}>Send me a new link<LuArrowRight /></Button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h1 className="font-display text-[34px] font-bold">Set a new password</h1>
              <p className="mt-1.5 text-[15px] text-muted">{check.name ? `Hi ${check.name}. ` : ""}Choose a password for <b className="text-ink">{check.email}</b>.</p>
              {err && <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-xl bg-critical-soft px-3.5 py-3 text-sm text-critical-ink"><LuCircleAlert className="mt-0.5 size-4 shrink-0" />{err}</div>}
              <div className="mt-6 flex flex-col gap-4">
                <input type="email" autoComplete="username" value={check.email} readOnly hidden />
                <Field label="New password" htmlFor="npw" hint="At least 10 characters. A short sentence is easy to remember and hard to guess.">
                  <div className="relative">
                    <Input id="npw" type={show ? "text" : "password"} autoComplete="new-password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} className="h-11 pr-11" />
                    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink">{show ? <LuEyeOff className="size-4" /> : <LuEye className="size-4" />}</button>
                  </div>
                </Field>
                {pw && (
                  <div className="-mt-1 flex items-center gap-3" aria-live="polite">
                    <div className="grid flex-1 grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 rounded-full transition", i < Math.max(1, score) ? COLORS[score] : "bg-line")} />)}</div>
                    <span className="w-16 text-right text-xs font-medium text-muted">{LABELS[score]}</span>
                  </div>
                )}
                <Field label="Type it again" htmlFor="npw2"><Input id="npw2" type={show ? "text" : "password"} autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr(""); }} className="h-11" /></Field>
                <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1 w-full">Save new password</Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
