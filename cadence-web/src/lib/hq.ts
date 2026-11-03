/* Cadence HQ data layer. Separate session from pharmacy logins (its own token, its own storage key).
   HQ only ever receives usage counts and help requests, never a pharmacy's stock, sales or prices. */
import { useSyncExternalStore } from "react";
import { API_URL, USE_MOCK, delay } from "./api";
import { HELP_CATEGORIES, mockTickets, type HelpTicket } from "./features";
import { storage, todayISO } from "./utils";

export type Health = "active" | "quiet" | "at_risk" | "new" | "inactive";
export interface HqPharmacy {
  id: string; name: string; location: string; joined: string; adminName: string; adminEmail: string; staff: number;
  activeUsersWeek: number; activeDaysMonth: number; loginsMonth: number; lastActive: string; health: Health;
  featuresMonth: Record<"login" | "ai_question" | "import" | "item_added" | "invite" | "help_request", number>;
  smsOn: boolean; emailOn: boolean; openTickets: number; urgentOpen: number; activityByDay: number[];
}
export interface HqDetail { pharmacy: HqPharmacy; activityMonth: { date: string; people: number; logins: number; aiQuestions: number; stockChanges: number }[]; roles: Record<string, number>; tickets: HelpTicket[] }
export interface HqOverview { pharmacies: number; newThisWeek: number; activeThisWeek: number; atRisk: number; users: number; openTickets: number; urgentOpen: number; newLeads: number; signupsByWeek: number[]; activePharmaciesByDay: number[] }
export interface HqTicket extends HelpTicket { pharmacyId: string; pharmacyName: string; phone: string; raisedByEmail: string }
export interface Lead { id: string; name: string; pharmacy: string; phone: string; email: string; branches: string; message: string; status: "new" | "contacted" | "booked" | "closed"; createdAt: string }

/* ---------- session ---------- */
interface HqSession { token: string; name: string; email: string }
let session: HqSession | null = storage.get<HqSession | null>("hq.session", null);
const subs = new Set<() => void>();
const setSession = (s: HqSession | null) => { session = s; storage.set("hq.session", s); subs.forEach((f) => f()); };
export const useHqSession = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => session);

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method, headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error(`Can't reach the Cadence API at ${API_URL}.`); }
  if (res.status === 401 && path !== "/hq/auth/login") { setSession(null); throw new Error("Your HQ session has ended. Log in again."); }
  if (!res.ok) { let d = res.statusText; try { const j = await res.json(); if (typeof j.detail === "string") d = j.detail; } catch { /* not JSON */ } throw new Error(d); }
  return res.json();
}

/* ---------- demo data (mock mode only) ---------- */
const DEMO_HQ = { email: "hq@cadence.example", password: "cadence-hq-2026" };
function mockPharmacies(): HqPharmacy[] {
  const seed = [
    ["Harbour View Pharmacy", "Tema", "Abena Mensah", 4, "active", 210],
    ["Osu Community Pharmacy", "Osu, Accra", "Ama Boateng", 6, "active", 95],
    ["Kumasi Central Chemists", "Adum, Kumasi", "Kwame Owusu", 3, "quiet", 64],
    ["Cape Coast Health Pharmacy", "Cape Coast", "Efua Quansah", 2, "at_risk", 140],
    ["Tamale Wellness Pharmacy", "Tamale", "Ibrahim Alhassan", 5, "active", 30],
    ["Ho Family Pharmacy", "Ho", "Selorm Agbeko", 1, "new", 2],
  ] as const;
  return seed.map(([name, location, admin, staff, health, ageDays], i) => {
    const lvl = health === "active" ? 1 : health === "quiet" ? 0.35 : health === "at_risk" ? 0.05 : 0.2;
    const days = Array.from({ length: 14 }, (_, d) => Math.max(0, Math.round((staff * 3 * lvl) * (0.6 + ((d * 7 + i * 3) % 10) / 10) * (d % 7 === 0 ? 0.4 : 1))));
    if (health === "at_risk") days.fill(0);
    const last = health === "at_risk" ? 19 : health === "quiet" ? 6 : 0;
    const d = new Date(Date.now() - last * 86400000);
    const tickets = mockTickets.all().filter((t) => i === 0 && t.status !== "resolved");
    return {
      id: `ph_${i}`, name, location, joined: new Date(Date.now() - ageDays * 86400000).toISOString().slice(0, 10), adminName: admin,
      adminEmail: admin.split(" ")[0].toLowerCase() + "@" + name.split(" ")[0].toLowerCase() + ".example", staff,
      activeUsersWeek: health === "at_risk" ? 0 : Math.max(1, Math.round(staff * lvl)), activeDaysMonth: Math.round(30 * lvl), loginsMonth: Math.round(staff * 22 * lvl),
      lastActive: health === "new" && i === 5 ? "" : d.toISOString().slice(0, 10) + "T" + (9 + i) + ":1" + i,
      health: health as Health, featuresMonth: { login: Math.round(staff * 22 * lvl), ai_question: Math.round(40 * lvl), import: i % 3, item_added: Math.round(60 * lvl), invite: i % 2, help_request: tickets.length },
      smsOn: i % 3 !== 2, emailOn: i % 2 === 0, openTickets: tickets.length, urgentOpen: tickets.filter((t) => t.urgency === "urgent").length, activityByDay: days,
    };
  });
}

/* ---------- API ---------- */
export const hq = {
  demoLogin: USE_MOCK ? DEMO_HQ : null,
  async login(email: string, password: string) {
    if (USE_MOCK) {
      await delay(500);
      if (email.trim().toLowerCase() !== DEMO_HQ.email || password !== DEMO_HQ.password) throw new Error("That email and password don't match an HQ account.");
      setSession({ token: "mock-hq", name: "Cadence HQ", email: DEMO_HQ.email }); return;
    }
    const r = await http<{ access_token: string; admin: { name: string; email: string } }>("POST", "/hq/auth/login", { email: email.trim().toLowerCase(), password });
    setSession({ token: r.access_token, ...r.admin });
  },
  logout() { setSession(null); },
  async overview(): Promise<HqOverview> {
    if (!USE_MOCK) return http("GET", "/hq/overview");
    await delay(250);
    const p = mockPharmacies(), t = mockTickets.all().filter((x) => x.status !== "resolved");
    return { pharmacies: p.length, newThisWeek: 1, activeThisWeek: p.filter((x) => x.activeUsersWeek > 0).length, atRisk: p.filter((x) => x.health === "at_risk" || x.health === "inactive").length,
      users: p.reduce((a, x) => a + x.staff, 0), openTickets: t.length, urgentOpen: t.filter((x) => x.urgency === "urgent").length, newLeads: 2,
      signupsByWeek: [0, 1, 0, 1, 1, 0, 1, 1], activePharmaciesByDay: Array.from({ length: 14 }, (_, i) => 3 + ((i * 5) % 3)) };
  },
  async pharmacies(): Promise<HqPharmacy[]> { if (!USE_MOCK) return http("GET", "/hq/pharmacies"); await delay(250); return mockPharmacies(); },
  async pharmacy(id: string): Promise<HqDetail> {
    if (!USE_MOCK) return http("GET", `/hq/pharmacies/${id}`);
    await delay(250);
    const p = mockPharmacies().find((x) => x.id === id)!;
    const base = p.activityByDay.reduce((a, b) => a + b, 0) / 14;
    return { pharmacy: p, roles: { Admin: 1, Pharmacist: Math.max(0, p.staff - 2), Dispenser: Math.min(1, p.staff - 1) },
      tickets: p.id === "ph_0" ? mockTickets.all() : [],
      activityMonth: Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 86400000); const v = p.health === "at_risk" && i > 10 ? 0 : Math.round(base * (0.5 + ((i * 7) % 10) / 10));
        return { date: d.toISOString().slice(0, 10), people: Math.min(p.staff, Math.round(v / 3)), logins: Math.round(v / 2), aiQuestions: Math.round(v / 4), stockChanges: Math.round(v / 3) }; }) };
  },
  async tickets(status: "open" | "acknowledged" | "resolved" | "all" = "open"): Promise<HqTicket[]> {
    if (!USE_MOCK) return http("GET", `/hq/tickets?status=${status}`);
    await delay(200);
    const all = mockTickets.all();
    return status === "all" ? all : status === "open" ? all.filter((t) => t.status !== "resolved") : all.filter((t) => t.status === status);
  },
  async updateTicket(id: string, patch: { status?: HqTicket["status"]; reply?: string }): Promise<HqTicket> {
    if (!USE_MOCK) return http("PATCH", `/hq/tickets/${id}`, patch);
    await delay(300);
    const all = mockTickets.all().map((t) => (t.id === id ? { ...t, ...patch, updatedAt: todayISO() + "T" + new Date().toTimeString().slice(0, 5) } : t));
    mockTickets.save(all);
    return all.find((t) => t.id === id)!;
  },
  async leads(): Promise<Lead[]> {
    if (!USE_MOCK) return http("GET", "/hq/leads");
    await delay(200);
    const local = storage.get<{ name: string; pharmacy: string; phone: string; email: string; branches: string; message?: string; at: string }[]>("demoRequests", []);
    const saved = storage.get<Record<string, Lead["status"]>>("hq.leadStatus", {});
    const sample: Lead[] = [{ id: "ld_s1", name: "Kofi Annan-Boateng", pharmacy: "Spintex Pharmacy", phone: "+233 24 000 1111", email: "kofi@spintex.example", branches: "2–5 branches", message: "We want SMS alerts for all branches.", status: "new", createdAt: todayISO() + "T10:15" }];
    return [...local.map((l, i) => ({ id: "ld_" + i, name: l.name, pharmacy: l.pharmacy, phone: l.phone, email: l.email, branches: l.branches, message: l.message ?? "", status: "new" as const, createdAt: l.at.slice(0, 16) })), ...sample]
      .map((l) => ({ ...l, status: saved[l.id] ?? l.status }));
  },
  async updateLead(id: string, status: Lead["status"]): Promise<void> {
    if (!USE_MOCK) { await http("PATCH", `/hq/leads/${id}`, { status }); return; }
    storage.set("hq.leadStatus", { ...storage.get<Record<string, Lead["status"]>>("hq.leadStatus", {}), [id]: status });
  },
};
export const CATEGORY_LABEL = HELP_CATEGORIES;
