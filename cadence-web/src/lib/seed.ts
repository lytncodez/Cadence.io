/* Sample pharmacy data for mock mode. Expiry is stored as days-from-today so statuses stay realistic. */
import { addDays, MONTHS, todayISO } from "./utils";
import type { Item, Month, Permission, Role, User } from "./types";

type Row = [string, string, string, string, number, number, number, number, string, number, number];
// name, category, barcode, batch, daysToExpiry, qty, unitCost, unitPrice, supplier, soldThisMonth, reorderLevel
const ROWS: Row[] = [
  ["Paracetamol 500mg Tabs ×100", "Analgesics", "6034000112011", "PCM-2408", 412, 64, 18.5, 32, "Ernest Chemists", 142, 30],
  ["Paracetamol 500mg Tabs ×100", "Analgesics", "6034000112011", "PCM-2411", 23, 18, 18.5, 32, "Ernest Chemists", 0, 30],
  ["Ibuprofen 400mg Tabs ×24", "Analgesics", "6034000112035", "IBU-2502", 287, 52, 9.8, 18, "Letap Pharma", 88, 25],
  ["Diclofenac 50mg Tabs ×30", "Analgesics", "6034000112059", "DIC-2410", -6, 9, 7.2, 14, "Letap Pharma", 0, 20],
  ["Amoxicillin 500mg Caps ×21", "Antibiotics", "6034000221004", "AMX-2503", 12, 26, 14.9, 28, "Tobinco Pharma", 61, 30],
  ["Amoxicillin 500mg Caps ×21", "Antibiotics", "6034000221004", "AMX-2507", 196, 80, 14.9, 28, "Tobinco Pharma", 0, 30],
  ["Augmentin 625mg Tabs ×14", "Antibiotics", "5000123004512", "AUG-2505", 74, 22, 96, 145, "GSK Ghana", 31, 10],
  ["Ciprofloxacin 500mg Tabs ×10", "Antibiotics", "6034000221028", "CIP-2409", 0, 14, 11.4, 22, "Tobinco Pharma", 0, 15],
  ["Metronidazole 400mg Tabs ×21", "Antibiotics", "6034000221042", "MTZ-2504", 158, 47, 6.3, 12, "Kinapharma", 40, 20],
  ["Coartem 80/480mg ×6", "Antimalarials", "7612797004312", "CTM-2502", 41, 38, 42, 68, "Novartis via M&G", 97, 25],
  ["Lonart DS ×6", "Antimalarials", "8906002961015", "LNT-2506", 233, 55, 21, 38, "Bliss GVS", 76, 25],
  ["Lonart DS ×6", "Antimalarials", "8906002961015", "LNT-2501", 17, 11, 21, 38, "Bliss GVS", 0, 25],
  ["Artesunate 60mg Inj", "Antimalarials", "6034000330017", "ART-2503", 129, 16, 28, 46, "Guilin via Tobinco", 12, 10],
  ["Metformin 500mg Tabs ×28", "Chronic care", "6034000440051", "MET-2412", 64, 70, 8.6, 16, "Ernest Chemists", 118, 40],
  ["Amlodipine 10mg Tabs ×28", "Chronic care", "6034000440075", "AML-2502", 312, 66, 10.2, 20, "Kinapharma", 104, 40],
  ["Lisinopril 10mg Tabs ×28", "Chronic care", "6034000440099", "LIS-2411", 8, 12, 12.8, 24, "Kinapharma", 22, 20],
  ["Atorvastatin 20mg Tabs ×30", "Chronic care", "6034000440112", "ATV-2504", 401, 41, 16.5, 30, "Ernest Chemists", 47, 20],
  ["Insulin Mixtard 30/70 10ml", "Chronic care", "5701234005671", "INS-2503", 52, 8, 118, 165, "Novo Nordisk", 9, 6],
  ["Ventolin Inhaler 100mcg", "Respiratory", "5000123006417", "VEN-2501", 86, 14, 48, 75, "GSK Ghana", 18, 8],
  ["Cetirizine 10mg Tabs ×30", "Respiratory", "6034000550018", "CET-2505", 520, 90, 5.4, 12, "Letap Pharma", 66, 30],
  ["Benylin Cough Syrup 100ml", "Respiratory", "6001067021113", "BNL-2502", 27, 21, 22, 38, "Kenvue", 34, 15],
  ["Benylin Cough Syrup 100ml", "Respiratory", "6001067021113", "BNL-2409", -21, 6, 22, 38, "Kenvue", 0, 15],
  ["ORS Sachets ×10", "Rehydration", "6034000660014", "ORS-2506", 610, 120, 6, 12, "Kinapharma", 73, 40],
  ["Zinc 20mg Dispersible ×10", "Rehydration", "6034000660038", "ZNC-2504", 145, 48, 4.5, 9, "Kinapharma", 29, 20],
  ["Vitamin C 1000mg Effervescent ×20", "Supplements", "4005800123456", "VTC-2503", 58, 33, 19, 35, "Bayer West Africa", 52, 20],
  ["Folic Acid 5mg Tabs ×28", "Supplements", "6034000770011", "FOL-2501", 365, 72, 3.2, 7, "Ernest Chemists", 38, 25],
  ["Ferrous Sulphate 200mg ×28", "Supplements", "6034000770035", "FES-2410", 4, 15, 4.1, 9, "Ernest Chemists", 11, 20],
  ["Omeprazole 20mg Caps ×28", "Gastro", "6034000880017", "OMP-2502", 188, 58, 9.1, 18, "Letap Pharma", 63, 25],
  ["Gaviscon Liquid 200ml", "Gastro", "5011417564781", "GAV-2505", 77, 19, 41, 62, "Reckitt", 23, 10],
  ["Loperamide 2mg Caps ×12", "Gastro", "6034000880031", "LOP-2409", -45, 5, 3.8, 8, "Letap Pharma", 0, 10],
  ["Hydrocortisone 1% Cream 15g", "Dermatology", "6034000990013", "HYD-2503", 241, 27, 8.4, 16, "Kinapharma", 14, 10],
  ["Clotrimazole 1% Cream 20g", "Dermatology", "6034000990037", "CLT-2408", 35, 24, 7.6, 15, "Kinapharma", 19, 10],
  ["Sterile Gauze Swabs ×100", "Consumables", "6034001110016", "GZE-2502", 702, 40, 15, 26, "Medilab Supplies", 21, 15],
  ["Disposable Syringes 5ml ×100", "Consumables", "6034001110030", "SYR-2504", 811, 22, 32, 52, "Medilab Supplies", 15, 10],
  ["Salbutamol 4mg Tabs ×28", "Respiratory", "6034000550032", "SAL-2503", 47, 25, 3.9, 8, "Letap Pharma", 17, 15],
  ["Azithromycin 500mg Tabs ×3", "Antibiotics", "6034000221066", "AZI-2506", 140, 40, 12.5, 24, "Tobinco Pharma", 26, 15],
];

export function seedItems(): Item[] {
  const t = todayISO();
  return ROWS.map((r, i) => ({
    id: "itm_" + String(i + 1).padStart(3, "0"),
    name: r[0], category: r[1], barcode: r[2], batch: r[3], expiry: addDays(t, r[4]),
    qty: r[5], unitCost: r[6], unitPrice: r[7], supplier: r[8], soldThisMonth: r[9], reorderLevel: r[10],
  }));
}

export function seedMonthly(): Month[] {
  const now = new Date();
  const figures = [[38240, 27420], [40110, 28630], [39580, 28050], [42760, 29910], [43920, 30470], [47630, 32480]];
  return figures.map(([revenue, cost], i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { label: MONTHS[d.getMonth()], year: d.getFullYear(), revenue, cost };
  });
}

export function seedUsers(): User[] {
  const t = todayISO();
  return [
    { id: "u1", name: "Abena Mensah", email: "abena@harbourview.example", role: "Admin", status: "Active", position: "Pharmacy Manager", staffId: "HVP-001", phone: "+233 24 555 0142", department: "Management", regNo: "", joined: "2021-03-15", lastLogin: t + "T07:42", photo: "", bio: "Runs day-to-day operations, supplier accounts and the monthly stock review." },
    { id: "u2", name: "Kojo Asante", email: "kojo@harbourview.example", role: "Pharmacist", status: "Active", position: "Superintendent Pharmacist", staffId: "HVP-004", phone: "+233 20 555 0198", department: "Main dispensary", regNo: "PSGH/PH/04417", joined: "2022-01-10", lastLogin: addDays(t, -1) + "T18:05", photo: "", bio: "Responsible pharmacist on duty. Signs off write-offs and controlled-drug counts." },
    { id: "u3", name: "Efua Owusu", email: "efua@harbourview.example", role: "Dispenser", status: "Active", position: "Dispensing Technician", staffId: "HVP-009", phone: "+233 27 555 0311", department: "Main dispensary", regNo: "", joined: "2023-08-01", lastLogin: t + "T08:15", photo: "", bio: "Front counter and dispensing. Receives deliveries on Tuesdays and Fridays." },
    { id: "u4", name: "Yaw Boateng", email: "yaw@harbourview.example", role: "Dispenser", status: "Invited", position: "Dispensing Assistant", staffId: "HVP-012", phone: "+233 55 555 0420", department: "Back store", regNo: "", joined: addDays(t, -3), lastLogin: "", photo: "", bio: "" },
  ];
}

export const PERMISSIONS: [Permission, string][] = [
  ["view_inventory", "View inventory"],
  ["edit_inventory", "Add & edit stock"],
  ["delete_inventory", "Delete stock records"],
  ["import", "Import CSV / Excel"],
  ["dispense", "Dispense (FEFO)"],
  ["view_insights", "AI insights & reports"],
  ["view_finance", "Costs & margins"],
  ["manage_alerts", "Alert settings"],
  ["manage_users", "Users & roles"],
  ["company", "Pharmacy details"],
];

export function seedRoles(): Role[] {
  return [
    { name: "Admin", summary: "Full access to every feature", perms: PERMISSIONS.map((p) => p[0]), locked: true },
    { name: "Pharmacist", summary: "Manages stock, dispenses and reads reports", perms: ["view_inventory", "edit_inventory", "import", "dispense", "view_insights", "view_finance", "manage_alerts"] },
    { name: "Dispenser", summary: "Views stock, dispenses and clears alerts", perms: ["view_inventory", "dispense"] },
  ];
}

export const PHARMACY = { name: "Harbour View Pharmacy", location: "Tema, Ghana", licence: "PC/RP/1187/26" };
