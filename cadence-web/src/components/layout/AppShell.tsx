import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Menu, MenuButton, MenuItem, MenuItems, Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import {
  LuHouse, LuPackage, LuSparkles, LuBell, LuSettings, LuSearch, LuPanelLeftClose, LuPanelLeftOpen, LuSun, LuMoon, LuMonitor,
  LuLogOut, LuUser, LuChevronsUpDown, LuStore, LuShieldCheck, LuArrowRight,
} from "react-icons/lu";
import type { IconType } from "react-icons";
import { Link, navigate, usePath } from "@/lib/router";
import { auth, useCan, useCurrentUser, useStore } from "@/lib/api";
import { summarize } from "@/lib/analytics";
import { useHotkey } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import { cn, relDays, storage } from "@/lib/utils";
import type { Permission } from "@/lib/types";
import { Avatar, Button, Kbd, Logo, StatusPill } from "@/components/ui/primitives";
import { CommandPalette } from "./CommandPalette";
import { AddStockDialog } from "@/components/AddStockDialog";

interface NavItem { to: string; label: string; icon: IconType; perm?: Permission; match: (p: string) => boolean }
const NAV: NavItem[] = [
  { to: "/app", label: "Overview", icon: LuHouse, match: (p) => p === "/app" },
  { to: "/app/inventory", label: "Inventory", icon: LuPackage, match: (p) => p.startsWith("/app/inventory") },
  { to: "/app/insights", label: "AI Insights", icon: LuSparkles, perm: "view_insights", match: (p) => p.startsWith("/app/insights") },
  { to: "/app/alerts", label: "Alerts", icon: LuBell, match: (p) => p.startsWith("/app/alerts") },
  { to: "/app/settings", label: "Settings", icon: LuSettings, match: (p) => p.startsWith("/app/settings") },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const path = usePath();
  const can = useCan();
  const [collapsed, setCollapsed] = useState(() => storage.get("sidebar.collapsed", false));
  const [cmdOpen, setCmdOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const items = useStore((s) => s.items);
  const monthly = useStore((s) => s.monthly);
  const thresholds = useStore((s) => s.thresholds);
  const pharmacy = useStore((s) => s.pharmacy);
  const urgent = useMemo(() => summarize(items, monthly, thresholds).rows.filter((r) => r.status === "expired" || r.status === "critical"), [items, monthly, thresholds]);

  useEffect(() => storage.set("sidebar.collapsed", collapsed), [collapsed]);
  useEffect(() => { document.title = `${title} · Cadence.io`; }, [title]);
  useHotkey("k", () => setCmdOpen(true), { meta: true });
  useHotkey("/app", () => setCmdOpen(true));
  useHotkey("n", () => can("edit_inventory") && setAddOpen(true));

  const nav = NAV.filter((n) => !n.perm || can(n.perm));

  return (
    <div className="min-h-full bg-bg">
      {/* Sidebar */}
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface/70 backdrop-blur-xl transition-[width] duration-300 md:flex", collapsed ? "w-[76px]" : "w-[248px]")}>
        <div className={cn("flex h-16 items-center px-5", collapsed && "justify-center px-0")}>
          <Link to="/app" aria-label="Overview"><Logo withText={!collapsed} /></Link>
        </div>

        <div className={cn("px-3", collapsed && "px-2")}>
          <div className={cn("flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 p-2", collapsed && "justify-center")}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"><LuStore className="size-4" /></span>
            {!collapsed && <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{pharmacy.name}</span><span className="block truncate text-[11px] text-muted">{pharmacy.location}</span></span>}
          </div>
        </div>

        <nav className={cn("mt-5 flex flex-col gap-1 px-3", collapsed && "px-2")} aria-label="Main">
          {!collapsed && <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Workspace</p>}
          {nav.map((n) => {
            const on = n.match(path);
            return (
              <Link key={n.to} to={n.to} title={collapsed ? n.label : undefined} aria-current={on ? "page" : undefined}
                className={cn("group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-ink-2 transition hover:bg-sunken hover:text-ink", collapsed && "justify-center px-0", on && "bg-brand-soft text-brand-ink hover:bg-brand-soft hover:text-brand-ink")}>
                {on && <span className="absolute top-2 bottom-2 -left-3 w-1 rounded-r-full bg-brand" />}
                <n.icon className="size-[18px] shrink-0" />
                {!collapsed && <span className="flex-1">{n.label}</span>}
                {n.to === "/app/alerts" && urgent.length > 0 && (
                  <span className={cn("grid h-5 min-w-5 place-items-center rounded-full bg-critical px-1.5 text-[11px] font-semibold text-white tabular", collapsed && "absolute top-1 right-2 h-4 min-w-4 px-1 text-[10px]")}>{urgent.length}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className={cn("mt-auto flex flex-col gap-3 p-3", collapsed && "p-2")}>
          {!collapsed && (
            <button onClick={() => setCmdOpen(true)} className="flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-left text-[13px] text-muted transition hover:border-brand hover:text-ink">
              <LuSearch className="size-4" /><span className="flex-1">Quick search</span><Kbd>⌘K</Kbd>
            </button>
          )}
          <UserMenu collapsed={collapsed} theme={theme} setTheme={setTheme} />
          <Button variant="ghost" size="sm" onClick={() => setCollapsed((c) => !c)} className={cn("justify-start text-muted", collapsed && "justify-center")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <LuPanelLeftOpen /> : <><LuPanelLeftClose />Collapse</>}
          </Button>
        </div>
      </aside>

      {/* Main column */}
      <div className={cn("transition-[padding] duration-300", collapsed ? "md:pl-[76px]" : "md:pl-[248px]")}>
        <header className="glass sticky top-0 z-20 border-b border-line/70 pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 md:px-8">
            <span className="md:hidden"><Logo withText={false} /></span>
            <h1 className="min-w-0 truncate font-display text-lg font-semibold">{title}</h1>
            <button onClick={() => setCmdOpen(true)} className="ml-auto hidden h-10 w-72 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-muted shadow-hair transition hover:border-line-strong lg:flex">
              <LuSearch className="size-4" /><span className="flex-1 text-left">Search batches or pages</span><Kbd>⌘K</Kbd>
            </button>
            <Button variant="ghost" size="icon" className="ml-auto lg:hidden" onClick={() => setCmdOpen(true)} aria-label="Search"><LuSearch /></Button>
            <Notifications urgent={urgent} />
            <span className="md:hidden"><UserMenu compact theme={theme} setTheme={setTheme} /></span>
          </div>
        </header>
        <main className="mx-auto max-w-[1320px] px-4 pt-6 pb-28 md:px-8 md:pb-12">{children}</main>
      </div>

      {/* Mobile tab bar */}
      <nav className="glass fixed inset-x-0 bottom-0 z-30 flex border-t border-line px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] md:hidden" aria-label="Main">
        {[...nav.slice(0, 4), { to: "/app/profile", label: "Me", icon: LuUser, match: (p: string) => p.startsWith("/app/profile") }].map((n) => {
          const on = n.match(path);
          return (
            <Link key={n.to} to={n.to} className={cn("relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium text-muted", on && "text-brand-ink")}>
              <n.icon className="size-5" />{n.label}
              {n.to === "/app/alerts" && urgent.length > 0 && <span className="absolute top-0.5 left-[calc(50%+4px)] grid h-4 min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] text-white">{urgent.length}</span>}
            </Link>
          );
        })}
      </nav>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onTheme={setTheme} onAddStock={() => setAddOpen(true)} />
      <AddStockDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function UserMenu({ collapsed, compact, theme, setTheme }: { collapsed?: boolean; compact?: boolean; theme: string; setTheme: (t: "light" | "dark" | "system") => void }) {
  const user = useCurrentUser()!;
  const themes = [["light", "Light", LuSun], ["dark", "Dark", LuMoon], ["system", "System", LuMonitor]] as const;
  return (
    <Menu>
      <MenuButton className={cn("flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition hover:bg-sunken data-open:bg-sunken", (collapsed || compact) && "w-auto justify-center")} aria-label="Account menu">
        <Avatar name={user.name} photo={user.photo} size={34} />
        {!collapsed && !compact && (
          <>
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-ink">{user.name}</span><span className="block truncate text-[11px] text-muted">{user.position}</span></span>
            <LuChevronsUpDown className="size-4 text-muted" />
          </>
        )}
      </MenuButton>
      <MenuItems transition anchor={compact ? "bottom end" : "top start"} className="z-50 w-64 origin-bottom rounded-2xl border border-line bg-surface p-1.5 shadow-float transition duration-150 [--anchor-gap:8px] focus:outline-none data-closed:scale-95 data-closed:opacity-0">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar name={user.name} photo={user.photo} size={38} />
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{user.name}</p><p className="truncate text-xs text-muted">{user.email}</p></div>
        </div>
        <div className="mx-3 mb-1.5 flex items-center gap-1.5 rounded-lg bg-brand-soft px-2 py-1 text-[11px] font-semibold text-brand-ink"><LuShieldCheck className="size-3.5" />{user.role} · {user.position}</div>
        <MenuItem><button onClick={() => navigate("/app/profile")} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm data-focus:bg-sunken"><LuUser className="size-4 text-muted" />View profile</button></MenuItem>
        <div className="my-1 h-px bg-line" />
        <p className="px-3 pt-1 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Theme</p>
        <div className="mx-2 mb-1 grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1">
          {themes.map(([k, l, I]) => (
            <button key={k} onClick={() => setTheme(k)} className={cn("flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-ink-2", theme === k && "bg-surface text-ink shadow-hair")}><I className="size-3.5" />{l}</button>
          ))}
        </div>
        <div className="my-1 h-px bg-line" />
        <MenuItem><button onClick={() => { auth.logout(); navigate("/login", { replace: true }); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-critical-ink data-focus:bg-critical-soft"><LuLogOut className="size-4" />Log out</button></MenuItem>
      </MenuItems>
    </Menu>
  );
}

function Notifications({ urgent }: { urgent: ReturnType<typeof summarize>["rows"] }) {
  return (
    <Popover className="relative">
      <PopoverButton className="relative grid size-10 place-items-center rounded-xl text-ink-2 transition hover:bg-sunken data-open:bg-sunken" aria-label={`Notifications, ${urgent.length} urgent`}>
        <LuBell className="size-[18px]" />
        {urgent.length > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-critical ring-2 ring-surface" />}
      </PopoverButton>
      <PopoverPanel transition anchor="bottom end" className="z-50 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-line bg-surface shadow-float transition duration-150 [--anchor-gap:8px] data-closed:translate-y-1 data-closed:opacity-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-display font-semibold">Needs attention</p>
          <span className="text-xs text-muted">{urgent.length} batches</span>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {urgent.slice(0, 8).map((b) => (
            <li key={b.id}>
              <Link to={`/app/inventory?batch=${b.id}`} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-sunken">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", b.status === "expired" ? "bg-expired" : "bg-critical")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{b.name}</span>
                  <span className="block text-xs text-muted"><span className="font-mono">{b.batch}</span> · {relDays(b.days)} · {b.qty} units</span>
                </span>
                <StatusPill status={b.status} short />
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/app/alerts" className="flex items-center justify-center gap-1.5 border-t border-line py-3 text-sm font-medium text-brand-ink hover:bg-sunken rounded-b-2xl">See all alerts<LuArrowRight className="size-4" /></Link>
      </PopoverPanel>
    </Popover>
  );
}
