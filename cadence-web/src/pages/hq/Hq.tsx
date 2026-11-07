/* Cadence HQ (/hq): the console for the team that runs Cadence.
   Who uses Cadence and how often, help requests (the distress button) and website leads.
   It never shows a pharmacy's stock, sales, prices or patients: the API doesn't send them. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuLayoutDashboard, LuStore, LuLifeBuoy, LuInbox, LuLogOut, LuSiren, LuSearch, LuArrowRight, LuShieldCheck, LuUsers,
  LuActivity, LuSparkles, LuUpload, LuMessageSquare, LuMail, LuCircleCheck, LuEye, LuPhone, LuRefreshCw, LuCircleAlert,
  LuMegaphone, LuServer, LuTrash2,
} from "react-icons/lu";
import type { IconType } from "react-icons";
import { Button, Card, CardHeader, EmptyState, Input, Logo } from "@/components/ui/primitives";
import { Drawer, useToast } from "@/components/ui/overlay";
import { Sparkline } from "@/components/charts";
import { hq, useHqSession, type Health, type HqDetail, type HqOverview, type HqPharmacy, type HqTicket, type Lead } from "@/lib/hq";
import { AskAi, BriefingCard, Messages, SystemPage } from "./HqComms";
import { Link, navigate } from "@/lib/router";
import { cn, fmtDate, fmtStamp, int, daysUntil } from "@/lib/utils";

const HEALTH: Record<Health, { label: string; cls: string; dot: string }> = {
  active: { label: "Active", cls: "bg-safe-soft text-safe-ink", dot: "bg-safe" },
  quiet: { label: "Quiet", cls: "bg-soon-soft text-soon-ink", dot: "bg-soon" },
  at_risk: { label: "At risk", cls: "bg-critical-soft text-critical-ink", dot: "bg-critical" },
  new: { label: "New", cls: "bg-brand-soft text-brand-ink", dot: "bg-brand" },
  inactive: { label: "Never used", cls: "bg-sunken text-muted", dot: "bg-expired" },
};
const ago = (stamp: string) => { if (!stamp) return "Never"; const d = -daysUntil(stamp.slice(0, 10)); return d <= 0 ? `Today ${stamp.slice(11, 16)}` : d === 1 ? "Yesterday" : `${d} days ago`; };

export default function Hq({ path }: { path: string }) {
  const session = useHqSession();
  useEffect(() => { document.title = "Cadence HQ"; }, []);
  if (!session) return <HqLogin />;
  return <HqShell path={path} />;
}

function HqLogin() {
  const [email, setEmail] = useState(hq.demoLogin?.email ?? ""), [pw, setPw] = useState(hq.demoLogin?.password ?? "");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await hq.login(email, pw); navigate("/hq", { replace: true }); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="mesh-brand grain relative grid min-h-full place-items-center overflow-hidden px-5 py-10">
      <div className="hex-lattice absolute inset-0 opacity-60" />
      <form onSubmit={go} noValidate className="relative w-full max-w-[400px] animate-fade-up rounded-3xl border border-white/10 bg-surface p-8 shadow-float">
        <div className="flex items-center gap-2"><Logo /><span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold tracking-wider text-bg uppercase">HQ</span></div>
        <h1 className="mt-6 font-display text-[28px] font-bold">Cadence HQ</h1>
        <p className="mt-1 text-sm text-muted">For the Cadence team. Pharmacy accounts can't sign in here.</p>
        {err && <p role="alert" className="mt-5 flex items-start gap-2 rounded-xl bg-critical-soft px-3.5 py-3 text-sm text-critical-ink"><LuCircleAlert className="mt-0.5 size-4 shrink-0" />{err}</p>}
        {hq.demoLogin && <p className="mt-5 rounded-xl border border-dashed border-brand/40 bg-brand-soft/40 px-3.5 py-2.5 text-xs text-brand-ink">Demo mode: sample pharmacies. The details are filled in for you.</p>}
        <div className="mt-6 grid gap-4">
          <label className="grid gap-1.5 text-[13px] font-medium text-ink-2" htmlFor="hq-email">Email<Input id="hq-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" /></label>
          <label className="grid gap-1.5 text-[13px] font-medium text-ink-2" htmlFor="hq-pw">Password<Input id="hq-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-11" /></label>
          <Button type="submit" variant="primary" size="lg" loading={busy}>Log in to HQ</Button>
        </div>
        <p className="mt-6 flex items-center gap-2 text-xs text-muted"><LuShieldCheck className="size-4 text-safe" />HQ sees usage and help requests only. Never stock, sales or patients.</p>
      </form>
    </div>
  );
}

const NAV: { to: string; label: string; icon: IconType }[] = [
  { to: "/hq", label: "Overview", icon: LuLayoutDashboard },
  { to: "/hq/pharmacies", label: "Pharmacies", icon: LuStore },
  { to: "/hq/help", label: "Help requests", icon: LuLifeBuoy },
  { to: "/hq/leads", label: "Demo requests", icon: LuInbox },
  { to: "/hq/ai", label: "Ask AI", icon: LuSparkles },
  { to: "/hq/messages", label: "Messages", icon: LuMegaphone },
  { to: "/hq/system", label: "System", icon: LuServer },
];

function HqShell({ path }: { path: string }) {
  const session = useHqSession()!;
  const toast = useToast();
  const [ov, setOv] = useState<HqOverview | null>(null);
  const seen = useRef<number | null>(null);
  const refresh = useCallback(() => hq.overview().then((o) => {
    setOv(o);
    if (seen.current !== null && o.urgentOpen > seen.current) toast({ message: "New URGENT help request", tone: "error" });
    seen.current = o.urgentOpen;
    document.title = o.openTickets ? `(${o.openTickets}) Cadence HQ` : "Cadence HQ";
  }, () => {}), [toast]);
  useEffect(() => { void refresh(); const t = window.setInterval(refresh, 30000); return () => clearInterval(t); }, [refresh]);
  const p = path.split("?")[0].replace(/\/+$/, "") || "/hq";
  const page = p === "/hq/pharmacies" ? <Pharmacies /> : p === "/hq/help" ? <Help onChange={refresh} /> : p === "/hq/leads" ? <Leads />
    : p === "/hq/ai" ? <AskAi /> : p === "/hq/messages" ? <Messages /> : p === "/hq/system" ? <SystemPage /> : <Overview ov={ov} />;

  return (
    <div className="min-h-full bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col bg-[#0a1230] text-white md:flex">
        <div className="flex h-16 items-center gap-2 px-5"><Logo onDark /><span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">HQ</span></div>
        <nav className="mt-4 grid gap-1 px-3" aria-label="HQ">
          {NAV.map((n) => {
            const on = n.to === "/hq" ? p === "/hq" : p.startsWith(n.to);
            const count = n.to === "/hq/help" ? ov?.openTickets : n.to === "/hq/leads" ? ov?.newLeads : 0;
            return (
              <Link key={n.to} to={n.to} className={cn("flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white", on && "bg-white/12 text-white")}>
                <n.icon className="size-[18px]" /><span className="flex-1">{n.label}</span>
                {!!count && <span className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold", n.to === "/hq/help" && ov?.urgentOpen ? "bg-critical" : "bg-white/20")}>{count}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-white/10 p-4 text-sm">
          <p className="font-medium">{session.name}</p><p className="truncate text-xs text-white/60">{session.email}</p>
          <button onClick={() => { hq.logout(); navigate("/hq", { replace: true }); }} className="mt-3 flex items-center gap-2 text-xs text-white/70 hover:text-white"><LuLogOut className="size-4" />Log out</button>
        </div>
      </aside>
      <div className="md:pl-[240px]">
        <header className="glass sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line/70 px-4 md:px-8">
          <span className="md:hidden"><Logo withText={false} /></span>
          <nav className="flex gap-1 overflow-x-auto md:hidden">{NAV.map((n) => <Link key={n.to} to={n.to} className="rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-ink-2 hover:bg-sunken">{n.label}</Link>)}</nav>
          <h1 className="hidden font-display text-lg font-semibold md:block">{NAV.find((n) => (n.to === "/hq" ? p === "/hq" : p.startsWith(n.to)))?.label ?? "Overview"}</h1>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { void refresh(); }}><LuRefreshCw />Refresh</Button>
        </header>
        {!!ov?.urgentOpen && p !== "/hq/help" && (
          <Link to="/hq/help" className="flex items-center gap-3 bg-critical px-4 py-3 text-sm font-semibold text-white md:px-8"><LuSiren className="size-5 animate-pulse" />{ov.urgentOpen} urgent help {ov.urgentOpen === 1 ? "request is" : "requests are"} waiting<LuArrowRight className="ml-auto size-4" /></Link>
        )}
        <main className="mx-auto max-w-[1280px] px-4 pt-6 pb-16 md:px-8">{page}</main>
      </div>
    </div>
  );
}

function Stat({ icon: I, label, value, tone, sub }: { icon: IconType; label: string; value: string | number; tone?: "critical" | "safe"; sub?: string }) {
  return (
    <Card className="p-5">
      <span className={cn("grid size-9 place-items-center rounded-xl", tone === "critical" ? "bg-critical-soft text-critical-ink" : tone === "safe" ? "bg-safe-soft text-safe-ink" : "bg-brand-soft text-brand-ink")}><I className="size-[18px]" /></span>
      <p className="mt-4 text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 font-display text-[28px] leading-tight font-bold tabular">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

function Bars({ data, labels, className }: { data: number[]; labels?: string[]; className?: string }) {
  const max = Math.max(1, ...data);
  return (
    <div className={cn("flex items-end gap-1", className)}>
      {data.map((v, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={`${labels?.[i] ?? ""} ${v}`}>
          <div className="flex min-h-0 w-full flex-1 items-end"><div className={cn("w-full rounded-t", i === data.length - 1 ? "bg-brand" : "bg-brand/35")} style={{ height: `${Math.max(3, (v / max) * 100)}%` }} /></div>
          {labels && <span className="text-[10px] text-muted">{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

function Overview({ ov }: { ov: HqOverview | null }) {
  const [list, setList] = useState<HqPharmacy[]>([]);
  useEffect(() => { hq.pharmacies().then(setList, () => {}); }, []);
  if (!ov) return <p className="text-muted">Loading…</p>;
  const needs = list.filter((p) => p.urgentOpen || p.health === "at_risk" || p.health === "inactive").slice(0, 6);
  return (
    <div className="grid gap-4">
      <BriefingCard />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat icon={LuStore} label="Pharmacies" value={ov.pharmacies} sub={`${ov.newThisWeek} joined this week`} />
        <Stat icon={LuActivity} label="Active this week" value={ov.activeThisWeek} tone="safe" sub={`${ov.users} people in total`} />
        <Stat icon={LuLifeBuoy} label="Open help requests" value={ov.openTickets} tone={ov.urgentOpen ? "critical" : undefined} sub={ov.urgentOpen ? `${ov.urgentOpen} urgent` : "none urgent"} />
        <Stat icon={LuCircleAlert} label="At risk" value={ov.atRisk} tone={ov.atRisk ? "critical" : undefined} sub="no activity for 14+ days" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader title="Pharmacies using Cadence each day" subtitle="Last 14 days" /><div className="px-5 pb-5"><Bars data={ov.activePharmaciesByDay} className="h-40" /></div></Card>
        <Card><CardHeader title="New sign-ups" subtitle="Per week, last 8 weeks" /><div className="px-5 pb-5"><Bars data={ov.signupsByWeek} labels={ov.signupsByWeek.map((_, i) => (i === 7 ? "now" : `-${7 - i}w`))} className="h-40" /></div></Card>
      </div>
      <Card>
        <CardHeader title="Needs attention" subtitle="Urgent requests, or pharmacies that have gone quiet" action={<Link to="/hq/pharmacies" className="flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">All pharmacies<LuArrowRight className="size-4" /></Link>} />
        {needs.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Everyone's fine.</p> : (
          <ul className="grid gap-1 px-3 pb-3">{needs.map((p) => (
            <li key={p.id}><Link to="/hq/pharmacies" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-sunken">
              <span className={cn("size-2 rounded-full", HEALTH[p.health].dot)} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block text-xs text-muted">{p.location} · last active {ago(p.lastActive).toLowerCase()}</span></span>
              {p.urgentOpen > 0 && <span className="rounded-full bg-critical px-2 py-0.5 text-[11px] font-semibold text-white">Urgent help</span>}
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", HEALTH[p.health].cls)}>{HEALTH[p.health].label}</span>
            </Link></li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function Pharmacies() {
  const [list, setList] = useState<HqPharmacy[] | null>(null);
  const [q, setQ] = useState(""), [filter, setFilter] = useState<Health | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { hq.pharmacies().then(setList, (e) => setErr((e as Error).message)); }, []);
  const shown = useMemo(() => (list ?? []).filter((p) => (filter === "all" || p.health === filter) && (!q || `${p.name} ${p.location} ${p.adminName} ${p.adminEmail}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.urgentOpen - a.urgentOpen || (b.lastActive > a.lastActive ? 1 : -1)), [list, q, filter]);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1"><Input icon={<LuSearch />} placeholder="Search pharmacy, town or admin" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search pharmacies" /></div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
          {(["all", "active", "quiet", "at_risk", "new", "inactive"] as const).map((h) => (
            <button key={h} onClick={() => setFilter(h)} className={cn("rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap text-ink-2", filter === h && "bg-ink text-bg dark:bg-brand dark:text-on-brand")}>{h === "all" ? `All ${list?.length ?? ""}` : HEALTH[h].label}</button>
          ))}
        </div>
      </div>
      {err && <p role="alert" className="mb-4 rounded-xl bg-critical-soft px-3.5 py-3 text-sm text-critical-ink">{err}</p>}
      <Card className="overflow-hidden">
        {!list ? <p className="p-5 text-sm text-muted">Loading…</p> : shown.length === 0 ? <EmptyState icon={<LuStore />} title="No pharmacies match" body="Try another search or filter." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface-2 text-xs font-semibold text-muted"><tr>
                <th className="px-4 py-3 text-left">Pharmacy</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Last 14 days</th>
                <th className="px-4 py-3 text-right">Active people (7d)</th><th className="px-4 py-3 text-right">Days used (30d)</th><th className="px-4 py-3 text-left">Last active</th><th className="px-4 py-3 text-left">Help</th>
              </tr></thead>
              <tbody>{shown.map((p) => (
                <tr key={p.id} onClick={() => setOpen(p.id)} className="cursor-pointer border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-3"><p className="font-medium">{p.name}</p><p className="text-xs text-muted">{p.location} · joined {fmtDate(p.joined)}</p></td>
                  <td className="px-4 py-3"><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", HEALTH[p.health].cls)}>{HEALTH[p.health].label}</span></td>
                  <td className="px-4 py-3"><Sparkline data={p.activityByDay.length > 1 ? p.activityByDay : [0, 0]} className="h-8 w-28" color={p.health === "at_risk" ? "var(--critical)" : "var(--brand)"} /></td>
                  <td className="px-4 py-3 text-right tabular">{p.activeUsersWeek} / {p.staff}</td>
                  <td className="px-4 py-3 text-right tabular">{p.activeDaysMonth}</td>
                  <td className="px-4 py-3 text-xs">{ago(p.lastActive)}</td>
                  <td className="px-4 py-3">{p.openTickets ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", p.urgentOpen ? "bg-critical text-white" : "bg-soon-soft text-soon-ink")}>{p.openTickets} open</span> : <span className="text-xs text-muted">—</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <PharmacyDrawer id={open} onClose={() => setOpen(null)} onDeleted={(id) => { setList((l) => l?.filter((x) => x.id !== id) ?? null); setOpen(null); }} />
    </>
  );
}

function PharmacyDrawer({ id, onClose, onDeleted }: { id: string | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState<HqDetail | null>(null);
  const [confirming, setConfirming] = useState(false), [typed, setTyped] = useState(""), [busy, setBusy] = useState(false), [delErr, setDelErr] = useState("");
  useEffect(() => { setD(null); setConfirming(false); setTyped(""); setDelErr(""); if (id) hq.pharmacy(id).then(setD, () => {}); }, [id]);
  async function remove() {
    if (!id || !d) return;
    setBusy(true); setDelErr("");
    try { await hq.deletePharmacy(id, typed); toast({ message: `Deleted ${d.pharmacy.name} and all its data` }); onDeleted(id); }
    catch (e) { setDelErr((e as Error).message); }
    finally { setBusy(false); }
  }
  const p = d?.pharmacy;
  const feat: [keyof HqPharmacy["featuresMonth"], string, IconType][] = [["login", "Logins", LuUsers], ["ai_question", "AI questions", LuSparkles], ["item_added", "Batches added", LuStore], ["import", "Rows imported", LuUpload], ["invite", "Invites sent", LuMail], ["help_request", "Help requests", LuLifeBuoy]];
  return (
    <Drawer open={!!id} onClose={onClose} title="Pharmacy usage">
      {!p ? <p className="p-6 text-sm text-muted">Loading…</p> : (
        <div className="grid gap-6 p-6">
          <div>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", HEALTH[p.health].cls)}>{HEALTH[p.health].label}</span>
            <h3 className="mt-3 font-display text-2xl font-bold">{p.name}</h3>
            <p className="text-sm text-muted">{p.location} · joined {fmtDate(p.joined)} · last active {ago(p.lastActive).toLowerCase()}</p>
          </div>
          <div className="rounded-2xl border border-line p-4 text-sm">
            <p className="text-xs font-semibold tracking-wider text-muted uppercase">Admin contact</p>
            <p className="mt-1 font-medium">{p.adminName}</p>
            <a href={`mailto:${p.adminEmail}`} className="text-brand-ink hover:underline">{p.adminEmail}</a>
            <p className="mt-2 text-xs text-muted">{p.staff} people · {Object.entries(d!.roles).map(([r, n]) => `${n} ${r}`).join(", ")}</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">People using it each day (30 days)</p>
            <Bars data={d!.activityMonth.map((x) => x.people)} className="h-28" />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">What they used (30 days)</p>
            <ul className="grid grid-cols-2 gap-2">{feat.map(([k, l, I]) => <li key={k} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"><I className="size-4 text-muted" /><span className="flex-1">{l}</span><b className="tabular">{int(p.featuresMonth[k])}</b></li>)}</ul>
            <p className="mt-2 text-xs text-muted">Alerts: SMS {p.smsOn ? "on" : "off"} · email {p.emailOn ? "on" : "off"}</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Help requests</p>
            {d!.tickets.length === 0 ? <p className="text-sm text-muted">None.</p> : d!.tickets.map((t) => <p key={t.id} className="mb-1.5 flex items-center gap-2 text-sm"><span className={cn("size-2 rounded-full", t.status === "resolved" ? "bg-safe" : t.urgency === "urgent" ? "bg-critical" : "bg-soon")} />{t.categoryLabel}<span className="ml-auto text-xs text-muted">{fmtStamp(t.createdAt)}</span></p>)}
          </div>
          <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted"><LuShieldCheck className="mt-0.5 size-4 shrink-0 text-safe" />HQ only receives usage counts. This pharmacy's stock, sales, prices and alert recipients stay private to them.</p>
          <div className="rounded-2xl border border-critical/40 p-4">
            <p className="text-xs font-semibold tracking-wider text-critical-ink uppercase">Delete account</p>
            {!confirming ? (
              <>
                <p className="mt-1 text-sm text-muted">Permanently removes {p.name}: its {p.staff} {p.staff === 1 ? "person" : "people"}, stock, sales, alerts and help requests. They won't be able to sign in again.</p>
                <Button variant="ghost" className="mt-3 text-critical-ink" onClick={() => setConfirming(true)}><LuTrash2 />Delete this pharmacy…</Button>
              </>
            ) : (
              <form className="mt-2 grid gap-2" onSubmit={(e) => { e.preventDefault(); remove(); }}>
                <label className="text-sm" htmlFor="del-name">This can't be undone. Type <b>{p.name}</b> to confirm.</label>
                <Input id="del-name" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={p.name} autoComplete="off" />
                {delErr && <p role="alert" className="text-xs text-critical-ink">{delErr}</p>}
                <div className="flex gap-2">
                  <Button type="submit" className="bg-critical text-white hover:bg-critical/90" loading={busy} disabled={typed.trim().toLowerCase() !== p.name.trim().toLowerCase()}><LuTrash2 />Delete permanently</Button>
                  <Button type="button" variant="ghost" onClick={() => { setConfirming(false); setTyped(""); setDelErr(""); }}>Cancel</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Help({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [list, setList] = useState<HqTicket[] | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [textIt, setTextIt] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => hq.tickets(status).then(setList, () => setList([])), [status]);
  useEffect(() => { void load(); const t = window.setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  async function update(t: HqTicket, patch: { status?: HqTicket["status"]; reply?: string; textReply?: boolean }, msg: string) {
    setBusy(t.id);
    try { await hq.updateTicket(t.id, patch); toast({ message: msg }); await load(); onChange(); } catch (e) { toast({ message: (e as Error).message, tone: "error" }); } finally { setBusy(null); }
  }
  return (
    <>
      <div className="mb-4 flex gap-1 rounded-xl border border-line bg-surface p-1 sm:w-fit">
        {(["open", "resolved", "all"] as const).map((s) => <button key={s} onClick={() => setStatus(s)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 capitalize", status === s && "bg-ink text-bg dark:bg-brand dark:text-on-brand")}>{s}</button>)}
      </div>
      {!list ? <p className="text-muted">Loading…</p> : list.length === 0 ? <Card><EmptyState icon={<LuCircleCheck />} title={status === "open" ? "No open requests" : "Nothing here"} body="When a pharmacy presses Get help, it appears here straight away and you're emailed (and texted if it's urgent)." /></Card> : (
        <div className="grid gap-3">{list.map((t) => (
          <Card key={t.id} className={cn("overflow-hidden", t.urgency === "urgent" && t.status !== "resolved" && "ring-2 ring-critical")}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
              {t.urgency === "urgent" && <span className="flex items-center gap-1 rounded-full bg-critical px-2.5 py-0.5 text-xs font-bold text-white"><LuSiren className="size-3.5" />URGENT</span>}
              <span className="font-semibold">{t.pharmacyName}</span><span className="text-sm text-muted">· {t.categoryLabel}</span>
              <span className={cn("ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold", t.status === "open" ? "bg-soon-soft text-soon-ink" : t.status === "acknowledged" ? "bg-brand-soft text-brand-ink" : "bg-safe-soft text-safe-ink")}>{t.status === "acknowledged" ? "Seen" : t.status === "open" ? "New" : "Resolved"}</span>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_340px]">
              <div>
                <p className="text-[15px] whitespace-pre-line">{t.message}</p>
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{t.raisedBy}{t.raisedByEmail ? ` · ${t.raisedByEmail}` : ""}</span>
                  {t.phone && <a href={`tel:${t.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 font-medium text-brand-ink hover:underline"><LuPhone className="size-3.5" />{t.phone}</a>}
                  <span>{fmtStamp(t.createdAt)}</span>
                </p>
                {t.reply && <p className="mt-3 flex gap-2 rounded-xl bg-brand-soft/50 p-3 text-sm"><LuMessageSquare className="mt-0.5 size-4 shrink-0 text-brand-ink" />{t.reply}</p>}
              </div>
              <div className="grid content-start gap-2">
                <textarea rows={3} value={reply[t.id] ?? ""} onChange={(e) => setReply((r) => ({ ...r, [t.id]: e.target.value }))} placeholder="Reply to the pharmacy (they see it in Cadence and by email)"
                  className="rounded-xl border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-brand focus:outline-none" aria-label={`Reply to ${t.pharmacyName}`} />
                {t.phone && reply[t.id]?.trim() && (
                  <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" className="size-4 accent-[var(--brand)]" checked={!!textIt[t.id]} onChange={(e) => setTextIt((x) => ({ ...x, [t.id]: e.target.checked }))} />Also text the reply to {t.phone}</label>
                )}
                <div className="flex flex-wrap gap-2">
                  {reply[t.id]?.trim() && <Button size="sm" variant="primary" loading={busy === t.id} onClick={() => update(t, { reply: reply[t.id], status: t.status === "open" ? "acknowledged" : t.status, textReply: !!textIt[t.id] && !!t.phone }, textIt[t.id] ? "Reply sent by email and SMS" : "Reply sent")}><LuMessageSquare />Send reply</Button>}
                  {t.status === "open" && <Button size="sm" loading={busy === t.id} onClick={() => update(t, { status: "acknowledged" }, "Marked as seen")}><LuEye />Mark seen</Button>}
                  {t.status !== "resolved" ? <Button size="sm" variant="ghost" loading={busy === t.id} onClick={() => update(t, { status: "resolved" }, "Resolved")}><LuCircleCheck />Resolve</Button>
                    : <Button size="sm" variant="ghost" onClick={() => update(t, { status: "open" }, "Reopened")}>Reopen</Button>}
                </div>
              </div>
            </div>
          </Card>
        ))}</div>
      )}
    </>
  );
}

function Leads() {
  const toast = useToast();
  const [list, setList] = useState<Lead[] | null>(null);
  useEffect(() => { hq.leads().then(setList, () => setList([])); }, []);
  async function set(l: Lead, status: Lead["status"]) { await hq.updateLead(l.id, status); setList((x) => x?.map((y) => (y.id === l.id ? { ...y, status } : y)) ?? null); toast({ message: `Marked ${status}` }); }
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Demo requests" subtitle="From the website's Book a demo form" />
      {!list ? <p className="px-5 pb-5 text-sm text-muted">Loading…</p> : list.length === 0 ? <EmptyState icon={<LuInbox />} title="No demo requests yet" body="They'll appear here when someone fills in the form on the website." /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2 text-xs font-semibold text-muted"><tr><th className="px-4 py-3 text-left">Pharmacy</th><th className="px-4 py-3 text-left">Contact</th><th className="px-4 py-3 text-left">Note</th><th className="px-4 py-3 text-left">Received</th><th className="px-4 py-3 text-left">Status</th></tr></thead>
          <tbody>{list.map((l) => (
            <tr key={l.id} className="border-t border-line align-top">
              <td className="px-4 py-3"><p className="font-medium">{l.pharmacy}</p><p className="text-xs text-muted">{l.branches}</p></td>
              <td className="px-4 py-3"><p>{l.name}</p><a href={`tel:${l.phone.replace(/\s/g, "")}`} className="text-xs text-brand-ink hover:underline">{l.phone}</a>{l.email && <a href={`mailto:${l.email}`} className="block text-xs text-brand-ink hover:underline">{l.email}</a>}</td>
              <td className="max-w-[280px] px-4 py-3 text-xs text-ink-2">{l.message || "—"}</td>
              <td className="px-4 py-3 text-xs">{fmtStamp(l.createdAt)}</td>
              <td className="px-4 py-3"><select value={l.status} onChange={(e) => set(l, e.target.value as Lead["status"])} aria-label={`Status for ${l.pharmacy}`} className="h-8 rounded-lg border border-line bg-surface px-2 text-xs">
                {(["new", "contacted", "booked", "closed"] as const).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}
