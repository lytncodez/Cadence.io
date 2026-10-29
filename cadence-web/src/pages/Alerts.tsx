import { useCallback, useEffect, useMemo, useState } from "react";
import { LuCheck, LuCheckCheck, LuMessageSquare, LuMail, LuSend, LuBan, LuTriangleAlert, LuClock, LuLayers, LuArrowRight, LuTrash2, LuInfo, LuCircleAlert, LuCircleCheck } from "react-icons/lu";
import { AppShell } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Skeleton, StatusPill, Toggle } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { useCan, useStore, USE_MOCK } from "@/lib/api";
import { alerts as alertsApi, type AlertItem, type Delivery, type NotifySettings, type SendResult } from "@/lib/features";
import { Link } from "@/lib/router";
import { cn, fmtStamp } from "@/lib/utils";

type Filter = "all" | "unread" | "expiry" | "stock";

export default function Alerts() {
  const can = useCan();
  const toast = useToast();
  const items = useStore((s) => s.items), thresholds = useStore((s) => s.thresholds);
  const [list, setList] = useState<AlertItem[] | null>(null);
  const [ns, setNs] = useState<NotifySettings | null>(null);
  const [log, setLog] = useState<Delivery[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const manage = can("manage_alerts");

  const load = useCallback(async () => {
    try {
      setError("");
      const [a, n, d] = await Promise.all([alertsApi.list(), alertsApi.getSettings(), alertsApi.deliveries()]);
      setList(a); setNs((cur) => cur ?? n); setLog(d);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load, items, thresholds]);

  const counts = useMemo(() => {
    const l = list ?? [];
    return { all: l.length, unread: l.filter((a) => !a.read).length, expiry: l.filter((a) => a.type === "expiry").length, stock: l.filter((a) => a.type === "stock").length };
  }, [list]);
  const shown = (list ?? []).filter((a) => filter === "all" || (filter === "unread" ? !a.read : a.type === filter));

  async function markRead(keys: string[]) {
    await alertsApi.markRead(keys);
    setList((l) => l?.map((a) => (keys.includes(a.key) ? { ...a, read: true } : a)) ?? null);
  }
  async function run(label: string, fn: () => Promise<SendResult | SendResult[]>) {
    setBusy(label); setResult(null);
    try {
      const r = await fn();
      const arr = Array.isArray(r) ? r : [r];
      if (!arr.length) toast({ message: "Nothing to send: no channels are on, or nothing needs attention." });
      arr.forEach((x) => toast({ message: x.status === "failed" ? `${x.channel.toUpperCase()} failed: ${x.detail}` : x.status === "mock" ? `${x.channel.toUpperCase()} logged (demo mode, not sent)` : `${x.channel.toUpperCase()} sent`, tone: x.status === "failed" ? "error" : "success" }));
      if (!Array.isArray(r)) setResult(r);
      setLog(await alertsApi.deliveries());
    } catch (e) { toast({ message: (e as Error).message, tone: "error" }); }
    finally { setBusy(null); }
  }
  async function save() {
    if (!ns) return;
    setBusy("save");
    try { setNs(await alertsApi.saveSettings(ns)); toast({ message: "Alert settings saved" }); await load(); }
    catch (e) { toast({ message: (e as Error).message, tone: "error" }); }
    finally { setBusy(null); }
  }

  return (
    <AppShell title="Alerts">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[28px] font-bold">What needs attention</h2>
          <p className="text-sm text-muted">Expiry and low-stock warnings, and where they're delivered.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!counts.unread} onClick={() => markRead((list ?? []).filter((a) => !a.read).map((a) => a.key))}><LuCheckCheck />Mark all read</Button>
          {manage && <Button variant="primary" loading={busy === "digest"} onClick={() => run("digest", alertsApi.sendDigest)}><LuSend />Send digest now</Button>}
        </div>
      </div>

      {error && <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-2xl bg-critical-soft px-4 py-3 text-sm text-critical-ink"><LuCircleAlert className="mt-0.5 size-4 shrink-0" />{error}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-3">
            {([["all", "All"], ["unread", "Unread"], ["expiry", "Expiry"], ["stock", "Low stock"]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={cn("flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-medium text-ink-2 transition hover:text-ink", filter === k && "border-transparent bg-ink text-bg hover:text-bg dark:bg-brand dark:text-on-brand")}>
                {l}<span className="text-xs opacity-70 tabular">{counts[k]}</span>
              </button>
            ))}
          </div>
          {!list ? (
            <div className="grid gap-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : shown.length === 0 ? (
            <EmptyState icon={<LuCheck />} title="All clear" body={filter === "unread" ? "You've read every alert." : "Nothing in this view needs attention."} />
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((a) => <AlertRow key={a.key} a={a} onRead={() => markRead([a.key])} />)}
            </ul>
          )}
        </Card>

        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader title="Delivery" subtitle={manage ? "Morning SMS and a daily email digest" : "Set by your pharmacy admin"} action={<Badge>{USE_MOCK ? "Demo mode" : "Live"}</Badge>} />
            {!ns ? <div className="grid gap-3 px-5 pb-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : (
              <form className="grid gap-4 px-5 pb-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                <Row icon={<LuMessageSquare />} title="SMS alerts" hint="Critical and expired batches, once a day">
                  <Toggle checked={ns.smsEnabled} onChange={(v) => setNs({ ...ns, smsEnabled: v })} label="SMS alerts" disabled={!manage} />
                </Row>
                <Field label="Phone numbers" htmlFor="al-numbers" hint="Separate with commas, e.g. +233 24 555 0142">
                  <Input id="al-numbers" value={ns.smsNumbers} onChange={(e) => setNs({ ...ns, smsNumbers: e.target.value })} disabled={!manage || !ns.smsEnabled} />
                </Field>
                <Row icon={<LuMail />} title="Email digest" hint="Every open alert in one email">
                  <Toggle checked={ns.emailEnabled} onChange={(v) => setNs({ ...ns, emailEnabled: v })} label="Email digest" disabled={!manage} />
                </Row>
                <Field label="Email address" htmlFor="al-email">
                  <Input id="al-email" type="email" value={ns.email} onChange={(e) => setNs({ ...ns, email: e.target.value })} disabled={!manage || !ns.emailEnabled} />
                </Field>
                <Field label="Send at (Ghana time)" htmlFor="al-time">
                  <Input id="al-time" type="time" value={ns.digestTime} onChange={(e) => setNs({ ...ns, digestTime: e.target.value })} disabled={!manage} className="max-w-[160px]" />
                </Field>
                <div className="grid gap-1 rounded-2xl border border-line p-3">
                  <p className="px-1 pb-1 text-xs font-semibold tracking-wider text-muted uppercase">Alert me about</p>
                  {([["onExpired", "Expired batches", LuBan], ["onCritical", `Critical batches (1–${thresholds.criticalMax} days)`, LuTriangleAlert], ["onSoon", `Expiring soon (${thresholds.criticalMax + 1}–${thresholds.soonMax} days)`, LuClock], ["onLowStock", "Low stock", LuLayers]] as const).map(([k, l, I]) => (
                    <label key={k} className="flex items-center justify-between gap-3 rounded-xl px-1 py-1.5 text-sm">
                      <span className="flex items-center gap-2"><I className="size-4 text-muted" />{l}</span>
                      <Toggle checked={ns[k]} onChange={(v) => setNs({ ...ns, [k]: v })} label={l} disabled={!manage} />
                    </label>
                  ))}
                </div>
                {manage && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="primary" loading={busy === "save"}>Save</Button>
                    <Button type="button" loading={busy === "sms"} onClick={() => run("sms", alertsApi.testSms)}><LuMessageSquare />Test SMS</Button>
                    <Button type="button" loading={busy === "email"} onClick={() => run("email", alertsApi.testEmail)}><LuMail />Test email</Button>
                  </div>
                )}
                {result && (
                  <p className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-sm", result.status === "failed" ? "bg-critical-soft text-critical-ink" : result.status === "mock" ? "bg-brand-soft text-brand-ink" : "bg-safe-soft text-safe-ink")}>
                    {result.status === "failed" ? <LuCircleAlert className="mt-0.5 size-4 shrink-0" /> : result.status === "mock" ? <LuInfo className="mt-0.5 size-4 shrink-0" /> : <LuCircleCheck className="mt-0.5 size-4 shrink-0" />}
                    {result.detail}
                  </p>
                )}
                {manage && <p className="text-xs text-muted">Save first, then test. Tests go to the saved numbers and address.</p>}
              </form>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Recent deliveries" subtitle="Last 20 messages" action={manage && log.length ? <Button size="sm" variant="ghost" onClick={async () => { await alertsApi.clearDeliveries(); setLog([]); }}><LuTrash2 />Clear</Button> : undefined} />
            {log.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Nothing sent yet. Use Test SMS, Test email or Send digest now.</p> : (
              <ul className="grid min-w-0 gap-2 px-3 pb-3">
                {log.map((d) => (
                  <li key={d.id} className="min-w-0">
                    <details className="group rounded-xl border border-line px-3 py-2.5 open:bg-surface-2">
                      <summary className="flex cursor-pointer list-none items-center gap-2.5 text-sm [&::-webkit-details-marker]:hidden">
                        {d.channel === "sms" ? <LuMessageSquare className="size-4 text-muted" /> : <LuMail className="size-4 text-muted" />}
                        <span className="min-w-0 flex-1 truncate">{d.kind === "test" ? "Test" : d.kind === "reset" ? "Password reset" : "Digest"} · {d.recipient}</span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase", d.status === "sent" ? "bg-safe-soft text-safe-ink" : d.status === "failed" ? "bg-critical-soft text-critical-ink" : "bg-brand-soft text-brand-ink")}>{d.status === "mock" ? "logged" : d.status}</span>
                        <time className="hidden shrink-0 text-xs text-muted tabular sm:inline">{fmtStamp(d.createdAt).replace("Today · ", "")}</time>
                      </summary>
                      <div className="mt-2 grid gap-1.5 text-xs">
                        {d.subject && <p className="font-semibold">{d.subject}</p>}
                        <p className="whitespace-pre-line text-ink-2">{d.message}</p>
                        {d.error && <p className="text-critical-ink">{d.error}</p>}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand-ink [&_svg]:size-4">{icon}</span>
        <div><p className="text-sm font-semibold">{title}</p><p className="text-xs text-muted">{hint}</p></div>
      </div>
      {children}
    </div>
  );
}

const ICON = { expired: LuBan, critical: LuTriangleAlert, soon: LuClock, safe: LuCheck } as const;
const TINT = { expired: "bg-expired-soft text-expired-ink", critical: "bg-critical-soft text-critical-ink", soon: "bg-soon-soft text-soon-ink", safe: "bg-safe-soft text-safe-ink" } as const;

function AlertRow({ a, onRead }: { a: AlertItem; onRead: () => void }) {
  const Icon = a.type === "stock" ? LuLayers : ICON[a.status];
  return (
    <li className={cn("grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-4 py-4 sm:grid-cols-[40px_minmax(0,1fr)_auto]", !a.read && "bg-brand-soft/35")}>
      <span className={cn("hex-clip grid size-10 place-items-center", TINT[a.status])}><Icon className="size-4" /></span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-semibold">{a.title}{!a.read && <span className="size-2 rounded-full bg-brand" aria-label="Unread" />}</p>
        <p className="mt-0.5 text-sm text-ink-2">{a.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {a.type === "stock" ? <Badge>Low stock</Badge> : <StatusPill status={a.status} short />}
        </div>
      </div>
      <div className="col-span-2 flex gap-1.5 sm:col-span-1 sm:flex-col sm:items-end">
        {a.itemId && <Link to={`/app/inventory?batch=${a.itemId}`} onClick={onRead} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-surface-2">View batch<LuArrowRight className="size-3.5" /></Link>}
        {!a.read && <Button size="sm" variant="ghost" onClick={onRead}><LuCheck />Mark read</Button>}
      </div>
    </li>
  );
}

