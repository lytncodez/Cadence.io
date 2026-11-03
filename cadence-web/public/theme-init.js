// Apply the saved theme and motion setting before first paint, so pages don't flash light-then-dark.
// Kept as a file (not inline) so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem("cadence.theme") || "system";
  var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  var p = JSON.parse(localStorage.getItem("cadence.prefs") || "{}");
  if (p.reduceMotion) document.documentElement.classList.add("reduce-motion");
} catch (e) {}
