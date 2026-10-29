/* Small motion helpers for the public website. All of them respect "Reduce motion" (device or Cadence setting). */
import type { CSSProperties, ElementType, ReactNode } from "react";
import { useCountUp, useReveal } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, delay = 0, className, as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: ElementType }) {
  const [ref, shown] = useReveal<HTMLElement>();
  return <Tag ref={ref} className={cn("reveal", shown && "in", className)} style={{ "--d": `${delay}ms` } as CSSProperties}>{children}</Tag>;
}

/** A number that counts up to `value` once mounted. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("en-GH"), duration = 1200 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const n = useCountUp(value, duration);
  return <span className="tabular">{format(n)}</span>;
}

/** Endless horizontal ticker. Content is duplicated so the loop is seamless; pauses on hover. */
export function Marquee({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("marquee relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]", className)}>
      <div className="marquee-track flex w-max">
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center" aria-hidden>{children}</div>
      </div>
    </div>
  );
}
