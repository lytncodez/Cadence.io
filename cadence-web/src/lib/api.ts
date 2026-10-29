/* Data layer.
   USE_MOCK (default true until the FastAPI backend is deployed) keeps everything in this browser.
   Set VITE_USE_MOCK=false and VITE_API_URL=https://your-api.onrender.com/api/v1 to go live. */
import { useSyncExternalStore } from "react";
import { seedItems, seedMonthly, seedRoles, seedUsers } from "./seed";
import { DEFAULT_THRESHOLDS } from "./analytics";
import { storage, todayISO } from "./utils";
import type { Item, Month, Permission, Role, Thresholds, User } from "./types";

export const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";
export const API_URL: string = import.meta.env.VITE_API_URL || "";
export const DEMO_PASSWORD = "cadence2026";

interface State { items: Item[]; users: User[]; roles: Role[]; monthly: Month[]; thresholds: Thresholds; session: Session | null; ready: boolean }
interface Session { userId: string; token: string; user?: User }

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const V = "v3.";

let state: State = {
  items: USE_MOCK ? storage.get(V + "items", seedItems()) : [],
  users: USE_MOCK ? storage.get(V + "users", seedUsers()) : [],
  roles: USE_MOCK ? storage.get(V + "roles", seedRoles()) : [],
  monthly: seedMonthly(),
  thresholds: storage.get(V + "thresholds", DEFAULT_THRESHOLDS),
  session: storage.get<Session | null>(V + "session", null),
  ready: USE_MOCK,
};
const listeners = new Set<() => void>();
function set(patch: Partial<State>, persist?: (keyof State)[]) {
  state = { ...state, ...patch };
  persist?.forEach((k) => storage.set(V + k, state[k]));
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
export const getState = () => state;

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: { "Content-Type": "application/json", ...(state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { auth.logout(); throw new Error("Your session has ended. Log in again."); }
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = typeof j.detail === "string" ? j.detail : detail; } catch { /* not JSON */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/* ---------------- Auth ---------------- */
export const auth = {
  async login(email: string, password: string) {
    email = email.trim().toLowerCase();
    if (!USE_MOCK) {
      const r = await http<{ access_token: string; user: User }>("POST", "/auth/login", { email, password });
      set({ session: { userId: r.user.id, token: r.access_token, user: r.user } }, ["session"]);
      await api.loadAll();
      return r.user;
    }
    await delay(650);
    const u = state.users.find((x) => x.email.toLowerCase() === email);
    if (!u || password !== DEMO_PASSWORD) throw new Error("That email and password don't match an account.");
    if (u.status !== "Active") throw new Error("This account hasn't been activated yet. Ask your admin to resend the invite.");
    const now = todayISO() + "T" + new Date().toTimeString().slice(0, 5);
    set({ users: state.users.map((x) => (x.id === u.id ? { ...x, lastLogin: now } : x)), session: { userId: u.id, token: "mock-" + u.id } }, ["users", "session"]);
    return u;
  },
  logout() { set({ session: null }, ["session"]); },
};
export function useCurrentUser(): User | null {
  return useStore((s) => (s.session ? s.session.user && !USE_MOCK ? s.session.user : s.users.find((u) => u.id === s.session!.userId) ?? null : null));
}
export function useRole(): Role | undefined {
  const u = useCurrentUser();
  return useStore((s) => s.roles.find((r) => r.name === u?.role));
}
export function useCan() {
  const role = useRole();
  return (p: Permission) => !!role?.perms.includes(p);
}

/* ---------------- Data ---------------- */
export const api = {
  async loadAll() {
    if (USE_MOCK) return;
    const [items, users, roles, monthly] = await Promise.all([
      http<Item[]>("GET", "/items"), http<User[]>("GET", "/users"), http<Role[]>("GET", "/roles"), http<Month[]>("GET", "/analytics/monthly"),
    ]);
    set({ items, users, roles, monthly, ready: true });
  },
  async createItem(data: Omit<Item, "id" | "soldThisMonth" | "reorderLevel"> & Partial<Item>) {
    if (!USE_MOCK) { const it = await http<Item>("POST", "/items", data); set({ items: [it, ...state.items] }); return it; }
    await delay(350);
    if (state.items.some((i) => i.barcode === data.barcode && i.batch.toLowerCase() === data.batch.toLowerCase()))
      throw new Error(`Batch ${data.batch} already exists for this barcode. Edit that row instead.`);
    const it: Item = { soldThisMonth: 0, reorderLevel: 20, ...data, id: "itm_" + Date.now().toString(36) };
    set({ items: [it, ...state.items] }, ["items"]);
    return it;
  },
  async updateItem(id: string, data: Partial<Item>) {
    if (!USE_MOCK) { const it = await http<Item>("PATCH", `/items/${id}`, data); set({ items: state.items.map((i) => (i.id === id ? it : i)) }); return it; }
    await delay(250);
    set({ items: state.items.map((i) => (i.id === id ? { ...i, ...data } : i)) }, ["items"]);
  },
  async deleteItems(ids: string[]) {
    if (!USE_MOCK) { await Promise.all(ids.map((id) => http("DELETE", `/items/${id}`))); }
    else await delay(250);
    const removed = state.items.filter((i) => ids.includes(i.id));
    set({ items: state.items.filter((i) => !ids.includes(i.id)) }, USE_MOCK ? ["items"] : []);
    return removed;
  },
  restoreItems(items: Item[]) { set({ items: [...items, ...state.items] }, USE_MOCK ? ["items"] : []); },
  async updateUser(id: string, data: Partial<User>) {
    if (!USE_MOCK) { const u = await http<User>("PATCH", `/users/${id}`, data); set({ users: state.users.map((x) => (x.id === id ? u : x)) }); return u; }
    await delay(300);
    set({ users: state.users.map((x) => (x.id === id ? { ...x, ...data } : x)) }, ["users"]);
  },
  async changePassword(current: string, next: string) {
    if (!USE_MOCK) return http("POST", "/auth/change-password", { current, next });
    await delay(400);
    if (current !== DEMO_PASSWORD) throw new Error("Your current password is incorrect.");
  },
  resetDemo() {
    ["items", "users", "roles", "thresholds"].forEach((k) => storage.remove(V + k));
    set({ items: seedItems(), users: seedUsers(), roles: seedRoles(), thresholds: DEFAULT_THRESHOLDS });
  },
};
