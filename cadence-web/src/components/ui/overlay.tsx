import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { LuX, LuCircleCheck, LuCircleAlert } from "react-icons/lu";
import { cn } from "@/lib/utils";
import { Button } from "./primitives";

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, description, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg";
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-[#050a18]/55 backdrop-blur-[2px] transition duration-200 data-closed:opacity-0" />
      <div className="fixed inset-0 grid place-items-center overflow-y-auto p-4">
        <DialogPanel
          transition
          className={cn(
            "w-full rounded-3xl border border-line bg-surface shadow-float transition duration-200 ease-out data-closed:translate-y-2 data-closed:scale-[.98] data-closed:opacity-0",
            size === "sm" ? "max-w-md" : size === "lg" ? "max-w-2xl" : "max-w-xl",
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-6">
            <div>
              <DialogTitle className="font-display text-lg font-semibold text-ink">{title}</DialogTitle>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><LuX /></Button>
          </div>
          <div className="px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 rounded-b-3xl border-t border-line bg-surface-2 px-6 py-4">{footer}</div>}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

/* ---------------- Side drawer ---------------- */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-[#050a18]/40 transition duration-200 data-closed:opacity-0" />
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-6">
        <DialogPanel transition className="flex w-screen max-w-md flex-col border-l border-line bg-surface shadow-float transition duration-300 ease-out data-closed:translate-x-full">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <DialogTitle className="font-display text-base font-semibold">{title}</DialogTitle>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><LuX /></Button>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

/* ---------------- Toasts (with optional Undo) ---------------- */
interface Toast { id: number; message: string; tone: "success" | "error"; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(t: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { tone: "success", ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.action ? 6000 : 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] flex flex-col items-end gap-2 max-md:bottom-24">
        {list.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-[min(420px,calc(100vw-2rem))] animate-fade-up items-center gap-3 rounded-2xl bg-navy px-4 py-3 text-sm text-white shadow-float dark:bg-[#1a2647]">
            {t.tone === "error" ? <LuCircleAlert className="size-4 shrink-0 text-[#ff8f8a]" /> : <LuCircleCheck className="size-4 shrink-0 text-[#5fe0a0]" />}
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button className="rounded-lg px-2 py-1 font-semibold text-[#a9c1ff] hover:bg-white/10" onClick={() => { t.action!.run(); setList((l) => l.filter((x) => x.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
