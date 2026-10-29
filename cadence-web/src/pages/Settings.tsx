import { useEffect, useState } from "react";
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from "@headlessui/react";
import {
  LuUsers, LuStore, LuRefreshCw, LuPalette, LuShieldCheck, LuBell, LuGlobe, LuDatabase, LuInfo, LuSun, LuMoon, LuMonitor, LuCheck,
  LuLock, LuLogOut, LuDownload, LuUpload, LuArrowRight, LuKeyboard, LuMail, LuMessageSquare,
} from "react-icons/lu";
import type { IconType } from "react-icons";
import { AppShell } from "@/components/layout/AppShell";
import { Avatar, Button, Card, CardHeader, Field, Input, Kbd, Toggle } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { api, auth, useCan, useCurrentUser, useStore, USE_MOCK, API_URL } from "@/lib/api";
import { alerts, savePharmacy, type NotifySettings } from "@/lib/features";
import { setPrefs, usePrefs, type Prefs, type ThemeChoice } from "@/lib/theme";
import { Link, navigate, usePath } from "@/lib/router";
import { cn, fmtDate, fmtStamp, todayISO, type DateFormat } from "@/lib/utils";
import { ChangePassword } from "@/pages/Profile";

const VERSION = "0.4.0";

export default function Settings() {
  const can = useCan();
  const path = usePath();
  const tabs = [
    { key: "appearance", label: "Appearance", icon: LuPalette, show: true },
    { key: "account", label: "Account & security", icon: LuShieldCheck, show: true },
    { key: "notifications", label: "Notifications", icon: LuBell, show: true },
    { key: "regional", label: "Region & format", icon: LuGlobe, show: true },
    { key: "data", label: "Data", icon: LuDatabase, show: can("view_inventory") },
    { key: "team", label: "Team", icon: LuUsers, show: can("manage_users") },
    { key: "pharmacy", label: "Pharmacy & expiry rules", icon: LuStore, show: can("company") || can("manage_users") },
    { key: "about", label: "About", icon: LuInfo, show: true },
  ].filter((t) => t.show);
  const wanted = new URLSearchParams(location.search || location.hash.split("?")[1] || "").get("tab");
  const [idx, setIdx] = useState(() => Math.max(0, tabs.findIndex((t) => t.key === wanted)));
  void path;
  const panel = (k: string) => k === "appearance" ? <Appearance /> : k === "account" ? <Account /> : k === "notifications" ? <Notifications /> : k === "regional" ? <Regional />
    : k === "data" ? <DataTab /> : k === "team" ? <Team /> : k === "pharmacy" ? <PharmacyForm /> : <About />;
  return (
    <AppShell title="Settings">
      <div className="mb-5"><h2 className="font-display text-[28px] font-bold">Settings</h2><p className="text-sm text-muted">How Cadence looks, your account, alerts, formats and your pharmacy's rules.</p></div>
      <TabGroup vertical selectedIndex={idx} onChange={setIdx} className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <TabList className="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1.5 shadow-hair lg:sticky lg:top-24 lg:flex-col lg:self-start">
          {tabs.map((t) => (
            <Tab key={t.key} className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium whitespace-nowrap text-ink-2 outline-none data-focus:ring-2 data-focus:ring-brand data-hover:bg-sunken data-hover:text-ink data-selected:bg-brand-soft data-selected:text-brand-ink"><t.icon className="size-4 shrink-0" />{t.label}</Tab>
          ))}
        </TabList>
        <TabPanels className="min-w-0">
          {tabs.map((t) => <TabPanel key={t.key} className="animate-fade-up">{panel(t.key)}</TabPanel>)}
        </TabPanels>
      </TabGroup>
    </AppShell>
  );
}

function Row({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 first:border-t-0">
      <div className="min-w-0 flex-1 basis-60"><p className="font-medium">{title}</p>{hint && <p className="text-sm text-muted">{hint}</p>}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-xl border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={cn("rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 transition", value === o.v ? "bg-surface text-ink shadow-hair" : "hover:text-ink")}>{o.label}</button>
      ))}
    </div>
  );
}

function ThemePreview({ dark }: { dark: boolean }) {
  return (
    <div className={cn("h-full w-full p-2", dark ? "bg-[#0c111d]" : "bg-[#f5f6f8]")}>
      <div className="flex h-full gap-1.5">
        <div className={cn("w-1/4 rounded-md", dark ? "bg-[#151b2b]" : "bg-white")}><div className="m-1.5 h-1.5 w-2/3 rounded bg-[#1E4FD8]" /><div className={cn("m-1.5 h-1 w-1/2 rounded", dark ? "bg-white/15" : "bg-black/10")} /><div className={cn("m-1.5 h-1 w-1/2 rounded", dark ? "bg-white/15" : "bg-black/10")} /></div>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className={cn("h-1/3 rounded-md", dark ? "bg-[#151b2b]" : "bg-white")}><div className="m-1.5 h-1.5 w-1/3 rounded bg-[#1E4FD8]/70" /></div>
          <div className="flex flex-1 gap-1.5">{["#e5484d", "#f5a524", "#17a34a"].map((c) => <div key={c} className={cn("flex-1 rounded-md", dark ? "bg-[#151b2b]" : "bg-white")}><div className="m-1.5 h-1 w-1/2 rounded" style={{ background: c }} /></div>)}</div>
        </div>
      </div>
    </div>
  );
}

function Appearance() {
  const p = usePrefs();
  const can = useCan();
  const opts: { v: ThemeChoice; label: string; icon: IconType }[] = [{ v: "light", label: "Light", icon: LuSun }, { v: "dark", label: "Dark", icon: LuMoon }, { v: "system", label: "Match device", icon: LuMonitor }];
  const starts: { v: Prefs["startPage"]; label: string; ok: boolean }[] = [
    { v: "/app", label: "Overview", ok: true }, { v: "/app/inventory", label: "Inventory", ok: can("view_inventory") },
    { v: "/app/alerts", label: "Alerts", ok: true }, { v: "/app/insights", label: "AI Insights", ok: can("view_insights") },
  ];
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="Theme" subtitle="Light for bright shop floors, dark for evenings. Saved on this device." />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
          {opts.map((o) => (
            <button key={o.v} role="radio" aria-checked={p.theme === o.v} onClick={() => setPrefs({ theme: o.v })}
              className={cn("group overflow-hidden rounded-2xl border-2 text-left transition hover:-translate-y-0.5", p.theme === o.v ? "border-brand shadow-card" : "border-line hover:border-line-strong")}>
              <div className="relative h-28 overflow-hidden">
                {o.v === "system"
                  ? <div className="flex h-full"><div className="w-1/2 overflow-hidden"><div className="w-[200%]"><div className="h-28"><ThemePreview dark={false} /></div></div></div><div className="w-1/2 overflow-hidden"><div className="-ml-[100%] w-[200%]"><div className="h-28"><ThemePreview dark /></div></div></div></div>
                  : <ThemePreview dark={o.v === "dark"} />}
                {p.theme === o.v && <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-brand text-white"><LuCheck className="size-3.5" /></span>}
              </div>
              <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5 text-sm font-medium"><o.icon className="size-4 text-muted" />{o.label}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <Row title="Reduce motion" hint="Turns off animations and moving charts. Cadence also follows your device's reduced-motion setting.">
          <Toggle checked={p.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} label="Reduce motion" />
        </Row>
        <Row title="Start page" hint="Where you land after signing in.">
          <Choice label="Start page" value={p.startPage} onChange={(v) => setPrefs({ startPage: v })} options={starts.filter((s) => s.ok).map(({ v, label }) => ({ v, label }))} />
        </Row>
      </Card>
    </div>
  );
}

function Account() {
  const u = useCurrentUser()!;
  const [pw, setPw] = useState(false);
  const toast = useToast();
  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4 p-5">
          <Avatar name={u.name} photo={u.photo} size={56} />
          <div className="min-w-0 flex-1"><p className="font-display text-lg font-semibold">{u.name}</p><p className="truncate text-sm text-muted">{u.email} · {u.role}{u.position ? ` · ${u.position}` : ""}</p></div>
          <Link to="/app/profile" className="inline-flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">Edit profile<LuArrowRight className="size-4" /></Link>
        </div>
      </Card>
      <Card>
        <Row title="Password" hint="Use at least 8 characters. Don't share one login between staff: each person's actions are recorded under their name.">
          <Button onClick={() => setPw(true)}><LuLock />Change password</Button>
        </Row>
        <Row title="This session" hint={<>Signed in {fmtStamp(u.lastLogin)} · {USE_MOCK ? "demo data in this browser" : "connected to the Cadence API"}. Sessions end automatically after a period without use.</>}>
          <Button variant="danger" onClick={() => { auth.logout(); toast({ message: "Signed out" }); navigate("/login"); }}><LuLogOut />Sign out</Button>
        </Row>
        <Row title="Role & permissions" hint={`Your role is ${u.role}. An Admin can change roles from Settings → Team.`}><span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-ink">{u.role}</span></Row>
      </Card>
      <ChangePassword open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

function Notifications() {
  const can = useCan();
  const [ns, setNs] = useState<NotifySettings | null>(null);
  useEffect(() => { alerts.getSettings().then(setNs, () => setNs(null)); }, []);
  const on = (b?: boolean) => <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", b ? "bg-safe-soft text-safe-ink" : "bg-sunken text-muted")}>{b ? "On" : "Off"}</span>;
  return (
    <Card>
      <CardHeader title="Alert delivery" subtitle="Pharmacy-wide: everyone on the SMS and email lists gets the daily digest." action={<Link to="/app/alerts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">{can("manage_alerts") ? "Manage" : "View"} on Alerts<LuArrowRight className="size-4" /></Link>} />
      <div className="pb-1">
        <Row title="SMS digest" hint={ns?.smsNumbers || "No numbers yet"}><LuMessageSquare className="size-4 text-muted" />{on(ns?.smsEnabled)}</Row>
        <Row title="Email digest" hint={ns?.email || "No address yet"}><LuMail className="size-4 text-muted" />{on(ns?.emailEnabled)}</Row>
        <Row title="Daily send time" hint="Ghana time (GMT)"><span className="font-mono text-sm">{ns?.digestTime ?? "—"}</span></Row>
        <Row title="What's included" hint={ns ? [ns.onExpired && "expired", ns.onCritical && "critical", ns.onSoon && "expiring soon", ns.onLowStock && "low stock"].filter(Boolean).join(", ") || "Nothing selected" : "—"}><span /></Row>
        <Row title="In-app badge" hint="The bell and the Alerts count always show expired and critical batches."><span className="rounded-full bg-safe-soft px-2.5 py-0.5 text-xs font-semibold text-safe-ink">Always on</span></Row>
      </div>
    </Card>
  );
}

function Regional() {
  const p = usePrefs();
  const sample = todayISO();
  const fmts: { v: DateFormat; label: string }[] = [{ v: "d MMM yyyy", label: fmtDate(sample, "d MMM yyyy") }, { v: "dd/MM/yyyy", label: fmtDate(sample, "dd/MM/yyyy") }, { v: "yyyy-MM-dd", label: fmtDate(sample, "yyyy-MM-dd") }];
  return (
    <Card>
      <Row title="Date format" hint="Used for expiry dates across inventory, alerts and reports. Imports accept any of these.">
        <Choice label="Date format" value={p.dateFormat} onChange={(v) => setPrefs({ dateFormat: v })} options={fmts} />
      </Row>
      <Row title="Currency" hint="All prices, costs and reports are in Ghana cedis."><span className="font-mono text-sm">GHS · ₵</span></Row>
      <Row title="Time zone" hint="Digest times and “today” for expiry counts."><span className="font-mono text-sm">Africa/Accra (GMT+0)</span></Row>
      <Row title="Language" hint="More languages are planned."><span className="text-sm">English (Ghana)</span></Row>
    </Card>
  );
}

function DataTab() {
  const can = useCan();
  const toast = useToast();
  const items = useStore((s) => s.items);
  function exportCsv() {
    const cols = ["name", "category", "barcode", "batch", "expiry", "qty", "unit_cost", "unit_price", "supplier", "reorder_level", "sold_this_month"] as const;
    const esc = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [cols.join(","), ...items.map((i) => [i.name, i.category, i.barcode, i.batch, i.expiry, i.qty, i.unitCost, i.unitPrice, i.supplier, i.reorderLevel, i.soldThisMonth].map(esc).join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `cadence-inventory-${todayISO()}.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast({ message: `Exported ${items.length} batches` });
  }
  return (
    <div className="grid gap-4">
      <Card>
        <Row title="Export inventory" hint={`Every batch (${items.length}) as a CSV that opens in Excel. The columns match the import format, so it doubles as a backup.`}>
          <Button onClick={exportCsv}><LuDownload />Export CSV</Button>
        </Row>
        {can("import") && <Row title="Import stock" hint="Add or update batches from a CSV or Excel file. You'll see a preview before anything is saved.">
          <Button onClick={() => navigate("/app/inventory?import=1")}><LuUpload />Import</Button>
        </Row>}
        <Row title="Analyse a file without saving" hint="Upload a file in AI Insights and choose “Analyse only”.">
          <Link to="/app/insights" className="inline-flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">Open AI Insights<LuArrowRight className="size-4" /></Link>
        </Row>
      </Card>
      {USE_MOCK && can("company") && (
        <Card>
          <Row title="Reset demo data" hint="Restores the sample stock, team, alerts and settings in this browser.">
            <Button onClick={() => { api.resetDemo(); toast({ message: "Demo data restored" }); }}><LuRefreshCw />Reset</Button>
          </Row>
        </Card>
      )}
    </div>
  );
}

function About() {
  const keys: [string, string][] = [["⌘K / Ctrl K", "Search and commands"], ["/", "Open search"], ["N", "Add stock"], ["Esc", "Close a dialog"]];
  return (
    <div className="grid gap-4">
      <Card>
        <Row title="Cadence.io" hint="Expiry tracking and AI insights for pharmacies."><span className="font-mono text-sm">v{VERSION}</span></Row>
        <Row title="Mode" hint={USE_MOCK ? "Demo: data lives in this browser only." : `Live: ${API_URL}`}><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", USE_MOCK ? "bg-soon-soft text-soon-ink" : "bg-safe-soft text-safe-ink")}>{USE_MOCK ? "Demo" : "Live"}</span></Row>
        <Row title="Website" hint="Product tour and pricing."><Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">Open<LuArrowRight className="size-4" /></Link></Row>
      </Card>
      <Card>
        <CardHeader title="Keyboard shortcuts" action={<LuKeyboard className="size-5 text-muted" />} />
        <ul className="grid gap-2 px-5 pb-5 sm:grid-cols-2">{keys.map(([k, d]) => <li key={k} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">{d}<Kbd>{k}</Kbd></li>)}</ul>
      </Card>
    </div>
  );
}

function Team() {
  const users = useStore((s) => s.users);
  return (
    <Card>
      <CardHeader title={`${users.length} people`} subtitle="Open a profile to see details or change someone's role." />
      <ul className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
        {users.map((u, i) => (
          <li key={u.id} className="animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
            <Link to={`/app/profile/${u.id}`} className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-line p-5 text-center transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card">
              <Avatar name={u.name} photo={u.photo} size={64} />
              <div><p className="font-semibold">{u.name}</p><p className="text-xs text-muted">{u.position}</p></div>
              <div className="flex gap-1.5">
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">{u.role}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", u.status === "Active" ? "bg-safe-soft text-safe-ink" : "bg-soon-soft text-soon-ink")}>{u.status}</span>
              </div>
              <p className="mt-auto text-[11px] text-muted">Last sign-in: {fmtStamp(u.lastLogin)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PharmacyForm() {
  const toast = useToast();
  const can = useCan();
  const ph = useStore((s) => s.pharmacy), t = useStore((s) => s.thresholds);
  const [f, setF] = useState({ name: ph.name, location: ph.location, licenceNo: ph.licenceNo ?? "", criticalDays: t.criticalMax, soonDays: t.soonMax });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const editable = can("company");
  const span = Math.max(f.soonDays + 60, 180);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await savePharmacy({ ...f, criticalDays: Number(f.criticalDays), soonDays: Number(f.soonDays) }); toast({ message: "Saved. Statuses and alerts now use the new rules." }); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Pharmacy" subtitle="Shown in the sidebar, alerts and reports" />
        <form id="ph-form" onSubmit={save} className="grid gap-4 px-5 pb-5">
          <Field label="Pharmacy name" htmlFor="ph-name"><Input id="ph-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!editable} /></Field>
          <Field label="Location" htmlFor="ph-loc"><Input id="ph-loc" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} disabled={!editable} placeholder="e.g. Tema, Ghana" /></Field>
          <Field label="Pharmacy Council licence no." htmlFor="ph-lic"><Input id="ph-lic" className="font-mono" value={f.licenceNo} onChange={(e) => setF({ ...f, licenceNo: e.target.value })} disabled={!editable} /></Field>
        </form>
      </Card>
      <Card>
        <CardHeader title="Expiry rules" subtitle="One rule for the counter, alerts and AI reports" />
        <div className="grid gap-4 px-5 pb-5">
          <div className="flex h-9 overflow-hidden rounded-xl text-[11px] font-semibold" aria-hidden>
            <div className="grid place-items-center bg-expired-soft text-expired-ink" style={{ flex: 10 }}>Expired</div>
            <div className="grid place-items-center truncate bg-critical-soft text-critical-ink" style={{ flex: f.criticalDays }}>1–{f.criticalDays}</div>
            <div className="grid place-items-center truncate bg-soon-soft text-soon-ink" style={{ flex: Math.max(1, f.soonDays - f.criticalDays) }}>{Number(f.criticalDays) + 1}–{f.soonDays}</div>
            <div className="grid place-items-center bg-safe-soft text-safe-ink" style={{ flex: Math.max(1, span - f.soonDays) }}>Safe</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Critical up to (days)" htmlFor="ph-crit"><Input id="ph-crit" type="number" min={1} max={365} form="ph-form" value={f.criticalDays} onChange={(e) => setF({ ...f, criticalDays: Number(e.target.value) || 1 })} disabled={!editable} /></Field>
            <Field label="Expiring soon up to (days)" htmlFor="ph-soon"><Input id="ph-soon" type="number" min={2} max={730} form="ph-form" value={f.soonDays} onChange={(e) => setF({ ...f, soonDays: Number(e.target.value) || 2 })} disabled={!editable} /></Field>
          </div>
          <p className="text-xs text-muted">Usual pharmacy settings are 30 / 90 days. Slow-moving stock often suits 60 / 180.</p>
          {err && <p role="alert" className="text-sm text-critical-ink">{err}</p>}
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" form="ph-form" variant="primary" loading={busy}>Save changes</Button>
              <Button type="button" variant="ghost" onClick={() => setF({ ...f, criticalDays: 30, soonDays: 90 })}>Use 30 / 90</Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
