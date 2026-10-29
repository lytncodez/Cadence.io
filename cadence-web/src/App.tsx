import { useEffect } from "react";
import { ToastProvider } from "@/components/ui/overlay";
import { HexLoader } from "@/components/ui/primitives";
import { match, navigate, usePath } from "@/lib/router";
import { useCan, useCurrentUser, useStore } from "@/lib/api";
import Login from "@/pages/Login";
import Overview from "@/pages/Overview";
import Inventory from "@/pages/Inventory";
import Profile from "@/pages/Profile";
import { ComingSoon, Team } from "@/pages/Placeholders";

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
  const p = path.split("?")[0];

  useEffect(() => {
    if (!user && p !== "/login") navigate("/login", { replace: true });
    if (user && p === "/login") navigate("/", { replace: true });
  }, [user, p]);

  if (!user) return p === "/login" ? <Login /> : null;
  if (!ready) return <HexLoader label="Loading your pharmacy" />;

  if (p === "/") return <Overview />;
  if (p === "/inventory") return <Inventory />;
  if (p === "/insights") return can("view_insights") ? <ComingSoon kind="insights" /> : <Overview />;
  if (p === "/alerts") return <ComingSoon kind="alerts" />;
  if (p === "/settings") return can("manage_users") ? <Team /> : <Overview />;
  if (p === "/profile") return <Profile />;
  const prof = match("/profile/:id", p);
  if (prof) return <Profile userId={prof.id} />;
  return <Overview />;
}
