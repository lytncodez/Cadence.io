import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuSparkles, LuSend, LuFileText, LuTriangleAlert, LuChartColumn, LuLayoutGrid, LuShieldCheck, LuCopy, LuArrowUpRight, LuArrowDownRight,
  LuPackage, LuCircleCheck, LuPaperclip, LuFileSpreadsheet, LuX, LuDatabase, LuEye, LuCircleAlert, LuGlobe, LuUpload,
} from "react-icons/lu";
import { AppShell } from "@/components/layout/AppShell";
import { Avatar, Button, Card, StatusPill, dot } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { RevenueChart, StatusDonut } from "@/components/charts";
import { useCan, useCurrentUser, useStore, USE_MOCK } from "@/lib/api";
import { summarize, type Summary } from "@/lib/analytics";
import { aiStatus, ask, importFile, parseFile, SAMPLE_SALES_CSV, summarizeDataset, type AskKind, type Dataset, type ParseResult } from "@/lib/features";
import { Link } from "@/lib/router";
import { cn, compactMoney, fmtDate, int, money, MONTHS_LONG, relDays } from "@/lib/utils";

type Msg =
  | { id: number; role: "user"; text: string; file?: string }
  | { id: number; role: "ai"; text: string; kind?: AskKind; pending?: boolean; error?: boolean; dataset?: Dataset | null }
  | { id: number; role: "upload"; file: File; parsed: ParseResult; choice?: "once" | "keep" | "busy" };

const QUICK: { kind: AskKind; label: string; icon: typeof LuFileText; prompt: (d: Dataset | null) => string }[] = [
  { kind: "report", label: "Report", icon: LuFileText, prompt: (d) => d ? `Generate a report for ${d.name}.` : `Generate a detailed report for ${MONTHS_LONG[new Date().getMonth()]}.` },
  { kind: "losses", label: "Losses", icon: LuTriangleAlert, prompt: (d) => d ? `Where is ${d.name} losing money to expiry?` : "Where are we losing money to expiry?" },
  { kind: "margins", label: "Profit margins", icon: LuChartColumn, prompt: () => "Show profit margins by product." },
  { kind: "dashboard", label: "Dashboard", icon: LuLayoutGrid, prompt: () => "Give me a stock dashboard overview." },
];
const SUGGEST = ["What should I reorder this week?", "How should insulin be stored?", "Tell me about Coartem", "How can I cut expiry losses?"];

export default function Insights() {
  const user = useCurrentUser()!;
  const can = useCan();
  const toast = useToast();
  const items = useStore((s) => s.items), monthly = useStore((s) => s.monthly), thresholds = useStore((s) => s.thresholds);
  const pharmacy = useStore((s) => s.pharmacy);
  const inv = useMemo(() => summarize(items, monthly, thresholds), [items, monthly, thresholds]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [drag, setDrag] = useState(false);
  const [connected, setConnected] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => { void aiStatus().then(setConnected); }, []);

  const history = () => msgs.flatMap((m) => (m.role === "user" ? [{ role: "user" as const, text: m.text }] : m.role === "ai" && !m.pending && !m.error ? [{ role: "ai" as const, text: m.text }] : []));

  async function send(text: string, ds: Dataset | null = dataset) {
    if (busy || !text.trim()) return;
    setBusy(true);
    const id = Date.now(), h = history();
    setMsgs((m) => [...m, { id, role: "user", text }, { id: id + 1, role: "ai", text: "", pending: true }]);
    try {
      const r = await ask(text, { history: h, dataset: ds });
      setMsgs((m) => m.map((x) => (x.id === id + 1 ? { id: x.id, role: "ai", text: r.text, kind: r.kind, dataset: ds } : x)));
    } catch (e) {
      setMsgs((m) => m.map((x) => (x.id === id + 1 ? { id: x.id, role: "ai", text: (e as Error).message, error: true } : x)));
    } finally { setBusy(false); }
  }
  useEffect(() => { if (!started.current) { started.current = true; void send(QUICK[0].prompt(null), null); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  async function onFile(file: File | undefined | null) {
    if (!file || busy) return;
    setBusy(true);
    const id = Date.now();
    setMsgs((m) => [...m, { id, role: "user", text: `Uploaded ${file.name}`, file: file.name }, { id: id + 1, role: "ai", text: "", pending: true }]);
    try {
      const parsed = await parseFile(file);
      setMsgs((m) => m.filter((x) => x.id !== id + 1).concat({ id: id + 1, role: "upload", file, parsed }));
    } catch (e) {
      setMsgs((m) => m.map((x) => (x.id === id + 1 ? { id: x.id, role: "ai", text: (e as Error).message, error: true } : x)));
    } finally { setBusy(false); }
  }

  async function choose(msgId: number, file: File, parsed: ParseResult, keep: boolean) {
    setMsgs((m) => m.map((x) => (x.id === msgId && x.role === "upload" ? { ...x, choice: "busy" } : x)));
    try {
      if (keep) {
        const r = await importFile(file, false);
        toast({ message: `${file.name}: ${r.added} added to inventory, ${r.updated} updated` });
      }
      const ds: Dataset = { name: file.name, rows: parsed.rows, kept: keep, file };
      setDataset(ds);
      setMsgs((m) => m.map((x) => (x.id === msgId && x.role === "upload" ? { ...x, choice: keep ? "keep" : "once" } : x)));
      await new Promise((r) => setTimeout(r, 50));
      setBusy(false);
      void send(QUICK[0].prompt(ds), ds);
    } catch (e) {
      toast({ message: (e as Error).message, tone: "error" });
      setMsgs((m) => m.map((x) => (x.id === msgId && x.role === "upload" ? { ...x, choice: undefined } : x)));
    }
  }

  const lastKind = [...msgs].reverse().find((m) => m.role === "ai" && m.kind)?.role === "ai" ? ([...msgs].reverse().find((m) => m.role === "ai" && (m as { kind?: AskKind }).kind) as { kind?: AskKind })?.kind : undefined;
  const trySample = () => onFile(new File([SAMPLE_SALES_CSV()], "sample_sales.csv", { type: "text/csv" }));

  return (
    <AppShell title="AI Insights">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="hex-clip grid size-14 place-items-center bg-gradient-to-br from-brand to-violet text-white"><LuSparkles className="size-6" /></span>
          <div>
            <h2 className="font-display text-[28px] font-bold">Ask Cadence AI anything</h2>
            <p className="text-sm text-muted">Reports on your stock or any file you upload, plus general questions{connected ? "." : " once the AI service is connected."}</p>
          </div>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold", connected ? "bg-safe-soft text-safe-ink" : "bg-sunken text-muted")}>
          <LuGlobe className="size-3.5" />{connected ? "General knowledge on" : USE_MOCK ? "Demo: answers from your records" : "General knowledge off (no AI key on server)"}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-1.5 shadow-hair md:grid-cols-4" role="toolbar" aria-label="Quick reports">
        {QUICK.map((q) => (
          <button key={q.kind} onClick={() => send(q.prompt(dataset))} disabled={busy}
            className={cn("flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-2 transition hover:bg-sunken hover:text-ink disabled:opacity-60", lastKind === q.kind && "bg-brand-soft text-brand-ink hover:bg-brand-soft hover:text-brand-ink")}>
            <q.icon className="size-4" />{q.label}
          </button>
        ))}
      </div>

      <Card className="relative flex min-h-[62vh] flex-col overflow-hidden"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files[0]); }}>
        {drag && (
          <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-brand bg-brand-soft/80 backdrop-blur-sm">
            <div className="text-center"><LuUpload className="mx-auto size-8 text-brand-ink" /><p className="mt-2 font-semibold text-brand-ink">Drop to analyse</p><p className="text-sm text-ink-2">CSV{USE_MOCK ? "" : " or Excel"} with your stock or sales</p></div>
          </div>
        )}
        <div className="flex-1 space-y-6 p-4 sm:p-6" aria-live="polite">
          <AiRow>
            <Bubble>Hi {user.name.split(" ")[0]}. I've gone through {pharmacy.name || "your pharmacy"}'s stock and sales. Ask for a report, trace expiry losses, compare margins, or <b>attach a file</b> and I'll analyse it.</Bubble>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted"><LuCircleCheck className="size-4 text-safe" />Live inventory · {inv.rows.length} batches · {inv.products.length} products</span>
              <button onClick={trySample} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 text-xs font-medium text-ink-2 hover:border-brand hover:text-brand-ink disabled:opacity-50"><LuFileSpreadsheet className="size-4" />Try a sample sales file</button>
            </div>
          </AiRow>
          {msgs.map((m) => {
            if (m.role === "user") return (
              <div key={m.id} className="flex animate-fade-up justify-end gap-3">
                {m.file
                  ? <div className="flex items-center gap-2.5 rounded-2xl rounded-br-md border border-brand/30 bg-brand-soft px-4 py-2.5 text-sm text-brand-ink"><LuPaperclip className="size-4" />{m.file}</div>
                  : <div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[15px] text-on-brand shadow-hair">{m.text}</div>}
                <Avatar name={user.name} photo={user.photo} size={34} />
              </div>
            );
            if (m.role === "upload") return <AiRow key={m.id}><UploadCard m={m} canKeep={can("import")} onChoose={(keep) => choose(m.id, m.file, m.parsed, keep)} /></AiRow>;
            return (
              <AiRow key={m.id}>
                {m.pending ? <Bubble><span className="flex gap-1 py-1" aria-label="Thinking">{[0, 1, 2].map((i) => <span key={i} className="size-2 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />)}</span></Bubble>
                  : m.error ? <Bubble className="border-critical/30 bg-critical-soft text-critical-ink">{m.text}</Bubble>
                  : <>
                    {m.dataset && <span className="inline-flex items-center gap-1.5 rounded-full bg-violet/10 px-2.5 py-1 text-[11px] font-semibold text-violet"><LuFileSpreadsheet className="size-3.5" />From {m.dataset.name}</span>}
                    <Bubble><span className="whitespace-pre-line">{m.text}</span></Bubble>
                    {m.kind && m.kind !== "text" && <AnswerCard kind={m.kind} s={m.dataset ? summarizeDataset(m.dataset) : inv} fromFile={!!m.dataset} criticalDays={thresholds.criticalMax} text={m.text} />}
                  </>}
              </AiRow>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 border-t border-line bg-surface/95 p-3 backdrop-blur sm:p-4">
          {dataset && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-violet/30 bg-violet/5 px-3 py-2 text-sm">
              <LuFileSpreadsheet className="size-4 text-violet" />
              <span className="min-w-0 flex-1 truncate">Analysing <b>{dataset.name}</b> · {dataset.rows.length} batches · {dataset.kept ? "saved to inventory" : "one-time, not saved"}</span>
              <button onClick={() => setDataset(null)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-2 hover:bg-sunken"><LuX className="size-3.5" />Back to my inventory</button>
            </div>
          )}
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {SUGGEST.map((t) => <button key={t} disabled={busy} onClick={() => send(t)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 transition hover:border-brand hover:text-brand-ink disabled:opacity-50">{t}</button>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); const t = input; setInput(""); void send(t); }} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-2 shadow-hair focus-within:border-brand focus-within:ring-4 focus-within:ring-[var(--ring)]">
            <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Attach a CSV or Excel file" title="Attach a CSV or Excel file"><LuPaperclip /></Button>
            <input ref={fileRef} type="file" hidden accept={USE_MOCK ? ".csv,text/csv" : ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <label htmlFor="ask" className="sr-only">Ask a question</label>
            <input id="ask" value={input} onChange={(e) => setInput(e.target.value)} placeholder={dataset ? `Ask about ${dataset.name}…` : "Ask about your stock, a medicine, or anything else…"} className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" autoComplete="off" />
            <Button type="submit" variant="primary" size="icon" disabled={busy || !input.trim()} aria-label="Send"><LuSend /></Button>
          </form>
        </div>
      </Card>
    </AppShell>
  );
}

function UploadCard({ m, canKeep, onChoose }: { m: Extract<Msg, { role: "upload" }>; canKeep: boolean; onChoose: (keep: boolean) => void }) {
  const { parsed, file, choice } = m;
  const ok = parsed.rows.length;
  const expired = parsed.rows.filter((r) => r.expiry < new Date().toISOString().slice(0, 10)).length;
  return (
    <Card className="w-full max-w-2xl animate-fade-up overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line p-4">
        <span className="hex-clip grid size-11 place-items-center bg-violet/15 text-violet"><LuFileSpreadsheet className="size-5" /></span>
        <div className="min-w-0 flex-1"><p className="truncate font-semibold">{file.name}</p><p className="text-xs text-muted">{parsed.total} rows read · {(file.size / 1024).toFixed(1)} KB</p></div>
      </div>
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-safe-soft px-3 py-1 font-medium text-safe-ink"><LuCircleCheck className="size-4" />{ok} batches ready</span>
          {expired > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-expired-soft px-3 py-1 font-medium text-expired-ink">{expired} already expired</span>}
          {parsed.errors.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-critical-soft px-3 py-1 font-medium text-critical-ink"><LuCircleAlert className="size-4" />{parsed.errors.length} rows can't be read</span>}
        </div>
        {parsed.errors.length > 0 && (
          <ul className="grid gap-0.5 rounded-xl bg-critical-soft/50 p-3 text-xs text-critical-ink">
            {parsed.errors.slice(0, 4).map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
            {parsed.errors.length > 4 && <li>…and {parsed.errors.length - 4} more</li>}
          </ul>
        )}
        {!choice && ok > 0 && (
          <>
            <p className="text-sm text-ink-2">What should I do with this file?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button onClick={() => onChoose(false)} className="group rounded-2xl border border-line p-4 text-left transition hover:-translate-y-0.5 hover:border-brand hover:shadow-card">
                <LuEye className="size-5 text-brand-ink" /><p className="mt-2 font-semibold">Analyse only</p><p className="mt-0.5 text-xs text-muted">One-time look. Nothing is added to your inventory.</p>
              </button>
              <button onClick={() => onChoose(true)} disabled={!canKeep} className="group rounded-2xl border border-line p-4 text-left transition hover:-translate-y-0.5 hover:border-brand hover:shadow-card disabled:pointer-events-none disabled:opacity-50">
                <LuDatabase className="size-5 text-brand-ink" /><p className="mt-2 font-semibold">Add to inventory & analyse</p><p className="mt-0.5 text-xs text-muted">{canKeep ? "Saves every batch. Matching batches are updated." : "Your role can't import stock."}</p>
              </button>
            </div>
          </>
        )}
        {choice === "busy" && <p className="text-sm text-muted">Working on it…</p>}
        {(choice === "once" || choice === "keep") && <p className="flex items-center gap-2 text-sm font-medium text-safe-ink"><LuCircleCheck className="size-4" />{choice === "keep" ? "Added to your inventory." : "Analysing without saving."} Reports, Losses, Margins and Dashboard now use this file.</p>}
      </div>
    </Card>
  );
}

function AiRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex animate-fade-up gap-3">
      <span className="hex-clip grid size-9 shrink-0 place-items-center bg-gradient-to-br from-brand to-violet text-white"><LuSparkles className="size-4" /></span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">{children}</div>
    </div>
  );
}
const Bubble = ({ children, className }: { children: React.ReactNode; className?: string }) =>
  <div className={cn("max-w-3xl rounded-2xl rounded-tl-md border border-line bg-surface-2 px-4 py-3 text-[15px] leading-relaxed text-ink", className)}>{children}</div>;

function AnswerCard({ kind, s, fromFile, criticalDays, text }: { kind: AskKind; s: Summary; fromFile: boolean; criticalDays: number; text: string }) {
  const toast = useToast();
  const copy = () => navigator.clipboard?.writeText(text).then(() => toast({ message: "Summary copied" }), () => toast({ message: "Couldn't copy. Select the text instead.", tone: "error" }));
  return (
    <Card className="w-full animate-fade-up overflow-hidden">
      <div className="p-4 sm:p-5">
        {kind === "report" && <Report s={s} fromFile={fromFile} />}
        {kind === "losses" && <Losses s={s} criticalDays={criticalDays} />}
        {kind === "margins" && <Margins s={s} />}
        {kind === "dashboard" && <Dashboard s={s} />}
        {kind === "reorder" && <Reorder s={s} />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-xs text-muted"><LuShieldCheck className="size-3.5 text-safe" />Figures are calculated from {fromFile ? "the uploaded file" : "your records"}. The AI only explains them.</p>
        <Button size="sm" variant="ghost" onClick={copy}><LuCopy />Copy summary</Button>
      </div>
    </Card>
  );
}

const Kpi = ({ label, value, delta, unit = "%" }: { label: string; value: string; delta?: number; unit?: string }) => {
  const good = (delta ?? 0) >= 0;
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 font-display text-xl font-bold tabular">{value}</p>
      {delta !== undefined && <p className={cn("mt-0.5 flex items-center gap-0.5 text-xs font-semibold tabular", good ? "text-safe-ink" : "text-critical-ink")}>{delta >= 0 ? <LuArrowUpRight className="size-3.5" /> : <LuArrowDownRight className="size-3.5" />}{Math.abs(delta).toFixed(1)}{unit}<span className="ml-1 font-normal text-muted">vs last month</span></p>}
    </div>
  );
};

function Report({ s, fromFile }: { s: Summary; fromFile: boolean }) {
  const k = s.kpi, m = s.monthly[s.monthly.length - 1];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg font-semibold">{fromFile ? "Report on uploaded file" : `Pharmacy report · ${MONTHS_LONG[new Date().getMonth()]} ${m.year}`}</h3><span className="text-xs text-muted">{s.rows.length} batches</span></div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label={fromFile ? "Sales in file" : "Revenue"} value={compactMoney(k.revenue)} delta={fromFile ? undefined : k.revenueDelta} />
        <Kpi label="Cost of goods" value={compactMoney(m.cost)} />
        <Kpi label="Gross profit" value={compactMoney(k.profit)} delta={fromFile ? undefined : k.profitDelta} />
        <Kpi label="Margin" value={k.margin.toFixed(1) + "%"} delta={fromFile ? undefined : k.marginDelta} unit=" pts" />
      </div>
      <div className={cn("grid gap-4", !fromFile && "lg:grid-cols-[1.4fr_1fr]")}>
        {!fromFile && <div className="rounded-xl border border-line p-3"><p className="px-1 text-sm font-semibold">Revenue vs cost</p><RevenueChart data={s.monthly} /></div>}
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-sm font-semibold">Top sellers</p>
          {s.top.some((p) => p.revenue > 0) ? (
            <ol className="grid gap-2">{s.top.filter((p) => p.revenue > 0).map((p, i) => (
              <li key={p.name} className="flex items-center gap-2 text-sm"><span className="w-4 text-xs text-muted tabular">{i + 1}</span><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="tabular font-medium">{money(p.revenue, 0)}</span><span className="w-14 text-right text-xs text-muted tabular">{p.sold} sold</span></li>
            ))}</ol>
          ) : <p className="text-sm text-muted">No sales figures in this data. Add a "sold" column to see top sellers and revenue.</p>}
        </div>
      </div>
      {fromFile && <div className="rounded-xl border border-line p-3"><p className="mb-3 text-sm font-semibold">Stock value by expiry status</p><StatusDonut value={s.value} center={{ label: "Total", value: compactMoney(s.stockValue + s.value.expired) }} /></div>}
    </div>
  );
}

function Losses({ s, criticalDays }: { s: Summary; criticalDays: number }) {
  const rows = s.rows.filter((r) => r.status === "expired" || r.status === "critical").sort((a, b) => a.days - b.days);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Expired value" value={money(s.value.expired, 0)} />
        <Kpi label={`At risk (≤${criticalDays} days)`} value={money(s.value.critical, 0)} />
        <Kpi label="Expired batches" value={String(s.counts.expired)} />
        <Kpi label="Critical batches" value={String(s.counts.critical)} />
      </div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 text-left font-semibold">Product</th><th className="px-3 py-2 text-left font-semibold">Batch</th><th className="px-3 py-2 text-right font-semibold">Qty</th><th className="px-3 py-2 text-right font-semibold">Value</th><th className="px-3 py-2 text-left font-semibold">Expiry</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-line"><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2 font-mono text-xs">{r.batch}</td><td className="px-3 py-2 text-right tabular">{r.qty}</td><td className="px-3 py-2 text-right tabular">{money(r.qty * r.unitCost, 0)}</td><td className="px-3 py-2 text-xs"><span className="tabular">{fmtDate(r.expiry)}</span><span className="block text-muted">{relDays(r.days)}</span></td><td className="px-3 py-2"><StatusPill status={r.status} short /></td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="flex items-center gap-2 text-sm"><LuCircleCheck className="size-4 text-safe" />Nothing expired or close to expiry.</p>}
      <Link to="/app/alerts" className="text-sm font-medium text-brand-ink hover:underline">Open alerts to act on these →</Link>
    </div>
  );
}

function Margins({ s }: { s: Summary }) {
  const ranked = [...s.products].sort((a, b) => b.margin - a.margin);
  const show = ranked.length > 10 ? [...ranked.slice(0, 7), ...ranked.slice(-3)] : ranked;
  const max = ranked[0]?.margin || 1;
  return (
    <div className="grid gap-2.5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-display text-base font-semibold">Margin by product</h3><span className="text-xs text-muted">{ranked.length > 10 ? "Top 7 and bottom 3 · " : ""}amber is under 30%</span></div>
      {show.map((p, i) => (
        <div key={p.name}>
          {ranked.length > 10 && i === 7 && <p className="mt-1 mb-2 border-t border-dashed border-line pt-2 text-xs text-muted">Thinnest margins</p>}
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_48px] items-center gap-3 text-sm">
            <span className="truncate">{p.name}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-sunken"><span className={cn("block h-full rounded-full transition-all duration-700", p.margin < 30 ? "bg-soon" : "bg-brand")} style={{ width: `${(p.margin / max) * 100}%` }} /></span>
            <span className="text-right font-semibold tabular">{p.margin.toFixed(0)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ s }: { s: Summary }) {
  const cats = new Map<string, number>();
  s.rows.filter((r) => r.status !== "expired").forEach((r) => cats.set(r.category || "Uncategorised", (cats.get(r.category || "Uncategorised") ?? 0) + r.qty * r.unitCost));
  const list = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  const max = list[0]?.[1] || 1;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div><p className="mb-3 text-sm font-semibold">Stock value by expiry status</p><StatusDonut value={s.value} center={{ label: "Total", value: compactMoney(s.stockValue + s.value.expired) }} /></div>
      <div>
        <p className="mb-3 text-sm font-semibold">Usable stock by category</p>
        <div className="grid gap-2">{list.map(([c, v]) => (
          <div key={c} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_64px] items-center gap-3 text-sm"><span className="truncate">{c}</span><span className="h-2 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-brand" style={{ width: `${(v / max) * 100}%` }} /></span><span className="text-right text-xs tabular">{money(v, 0)}</span></div>
        ))}</div>
      </div>
    </div>
  );
}

function Reorder({ s }: { s: Summary }) {
  if (!s.lowStock.length) return <p className="flex items-center gap-2 text-sm"><LuPackage className="size-4 text-safe" />Every product is above its reorder level.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 text-left font-semibold">Product</th><th className="px-3 py-2 text-right font-semibold">Usable</th><th className="px-3 py-2 text-right font-semibold">Reorder at</th><th className="px-3 py-2 text-right font-semibold">Sold</th></tr></thead>
        <tbody>{s.lowStock.map((p) => (
          <tr key={p.name} className="border-t border-line"><td className="px-3 py-2"><span className="flex items-center gap-2"><span className={cn("size-2 rounded-full", p.usable === 0 ? dot.critical : dot.soon)} />{p.name}</span></td><td className={cn("px-3 py-2 text-right font-semibold tabular", p.usable === 0 && "text-critical-ink")}>{int(p.usable)}</td><td className="px-3 py-2 text-right tabular">{p.reorderLevel}</td><td className="px-3 py-2 text-right tabular">{p.sold}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
