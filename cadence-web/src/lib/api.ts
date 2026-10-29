/* Data layer.
   USE_MOCK (default true until the FastAPI backend is deployed) keeps everything in this browser.
   Set VITE_USE_MOCK=false and VITE_API_URL=https://your-api.onrender.com/api/v1 to go live. */
import { useSyncExternalStore } from "react";
import { PHARMACY, seedItems, seedMonthly, seedRoles, seedUsers } from "./seed";
import { DEFAULT_THRESHOLDS } from "./analytics";
import { storage, todayISO } from "./utils";
import type { Item, Month, Permission, Role, Thresholds, User } from "./types";

export const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";
export const API_URL: string = import.meta.env.VITE_API_URL || "";
export const DEMO_PASSWORD = "cadence2026";

export interface Pharmacy { name: string; location: string; licenceNo?: string }
interface State { items: Item[]; users: User[]; roles: Role[]; monthly: Month[]; thresholds: Thresholds; pharmacy: Pharmacy; session: Session | null; ready: boolean }
export type { State };
interface Session { userId: string; token: string; user?: User }

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const V = "v3.";

let state: State = {
  items: USE_MOCK ? storage.get(V + "items", seedItems()) : [],
  users: USE_MOCK ? storage.get(V + "users", seedUsers()) : [],
  roles: USE_MOCK ? storage.get(V + "roles", seedRoles()) : [],
  monthly: seedMonthly(),
  thresholds: storage.get(V + "thresholds", DEFAULT_THRESHOLDS),
  pharmacy: USE_MOCK ? storage.get(V + "pharmacy", PHARMACY) : { name: "", location: "" },
  session: storage.get<Session | null>(V + "session", null),
  ready: USE_MOCK,
};
const listeners = new Set<() => void>();
export function set(patch: Partial<State>, persist?: (keyof State)[]) {
  state = { ...state, ...patch };
  persist?.forEach((k) => storage.set(V + k, state[k]));
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
export const getState = () => state;

export async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new Error("VITE_API_URL isn't set, so the app doesn't know where the Cadence API is. Add it to .env.local (or Vercel's environment variables) and restart.");
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    // fetch only throws like this when the request never got an answer: server down, wrong URL, or blocked by CORS.
    throw new Error(`Can't reach the Cadence API at ${API_URL}. Check that it's running (open ${API_URL.replace(/\/api\/v\d+$/, "")}/health) and that ALLOWED_ORIGINS on the server includes ${location.origin}.`);
  }
  if (res.status === 401) { auth.logout(); throw new Error("Your session has ended. Log in again."); }
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = typeof j.detail === "string" ? j.detail : detail; } catch { /* not JSON */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/* ---------------- Auth ---------------- */
// Demo mode keeps per-user passwords in this browser so reset and change-password can be tried end to end.
const mockPasswords = (): Record<string, string> => storage.get(V + "passwords", {});
const setMockPassword = (id: string, pw: string) => storage.set(V + "passwords", { ...mockPasswords(), [id]: pw });
export const demoPassword = (userId: string) => mockPasswords()[userId] ?? DEMO_PASSWORD;
// Stored in this browser so the demo link still works when opened in a new tab.
const mockResets = {
  all: () => storage.get<Record<string, { userId: string; expires: number }>>(V + "resets", {}),
  get(t: string) { return this.all()[t]; },
  set(t: string, v: { userId: string; expires: number }) { storage.set(V + "resets", { ...this.all(), [t]: v }); },
  delete(t: string) { const a = this.all(); delete a[t]; storage.set(V + "resets", a); },
  clearUser(id: string) { storage.set(V + "resets", Object.fromEntries(Object.entries(this.all()).filter(([, v]) => v.userId !== id))); },
};
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
export const resetLink = (token: string) => `${location.origin}${import.meta.env.VITE_ROUTER === "hash" ? location.pathname + "#" : ""}/reset-password?token=${token}`;
export interface ResetCheck { valid: boolean; name: string; email: string }
export interface ResetLinkResult { status: "sent" | "mock" | "failed"; detail: string; email: string; link: string | null; expiresMinutes: number }

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
    if (!u || password !== demoPassword(u.id)) throw new Error("That email and password don't match an account.");
    if (u.status !== "Active") throw new Error("This account hasn't been activated yet. Ask your admin to resend the invite.");
    const now = todayISO() + "T" + new Date().toTimeString().slice(0, 5);
    set({ users: state.users.map((x) => (x.id === u.id ? { ...x, lastLogin: now } : x)), session: { userId: u.id, token: "mock-" + u.id } }, ["users", "session"]);
    return u;
  },
  logout() { set({ session: null }, ["session"]); },

  /** Always resolves the same way whether or not the email has an account. Demo mode also returns the link, since no email is sent. */
  async forgotPassword(email: string): Promise<{ demoLink?: string }> {
    email = email.trim().toLowerCase();
    if (!USE_MOCK) { await http("POST", "/auth/forgot-password", { email }); return {}; }
    await delay(600);
    const u = state.users.find((x) => x.email.toLowerCase() === email && x.status === "Active");
    if (!u) return {};
    const token = newToken();
    mockResets.clearUser(u.id);
    mockResets.set(token, { userId: u.id, expires: Date.now() + 60 * 60_000 });
    return { demoLink: resetLink(token) };
  },
  async checkReset(token: string): Promise<ResetCheck> {
    if (!USE_MOCK) return http<ResetCheck>("GET", `/auth/reset-password/${encodeURIComponent(token)}`);
    await delay(300);
    const r = mockResets.get(token), u = r && r.expires > Date.now() ? state.users.find((x) => x.id === r.userId) : undefined;
    return u ? { valid: true, name: u.name.split(" ")[0], email: u.email } : { valid: false, name: "", email: "" };
  },
  async resetPassword(token: string, password: string) {
    if (!USE_MOCK) { await http("POST", "/auth/reset-password", { token, password }); set({ session: null }, ["session"]); return; }
    await delay(500);
    const r = mockResets.get(token);
    if (!r || r.expires < Date.now()) throw new Error("This reset link has expired or was already used. Ask for a new one.");
    setMockPassword(r.userId, password); mockResets.delete(token);
    set({ session: null }, ["session"]);
  },
};
export function useCurrentUser(): User | null {
  return useStore((s) => (s.session ? s.users.find((u) => u.id === s.session!.userId) ?? s.session.user ?? null : null));
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
    if (!state.session) return;
    const [items, users, roles, monthly, ph] = await Promise.all([
      http<Item[]>("GET", "/items"), http<User[]>("GET", "/users"), http<Role[]>("GET", "/roles"), http<Month[]>("GET", "/analytics/monthly"),
      http<Pharmacy & { criticalDays: number; soonDays: number }>("GET", "/pharmacy"),
    ]);
    set({ items, users, roles, monthly, pharmacy: ph, thresholds: { criticalMax: ph.criticalDays, soonMax: ph.soonDays }, ready: true });
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
  /** Undo a delete. Live mode re-creates the batches (they get new ids). */
  async restoreItems(items: Item[]) {
    if (USE_MOCK) { set({ items: [...items, ...state.items] }, ["items"]); return; }
    for (const { id: _id, soldThisMonth: _s, ...rest } of items) await api.createItem(rest);
  },
  async updateUser(id: string, data: Partial<User>) {
    if (!USE_MOCK) { const u = await http<User>("PATCH", `/users/${id}`, data); set({ users: state.users.map((x) => (x.id === id ? u : x)) }); return u; }
    await delay(300);
    set({ users: state.users.map((x) => (x.id === id ? { ...x, ...data } : x)) }, ["users"]);
  },
  async changePassword(current: string, next: string) {
    if (!USE_MOCK) return http("POST", "/auth/change-password", { current, next });
    await delay(400);
    const id = state.session?.userId ?? "";
    if (current !== demoPassword(id)) throw new Error("Your current password is incorrect.");
    setMockPassword(id, next);
  },
  /** Admin: email a team member a link to set a new password. If the email wasn't delivered, the link comes back to share in person. */
  async sendReset(userId: string): Promise<ResetLinkResult> {
    if (!USE_MOCK) return http<ResetLinkResult>("POST", `/users/${userId}/send-reset`);
    await delay(500);
    const u = state.users.find((x) => x.id === userId)!;
    const token = newToken();
    mockResets.clearUser(userId);
    mockResets.set(token, { userId, expires: Date.now() + 60 * 60_000 });
    return { status: "mock", detail: "", email: u.email, link: resetLink(token), expiresMinutes: 60 };
  },
  resetDemo() {
    ["items", "users", "roles", "thresholds", "pharmacy", "notify", "deliveries", "alertReads", "passwords"].forEach((k) => storage.remove(V + k));
    set({ items: seedItems(), users: seedUsers(), roles: seedRoles(), thresholds: DEFAULT_THRESHOLDS, pharmacy: PHARMACY });
  },
};
