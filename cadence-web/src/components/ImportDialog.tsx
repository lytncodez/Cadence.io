import { useEffect, useRef, useState } from "react";
import { LuUpload, LuFileSpreadsheet, LuCircleAlert, LuCircleCheck, LuDownload } from "react-icons/lu";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";
import { USE_MOCK } from "@/lib/api";
import { importFile, importSales, SAMPLE_CSV, type ImportResult, type SalesImportResult } from "@/lib/features";
import { cn, fmtDate, money } from "@/lib/utils";

/* Two steps: check the file (dry run, nothing saved) → confirm import. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"stock" | "sales">("stock");
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [sales, setSales] = useState<SalesImportResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setFile(null); setCheck(null); setSales(null); setErr(""); } }, [open]);
  useEffect(() => { setFile(null); setCheck(null); setSales(null); setErr(""); }, [mode]);

  async function pick(f: File | undefined | null) {
    if (!f) return;
    setFile(f); setCheck(null); setSales(null); setErr(""); setBusy(true);
    try { if (mode === "sales") setSales(await importSales(f, true)); else setCheck(await importFile(f, true)); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!file) return;
    setBusy(true);
    if (mode === "sales") {
      try {
        const r = await importSales(file, false);
        toast({ message: `${file.name}: ${r.added} sales saved${r.duplicates ? `, ${r.duplicates} already there` : ""}${r.errors.length ? `, ${r.errors.length} skipped` : ""}` });
        onClose();
      } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      return;
    }
    try {
      const r = await importFile(file, false);
      toast({ message: `${file.name}: ${r.added} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} skipped` : ""}` });
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const useSample = () => pick(new File([SAMPLE_CSV()], "sample_stock.csv", { type: "text/csv" }));
  const ok = mode === "sales" ? sales?.added ?? 0 : check ? check.total - check.errors.length : 0;
  const ready = mode === "sales" ? !!sales : !!check;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={mode === "sales" ? "Import sales history" : "Import stock"}
      description={mode === "sales" ? "Past sales, one row per sale or per day. They feed reports, trends and forecasts; stock levels don't change." : "One row per batch. Rows matching an existing barcode and batch update that batch; the rest are added."}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || ok === 0} loading={busy && ready} onClick={confirm}>{ready ? `Import ${ok} ${ok === 1 ? (mode === "sales" ? "sale" : "row") : (mode === "sales" ? "sales" : "rows")}` : "Import"}</Button>
      </>}>
      <div className="grid gap-4">
        <div className="inline-flex w-fit rounded-full border border-line bg-surface p-1" role="tablist" aria-label="What are you importing?">
          {([["stock", "Stock"], ["sales", "Sales history"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              className={cn("h-8 rounded-full px-4 text-sm font-semibold text-ink-2", mode === k && "bg-ink text-bg dark:bg-brand dark:text-on-brand")}>{l}</button>
          ))}
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files[0]); }}
          className={cn("grid place-items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition", drag ? "border-brand bg-brand-soft/60" : "border-line-strong bg-surface-2")}>
          <span className="hex-clip grid size-12 place-items-center bg-brand-soft text-brand-ink"><LuFileSpreadsheet className="size-5" /></span>
          <p className="font-medium">{file ? file.name : mode === "sales" ? "Drop your sales file here" : "Drop your stock file here"}</p>
          <p className="text-xs text-muted">{USE_MOCK ? ".csv (demo mode)" : ".csv or .xlsx"} · up to 5 MB</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="primary" onClick={() => input.current?.click()} loading={busy && !check}><LuUpload />Choose file</Button>
            {mode === "stock" && <Button size="sm" onClick={useSample}>Try a sample file</Button>}
          </div>
          <input ref={input} type="file" hidden accept={USE_MOCK ? ".csv,text/csv" : ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <details className="rounded-xl border border-line px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Expected columns</summary>
          {mode === "sales" ? (<>
            <p className="mt-2 font-mono text-xs break-words text-ink-2">date, name, barcode, batch, qty, unit_price</p>
            <p className="mt-1 text-xs text-muted">Import your stock first: each sale is matched to a medicine by barcode (or exact name). Batch and price are optional. Importing the same file twice won't double the sales.</p>
          </>) : (<>
          <p className="mt-2 font-mono text-xs break-words text-ink-2">name, category, barcode, batch, expiry, qty, unit_cost, unit_price, supplier</p>
          <p className="mt-1 text-xs text-muted">Common alternatives work too: Product, Batch No, Expiry Date (YYYY-MM-DD or DD/MM/YYYY), Quantity, Cost, Price.</p>
          </>)}
          {mode === "stock" && <button className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline" onClick={() => navigator.clipboard?.writeText(SAMPLE_CSV()).then(() => toast({ message: "Sample CSV copied. Paste it into a new file to see the format." }))}><LuDownload className="size-3.5" />Copy a sample CSV</button>}
        </details>

        {err && <p role="alert" className="flex items-start gap-2 rounded-xl bg-critical-soft px-3 py-2.5 text-sm text-critical-ink"><LuCircleAlert className="mt-0.5 size-4 shrink-0" />{err}</p>}

        {sales && (
          <div className="grid animate-fade-up gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-safe-soft px-3 py-1 font-medium text-safe-ink"><LuCircleCheck className="size-4" />{sales.added} sales ready</span>
              {sales.duplicates > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 font-medium text-muted">{sales.duplicates} already imported</span>}
              {sales.errors.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-critical-soft px-3 py-1 font-medium text-critical-ink"><LuCircleAlert className="size-4" />{sales.errors.length} will be skipped</span>}
            </div>
            {Object.keys(sales.unitsByMonth).length > 0 && (
              <div className="flex flex-wrap gap-2">{Object.entries(sales.unitsByMonth).map(([m, u]) => (
                <span key={m} className="rounded-xl border border-line px-3 py-2 text-xs"><b className="block text-base tabular">{u.toLocaleString()}</b>units in {m}</span>
              ))}</div>
            )}
            {sales.preview.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-xl border border-line">
                <table className="w-full min-w-[480px] text-xs">
                  <thead className="sticky top-0 bg-surface-2 text-muted"><tr>{["Date", "Medicine", "Batch", "Qty"].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                  <tbody>{sales.preview.map((r, i) => (
                    <tr key={i} className="border-t border-line"><td className="px-3 py-1.5 tabular">{fmtDate(r.soldOn)}</td><td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 font-mono">{r.batch}</td><td className="px-3 py-1.5 tabular">{r.qty}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {sales.errors.length > 0 && (
              <ul className="grid gap-1 rounded-xl bg-critical-soft/50 p-3 text-xs text-critical-ink">
                {sales.errors.slice(0, 8).map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
                {sales.errors.length > 8 && <li>…and {sales.errors.length - 8} more</li>}
              </ul>
            )}
          </div>
        )}

        {check && (
          <div className="grid animate-fade-up gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-safe-soft px-3 py-1 font-medium text-safe-ink"><LuCircleCheck className="size-4" />{ok} ready</span>
              {check.errors.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-critical-soft px-3 py-1 font-medium text-critical-ink"><LuCircleAlert className="size-4" />{check.errors.length} will be skipped</span>}
              <span className="text-xs leading-7 text-muted">Checked only. Nothing is saved until you press Import.</span>
            </div>
            {check.preview.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-xl border border-line">
                <table className="w-full min-w-[520px] text-xs">
                  <thead className="sticky top-0 bg-surface-2 text-muted"><tr>{["Product", "Batch", "Expiry", "Qty", "Cost", "Price"].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                  <tbody>{check.preview.map((r, i) => (
                    <tr key={i} className="border-t border-line"><td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 font-mono">{r.batch}</td><td className="px-3 py-1.5 tabular">{fmtDate(r.expiry)}</td><td className="px-3 py-1.5 tabular">{r.qty}</td><td className="px-3 py-1.5 tabular">{money(r.unitCost)}</td><td className="px-3 py-1.5 tabular">{money(r.unitPrice)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {check.errors.length > 0 && (
              <ul className="grid gap-1 rounded-xl bg-critical-soft/50 p-3 text-xs text-critical-ink">
                {check.errors.slice(0, 8).map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
                {check.errors.length > 8 && <li>…and {check.errors.length - 8} more</li>}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
