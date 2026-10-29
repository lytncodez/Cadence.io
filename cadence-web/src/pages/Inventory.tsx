import { useEffect, useMemo, useState } from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { LuSearch, LuPlus, LuScanLine, LuEllipsis, LuPencil, LuTrash2, LuLayers, LuChevronLeft, LuChevronRight, LuArrowUp, LuArrowDown, LuBarcode, LuX, LuPackage, LuTruck, LuCoins, LuUpload } from "react-icons/lu";
import { AppShell } from "@/components/layout/AppShell";
import { Badge, Button, Card, EmptyState, Input, StatusPill, dot } from "@/components/ui/primitives";
import { Drawer, Modal, useToast } from "@/components/ui/overlay";
import { AddStockDialog } from "@/components/AddStockDialog";
import { ImportDialog } from "@/components/ImportDialog";
import { api, useCan, useStore } from "@/lib/api";
import { enrich, STATUS_META, STATUS_ORDER } from "@/lib/analytics";
import { navigate, usePath } from "@/lib/router";
import { cn, fmtDate, int, money, relDays } from "@/lib/utils";
import type { Batch, Item, Status } from "@/lib/types";

type SortKey = "expiry" | "name" | "qty" | "value";
const PAGE = 12;

export default function Inventory() {
  const path = usePath();
  const params = new URLSearchParams(path.split("?")[1] ?? "");
  const items = useStore((s) => s.items);
  const thresholds = useStore((s) => s.thresholds);
  const can = useCan();
  const toast = useToast();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "all">((params.get("status") as Status) || "all");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "expiry", dir: 1 });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(params.get("batch"));
  const [editing, setEditing] = useState<Item | null>(null);
  const [addOpen, setAddOpen] = useState(params.get("add") === "1");
  const [scanOpen, setScanOpen] = useState(params.get("scan") === "1");
  const [importOpen, setImportOpen] = useState(params.get("import") === "1");

  // Deep links (?batch=, ?status=, ?add=, ?scan=) are consumed once, then cleaned from the URL.
  useEffect(() => {
    const p = new URLSearchParams(path.split("?")[1] ?? "");
    if (p.get("batch")) setDetail(p.get("batch"));
    if (p.get("status")) setStatus(p.get("status") as Status);
    if (p.get("add") === "1") setAddOpen(true);
    if (p.get("scan") === "1") setScanOpen(true);
    if (p.get("import") === "1") setImportOpen(true);
    if ([...p.keys()].length) navigate("/app/inventory", { replace: true });
  }, [path]);

  const rows = useMemo(() => items.map((i) => enrich(i, thresholds)), [items, thresholds]);
  const counts = useMemo(() => {
    const c: Record<Status | "all", number> = { all: rows.length, expired: 0, critical: 0, soon: 0, safe: 0 };
    rows.forEach((r) => c[r.status]++);
    return c;
  }, [rows]);
  const cats = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = rows.filter((r) =>
      (status === "all" || r.status === status) && (!category || r.category === category) &&
      (!s || `${r.name} ${r.barcode} ${r.batch} ${r.supplier}`.toLowerCase().includes(s)));
    const val = (r: Batch) => (sort.key === "expiry" ? r.days : sort.key === "name" ? r.name : sort.key === "qty" ? r.qty : r.qty * r.unitCost);
    return list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.name.localeCompare(b.name); });
  }, [rows, q, status, category, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages);
  const view = filtered.slice((cur - 1) * PAGE, cur * PAGE);
  useEffect(() => setPage(1), [q, status, category]);

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const allOn = view.length > 0 && view.every((r) => selected.has(r.id));
  const detailRow = rows.find((r) => r.id === detail) ?? null;

  async function remove(ids: string[]) {
    const removed = await api.deleteItems(ids);
    setSelected(new Set()); setDetail(null);
    toast({ message: ids.length === 1 ? `Deleted ${removed[0]?.batch}` : `Deleted ${ids.length} batches`, action: { label: "Undo", run: () => { void api.restoreItems(removed); } } });
  }

  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th scope="col" className={cn("px-4 py-3 text-left", className)} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => toggleSort(k)} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === k && "text-ink")}>
        {children}{sort.key === k && (sort.dir === 1 ? <LuArrowUp className="size-3" /> : <LuArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <AppShell title="Inventory">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[28px] font-bold">Every batch, first-expiry-first-out</h2>
          <p className="text-sm text-muted">{int(rows.length)} batches · {int(rows.reduce((s, r) => s + r.qty, 0))} units · press <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[11px]">N</kbd> to add stock</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setScanOpen(true)}><LuScanLine />Scan barcode</Button>
          {can("import") && <Button onClick={() => setImportOpen(true)}><LuUpload />Import</Button>}
          {can("edit_inventory") && <Button variant="primary" onClick={() => setAddOpen(true)}><LuPlus />Add stock</Button>}
        </div>
      </div>

      {/* Status segments */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1 shadow-hair" role="tablist" aria-label="Filter by status">
        {(["all", ...STATUS_ORDER] as const).map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap text-ink-2 transition hover:text-ink", status === s && "bg-ink text-bg shadow-card hover:text-bg dark:bg-brand dark:text-on-brand")}>
            {s !== "all" && <span className={cn("size-2 rounded-full", dot[s])} />}
            {s === "all" ? "All" : STATUS_META[s].label}
            <span className={cn("rounded-full px-1.5 text-xs tabular", status === s ? "bg-white/15" : "bg-sunken text-muted")}>{counts[s]}</span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="min-w-[220px] flex-1"><Input icon={<LuSearch />} placeholder="Search name, barcode, batch or supplier" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search inventory" /></div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink shadow-hair focus:border-brand focus:outline-none">
            <option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}
          </select>
          {(q || category || status !== "all") && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setCategory(""); setStatus("all"); }}><LuX />Clear</Button>}
        </div>

        {selected.size > 0 && (
          <div className="flex animate-fade-up items-center gap-3 border-b border-line bg-brand-soft px-4 py-2.5 text-sm font-medium text-brand-ink">
            {selected.size} selected
            {can("delete_inventory") && <Button size="sm" variant="danger" onClick={() => remove([...selected])}><LuTrash2 />Delete</Button>}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState icon={<LuSearch />} title="No batches match" body="Try another search, category or status." action={<Button size="sm" onClick={() => { setQ(""); setCategory(""); setStatus("all"); }}>Clear filters</Button>} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-surface-2 text-xs font-semibold text-muted">
                  <tr className="border-b border-line">
                    <th className="w-12 px-4"><input type="checkbox" className="size-4 accent-[var(--brand)]" checked={allOn} aria-label="Select page" onChange={(e) => setSelected((s) => { const n = new Set(s); view.forEach((r) => e.target.checked ? n.add(r.id) : n.delete(r.id)); return n; })} /></th>
                    <SortHead k="name">Product</SortHead>
                    <th className="px-4 py-3 text-left">Batch</th>
                    <SortHead k="qty" className="text-right">Stock</SortHead>
                    <SortHead k="expiry">Expiry</SortHead>
                    <SortHead k="value" className="text-right">Value</SortHead>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {view.map((r) => (
                    <tr key={r.id} onClick={() => setDetail(r.id)}
                      className={cn("group cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-surface-2", selected.has(r.id) && "bg-brand-soft/60 hover:bg-brand-soft")}>
                      <td className="relative px-4" onClick={(e) => e.stopPropagation()}>
                        <span className={cn("absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full", dot[r.status])} />
                        <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={selected.has(r.id)} aria-label={`Select ${r.name} ${r.batch}`} onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} />
                      </td>
                      <td className="px-4 py-3"><p className="font-medium text-ink">{r.name}</p><p className="text-xs text-muted">{r.category} · {r.supplier}</p></td>
                      <td className="px-4 py-3"><span className="font-mono text-[13px]">{r.batch}</span><p className="font-mono text-[11px] text-muted">{r.barcode}</p></td>
                      <td className="px-4 py-3 text-right"><StockBar qty={r.qty} level={r.reorderLevel} /></td>
                      <td className="px-4 py-3"><p className="tabular">{fmtDate(r.expiry)}</p><p className={cn("text-xs", r.status === "critical" ? "font-medium text-critical-ink" : "text-muted")}>{relDays(r.days)}</p></td>
                      <td className="px-4 py-3 text-right tabular">{money(r.qty * r.unitCost, 0)}</td>
                      <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                      <td className="px-2" onClick={(e) => e.stopPropagation()}><RowMenu row={r} onEdit={() => setEditing(r)} onDelete={() => remove([r.id])} onOpen={() => setDetail(r.id)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {view.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setDetail(r.id)} className="relative flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-sunken">
                    <span className={cn("absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full", dot[r.status])} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block text-xs text-muted"><span className="font-mono">{r.batch}</span> · {r.qty} units</span>
                      <span className={cn("mt-1 block text-xs", r.status === "critical" ? "text-critical-ink" : "text-muted")}>{fmtDate(r.expiry)} · {relDays(r.days)}</span>
                    </span>
                    <StatusPill status={r.status} short />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
              <span className="tabular">{(cur - 1) * PAGE + 1}–{Math.min(cur * PAGE, filtered.length)} of {filtered.length}</span>
              <div className="flex items-center gap-1">
                <Button size="icon-sm" variant="ghost" disabled={cur === 1} onClick={() => setPage(cur - 1)} aria-label="Previous page"><LuChevronLeft /></Button>
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                  <button key={p} onClick={() => setPage(p)} aria-current={p === cur ? "page" : undefined} className={cn("size-8 rounded-lg text-sm font-medium tabular hover:bg-sunken", p === cur && "bg-ink text-bg hover:bg-ink dark:bg-brand dark:text-on-brand")}>{p}</button>
                ))}
                <Button size="icon-sm" variant="ghost" disabled={cur === pages} onClick={() => setPage(cur + 1)} aria-label="Next page"><LuChevronRight /></Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <BatchDrawer row={detailRow} rows={rows} onClose={() => setDetail(null)} onEdit={(r) => { setEditing(r); }} onDelete={(r) => remove([r.id])} onPick={setDetail} canEdit={can("edit_inventory")} canDelete={can("delete_inventory")} />
      <AddStockDialog open={addOpen || !!editing} edit={editing} onClose={() => { setAddOpen(false); setEditing(null); }} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ScanDialog open={scanOpen} onClose={() => setScanOpen(false)} rows={rows} onPick={(id) => { setScanOpen(false); setDetail(id); }} />
    </AppShell>
  );
}

function StockBar({ qty, level }: { qty: number; level: number }) {
  const pct = Math.min(100, (qty / Math.max(level * 2, 1)) * 100);
  const low = qty < level;
  return (
    <div className="ml-auto flex w-28 flex-col items-end gap-1">
      <span className={cn("tabular font-medium", low && "text-soon-ink")}>{int(qty)}</span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-sunken"><span className={cn("block h-full rounded-full", low ? "bg-soon" : "bg-brand/70")} style={{ width: pct + "%" }} /></span>
    </div>
  );
}

function RowMenu({ row, onEdit, onDelete, onOpen }: { row: Batch; onEdit: () => void; onDelete: () => void; onOpen: () => void }) {
  const can = useCan();
  return (
    <Menu>
      <MenuButton className="grid size-8 place-items-center rounded-lg text-muted opacity-60 transition group-hover:opacity-100 hover:bg-sunken hover:text-ink data-open:bg-sunken data-open:opacity-100" aria-label={`Actions for ${row.batch}`}><LuEllipsis className="size-4" /></MenuButton>
      <MenuItems transition anchor="bottom end" className="z-40 w-48 rounded-xl border border-line bg-surface p-1 shadow-float transition [--anchor-gap:4px] focus:outline-none data-closed:scale-95 data-closed:opacity-0">
        <MenuItem><button onClick={onOpen} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm data-focus:bg-sunken"><LuLayers className="size-4 text-muted" />Batch details</button></MenuItem>
        {can("edit_inventory") && <MenuItem><button onClick={onEdit} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm data-focus:bg-sunken"><LuPencil className="size-4 text-muted" />Edit</button></MenuItem>}
        {can("delete_inventory") && <MenuItem><button onClick={onDelete} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-critical-ink data-focus:bg-critical-soft"><LuTrash2 className="size-4" />Delete</button></MenuItem>}
      </MenuItems>
    </Menu>
  );
}

function BatchDrawer({ row, rows, onClose, onEdit, onDelete, onPick, canEdit, canDelete }: {
  row: Batch | null; rows: Batch[]; onClose: () => void; onEdit: (r: Batch) => void; onDelete: (r: Batch) => void; onPick: (id: string) => void; canEdit: boolean; canDelete: boolean;
}) {
  const [last, setLast] = useState<Batch | null>(row);
  useEffect(() => { if (row) setLast(row); }, [row]);
  const r = row ?? last;
  const siblings = r ? rows.filter((x) => x.barcode === r.barcode).sort((a, b) => a.days - b.days) : [];
  const fefo = siblings.find((x) => x.status !== "expired");
  const lifePct = r ? Math.max(0, Math.min(100, (r.days / 365) * 100)) : 0;
  return (
    <Drawer open={!!row} onClose={onClose} title="Batch details">
      {r && (
        <div className="flex flex-col gap-6 p-6">
          <div>
            <StatusPill status={r.status} />
            <h3 className="mt-3 font-display text-2xl font-bold">{r.name}</h3>
            <p className="text-sm text-muted">{r.category}</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-3xl font-bold tabular">{r.days <= 0 ? "Expired" : `${r.days} days`}</span>
              <span className="text-sm text-muted">{fmtDate(r.expiry)}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken"><div className={cn("h-full rounded-full transition-all duration-700", dot[r.status])} style={{ width: `${Math.max(lifePct, 2)}%` }} /></div>
            <p className="mt-2 text-xs text-muted">Shelf life left, on a one-year scale</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              [<LuBarcode key="b" />, "Barcode", <span key="v" className="font-mono">{r.barcode}</span>],
              [<LuLayers key="l" />, "Batch", <span key="v" className="font-mono">{r.batch}</span>],
              [<LuPackage key="p" />, "Units", int(r.qty)],
              [<LuCoins key="c" />, "Value at cost", money(r.qty * r.unitCost, 0)],
              [<LuTruck key="t" />, "Supplier", r.supplier],
              [<LuCoins key="m" />, "Price / cost", `${money(r.unitPrice)} / ${money(r.unitCost)}`],
            ].map(([icon, k, v], i) => (
              <div key={i} className="rounded-xl border border-line p-3">
                <dt className="flex items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5">{icon}{k}</dt>
                <dd className="mt-1 truncate font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">All batches of this product</p>
            <ul className="flex flex-col gap-1.5">
              {siblings.map((s) => (
                <li key={s.id}>
                  <button onClick={() => onPick(s.id)} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition hover:border-line-strong", s.id === r.id ? "border-brand bg-brand-soft/50" : "border-line")}>
                    <span className="font-mono">{s.batch}</span>
                    {fefo?.id === s.id && <Badge className="border-brand/30 bg-brand-soft text-brand-ink">Dispense first</Badge>}
                    <span className="ml-auto text-xs text-muted tabular">{s.qty} · {fmtDate(s.expiry)}</span>
                    <span className={cn("size-2 rounded-full", dot[s.status])} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {(canEdit || canDelete) && (
            <div className="flex gap-2 border-t border-line pt-5">
              {canEdit && <Button className="flex-1" onClick={() => onEdit(r)}><LuPencil />Edit batch</Button>}
              {canDelete && <Button variant="ghost" className="text-critical-ink hover:bg-critical-soft hover:text-critical-ink" onClick={() => onDelete(r)}><LuTrash2 />Delete</Button>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ScanDialog({ open, onClose, rows, onPick }: { open: boolean; onClose: () => void; rows: Batch[]; onPick: (id: string) => void }) {
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) { setCode(""); setQuery(""); } }, [open]);
  const hits = query ? rows.filter((r) => r.barcode === query.trim()).sort((a, b) => a.days - b.days) : [];
  const fefo = hits.find((h) => h.status !== "expired");
  const samples = [...new Set(rows.map((r) => r.barcode))].slice(4, 7);
  return (
    <Modal open={open} onClose={onClose} title="Scan or type a barcode" description="Scanners that type into a text box work here. You'll see every batch, first-to-dispense on top.">
      <form onSubmit={(e) => { e.preventDefault(); setQuery(code); }} className="flex gap-2">
        <div className="flex-1"><Input autoFocus icon={<LuBarcode />} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 6034000221004" inputMode="numeric" className="h-11 font-mono tracking-wider" aria-label="Barcode" /></div>
        <Button type="submit" variant="primary" className="h-11">Look up</Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">Try:{samples.map((s) => <button key={s} onClick={() => { setCode(s); setQuery(s); }} className="rounded-md border border-dashed border-line-strong px-2 py-0.5 font-mono hover:border-brand hover:text-ink">{s}</button>)}</div>
      {query && (
        <div className="mt-5 animate-fade-up">
          {hits.length === 0 ? (
            <EmptyState icon={<LuBarcode />} title={`No product with ${query}`} body="Add it as new stock to start tracking its batches." />
          ) : (
            <div className="rounded-2xl border border-line">
              <div className="flex items-center gap-3 border-b border-line p-4">
                <span className="hex-clip grid size-11 place-items-center bg-brand-soft text-brand-ink"><LuPackage className="size-5" /></span>
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{hits[0].name}</p><p className="text-xs text-muted">{hits[0].category} · {hits.filter((h) => h.status !== "expired").reduce((s, h) => s + h.qty, 0)} usable units</p></div>
              </div>
              <ul className="p-2">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => onPick(h.id)} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-sunken", fefo?.id === h.id && "bg-brand-soft/60 ring-1 ring-brand/40")}>
                      <span className="font-mono">{h.batch}</span>
                      {fefo?.id === h.id && <span className="text-[11px] font-semibold tracking-wide text-brand-ink uppercase">Dispense first</span>}
                      <span className="ml-auto text-xs text-muted tabular">{h.qty} units · {fmtDate(h.expiry)}</span>
                      <StatusPill status={h.status} short />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
