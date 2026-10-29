import { useSyncExternalStore } from "react";
import { setDateFormat, type DateFormat } from "./utils";

export type ThemeChoice = "light" | "dark" | "system";
export interface Prefs {
  theme: ThemeChoice;
  reduceMotion: boolean;
  dateFormat: DateFormat;
  startPage: "/app" | "/app/inventory" | "/app/alerts" | "/app/insights";
}
const DEFAULTS: Prefs = { theme: "system", reduceMotion: false, dateFormat: "d MMM yyyy", startPage: "/app" };

function load(): Prefs {
  try {
    const raw = localStorage.getItem("cadence.prefs");
    const theme = (localStorage.getItem("cadence.theme") as ThemeChoice) || DEFAULTS.theme;
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}), theme };
  } catch { return DEFAULTS; }
}

let prefs = load();
const subs = new Set<() => void>();
const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function apply() {
  const root = document.documentElement;
  root.classList.toggle("dark", prefs.theme === "dark" || (prefs.theme === "system" && !!mq?.matches));
  root.classList.toggle("reduce-motion", prefs.reduceMotion);
  setDateFormat(prefs.dateFormat);
}
apply();
mq?.addEventListener("change", () => { if (prefs.theme === "system") apply(); });

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem("cadence.theme", prefs.theme);
    const { theme: _t, ...rest } = prefs; // eslint-disable-line @typescript-eslint/no-unused-vars
    localStorage.setItem("cadence.prefs", JSON.stringify(rest));
  } catch { /* storage unavailable: keep in memory */ }
  apply();
  subs.forEach((f) => f());
}
export const getPrefs = () => prefs;
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };

export function usePrefs() {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}
/** Shared theme state: the user menu and Settings stay in sync. */
export function useTheme() {
  const p = usePrefs();
  return [p.theme, (t: ThemeChoice) => setPrefs({ theme: t })] as const;
}
