/* Minimal router: history API on Vercel (see vercel.json rewrites), hash mode for static previews.
   Small on purpose; swap for react-router if routes grow. */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const HASH = import.meta.env.VITE_ROUTER === "hash";

const read = () => (HASH ? location.hash.replace(/^#/, "") || "/" : location.pathname) || "/";
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
window.addEventListener(HASH ? "hashchange" : "popstate", notify);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (HASH) {
    if (opts.replace) history.replaceState(null, "", "#" + to); else history.pushState(null, "", "#" + to);
  } else {
    if (opts.replace) history.replaceState(null, "", to); else history.pushState(null, "", to);
  }
  notify();
  window.scrollTo({ top: 0 });
}
export function usePath() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, read);
}
/** Match "/profile/:id" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean), b = path.split("?")[0].split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      {...rest}
      href={HASH ? "#" + to : to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
