// Runs before the app loads so the right theme and colors show immediately (no flash).
// The values are computed and saved by src/lib/theme.ts.
(function () {
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("relay:appearance:v2") || "null");
  } catch (e) {}
  var theme = (saved && saved.theme) || "system";
  var dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  if (dark) root.classList.add("dark");
  root.style.colorScheme = dark ? "dark" : "light";
  if (saved) {
    var vars = dark ? saved.dark : saved.light;
    for (var k in vars) root.style.setProperty(k, vars[k]);
    root.setAttribute("data-wallpaper", saved.wallpaper || "plain");
  }
})();
