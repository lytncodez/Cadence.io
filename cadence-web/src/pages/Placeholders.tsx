import { LuSparkles, LuBell, LuArrowRight, LuUsers } from "react-icons/lu";
import { AppShell } from "@/components/layout/AppShell";
import { Avatar, Card, CardHeader, buttonClass } from "@/components/ui/primitives";
import { Link } from "@/lib/router";
import { useStore } from "@/lib/api";
import { cn, fmtStamp } from "@/lib/utils";

/* Pages scheduled for Phase 3. Shown as designed previews rather than blanks. */
export function ComingSoon({ kind }: { kind: "insights" | "alerts" }) {
  const meta = kind === "insights"
    ? { title: "AI Insights", icon: LuSparkles, line: "Streaming answers, report cards and real charts, built on the analytics engine.", points: ["Ask questions in plain English", "Monthly report, losses and margins in one tap", "Every number comes from your records"] }
    : { title: "Alerts", icon: LuBell, line: "A timeline of expiry and stock alerts, with SMS and email delivery status.", points: ["Morning SMS to +233 numbers", "Daily email digest", "Mark as read, snooze or assign"] };
  return (
    <AppShell title={meta.title}>
      <Card className="relative overflow-hidden">
        <div className="hex-lattice-ink absolute inset-0" />
        <div className="relative mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
          <span className="hex-clip grid size-16 place-items-center bg-brand text-on-brand"><meta.icon className="size-7" /></span>
          <p className="mt-6 text-xs font-semibold tracking-[.16em] text-brand-ink uppercase">Arriving in Phase 3</p>
          <h2 className="mt-2 font-display text-3xl font-bold">{meta.title} is being rebuilt</h2>
          <p className="mt-3 text-[15px] text-muted">{meta.line}</p>
          <ul className="mt-6 grid gap-2 text-left text-sm">
            {meta.points.map((p) => <li key={p} className="flex items-center gap-2.5"><span className="size-1.5 rounded-full bg-brand" />{p}</li>)}
          </ul>
          <Link to="/app" className={cn(buttonClass({ variant: "primary" }), "mt-8")}>Back to overview<LuArrowRight /></Link>
        </div>
      </Card>
    </AppShell>
  );
}

/* Settings → Team (the rest of Settings follows in Phase 3). */
export function Team() {
  const users = useStore((s) => s.users);
  return (
    <AppShell title="Settings">
      <div className="mb-5">
        <h2 className="font-display text-[28px] font-bold">Team</h2>
        <p className="text-sm text-muted">Open anyone's profile to see their details or change their role. Pharmacy details, roles and expiry rules move here in Phase 3.</p>
      </div>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><LuUsers className="size-4" />{users.length} people</span>} />
        <ul className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
          {users.map((u, i) => (
            <li key={u.id} className="animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
              <Link to={`/app/profile/${u.id}`} className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-line p-5 text-center transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card">
                <Avatar name={u.name} photo={u.photo} size={64} />
                <div><p className="font-semibold">{u.name}</p><p className="text-xs text-muted">{u.position}</p></div>
                <div className="flex gap-1.5">
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">{u.role}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", u.status === "Active" ? "bg-safe-soft text-safe-ink" : "bg-soon-soft text-soon-ink")}>{u.status}</span>
                </div>
                <p className="mt-auto text-[11px] text-muted">Last sign-in: {fmtStamp(u.lastLogin)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
