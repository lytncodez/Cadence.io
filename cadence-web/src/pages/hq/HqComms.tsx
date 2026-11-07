/* Cadence HQ: AI briefing, Ask AI, Messages (broadcasts to pharmacies) and System (providers, tests, HQ digest).
   The AI only ever sees usage counts: never a pharmacy's stock, sales, prices or people's contact details. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuSparkles, LuRefreshCw, LuSend, LuWand, LuBot, LuMegaphone, LuMail, LuMessageSquare, LuBell, LuShieldCheck,
  LuCircleCheck, LuCircleAlert, LuInfo, LuArrowRight, LuServer, LuEye,
} from "react-icons/lu";
import { Button, Card, CardHeader, EmptyState, Input, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import {
  hq, type Audience, type Briefing, type Broadcast, type BroadcastChannel, type ChatTurn, type HqDelivery, type HqPharmacy,
  type HqSendResult, type HqSystem, type Integration,
} from "@/lib/hq";
import { Link } from "@/lib/router";
import { cn, fmtStamp } from "@/lib/utils";

const AI_BADGE = (ai: boolean) => (
  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ai ? "bg-brand-soft text-brand-ink" : "bg-sunken text-muted")}>{ai ? "Cadence AI" : "Built-in summary"}</span>
);
const PRIVACY = "Cadence AI only sees usage counts and help-request totals. Never a pharmacy's stock, sales, prices or anyone's contact details.";

/* ---------------- Overview: today's briefing ---------------- */
let briefingCache: { at: number; b: Briefing } | null = null;
export function BriefingCard() {
  const [b, setB] = useState<Briefing | null>(briefingCache?.b ?? null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const load = useCallback(async (force = false) => {
    if (!force && briefingCache && Date.now() - briefingCache.at < 10 * 60_000) return;
    setBusy(true); setErr("");
    try { const x = await hq.briefing(); briefingCache = { at: Date.now(), b: x }; setB(x); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <Card className="overflow-hidden">
      <CardHeader title={<span className="flex items-center gap-2"><LuSparkles className="size-4 text-brand-ink" />Today's briefing</span>}
        subtitle={b ? `Generated ${fmtStamp(b.generatedAt).toLowerCase()}` : "Who to call and what to chase"}
        action={<div className="flex items-center gap-2">{b && AI_BADGE(b.ai)}<Button size="sm" variant="ghost" loading={busy} onClick={() => load(true)} aria-label="Refresh briefing"><LuRefreshCw /></Button></div>} />
      <div className="px-5 pb-5">
        {err ? <p className="text-sm text-critical-ink">{err}</p> : !b ? <div className="grid gap-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div> : (
          <p className="text-[15px] leading-relaxed whitespace-pre-line">{b.text}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link to="/hq/ai" className="flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline">Ask a follow-up<LuArrowRight className="size-4" /></Link>
          <span className="flex items-center gap-1.5 text-xs text-muted"><LuShieldCheck className="size-3.5 text-safe" />Usage counts only</span>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Ask AI ---------------- */
const SUGGESTIONS = ["Who should we call today, and why?", "Which pharmacies haven't added any stock yet?", "Which features are under-used?", "Who has alerts switched off?", "Summarise this week for the team."];
let chatMemory: ChatTurn[] = [];
export function AskAi() {
  const [turns, setTurns] = useState<ChatTurn[]>(chatMemory);
  const [q, setQ] = useState(""), [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { chatMemory = turns; end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);
  async function ask(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    const history = turns;
    setTurns([...history, { role: "user", text: msg }]); setQ(""); setBusy(true);
    try { const r = await hq.chat(msg, history); setTurns((t) => [...t, { role: "ai", text: r.text }]); }
    catch (e) { setTurns((t) => [...t, { role: "ai", text: `Sorry, that didn't work: ${(e as Error).message}` }]); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card className="flex min-h-[560px] flex-col overflow-hidden">
        <CardHeader title={<span className="flex items-center gap-2"><LuBot className="size-4 text-brand-ink" />Ask Cadence AI</span>} subtitle="About who's using Cadence, how much, and who needs a call"
          action={turns.length ? <Button size="sm" variant="ghost" onClick={() => setTurns([])}>New chat</Button> : undefined} />
        <div className="flex-1 overflow-y-auto px-5">
          {turns.length === 0 ? (
            <div className="grid gap-3 py-6">
              <p className="text-sm text-muted">Try one of these:</p>
              <div className="flex flex-wrap gap-2">{SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border border-line px-3 py-1.5 text-left text-sm text-ink-2 hover:border-brand hover:text-ink">{s}</button>)}</div>
            </div>
          ) : (
            <ul className="grid gap-3 py-4">
              {turns.map((t, i) => (
                <li key={i} className={cn("max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-line", t.role === "user" ? "ml-auto bg-brand text-on-brand" : "bg-surface-2")}>{t.text}</li>
              ))}
              {busy && <li className="w-fit rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">Thinking…</li>}
            </ul>
          )}
          <div ref={end} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="flex gap-2 border-t border-line p-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about usage, adoption or who needs help" aria-label="Question for Cadence AI" className="h-11" />
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!q.trim()} aria-label="Ask"><LuSend /></Button>
        </form>
      </Card>
      <Card className="h-fit p-5 text-sm">
        <p className="flex items-center gap-2 font-semibold"><LuShieldCheck className="size-4 text-safe" />What the AI can see</p>
        <p className="mt-2 text-ink-2">{PRIVACY}</p>
        <p className="mt-3 text-ink-2">It works out the numbers from Cadence's own counts and is told never to make figures up. Check anything important in Pharmacies before acting on it.</p>
      </Card>
    </div>
  );
}

/* ---------------- Messages: broadcasts to pharmacies ---------------- */
const AUDIENCES: [Audience, string][] = [["all", "All pharmacies"], ["active", "Active"], ["quiet", "Quiet"], ["at_risk", "At risk"], ["new", "New"], ["inactive", "Never used"], ["selected", "Choose pharmacies…"]];
const CHANNELS: [BroadcastChannel, string, typeof LuBell, string][] = [
  ["in_app", "In the app", LuBell, "A banner every user sees until they dismiss it"],
  ["email", "Email", LuMail, "To each pharmacy's admins"],
  ["sms", "SMS", LuMessageSquare, "To each pharmacy's admins (phone on their profile)"],
];
const segments = (n: number) => (n <= 160 ? 1 : Math.ceil(n / 153));

export function Messages() {
  const toast = useToast();
  const [notes, setNotes] = useState(""), [title, setTitle] = useState(""), [message, setMessage] = useState(""), [smsText, setSmsText] = useState("");
  const [channels, setChannels] = useState<BroadcastChannel[]>(["in_app", "email"]);
  const [audience, setAudience] = useState<Audience>("all"), [picked, setPicked] = useState<string[]>([]);
  const [pharmacies, setPharmacies] = useState<HqPharmacy[]>([]);
  const [preview, setPreview] = useState<Broadcast | null>(null), [previewErr, setPreviewErr] = useState("");
  const [history, setHistory] = useState<Broadcast[] | null>(null);
  const [busy, setBusy] = useState<"" | "draft" | "send">(""), [confirming, setConfirming] = useState(false);
  useEffect(() => { hq.pharmacies().then(setPharmacies, () => {}); hq.broadcasts().then(setHistory, () => setHistory([])); }, []);

  const ready = title.trim().length >= 3 && message.trim().length >= 3 && channels.length > 0 && (audience !== "selected" || picked.length > 0);
  const input = useMemo(() => ({ title: title.trim() || "Preview", message: message.trim() || "Preview", smsText: smsText.trim(), channels, audience, pharmacyIds: audience === "selected" ? picked : [] }), [title, message, smsText, channels, audience, picked]);
  // Who would this reach? Re-counted when the audience or channels change.
  useEffect(() => {
    setConfirming(false);
    if (!channels.length || (audience === "selected" && !picked.length)) { setPreview(null); return; }
    const t = window.setTimeout(() => hq.broadcast({ ...input, title: "Preview", message: "Preview", dryRun: true }).then((p) => { setPreview(p); setPreviewErr(""); }, (e) => { setPreview(null); setPreviewErr((e as Error).message); }), 300);
    return () => clearTimeout(t);
  }, [channels, audience, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function writeWithAi() {
    if (notes.trim().length < 3) return toast({ message: "Jot down a few words about what you want to say first.", tone: "error" });
    setBusy("draft");
    try {
      const d = await hq.draft(notes, AUDIENCES.find(([a]) => a === audience)?.[1] ?? "all pharmacies");
      setTitle(d.title); setMessage(d.message); setSmsText(d.sms);
      toast({ message: d.ai ? "Drafted by Cadence AI. Check it before sending." : "Tidied into a draft (AI isn't connected)." });
    } catch (e) { toast({ message: (e as Error).message, tone: "error" }); } finally { setBusy(""); }
  }
  async function send() {
    if (!confirming) { setConfirming(true); return; }
    setBusy("send");
    try {
      const r = await hq.broadcast({ ...input, title: title.trim(), message: message.trim() });
      const failed = (r.results.email?.failed ?? 0) + (r.results.sms?.failed ?? 0);
      toast({ message: failed ? `Sent, but ${failed} message(s) failed. See System → recent messages.` : `Sent to ${r.pharmacies} pharmac${r.pharmacies === 1 ? "y" : "ies"}`, tone: failed ? "error" : "success" });
      setHistory((h) => [r, ...(h ?? [])]); setTitle(""); setMessage(""); setSmsText(""); setNotes(""); setConfirming(false);
    } catch (e) { toast({ message: (e as Error).message, tone: "error" }); } finally { setBusy(""); }
  }
  const toggle = (c: BroadcastChannel) => setChannels((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  const smsLen = (smsText || `Cadence: ${title}. ${message}`).length;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1.4fr_1fr]">
      <Card className="overflow-hidden">
        <CardHeader title={<span className="flex items-center gap-2"><LuMegaphone className="size-4 text-brand-ink" />New announcement</span>} subtitle="Maintenance notices, new features, tips. Pharmacies see it in the app, by email or by SMS." />
        <div className="grid gap-4 px-5 pb-5">
          <div className="grid gap-2 rounded-2xl border border-dashed border-line p-3">
            <label htmlFor="bc-notes" className="text-[13px] font-medium text-ink-2">Rough notes (optional)</label>
            <textarea id="bc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. maintenance sunday 10pm 30 mins, app down, nothing lost" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-brand focus:outline-none" />
            <Button size="sm" variant="soft" className="w-fit" loading={busy === "draft"} onClick={writeWithAi}><LuWand />Write it for me</Button>
          </div>
          <label className="grid gap-1.5 text-[13px] font-medium text-ink-2" htmlFor="bc-title">Title<Input id="bc-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Short and clear" /></label>
          <label className="grid gap-1.5 text-[13px] font-medium text-ink-2" htmlFor="bc-msg">Message
            <textarea id="bc-msg" rows={6} value={message} maxLength={5000} onChange={(e) => setMessage(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-normal text-ink placeholder:text-muted focus:border-brand focus:outline-none" placeholder="What pharmacies need to know. Emails start with “Hi <name>,” and end with “The Cadence team”." />
          </label>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Send by</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {CHANNELS.map(([c, l, I, hint]) => (
                <label key={c} className={cn("flex cursor-pointer gap-2 rounded-xl border border-line p-3 text-sm transition", channels.includes(c) && "border-brand bg-brand-soft/40")}>
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" checked={channels.includes(c)} onChange={() => toggle(c)} />
                  <span><span className="flex items-center gap-1.5 font-medium"><I className="size-4 text-muted" />{l}</span><span className="block text-xs text-muted">{hint}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {channels.includes("sms") && (
            <label className="grid gap-1.5 text-[13px] font-medium text-ink-2" htmlFor="bc-sms">SMS text
              <textarea id="bc-sms" rows={2} value={smsText} maxLength={459} onChange={(e) => setSmsText(e.target.value)} placeholder={`Cadence: ${title || "your title"}. …`} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-normal text-ink focus:border-brand focus:outline-none" />
              <span className="text-xs font-normal text-muted">{smsLen} characters · {segments(smsLen)} SMS each{smsText ? "" : " (left empty, the title and message are used)"}</span>
            </label>
          )}

          <div className="grid gap-2">
            <label htmlFor="bc-aud" className="text-[13px] font-medium text-ink-2">Who gets it</label>
            <select id="bc-aud" value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className="h-10 rounded-xl border border-line bg-surface px-3 text-sm">
              {AUDIENCES.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
            </select>
            {audience === "selected" && (
              <ul className="grid max-h-56 gap-0.5 overflow-y-auto rounded-xl border border-line p-2">
                {pharmacies.map((p) => (
                  <li key={p.id}><label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
                    <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={picked.includes(p.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} />
                    <span className="flex-1">{p.name}</span><span className="text-xs text-muted">{p.location}</span>
                  </label></li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
            <LuEye className="size-4 text-muted" />
            {previewErr ? <span className="text-critical-ink">{previewErr}</span> : preview ? (
              <span>Reaches <b>{preview.pharmacies}</b> pharmac{preview.pharmacies === 1 ? "y" : "ies"}
                {channels.includes("email") && <> · <b>{preview.emailRecipients}</b> email{preview.emailRecipients === 1 ? "" : "s"}</>}
                {channels.includes("sms") && <> · <b>{preview.smsRecipients}</b> text{preview.smsRecipients === 1 ? "" : "s"}</>}</span>
            ) : <span className="text-muted">Pick how and who to see the reach.</span>}
            <Button variant={confirming ? "danger" : "primary"} className="ml-auto" disabled={!ready || !preview} loading={busy === "send"} onClick={send}>
              <LuSend />{confirming ? `Confirm: send to ${preview?.pharmacies ?? 0}` : "Send"}
            </Button>
          </div>
          {confirming && <p className="-mt-2 text-xs text-muted">Emails and texts can't be unsent. Press again to confirm, or change anything to cancel.</p>}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Sent" subtitle="Last 50 announcements" />
        {!history ? <div className="grid gap-2 px-5 pb-5"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : history.length === 0 ? (
          <EmptyState icon={<LuMegaphone />} title="Nothing sent yet" body="Announcements you send appear here with how many emails and texts went out." />
        ) : (
          <ul className="grid gap-2 px-3 pb-3">{history.map((b) => (
            <li key={b.id}><details className="rounded-xl border border-line px-3 py-2.5 open:bg-surface-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.title}</span>
                  <span className="block text-xs text-muted">{fmtStamp(b.createdAt)} · {b.pharmacies} pharmac{b.pharmacies === 1 ? "y" : "ies"} · {b.sentBy}</span></span>
                {b.channels.map((c) => <span key={c} className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-2">{c === "in_app" ? "App" : c === "email" ? "Email" : "SMS"}</span>)}
              </summary>
              <div className="mt-2 grid gap-2 text-xs">
                <p className="whitespace-pre-line text-ink-2">{b.message}</p>
                {(["email", "sms"] as const).map((c) => b.results[c] && (
                  <p key={c} className="text-muted">{c === "email" ? "Emails" : "Texts"}: {b.results[c]!.sent} sent{b.results[c]!.mock ? `, ${b.results[c]!.mock} logged (demo mode)` : ""}{b.results[c]!.failed ? <span className="text-critical-ink">, {b.results[c]!.failed} failed</span> : ""}</p>
                ))}
                {b.pharmacyNames.length > 0 && <p className="text-muted">To: {b.pharmacyNames.join(", ")}{b.pharmacies > b.pharmacyNames.length ? ` and ${b.pharmacies - b.pharmacyNames.length} more` : ""}</p>}
              </div>
            </details></li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- System: providers, tests, HQ digest, recent messages ---------------- */
const STATUS_STYLE: Record<Integration["status"], [string, string]> = {
  live: ["Live", "bg-safe-soft text-safe-ink"], demo: ["Demo", "bg-brand-soft text-brand-ink"], needs_setup: ["Needs setup", "bg-soon-soft text-soon-ink"],
};
function ResultLine({ r }: { r: HqSendResult | null }) {
  if (!r) return null;
  return (
    <p className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-sm", r.status === "failed" ? "bg-critical-soft text-critical-ink" : r.status === "mock" ? "bg-brand-soft text-brand-ink" : "bg-safe-soft text-safe-ink")}>
      {r.status === "failed" ? <LuCircleAlert className="mt-0.5 size-4 shrink-0" /> : r.status === "mock" ? <LuInfo className="mt-0.5 size-4 shrink-0" /> : <LuCircleCheck className="mt-0.5 size-4 shrink-0" />}
      <span className="min-w-0 break-words">{r.detail}</span>
    </p>
  );
}
const KIND_LABEL: Record<HqDelivery["kind"], string> = { test: "Test", digest: "HQ digest", help: "Help alert", broadcast: "Announcement", reply: "Reply" };

export function SystemPage() {
  const toast = useToast();
  const [sys, setSys] = useState<HqSystem | null>(null);
  const [log, setLog] = useState<HqDelivery[]>([]);
  const [email, setEmail] = useState(""), [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(""), [result, setResult] = useState<HqSendResult | null>(null);
  const [digest, setDigest] = useState<{ subject: string; body: string; to: string } | null>(null);
  const reload = useCallback(() => { hq.system().then(setSys, () => {}); hq.deliveries().then(setLog, () => {}); }, []);
  useEffect(reload, [reload]);
  async function run(key: string, fn: () => Promise<HqSendResult>) {
    setBusy(key); setResult(null);
    try { const r = await fn(); setResult(r); setLog(await hq.deliveries()); } catch (e) { toast({ message: (e as Error).message, tone: "error" }); } finally { setBusy(""); }
  }
  const rows: [keyof HqSystem, string][] = [["sms", "SMS (Africa's Talking)"], ["email", "Email (Brevo / Resend / SMTP)"], ["ai", "AI"], ["cron", "Scheduler (daily digests)"], ["hqEmail", "Your inbox"], ["hqSms", "Your phone"], ["hqDigest", "HQ daily email"], ["encryption", "Encryption"]];
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1fr_1fr]">
      <Card className="overflow-hidden">
        <CardHeader title={<span className="flex items-center gap-2"><LuServer className="size-4 text-brand-ink" />What's switched on</span>} subtitle="Server settings on Render. Shared by every pharmacy." action={<Button size="sm" variant="ghost" onClick={reload} aria-label="Refresh"><LuRefreshCw /></Button>} />
        {!sys ? <div className="grid gap-2 px-5 pb-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : (
          <ul className="divide-y divide-line">{rows.map(([k, l]) => (
            <li key={k} className="flex items-start gap-3 px-5 py-3">
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{l}</span><span className="block text-xs break-words text-muted">{sys[k].detail}</span></span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[sys[k].status][1])}>{STATUS_STYLE[sys[k].status][0]}</span>
            </li>
          ))}</ul>
        )}
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader title="Send yourself a test" subtitle="Leave blank to use HQ_NOTIFY_EMAIL / HQ_NOTIFY_SMS" />
          <div className="grid gap-3 px-5 pb-5">
            <div className="flex gap-2"><Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Test email address" />
              <Button loading={busy === "email"} onClick={() => run("email", () => hq.test("email", email))}><LuMail />Email</Button></div>
            <div className="flex gap-2"><Input type="tel" placeholder="+233 24 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Test phone number" />
              <Button loading={busy === "sms"} onClick={() => run("sms", () => hq.test("sms", phone))}><LuMessageSquare />SMS</Button></div>
            <Button className="w-fit" loading={busy === "ai"} onClick={() => run("ai", () => hq.test("ai"))}><LuSparkles />Test AI</Button>
            <ResultLine r={result} />
          </div>
        </Card>
        <Card>
          <CardHeader title="HQ daily email" subtitle="Briefing, sign-ups and open help requests, once a day" />
          <div className="grid gap-3 px-5 pb-5">
            <div className="flex flex-wrap gap-2">
              <Button loading={busy === "preview"} onClick={async () => { setBusy("preview"); try { setDigest(await hq.digestPreview()); } catch (e) { toast({ message: (e as Error).message, tone: "error" }); } finally { setBusy(""); } }}><LuEye />Preview</Button>
              <Button variant="primary" loading={busy === "digest"} onClick={() => run("digest", hq.digestSend)}><LuSend />Send now</Button>
            </div>
            {digest && <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs"><p className="font-semibold">{digest.subject}</p><p className="text-muted">To: {digest.to || "HQ_NOTIFY_EMAIL isn't set"}</p><pre className="mt-2 max-h-72 overflow-auto font-sans whitespace-pre-wrap text-ink-2">{digest.body}</pre></div>}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden xl:col-span-2">
        <CardHeader title="Recent messages" subtitle="What HQ sent: tests, help alerts, replies, announcements and the HQ email" />
        {log.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Nothing yet. Send a test above.</p> : (
          <ul className="grid gap-2 px-3 pb-3">{log.map((d) => (
            <li key={d.id}><details className="rounded-xl border border-line px-3 py-2.5 open:bg-surface-2">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 text-sm [&::-webkit-details-marker]:hidden">
                {d.channel === "sms" ? <LuMessageSquare className="size-4 text-muted" /> : d.channel === "ai" ? <LuSparkles className="size-4 text-muted" /> : <LuMail className="size-4 text-muted" />}
                <span className="min-w-0 flex-1 truncate">{KIND_LABEL[d.kind] ?? d.kind} · {d.subject || d.recipient}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase", d.status === "sent" ? "bg-safe-soft text-safe-ink" : d.status === "failed" ? "bg-critical-soft text-critical-ink" : "bg-brand-soft text-brand-ink")}>{d.status === "mock" ? "logged" : d.status}</span>
                <time className="hidden shrink-0 text-xs text-muted sm:inline">{fmtStamp(d.createdAt)}</time>
              </summary>
              <div className="mt-2 grid gap-1 text-xs"><p className="text-muted">To: {d.recipient || "—"}</p><p className="whitespace-pre-line text-ink-2">{d.message}</p>{d.error && <p className="text-critical-ink">{d.error}</p>}</div>
            </details></li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
