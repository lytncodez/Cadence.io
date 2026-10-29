import { useEffect, useRef, useState } from "react";

/** Animate a number from its previous value to `value`. */
export function useCountUp(value: number, duration = 900) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = prefersReducedMotion();
    if (reduce) { setShown(value); from.current = value; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

/** Keyboard shortcut, e.g. useHotkey("k", fn, { meta: true }). */
export function useHotkey(key: string, fn: (e: KeyboardEvent) => void, opts: { meta?: boolean } = {}) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (opts.meta && !(e.metaKey || e.ctrlKey)) return;
      if (!opts.meta) {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
      }
      if (e.key.toLowerCase() === key.toLowerCase()) { e.preventDefault(); ref.current(e); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [key, opts.meta]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** True when the device or the Cadence "Reduce motion" setting asks for less animation. */
export const prefersReducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");

/** Adds `in` to the element the first time it scrolls into view (pairs with the .reveal class). */
export function useReveal<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold, rootMargin: "100000px 0px -8% 0px" /* anything already scrolled past counts as seen */ });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, shown] as const;
}
