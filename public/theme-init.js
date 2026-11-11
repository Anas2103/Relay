// Runs before the app loads so the right theme is shown immediately (no white flash).
(function () {
  var colors = {
    indigo: "#4f46e5", violet: "#7c3aed", pink: "#db2777", rose: "#e11d48", orange: "#c2410c",
    emerald: "#047857", teal: "#0f766e", sky: "#0369a1", slate: "#334155",
  };
  var saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("relay:appearance") || "{}");
  } catch (e) {}
  var theme = saved.theme || "system";
  var dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  if (dark) root.classList.add("dark");
  root.style.colorScheme = dark ? "dark" : "light";
  root.style.setProperty("--bubble", colors[saved.bubbleColor] || colors.indigo);
})();
