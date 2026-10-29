import { useMemo, useState } from "react";
import { LuPencil, LuLock, LuMail, LuPhone, LuIdCard, LuBriefcase, LuMapPin, LuShieldCheck, LuCalendar, LuClock, LuCheck, LuMinus, LuArrowLeft, LuImage, LuScanLine, LuBan, LuSparkles, LuPlus, LuUserPlus, LuUpload, LuSettings, LuCopy } from "react-icons/lu";
import type { IconType } from "react-icons";
import { AppShell } from "@/components/layout/AppShell";
import { Avatar, Badge, Button, Card, CardHeader, Field, Input } from "@/components/ui/primitives";
import { Modal, useToast } from "@/components/ui/overlay";
import { api, useCan, useCurrentUser, useStore } from "@/lib/api";
import { PERMISSIONS } from "@/lib/seed";
import { Link } from "@/lib/router";
import { addDays, cn, fmtDate, fmtStamp, tenure, todayISO } from "@/lib/utils";
import type { User } from "@/lib/types";

export default function Profile({ userId }: { userId?: string }) {
  const me = useCurrentUser()!;
  const can = useCan();
  const users = useStore((s) => s.users);
  const roles = useStore((s) => s.roles);
  const items = useStore((s) => s.items);
  const toast = useToast();
  const viewingOther = !!userId && userId !== me.id && can("manage_users");
  const u = (viewingOther ? users.find((x) => x.id === userId) : null) ?? me;
  const self = u.id === me.id;
  const role = roles.find((r) => r.name === u.role);
  const [edit, setEdit] = useState(false);
  const [pw, setPw] = useState(false);

  const activity = useMemo(() => buildActivity(u, items.map((i) => `${i.name.split(" ").slice(0, 2).join(" ")} · ${i.batch}`)), [u, items]);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => toast({ message: "Copied" }), () => toast({ message: "Couldn't copy. Select the text instead.", tone: "error" }));
  };

  return (
    <AppShell title={self ? "My profile" : u.name}>
      {viewingOther && <Link to="/app/settings" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline"><LuArrowLeft className="size-4" />Back to team</Link>}

      {/* Identity header */}
      <Card className="overflow-hidden">
        <div className="mesh-brand grain relative h-36 overflow-hidden sm:h-44">
          <div className="hex-lattice absolute inset-0 opacity-80" />
          <div className="absolute right-6 bottom-4 hidden items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur sm:flex">
            <LuShieldCheck className="size-3.5" />{u.role} access · {role?.perms.length ?? 0} of {PERMISSIONS.length} permissions
          </div>
        </div>
        <div className="relative flex flex-wrap items-end gap-x-6 gap-y-4 px-6 pb-6">
          <div className="-mt-14 drop-shadow-xl"><Avatar name={u.name} photo={u.photo} size={112} className="ring-4 ring-surface" /></div>
          <div className="min-w-[220px] flex-1 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-3xl font-bold">{u.name}</h2>
              {self && <Badge>You</Badge>}
            </div>
            <p className="mt-0.5 text-[15px] text-ink-2">{u.position} <span className="text-muted">· {u.department}</span></p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-xs font-semibold text-brand-ink"><LuShieldCheck className="size-3.5" />{u.role}</span>
              <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold", u.status === "Active" ? "bg-safe-soft text-safe-ink" : "bg-soon-soft text-soon-ink")}><span className={cn("size-1.5 rounded-full", u.status === "Active" ? "bg-safe" : "bg-soon")} />{u.status}</span>
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-3 font-mono text-xs text-ink-2">{u.staffId}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {(self || can("manage_users")) && <Button onClick={() => setEdit(true)}><LuPencil />Edit profile</Button>}
            {self && <Button onClick={() => setPw(true)}><LuLock />Password</Button>}
          </div>
          {u.bio && <p className="w-full max-w-3xl text-[15px] leading-relaxed text-ink-2">{u.bio}</p>}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
        {/* Details */}
        <Card>
          <CardHeader title="Details" subtitle="Contact and employment" />
          <dl className="divide-y divide-line px-5 pb-2">
            <Detail icon={LuMail} label="Email" value={u.email} onCopy={() => copy(u.email)} />
            <Detail icon={LuPhone} label="Phone" value={u.phone || "—"} onCopy={u.phone ? () => copy(u.phone) : undefined} />
            <Detail icon={LuIdCard} label="Staff ID" value={<span className="font-mono">{u.staffId}</span>} />
            <Detail icon={LuBriefcase} label="Position" value={u.position} />
            <Detail icon={LuMapPin} label="Works in" value={u.department} />
            {u.regNo && <Detail icon={LuShieldCheck} label="PSGH reg. no." value={<span className="font-mono">{u.regNo}</span>} />}
            <Detail icon={LuCalendar} label="Joined" value={<>{fmtDate(u.joined)} <span className="text-muted">· {tenure(u.joined)}</span></>} />
            <Detail icon={LuClock} label="Last sign-in" value={fmtStamp(u.lastLogin)} />
          </dl>
        </Card>

        {/* Role & permissions */}
        <Card>
          <CardHeader title="Role & permissions" subtitle={role?.summary}
            action={viewingOther ? (
              <select value={u.role} onChange={async (e) => { await api.updateUser(u.id, { role: e.target.value }); toast({ message: `${u.name.split(" ")[0]} is now ${e.target.value}` }); }}
                className="h-9 rounded-xl border border-line bg-surface px-3 text-sm font-medium focus:border-brand focus:outline-none" aria-label="Change role">
                {roles.map((r) => <option key={r.name}>{r.name}</option>)}
              </select>
            ) : undefined} />
          <div className="px-5 pb-5">
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-violet transition-all duration-700" style={{ width: `${((role?.perms.length ?? 0) / PERMISSIONS.length) * 100}%` }} />
            </div>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {PERMISSIONS.map(([k, label]) => {
                const on = !!role?.perms.includes(k);
                return (
                  <li key={k} className={cn("flex items-center gap-2.5 rounded-lg py-1.5 text-sm", on ? "text-ink" : "text-muted")}>
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded-md", on ? "bg-safe-soft text-safe-ink" : "bg-sunken text-muted")}>{on ? <LuCheck className="size-3.5" /> : <LuMinus className="size-3.5" />}</span>
                    {label}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      </div>

      {/* Activity */}
      <Card className="mt-4">
        <CardHeader title="Recent activity" subtitle="Sample activity until the backend is connected" />
        {activity.length ? (
          <ol className="relative px-5 pb-5">
            <span className="absolute top-2 bottom-7 left-[38px] w-px bg-line" />
            {activity.map((a, i) => (
              <li key={i} className="relative flex animate-fade-up items-start gap-4 py-2.5" style={{ animationDelay: `${i * 50}ms` }}>
                <span className="relative z-10 grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface text-brand-ink shadow-hair"><a.icon className="size-4" /></span>
                <div className="min-w-0 flex-1 pt-1.5"><p className="text-sm text-ink">{a.text}</p></div>
                <time className="shrink-0 pt-1.5 text-xs text-muted tabular">{fmtStamp(a.when)}</time>
              </li>
            ))}
          </ol>
        ) : <p className="px-5 pb-6 text-sm text-muted">{u.name.split(" ")[0]} hasn't signed in yet.</p>}
      </Card>

      <EditProfile open={edit} onClose={() => setEdit(false)} user={u} isAdmin={can("manage_users")} />
      <ChangePassword open={pw} onClose={() => setPw(false)} />
    </AppShell>
  );
}

function Detail({ icon: Icon, label, value, onCopy }: { icon: IconType; label: string; value: React.ReactNode; onCopy?: () => void }) {
  return (
    <div className="group grid grid-cols-[130px_1fr_auto] items-center gap-3 py-3 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="flex items-center gap-2 text-[13px] text-muted"><Icon className="size-4" />{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium text-ink">{value}</dd>
      {onCopy ? <button onClick={onCopy} aria-label={`Copy ${label}`} className="grid size-7 place-items-center rounded-lg text-muted opacity-0 transition group-hover:opacity-100 hover:bg-sunken hover:text-ink focus:opacity-100 max-sm:hidden"><LuCopy className="size-3.5" /></button> : <span />}
    </div>
  );
}

function buildActivity(u: User, names: string[]) {
  if (!u.lastLogin) return [];
  const t = todayISO();
  const n = (i: number) => names[i % names.length];
  const byRole: Record<string, { icon: IconType; text: string; when: string }[]> = {
    Admin: [
      { icon: LuSettings, text: "Changed the morning SMS numbers", when: t + "T07:50" },
      { icon: LuUserPlus, text: "Invited Yaw Boateng as Dispenser", when: addDays(t, -3) + "T10:12" },
      { icon: LuUpload, text: "Imported october_delivery.xlsx · 12 batches", when: addDays(t, -6) + "T15:31" },
      { icon: LuSparkles, text: "Generated the monthly pharmacy report", when: addDays(t, -9) + "T09:04" },
    ],
    Pharmacist: [
      { icon: LuBan, text: `Approved write-off for ${n(3)}`, when: addDays(t, -1) + "T17:58" },
      { icon: LuPencil, text: `Corrected quantity on ${n(15)}`, when: addDays(t, -2) + "T11:20" },
      { icon: LuSparkles, text: "Asked AI Insights about expiry losses", when: addDays(t, -2) + "T11:05" },
      { icon: LuPlus, text: `Received ${n(19)}`, when: addDays(t, -5) + "T14:46" },
    ],
    Dispenser: [
      { icon: LuScanLine, text: `Scanned ${n(26)} and dispensed first-expiry batch`, when: t + "T08:22" },
      { icon: LuScanLine, text: `Scanned ${n(20)}`, when: addDays(t, -1) + "T16:40" },
      { icon: LuCheck, text: "Cleared 3 expiry alerts", when: addDays(t, -1) + "T08:31" },
      { icon: LuPlus, text: `Received ${n(24)}`, when: addDays(t, -4) + "T10:02" },
    ],
  };
  return byRole[u.role] ?? byRole.Dispenser;
}

function EditProfile({ open, onClose, user, isAdmin }: { open: boolean; onClose: () => void; user: User; isAdmin: boolean }) {
  const toast = useToast();
  const [f, setF] = useState(user);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) { setF(user); setErr(""); }
  if (open !== lastOpen) setLastOpen(open);
  const set = (k: keyof User) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    if (!f.name.trim()) return setErr("Enter a name.");
    if (f.phone && !/^\+?\d[\d\s]{7,}$/.test(f.phone)) return setErr("Enter the phone number in +233 format.");
    setBusy(true);
    await api.updateUser(user.id, { name: f.name.trim(), phone: f.phone.trim(), bio: f.bio.trim(), regNo: f.regNo.trim(), photo: f.photo, ...(isAdmin ? { position: f.position.trim(), department: f.department } : {}) });
    setBusy(false); onClose(); toast({ message: "Profile saved" });
  }
  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) return setErr("That photo is over 1 MB. Choose a smaller one.");
    const r = new FileReader();
    r.onload = () => setF((p) => ({ ...p, photo: String(r.result) }));
    r.readAsDataURL(file);
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Edit profile" description={isAdmin ? "Admins can change position and department." : "Position and department are set by your admin."}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save profile</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="col-span-full flex items-center gap-4">
          <Avatar name={f.name || user.name} photo={f.photo} size={64} />
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium hover:bg-surface-2"><LuImage className="size-4" />Upload photo<input type="file" accept="image/png,image/jpeg" hidden onChange={onPhoto} /></label>
          {f.photo && <Button variant="ghost" size="sm" onClick={() => setF((p) => ({ ...p, photo: "" }))}>Remove</Button>}
        </div>
        <Field label="Full name" htmlFor="ep-name" className="col-span-full"><Input id="ep-name" value={f.name} onChange={set("name")} /></Field>
        <Field label="Phone" htmlFor="ep-phone"><Input id="ep-phone" value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
        <Field label="PSGH reg. no." htmlFor="ep-reg" hint="Pharmacists only"><Input id="ep-reg" className="font-mono" value={f.regNo} onChange={set("regNo")} /></Field>
        <Field label="Position" htmlFor="ep-pos"><Input id="ep-pos" value={f.position} onChange={set("position")} disabled={!isAdmin} /></Field>
        <Field label="Works in" htmlFor="ep-dept">
          <select id="ep-dept" value={f.department} onChange={set("department")} disabled={!isAdmin} className="h-10 rounded-xl border border-line bg-surface px-3 text-sm disabled:bg-sunken disabled:text-muted">
            {["Management", "Main dispensary", "Back store", "Cold room"].map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="About" htmlFor="ep-bio" className="col-span-full">
          <textarea id="ep-bio" rows={3} value={f.bio} onChange={set("bio")} className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm focus:border-brand focus:ring-4 focus:ring-[var(--ring)] focus:outline-none" />
        </Field>
        {err && <p role="alert" className="col-span-full text-sm text-critical-ink">{err}</p>}
      </div>
    </Modal>
  );
}

export function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [rep, setRep] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const strength = Math.min(4, [nw.length >= 10, /[A-Z]/.test(nw), /\d/.test(nw), /[^A-Za-z0-9]/.test(nw)].filter(Boolean).length);
  async function go() {
    if (nw.length < 10) return setErr("Use at least 10 characters.");
    if (nw !== rep) return setErr("The new passwords don't match.");
    setBusy(true);
    try { await api.changePassword(cur, nw); onClose(); setCur(""); setNw(""); setRep(""); setErr(""); toast({ message: "Password updated" }); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Change password" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Update password</Button></>}>
      <div className="grid gap-4">
        <Field label="Current password" htmlFor="cp-cur"><Input id="cp-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" htmlFor="cp-new">
          <Input id="cp-new" type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} />
          <div className="mt-1 grid grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-1 rounded-full", i < strength ? ["bg-critical", "bg-soon", "bg-brand", "bg-safe"][strength - 1] : "bg-sunken")} />)}</div>
        </Field>
        <Field label="Repeat new password" htmlFor="cp-rep"><Input id="cp-rep" type="password" autoComplete="new-password" value={rep} onChange={(e) => setRep(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-critical-ink">{err}</p>}
      </div>
    </Modal>
  );
}
