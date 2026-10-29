import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { LuBarcode, LuCircleCheck } from "react-icons/lu";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, Field, Input } from "@/components/ui/primitives";
import { api, useStore } from "@/lib/api";
import { CURRENCY, daysUntil, relDays } from "@/lib/utils";
import type { Item } from "@/lib/types";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the product name"),
  category: z.string().trim().min(2, "Pick or type a category"),
  barcode: z.string().trim().regex(/^\d{6,14}$/, "6–14 digits"),
  batch: z.string().trim().min(2, "Enter the batch number from the pack"),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the expiry date"),
  qty: z.coerce.number().int("Whole units only").min(1, "At least 1 unit"),
  unitCost: z.coerce.number().positive("Enter the cost per unit"),
  unitPrice: z.coerce.number().positive("Enter the selling price"),
  supplier: z.string().trim().optional(),
}).refine((d) => d.unitPrice >= d.unitCost, { path: ["unitPrice"], message: "Selling price is below cost" });

type Form = Record<keyof z.infer<typeof schema>, string>;
const EMPTY: Form = { name: "", category: "", barcode: "", batch: "", expiry: "", qty: "", unitCost: "", unitPrice: "", supplier: "" };

export function AddStockDialog({ open, onClose, edit }: { open: boolean; onClose: () => void; edit?: Item | null }) {
  const items = useStore((s) => s.items);
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState(false);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);

  useEffect(() => {
    if (!open) return;
    setErrors({}); setKnown(false);
    setF(edit ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, String(edit[k as keyof Item] ?? "")])) as Form : EMPTY);
  }, [open, edit]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  function lookupBarcode(code: string) {
    if (edit) return;
    const hit = items.find((i) => i.barcode === code.trim());
    setKnown(!!hit);
    if (hit) setF((p) => ({ ...p, name: p.name || hit.name, category: p.category || hit.category, unitCost: p.unitCost || String(hit.unitCost), unitPrice: p.unitPrice || String(hit.unitPrice), supplier: p.supplier || hit.supplier }));
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const r = schema.safeParse(f);
    if (!r.success) {
      const errs: Partial<Record<keyof Form, string>> = {};
      r.error.issues.forEach((i) => { const k = i.path[0] as keyof Form; errs[k] ??= i.message; });
      setErrors(errs);
      document.getElementById("as-" + Object.keys(errs)[0])?.focus();
      return;
    }
    setErrors({}); setBusy(true);
    try {
      const data = { ...r.data, supplier: r.data.supplier || "—" };
      if (edit) await api.updateItem(edit.id, data); else await api.createItem(data);
      toast({ message: edit ? `Updated ${data.batch}` : `Added ${data.name} · ${data.batch}` });
      onClose();
    } catch (err) {
      setErrors({ batch: (err as Error).message });
    } finally { setBusy(false); }
  }

  const days = f.expiry ? daysUntil(f.expiry) : null;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={edit ? "Edit batch" : "Add stock"} description={edit ? `${edit.name} · ${edit.batch}` : "One entry per batch. The barcode identifies the product; batch and expiry come from the pack."}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => submit()}>{edit ? "Save changes" : "Add to inventory"}</Button></>}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Barcode" htmlFor="as-barcode" error={errors.barcode} hint={known ? undefined : "Scan the pack or type the digits"}>
          <Input id="as-barcode" icon={<LuBarcode />} inputMode="numeric" className="font-mono tracking-wider" value={f.barcode} onChange={set("barcode")} onBlur={(e) => lookupBarcode(e.target.value)} invalid={!!errors.barcode} autoFocus={!edit} />
        </Field>
        <Field label="Category" htmlFor="as-category" error={errors.category}>
          <Input id="as-category" list="as-cats" value={f.category} onChange={set("category")} invalid={!!errors.category} placeholder="e.g. Antibiotics" />
          <datalist id="as-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        {known && <p className="col-span-full -mt-2 flex items-center gap-1.5 text-xs font-medium text-safe-ink"><LuCircleCheck className="size-3.5" />Known product: details filled in from your last batch.</p>}
        <Field label="Product name" htmlFor="as-name" error={errors.name} className="sm:col-span-2">
          <Input id="as-name" value={f.name} onChange={set("name")} invalid={!!errors.name} placeholder="e.g. Amoxicillin 500mg Caps ×21" />
        </Field>
        <Field label="Batch number" htmlFor="as-batch" error={errors.batch}>
          <Input id="as-batch" className="font-mono" value={f.batch} onChange={set("batch")} invalid={!!errors.batch} />
        </Field>
        <Field label="Expiry date" htmlFor="as-expiry" error={errors.expiry} hint={days !== null ? relDays(days) : undefined}>
          <Input id="as-expiry" type="date" value={f.expiry} onChange={set("expiry")} invalid={!!errors.expiry} />
        </Field>
        <Field label="Quantity (units)" htmlFor="as-qty" error={errors.qty}>
          <Input id="as-qty" type="number" min={1} value={f.qty} onChange={set("qty")} invalid={!!errors.qty} />
        </Field>
        <Field label="Supplier" htmlFor="as-supplier">
          <Input id="as-supplier" value={f.supplier} onChange={set("supplier")} placeholder="Optional" />
        </Field>
        <Field label={`Unit cost (${CURRENCY})`} htmlFor="as-unitCost" error={errors.unitCost}>
          <Input id="as-unitCost" type="number" step="0.01" value={f.unitCost} onChange={set("unitCost")} invalid={!!errors.unitCost} />
        </Field>
        <Field label={`Selling price (${CURRENCY})`} htmlFor="as-unitPrice" error={errors.unitPrice}>
          <Input id="as-unitPrice" type="number" step="0.01" value={f.unitPrice} onChange={set("unitPrice")} invalid={!!errors.unitPrice} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
