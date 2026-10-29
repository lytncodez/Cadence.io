import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const CURRENCY = "₵";
const LOCALE = "en-GH";

export function money(n: number, decimals?: number) {
  const d = decimals ?? (Math.abs(n) < 100 ? 2 : 0);
  return CURRENCY + Number(n || 0).toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const int = (n: number) => Number(n || 0).toLocaleString(LOCALE);
export const compactMoney = (n: number) =>
  n >= 1000 ? CURRENCY + (n / 1000).toFixed(n >= 10000 ? 1 : 2).replace(/\.0+$/, "") + "k" : money(n, 0);

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function daysUntil(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}
export function fmtDate(iso?: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function relDays(days: number) {
  if (days < 0) return `expired ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago`;
  if (days === 0) return "expires today";
  if (days === 1) return "in 1 day";
  if (days < 60) return `in ${days} days`;
  return `in ${Math.round(days / 30.4)} months`;
}
export function fmtStamp(stamp?: string) {
  if (!stamp) return "Never";
  const [d, t] = stamp.split("T");
  const diff = -daysUntil(d);
  return (diff === 0 ? "Today" : diff === 1 ? "Yesterday" : fmtDate(d)) + (t ? ` · ${t}` : "");
}
export function tenure(iso?: string) {
  if (!iso) return "";
  const days = -daysUntil(iso);
  if (days < 31) return days <= 7 ? "new this week" : `${days} days`;
  const months = Math.floor(days / 30.44);
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} yr${y > 1 ? "s" : ""}` : "", m ? `${m} mo` : ""].filter(Boolean).join(" ");
}
export const initials = (name: string) => name.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export const storage = {
  get<T>(key: string, fallback: T): T {
    try { const raw = localStorage.getItem("cadence." + key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem("cadence." + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  remove(key: string) { try { localStorage.removeItem("cadence." + key); } catch { /* ignore */ } },
};
