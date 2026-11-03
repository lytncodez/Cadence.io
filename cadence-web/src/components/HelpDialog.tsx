/* "Get help": the distress button. Goes straight to the Cadence team (HQ) by email/SMS and appears in their inbox.
   The pharmacy sees each request's status and the team's reply here. */
import { useEffect, useState } from "react";
import { LuLifeBuoy, LuSiren, LuCircleCheck, LuMessageSquare, LuClock, LuSend, LuArrowLeft } from "react-icons/lu";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useCurrentUser } from "@/lib/api";
import { help, HELP_CATEGORIES, type HelpCategory, type HelpTicket } from "@/lib/features";
import { cn, fmtStamp } from "@/lib/utils";

const STATUS: Record<HelpTicket["status"], { label: string; cls: string }> = {
  open: { label: "Sent · waiting", cls: "bg-soon-soft text-soon-ink" },
  acknowledged: { label: "Seen · we're on it", cls: "bg-brand-soft text-brand-ink" },
  resolved: { label: "Resolved", cls: "bg-safe-soft text-safe-ink" },
};

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useCurrentUser();
  const toast = useToast();
  const [view, setView] = useState<"form" | "sent" | "list">("form");
  const [category, setCategory] = useState<HelpCategory>("bug");
  const [urgent, setUrgent] = useState(false);
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<HelpTicket[]>([]);

  useEffect(() => { if (open) { help.mine().then(setMine, () => setMine([])); setPhone(me?.phone ?? ""); } }, [open, me?.phone]);
  const close = () => { onClose(); setTimeout(() => { setView("form"); setMessage(""); setUrgent(false); setErr(""); }, 200); };

  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (message.trim().length < 3) return setErr("Tell us briefly what's wrong.");
    if (phone && !/^\+?\d[\d\s]{7,}$/.test(phone.trim())) return setErr("Use +233 format for the callback number.");
    setBusy(true);
    try {
      await help.raise({ category, urgency: urgent ? "urgent" : "normal", message: message.trim(), phone: phone.trim() });
      setMine(await help.mine()); setView("sent");
    } catch (x) { setErr((x as Error).message); toast({ message: "Couldn't send. Check your connection and try again.", tone: "error" }); }
    finally { setBusy(false); }
  }

  const open_ = mine.filter((t) => t.status !== "resolved").length;
  return (
    <Modal open={open} onClose={close} size="lg" title={view === "list" ? "Your help requests" : view === "sent" ? "Help is on the way" : "Get help from Cadence"}
      description={view === "form" ? "This goes straight to the Cadence team. For urgent problems we'll call you back." : undefined}
      footer={view === "form"
        ? <><Button variant="ghost" onClick={close}>Cancel</Button><Button type="submit" form="help-form" variant={urgent ? "danger" : "primary"} loading={busy}>{urgent ? <LuSiren /> : <LuSend />}{urgent ? "Send urgent request" : "Send"}</Button></>
        : <Button variant="primary" onClick={close}>Done</Button>}>
      {view === "form" && (
        <form id="help-form" onSubmit={send} noValidate className="grid gap-4">
          {err && <p role="alert" className="rounded-xl bg-critical-soft px-3.5 py-3 text-sm text-critical-ink">{err}</p>}
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink-2">What's happening?</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {(Object.keys(HELP_CATEGORIES) as HelpCategory[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={category === k} onClick={() => { setCategory(k); if (k === "cant_dispense") setUrgent(true); }}
                  className={cn("rounded-xl border px-3 py-2.5 text-left text-sm transition", category === k ? "border-brand bg-brand-soft/50 font-medium" : "border-line hover:border-line-strong")}>
                  {HELP_CATEGORIES[k]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition", urgent ? "border-critical bg-critical-soft" : "border-line")}>
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="mt-1 size-4 accent-[var(--critical)]" />
            <span><span className={cn("flex items-center gap-1.5 font-semibold", urgent && "text-critical-ink")}><LuSiren className="size-4" />Urgent: it's stopping us from working</span>
              <span className="block text-sm text-muted">We're alerted by SMS as well as email.</span></span>
          </label>
          <Field label="Tell us what's wrong" htmlFor="h-msg">
            <textarea id="h-msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="What were you doing, and what happened? Please don't include patient details."
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-muted focus:border-brand focus:ring-4 focus:ring-[var(--ring)] focus:outline-none" />
          </Field>
          <Field label="Number we can call back" htmlFor="h-phone"><Input id="h-phone" inputMode="tel" placeholder="+233 …" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          {mine.length > 0 && <button type="button" onClick={() => setView("list")} className="justify-self-start text-sm font-medium text-brand-ink hover:underline">See your requests{open_ ? ` (${open_} open)` : ""}</button>}
        </form>
      )}
      {view === "sent" && (
        <div className="grid gap-4">
          <div className="flex gap-3 rounded-2xl bg-safe-soft p-4 text-safe-ink"><LuCircleCheck className="mt-0.5 size-5 shrink-0" /><p>Sent. The Cadence team has been notified{urgent ? " and will call you back as soon as possible" : " and will reply here and by email"}.</p></div>
          <button type="button" onClick={() => setView("list")} className="justify-self-start text-sm font-medium text-brand-ink hover:underline">See all your requests</button>
        </div>
      )}
      {view === "list" && (
        <div className="grid gap-3">
          <button type="button" onClick={() => setView("form")} className="flex items-center gap-1.5 justify-self-start text-sm font-medium text-ink-2 hover:text-ink"><LuArrowLeft className="size-4" />New request</button>
          {mine.length === 0 ? <p className="text-sm text-muted">No requests yet.</p> : mine.map((t) => (
            <article key={t.id} className="rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t.categoryLabel}</span>
                {t.urgency === "urgent" && <span className="rounded-full bg-critical-soft px-2 py-0.5 text-[11px] font-semibold text-critical-ink">Urgent</span>}
                <span className={cn("ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS[t.status].cls)}>{STATUS[t.status].label}</span>
              </div>
              <p className="mt-2 text-sm text-ink-2">{t.message}</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><LuClock className="size-3.5" />{fmtStamp(t.createdAt)}{t.raisedBy ? ` · ${t.raisedBy}` : ""}</p>
              {t.reply && <p className="mt-3 flex gap-2 rounded-xl bg-brand-soft/60 p-3 text-sm"><LuMessageSquare className="mt-0.5 size-4 shrink-0 text-brand-ink" /><span><b className="block text-brand-ink">Cadence support</b>{t.reply}</span></p>}
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}

export const HelpIcon = LuLifeBuoy;
