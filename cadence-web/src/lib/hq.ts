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
export interface Integration { provider: string; status: "live" | "demo" | "needs_setup"; detail: string }
export interface HqSystem { sms: Integration; email: Integration; ai: Integration; cron: Integration; encryption: Integration; hqEmail: Integration; hqSms: Integration; hqDigest: Integration }
export interface HqSendResult { channel: "sms" | "email" | "ai"; status: "sent" | "mock" | "failed"; detail: string }
export interface HqDelivery { id: string; channel: "sms" | "email" | "ai"; recipient: string; subject: string; message: string; status: "sent" | "mock" | "failed"; error: string; kind: "test" | "digest" | "help" | "broadcast" | "reply"; createdAt: string }
export interface Briefing { text: string; ai: boolean; generatedAt: string }
export interface ChatTurn { role: "user" | "ai"; text: string }
export interface Draft { title: string; message: string; sms: string; ai: boolean }
export type Audience = "all" | "active" | "quiet" | "at_risk" | "new" | "inactive" | "selected";
export type BroadcastChannel = "in_app" | "email" | "sms";
export interface BroadcastInput { title: string; message: string; smsText: string; channels: BroadcastChannel[]; audience: Audience; pharmacyIds: string[]; dryRun?: boolean }
export interface Broadcast {
  id: string; title: string; message: string; smsText: string; channels: BroadcastChannel[]; audience: Audience; pharmacies: number; pharmacyNames: string[];
  emailRecipients: number; smsRecipients: number; results: Partial<Record<"email" | "sms", { sent: number; mock: number; failed: number }>> & { in_app?: { pharmacies: number } };
  sentBy: string; createdAt: string; dryRun?: boolean;
}
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

/* Demo-mode version of the server's template briefing (cadence-api/app/services/hq_ai.py). */
function mockBriefing(list: HqPharmacy[]): string {
  const names = (xs: string[], n = 4) => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");
  const active = list.filter((p) => p.activeUsersWeek > 0).length, open = list.reduce((a, p) => a + p.openTickets, 0), urgent = list.filter((p) => p.urgentOpen);
  const quiet = list.filter((p) => p.health === "at_risk" || p.health === "inactive"), fresh = list.filter((p) => p.health === "new");
  const stuck = list.filter((p) => p.health !== "at_risk" && p.health !== "inactive" && !p.featuresMonth.item_added && !p.featuresMonth.import);
  const off = list.filter((p) => !p.smsOn && !p.emailOn && p.health !== "inactive");
  const acts = [
    urgent.length && `Call ${names(urgent.map((p) => p.name))} about their urgent help request.`,
    quiet.length && `Check in with ${names(quiet.map((p) => `${p.name} (last active ${p.lastActive ? Math.max(0, -daysUntilStamp(p.lastActive)) + " days ago" : "never"})`), 3)}: they've gone quiet.`,
    stuck.length && `Offer import help to ${names(stuck.map((p) => p.name))}: no stock added in 30 days.`,
    fresh.length && `Welcome call for ${names(fresh.map((p) => p.name))}.`,
    off.length && `Help ${names(off.map((p) => p.name))} switch on SMS or email alerts.`,
  ].filter(Boolean) as string[];
  const top = [...list].sort((a, b) => b.activeDaysMonth - a.activeDaysMonth).slice(0, 3).map((p) => `${p.name} (${p.activeDaysMonth} days used)`);
  return `${active} of ${list.length} pharmacies used Cadence this week, with ${list.reduce((a, p) => a + p.staff, 0)} people in total. ${open} help request${open === 1 ? " is" : "s are"} open${urgent.length ? `, ${urgent.reduce((a, p) => a + p.urgentOpen, 0)} urgent.` : "."}\n\n`
    + (acts.length ? acts : ["Nothing needs chasing today."]).slice(0, 5).map((a, i) => `${i + 1}. ${a}`).join("\n") + `\n\nMost engaged: ${top.join(", ")}.`;
}
const daysUntilStamp = (stamp: string) => Math.round((new Date(stamp.slice(0, 10)).getTime() - new Date(todayISO()).getTime()) / 86400000);
const nowStamp = () => { const d = new Date(); return d.toISOString().slice(0, 10) + "T" + d.toTimeString().slice(0, 5); };
const mockLog = (d: Omit<HqDelivery, "id" | "createdAt">) => storage.set("hq.deliveries", [{ ...d, id: Math.random().toString(36).slice(2), createdAt: nowStamp() }, ...storage.get<HqDelivery[]>("hq.deliveries", [])].slice(0, 50));
const DEMO_INTEGRATION = (detail: string): Integration => ({ provider: "mock", status: "demo", detail });

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
  async updateTicket(id: string, patch: { status?: HqTicket["status"]; reply?: string; textReply?: boolean }): Promise<HqTicket> {
    if (!USE_MOCK) return http("PATCH", `/hq/tickets/${id}`, patch);
    if (patch.reply) mockLog({ channel: "email", recipient: "the person who asked", subject: "Cadence support", message: patch.reply, status: "mock", error: "", kind: "reply" });
    if (patch.reply && patch.textReply) mockLog({ channel: "sms", recipient: "callback number", subject: "", message: `Cadence support: ${patch.reply}`, status: "mock", error: "", kind: "reply" });
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
  /* ---- system: which providers are live, send yourself a test ---- */
  async system(): Promise<HqSystem> {
    if (!USE_MOCK) return http("GET", "/hq/system");
    await delay(200);
    return { sms: DEMO_INTEGRATION("Demo mode: texts are logged, not sent."), email: DEMO_INTEGRATION("Demo mode: emails are logged, not sent."),
      ai: DEMO_INTEGRATION("Built-in wording only."), cron: DEMO_INTEGRATION("The browser demo has no scheduler."), encryption: DEMO_INTEGRATION("Demo data lives in this browser."),
      hqEmail: DEMO_INTEGRATION("Help requests and the HQ digest go to HQ_NOTIFY_EMAIL."), hqSms: DEMO_INTEGRATION("Urgent help requests are texted to HQ_NOTIFY_SMS."),
      hqDigest: DEMO_INTEGRATION("Daily HQ email after HQ_DIGEST_TIME.") };
  },
  async test(channel: "sms" | "email" | "ai", to = ""): Promise<HqSendResult> {
    if (!USE_MOCK) return http("POST", "/hq/test", { channel, to });
    await delay(500);
    mockLog({ channel, recipient: to || (channel === "ai" ? "" : "HQ inbox"), subject: channel === "email" ? "Cadence HQ test email" : "", message: "Test from Cadence HQ", status: "mock", error: "", kind: "test" });
    return { channel, status: "mock", detail: "Demo mode: logged, not sent." };
  },
  async deliveries(kind = ""): Promise<HqDelivery[]> {
    if (!USE_MOCK) return http("GET", `/hq/deliveries${kind ? `?kind=${kind}` : ""}`);
    await delay(150);
    return storage.get<HqDelivery[]>("hq.deliveries", []).filter((d) => !kind || d.kind === kind);
  },
  async digestPreview(): Promise<{ subject: string; body: string; to: string }> {
    if (!USE_MOCK) return http("GET", "/hq/digest/preview");
    await delay(300);
    const p = mockPharmacies();
    return { to: "you@cadence.example", subject: `Cadence HQ · ${p.filter((x) => x.activeUsersWeek > 0).length}/${p.length} active`,
      body: `Good morning. Here's Cadence today.\n\nBRIEFING\n${mockBriefing(p)}\n\nOpen Cadence HQ to act on these.` };
  },
  async digestSend(): Promise<HqSendResult> {
    if (!USE_MOCK) return http("POST", "/hq/digest/send");
    const d = await hq.digestPreview();
    mockLog({ channel: "email", recipient: d.to, subject: d.subject, message: d.body, status: "mock", error: "", kind: "digest" });
    return { channel: "email", status: "mock", detail: "Demo mode: logged, not sent." };
  },

  /* ---- AI (usage counts only) ---- */
  async briefing(): Promise<Briefing> {
    if (!USE_MOCK) return http("POST", "/hq/ai/briefing");
    await delay(700);
    return { text: mockBriefing(mockPharmacies()), ai: false, generatedAt: nowStamp() };
  },
  async chat(message: string, history: ChatTurn[]): Promise<{ text: string; ai: boolean }> {
    if (!USE_MOCK) return http("POST", "/hq/ai/chat", { message, history: history.slice(-10) });
    await delay(800);
    return { ai: false, text: "Demo mode: open questions need the API with an AI key. Here's today's briefing instead.\n\n" + mockBriefing(mockPharmacies()) };
  },
  async draft(notes: string, audience: string): Promise<Draft> {
    if (!USE_MOCK) return http("POST", "/hq/ai/draft", { notes, audience });
    await delay(700);
    const clean = notes.replace(/\s+/g, " ").trim(), first = clean.split(/(?<=[.!?])\s/)[0];
    const sms = `Cadence: ${clean}`;
    return { title: first.length > 78 ? first.slice(0, 77) + "…" : first, message: notes.trim(), sms: sms.length > 300 ? sms.slice(0, 297) + "…" : sms, ai: false };
  },

  /* ---- broadcasts to pharmacies ---- */
  async broadcast(b: BroadcastInput): Promise<Broadcast> {
    if (!USE_MOCK) return http("POST", "/hq/broadcasts", b);
    await delay(b.dryRun ? 250 : 900);
    const all = mockPharmacies();
    const targets = b.audience === "all" ? all : b.audience === "selected" ? all.filter((p) => b.pharmacyIds.includes(p.id)) : all.filter((p) => p.health === b.audience);
    if (!targets.length) throw new Error("No pharmacies match that audience.");
    const email = b.channels.includes("email") ? targets.length : 0, sms = b.channels.includes("sms") ? targets.length : 0;
    const out: Broadcast = { id: "bc_" + Date.now().toString(36), title: b.title, message: b.message, smsText: b.channels.includes("sms") ? (b.smsText || `Cadence: ${b.title}. ${b.message}`).slice(0, 459) : "",
      channels: b.channels, audience: b.audience, pharmacies: targets.length, pharmacyNames: targets.map((p) => p.name), emailRecipients: email, smsRecipients: sms,
      results: { ...(email ? { email: { sent: 0, mock: email, failed: 0 } } : {}), ...(sms ? { sms: { sent: 0, mock: sms, failed: 0 } } : {}), ...(b.channels.includes("in_app") ? { in_app: { pharmacies: targets.length } } : {}) },
      sentBy: session?.name ?? "Cadence HQ", createdAt: nowStamp(), dryRun: !!b.dryRun };
    if (!b.dryRun) {
      storage.set("hq.broadcasts", [out, ...storage.get<Broadcast[]>("hq.broadcasts", [])].slice(0, 50));
      if (email) mockLog({ channel: "email", recipient: `${email} pharmacy admins`, subject: b.title, message: b.message, status: "mock", error: "", kind: "broadcast" });
      if (sms) mockLog({ channel: "sms", recipient: `${sms} pharmacy admins`, subject: "", message: out.smsText, status: "mock", error: "", kind: "broadcast" });
    }
    return out;
  },
  async broadcasts(): Promise<Broadcast[]> {
    if (!USE_MOCK) return http("GET", "/hq/broadcasts");
    await delay(150);
    return storage.get<Broadcast[]>("hq.broadcasts", []);
  },

  async updateLead(id: string, status: Lead["status"]): Promise<void> {
    if (!USE_MOCK) { await http("PATCH", `/hq/leads/${id}`, { status }); return; }
    storage.set("hq.leadStatus", { ...storage.get<Record<string, Lead["status"]>>("hq.leadStatus", {}), [id]: status });
  },
};
export const CATEGORY_LABEL = HELP_CATEGORIES;
