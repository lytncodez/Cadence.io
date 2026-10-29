export type Status = "expired" | "critical" | "soon" | "safe";
export type RoleName = "Admin" | "Pharmacist" | "Dispenser" | (string & {});

export interface Item {
  id: string;
  name: string;
  category: string;
  barcode: string;
  batch: string;
  expiry: string; // YYYY-MM-DD
  qty: number;
  unitCost: number;
  unitPrice: number;
  supplier: string;
  soldThisMonth: number;
  reorderLevel: number;
}
export interface Batch extends Item { days: number; status: Status }

export interface User {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  status: "Active" | "Invited" | "Suspended";
  position: string;
  staffId: string;
  phone: string;
  department: string;
  regNo: string;
  joined: string;
  lastLogin: string;
  photo: string;
  bio: string;
}

export type Permission =
  | "view_inventory" | "edit_inventory" | "delete_inventory" | "import" | "dispense"
  | "view_insights" | "view_finance" | "manage_alerts" | "manage_users" | "company";

export interface Role { name: RoleName; summary: string; perms: Permission[]; locked?: boolean }

export interface Month { label: string; year: number; revenue: number; cost: number }

export interface Thresholds { criticalMax: number; soonMax: number }
