/* Admin adds someone to the pharmacy. Cadence emails them a link to set their own password (valid 3 days).
   If email isn't switched on or fails, the admin gets the link to pass on in person. */
import { useState } from "react";
import { LuCopy, LuMailCheck, LuTriangleAlert, LuUserPlus } from "react-icons/lu";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, Field, Input } from "@/components/ui/primitives";
import { api, useStore, type InviteInput, type ResetLinkResult } from "@/lib/api";
import { cn } from "@/lib/utils";

const BLANK: InviteInput = { name: "", email: "", role: "Dispenser", position: "", department: "", phone: "" };

export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roles = useStore((s) => s.roles);
  const toast = useToast();
  const [f, setF] = useState<InviteInput>(BLANK);
  const [errors, setErrors] = useState<Partial<Record<keyof InviteInput, string>>>({});
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; delivery: ResetLinkResult } | null>(null);
  const set = (k: keyof InviteInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF((p) => ({ ...p, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const close = () => { onClose(); setTimeout(() => { setF(BLANK); setDone(null); setErr(""); setErrors({}); }, 200); };
  const role = roles.find((r) => r.name === f.role);

  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const v: typeof errors = {};
    if (f.name.trim().length < 2) v.name = "Add their full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) v.email = "They'll log in with this email";
    if (f.phone && !/^\+?\d[\d\s]{7,}$/.test(f.phone.trim())) v.phone = "Use +233 format";
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const r = await api.inviteUser(f);
      if (r.delivery.status === "sent") { toast({ message: `Invite emailed to ${r.delivery.email}` }); close(); }
      else setDone({ name: r.user.name.split(" ")[0], delivery: r.delivery });
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  const copy = () => done?.delivery.link && navigator.clipboard?.writeText(done.delivery.link).then(() => toast({ message: "Link copied" }), () => toast({ message: "Couldn't copy. Select the link instead.", tone: "error" }));

  return (
    <Modal open={open} onClose={close} size="lg" title={done ? `Send ${done.name} this link` : "Invite someone to your pharmacy"}
      description={done ? undefined : "They'll get an email to set their own password. You choose what they can see by their role."}
      footer={done ? <Button variant="primary" onClick={close}>Done</Button> : <><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" type="submit" form="invite-form" loading={busy}><LuUserPlus />Send invite</Button></>}>
      {done ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <p className="flex items-start gap-2.5 rounded-xl bg-soon-soft px-3.5 py-3 text-sm text-soon-ink">
            <LuTriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{done.delivery.status === "failed" ? <>The email couldn't be sent{done.delivery.detail ? `: ${done.delivery.detail}` : "."}</> : <>Email isn't switched on yet, so no invite was sent.</>} Their account is ready. Give {done.name} this link yourself, for example by WhatsApp.</span>
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-2 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{done.delivery.link}</code>
            <Button size="sm" onClick={copy}><LuCopy />Copy</Button>
          </div>
          <p className="text-xs text-muted">Anyone with the link can set the password, so send it only to {done.name}. It works once and expires in 3 days. You can send a new one from their profile.</p>
        </div>
      ) : (
        <form id="invite-form" onSubmit={send} noValidate className="grid gap-4 sm:grid-cols-2">
          {err && <p role="alert" className="rounded-xl bg-critical-soft px-3.5 py-3 text-sm text-critical-ink sm:col-span-2">{err}</p>}
          <Field label="Full name" htmlFor="i-name" error={errors.name}><Input id="i-name" autoFocus value={f.name} onChange={set("name")} invalid={!!errors.name} /></Field>
          <Field label="Email" htmlFor="i-email" error={errors.email}><Input id="i-email" type="email" value={f.email} onChange={set("email")} invalid={!!errors.email} /></Field>
          <Field label="Role" htmlFor="i-role" hint={role ? role.summary : undefined}>
            <select id="i-role" value={f.role} onChange={set("role")} className="h-10 rounded-xl border border-line bg-surface px-3 text-sm focus:border-brand focus:outline-none">
              {roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Position (optional)" htmlFor="i-pos"><Input id="i-pos" placeholder="e.g. Dispensing Technician" value={f.position} onChange={set("position")} /></Field>
          <Field label="Department (optional)" htmlFor="i-dep"><Input id="i-dep" placeholder="e.g. Main dispensary" value={f.department} onChange={set("department")} /></Field>
          <Field label="Phone (optional)" htmlFor="i-phone" error={errors.phone}><Input id="i-phone" inputMode="tel" placeholder="+233 …" value={f.phone} onChange={set("phone")} invalid={!!errors.phone} /></Field>
          <p className={cn("flex items-center gap-2 text-xs text-muted sm:col-span-2")}><LuMailCheck className="size-4" />The invite link works once and expires in 3 days.</p>
        </form>
      )}
    </Modal>
  );
}
