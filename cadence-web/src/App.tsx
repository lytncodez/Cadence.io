import { useEffect } from "react";
import { ToastProvider } from "@/components/ui/overlay";
import { HexLoader } from "@/components/ui/primitives";
import { match, navigate, usePath } from "@/lib/router";
import { api, auth, useCan, useCurrentUser, useStore } from "@/lib/api";
import Website from "@/pages/Website";
import Login from "@/pages/Login";
import Overview from "@/pages/Overview";
import Inventory from "@/pages/Inventory";
import Profile from "@/pages/Profile";
import Insights from "@/pages/Insights";
import Alerts from "@/pages/Alerts";
import Settings from "@/pages/Settings";

/*  /            public website
    /login       sign in
    /app/...     the dashboard (signed-in only)  */
export default function App() {
  return (
    <ToastProvider>
      <Routes />
    </ToastProvider>
  );
}

function Routes() {
  const path = usePath();
  const user = useCurrentUser();
  const ready = useStore((s) => s.ready);
  const can = useCan();
  const p = path.split("?")[0].replace(/\/+$/, "") || "/";
  const inApp = p === "/app" || p.startsWith("/app/");

  // Live mode: fetch the pharmacy's data after a page reload. A dead token sends you back to login.
  useEffect(() => {
    if (user && !ready) api.loadAll().catch(() => auth.logout());
  }, [user, ready]);

  useEffect(() => {
    if (!user && inApp) navigate("/login", { replace: true });
    if (user && p === "/login") navigate("/app", { replace: true });
  }, [user, p, inApp]);

  if (p === "/") return <Website />;
  if (p === "/login") return user ? null : <Login />;
  if (!inApp) return <Website />;
  if (!user) return null;
  if (!ready) return <HexLoader label="Loading your pharmacy" />;

  if (p === "/app") return <Overview />;
  if (p === "/app/inventory") return <Inventory />;
  if (p === "/app/insights") return can("view_insights") ? <Insights /> : <Overview />;
  if (p === "/app/alerts") return <Alerts />;
  if (p === "/app/settings") return <Settings />;
  if (p === "/app/profile") return <Profile />;
  const prof = match("/app/profile/:id", p);
  if (prof) return <Profile userId={prof.id} />;
  return <Overview />;
}
