import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    try { return (localStorage.getItem("cadence.theme") as ThemeChoice) || "system"; } catch { return "system"; }
  });
  useEffect(() => {
    apply(choice);
    try { localStorage.setItem("cadence.theme", choice); } catch { /* ignore */ }
    if (choice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);
  return [choice, setChoice] as const;
}
