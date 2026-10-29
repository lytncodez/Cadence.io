import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Switch as HSwitch } from "@headlessui/react";
import { cn, initials } from "@/lib/utils";
import { STATUS_META } from "@/lib/analytics";
import type { Status } from "@/lib/types";
import logoUrl from "@/assets/logo.svg";

/* ---------------- Button ---------------- */
const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background,color,border-color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand text-on-brand shadow-[0_1px_0_rgb(255_255_255/.18)_inset,0_6px_16px_-6px_color-mix(in_oklab,var(--brand)_70%,transparent)] hover:bg-brand-hover",
        secondary: "border border-line bg-surface text-ink shadow-hair hover:border-line-strong hover:bg-surface-2",
        ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
        danger: "bg-critical text-white hover:brightness-110",
        soft: "bg-brand-soft text-brand-ink hover:brightness-[.97] dark:hover:brightness-125",
      },
      size: {
        sm: "h-8 rounded-lg px-3 text-[13px]",
        md: "h-10 rounded-xl px-4 text-sm",
        lg: "h-12 rounded-xl px-5 text-[15px]",
        icon: "size-9 rounded-xl",
        "icon-sm": "size-8 rounded-lg",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, ...props }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} {...props} disabled={props.disabled || loading}>
    {loading && <Spinner />}
    {children}
  </button>
));
Button.displayName = "Button";
export const buttonClass = button;

export const Spinner = ({ className }: { className?: string }) => (
  <span className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} aria-hidden />
);

/* ---------------- Inputs ---------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; icon?: ReactNode }>(
  ({ className, invalid, icon, ...props }, ref) => (
    <div className="relative">
      {icon && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted [&_svg]:size-4">{icon}</span>}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-10 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-ink shadow-hair transition placeholder:text-muted/80",
          "focus:border-brand focus:ring-4 focus:ring-[var(--ring)] focus:outline-none disabled:bg-sunken disabled:text-muted",
          invalid && "border-critical focus:border-critical focus:ring-critical/20",
          icon && "pl-9",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
Input.displayName = "Input";

export function Field({ label, htmlFor, hint, error, children, className }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">{label}</label>
      {children}
      {error ? <p className="text-xs text-critical-ink">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <HSwitch
      checked={checked} onChange={onChange} disabled={disabled} aria-label={label}
      className="group relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full bg-line-strong p-0.5 transition data-checked:bg-brand data-disabled:cursor-not-allowed data-disabled:opacity-50"
    >
      <span className="size-5 rounded-full bg-white shadow-sm transition group-data-checked:translate-x-5" />
    </HSwitch>
  );
}

/* ---------------- Surfaces ---------------- */
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-2xl border border-line bg-surface shadow-card", className)} {...p} />;
}
export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="font-display text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- Status ---------------- */
const pill: Record<Status, string> = {
  expired: "bg-expired-soft text-expired-ink",
  critical: "bg-critical-soft text-critical-ink",
  soon: "bg-soon-soft text-soon-ink",
  safe: "bg-safe-soft text-safe-ink",
};
export const dot: Record<Status, string> = { expired: "bg-expired", critical: "bg-critical", soon: "bg-soon", safe: "bg-safe" };
export function StatusPill({ status, className, short }: { status: Status; className?: string; short?: boolean }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold tracking-wide uppercase", pill[status], className)}>
      <span className={cn("size-1.5 rounded-full", dot[status], status === "critical" && "animate-pulse-ring")} />
      {short ? STATUS_META[status].short : STATUS_META[status].label}
    </span>
  );
}
export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase", className)}>{children}</span>;
}
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-surface-2 px-1 font-mono text-[11px] text-muted", className)}>{children}</kbd>;
}
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton", className)} />;

/* ---------------- Identity ---------------- */
export function Logo({ className, withText = true, textClass, onDark }: { className?: string; withText?: boolean; textClass?: string; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img src={logoUrl} alt="" className="size-8 shrink-0" />
      {withText && <span className={cn("font-display text-[19px] font-bold tracking-tight", onDark ? "text-white" : "text-ink", textClass)}>Cadence<span className={onDark ? "text-[#8fb0ff]" : "text-brand"}>.io</span></span>}
    </span>
  );
}

const AVATAR_TINTS = ["from-[#1e4fd8] to-[#5d89f7]", "from-[#6a4be0] to-[#a68cff]", "from-[#0e7f8a] to-[#36c2c9]", "from-[#173a9e] to-[#7c5ce8]"];
/** Hexagon avatar, echoing the logo. */
export function Avatar({ name, photo, size = 36, className }: { name: string; photo?: string; size?: number; className?: string }) {
  const tint = AVATAR_TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  return (
    <span className={cn("hex-clip relative inline-grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br font-semibold text-white", tint, className)} style={{ width: size, height: size * 1.08, fontSize: size * 0.36 }}>
      {photo ? <img src={photo} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}

export function HexLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="grid place-items-center gap-3 py-16 text-muted">
      <img src={logoUrl} alt="" className="size-10 animate-hex-spin" />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="hex-clip grid size-14 place-items-center bg-brand-soft text-brand-ink [&_svg]:size-6">{icon}</div>
      <div>
        <p className="font-display text-base font-semibold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}
