import { useMemo, useState } from "react";
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions, Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { LuSearch, LuHouse, LuPackage, LuUser, LuSparkles, LuBell, LuSettings, LuPlus, LuSun, LuMoon, LuLogOut, LuCornerDownLeft, LuPill } from "react-icons/lu";
import type { IconType } from "react-icons";
import { navigate } from "@/lib/router";
import { auth, useCan, useStore } from "@/lib/api";
import { enrich } from "@/lib/analytics";
import { Kbd, StatusPill } from "@/components/ui/primitives";
import type { Status } from "@/lib/types";
import { cn, relDays } from "@/lib/utils";

interface Cmd { id: string; group: string; label: string; hint?: string; icon: IconType; run: () => void; status?: Status; keywords?: string }

export function CommandPalette({ open, onClose, onTheme, onAddStock }: { open: boolean; onClose: () => void; onTheme: (t: "light" | "dark") => void; onAddStock: () => void }) {
  const [q, setQ] = useState("");
  const items = useStore((s) => s.items);
  const thresholds = useStore((s) => s.thresholds);
  const can = useCan();

  const commands = useMemo<Cmd[]>(() => {
    const go = (p: string) => () => navigate(p);
    const base: Cmd[] = [
      { id: "nav-home", group: "Go to", label: "Overview", icon: LuHouse, run: go("/") },
      { id: "nav-inv", group: "Go to", label: "Inventory", icon: LuPackage, run: go("/inventory") },
      ...(can("view_insights") ? [{ id: "nav-ai", group: "Go to", label: "AI Insights", icon: LuSparkles, run: go("/insights") }] : []),
      { id: "nav-alerts", group: "Go to", label: "Alerts", icon: LuBell, run: go("/alerts") },
      ...(can("manage_users") ? [{ id: "nav-set", group: "Go to", label: "Settings", icon: LuSettings, run: go("/settings") }] : []),
      { id: "nav-me", group: "Go to", label: "My profile", icon: LuUser, run: go("/profile") },
      ...(can("edit_inventory") ? [{ id: "act-add", group: "Actions", label: "Add stock", hint: "N", icon: LuPlus, run: onAddStock }] : []),
      { id: "act-light", group: "Actions", label: "Switch to light theme", icon: LuSun, run: () => onTheme("light") },
      { id: "act-dark", group: "Actions", label: "Switch to dark theme", icon: LuMoon, run: () => onTheme("dark") },
      { id: "act-out", group: "Actions", label: "Log out", icon: LuLogOut, run: () => { auth.logout(); navigate("/login", { replace: true }); } },
    ];
    const batches: Cmd[] = items.map((i) => enrich(i, thresholds)).sort((a, b) => a.days - b.days).map((b) => ({
      id: b.id, group: "Batches", label: `${b.name}`, hint: `${b.batch} · ${relDays(b.days)}`, icon: LuPill, status: b.status,
      keywords: `${b.barcode} ${b.batch} ${b.category}`, run: () => navigate(`/inventory?batch=${b.id}`),
    }));
    return [...base, ...batches];
  }, [items, thresholds, can, onTheme, onAddStock]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? commands.filter((c) => (c.label + " " + (c.hint ?? "") + " " + (c.keywords ?? "")).toLowerCase().includes(s)) : commands.filter((c) => c.group !== "Batches").concat(commands.filter((c) => c.group === "Batches").slice(0, 5));
    return list.slice(0, 40);
  }, [q, commands]);
  const groups = [...new Set(results.map((r) => r.group))];

  return (
    <Dialog open={open} onClose={() => { onClose(); setQ(""); }} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-[#050a18]/50 backdrop-blur-[2px] transition duration-150 data-closed:opacity-0" />
      <div className="fixed inset-0 overflow-y-auto p-4 pt-[12vh]">
        <DialogPanel transition className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-line bg-surface shadow-float transition duration-150 data-closed:scale-[.98] data-closed:opacity-0">
          <Combobox<Cmd | null> onChange={(c) => { if (c) { c.run(); onClose(); setQ(""); } }}>
            <div className="flex items-center gap-3 border-b border-line px-5">
              <LuSearch className="size-5 text-muted" />
              <ComboboxInput autoFocus className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted" placeholder="Search batches, barcodes or jump to a page…" onChange={(e) => setQ(e.target.value)} />
              <Kbd>Esc</Kbd>
            </div>
            <ComboboxOptions static className="max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">No matches for “{q}”.</p>}
              {groups.map((g) => (
                <div key={g} className="pb-1">
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{g}</p>
                  {results.filter((r) => r.group === g).map((c) => (
                    <ComboboxOption key={c.id} value={c} className="group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 data-focus:bg-brand-soft">
                      <span className="grid size-8 place-items-center rounded-lg border border-line bg-surface-2 text-ink-2 group-data-focus:border-transparent group-data-focus:bg-brand group-data-focus:text-on-brand"><c.icon className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{c.label}</span>
                        {c.hint && <span className={cn("block truncate text-xs text-muted", c.group === "Batches" && "font-mono")}>{c.hint}</span>}
                      </span>
                      {c.status && <StatusPill status={c.status} short />}
                      <LuCornerDownLeft className="size-4 text-muted opacity-0 group-data-focus:opacity-100" />
                    </ComboboxOption>
                  ))}
                </div>
              ))}
            </ComboboxOptions>
          </Combobox>
          <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-5 py-2.5 text-[11px] text-muted">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
            <span className="ml-auto">Cadence command bar</span>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
