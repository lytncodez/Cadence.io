import { useEffect, useRef, useState } from "react";
import { LuUpload, LuFileSpreadsheet, LuCircleAlert, LuCircleCheck, LuDownload } from "react-icons/lu";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";
import { USE_MOCK } from "@/lib/api";
import { importFile, SAMPLE_CSV, type ImportResult } from "@/lib/features";
import { cn, fmtDate, money } from "@/lib/utils";

/* Two steps: check the file (dry run, nothing saved) → confirm import. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setFile(null); setCheck(null); setErr(""); } }, [open]);

  async function pick(f: File | undefined | null) {
    if (!f) return;
    setFile(f); setCheck(null); setErr(""); setBusy(true);
    try { setCheck(await importFile(f, true)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await importFile(file, false);
      toast({ message: `${file.name}: ${r.added} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} skipped` : ""}` });
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const useSample = () => pick(new File([SAMPLE_CSV()], "sample_stock.csv", { type: "text/csv" }));
  const ok = check ? check.total - check.errors.length : 0;

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Import stock" description="One row per batch. Rows matching an existing barcode and batch update that batch; the rest are added."
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!check || ok === 0} loading={busy && !!check} onClick={confirm}>{check ? `Import ${ok} ${ok === 1 ? "row" : "rows"}` : "Import"}</Button>
      </>}>
      <div className="grid gap-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files[0]); }}
          className={cn("grid place-items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition", drag ? "border-brand bg-brand-soft/60" : "border-line-strong bg-surface-2")}>
          <span className="hex-clip grid size-12 place-items-center bg-brand-soft text-brand-ink"><LuFileSpreadsheet className="size-5" /></span>
          <p className="font-medium">{file ? file.name : "Drop your stock file here"}</p>
          <p className="text-xs text-muted">{USE_MOCK ? ".csv (demo mode)" : ".csv or .xlsx"} · up to 5 MB</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="primary" onClick={() => input.current?.click()} loading={busy && !check}><LuUpload />Choose file</Button>
            <Button size="sm" onClick={useSample}>Try a sample file</Button>
          </div>
          <input ref={input} type="file" hidden accept={USE_MOCK ? ".csv,text/csv" : ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <details className="rounded-xl border border-line px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Expected columns</summary>
          <p className="mt-2 font-mono text-xs break-words text-ink-2">name, category, barcode, batch, expiry, qty, unit_cost, unit_price, supplier</p>
          <p className="mt-1 text-xs text-muted">Common alternatives work too: Product, Batch No, Expiry Date (YYYY-MM-DD or DD/MM/YYYY), Quantity, Cost, Price.</p>
          <button className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline" onClick={() => navigator.clipboard?.writeText(SAMPLE_CSV()).then(() => toast({ message: "Sample CSV copied. Paste it into a new file to see the format." }))}><LuDownload className="size-3.5" />Copy a sample CSV</button>
        </details>

        {err && <p role="alert" className="flex items-start gap-2 rounded-xl bg-critical-soft px-3 py-2.5 text-sm text-critical-ink"><LuCircleAlert className="mt-0.5 size-4 shrink-0" />{err}</p>}

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
