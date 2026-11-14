// Runs before the app loads so the right theme, colors, font and sizes show immediately (no flash).
// The values are computed and saved by src/lib/theme.ts.
(function () {
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("relay:appearance:v4") || "null");
  } catch (e) {}
  var theme = (saved && saved.theme) || "system";
  var dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  if (dark) root.classList.add("dark");
  root.style.colorScheme = dark ? "dark" : "light";
  if (saved) {
    root.setAttribute("data-light-theme", saved.lightTheme || "classic");
    root.setAttribute("data-dark-theme", saved.darkTheme || "classic");
    root.setAttribute("data-motion", saved.motion || "on");
    var vars = dark ? saved.dark : saved.light;
    for (var k in vars) root.style.setProperty(k, vars[k]);
  }
})();
