/* ============================================================
   HTML Tools — shared theme handling (dark / light)
   Remembers the user's last choice in localStorage.
   Include this on every page. To avoid a flash of the wrong
   theme, also add the small inline snippet (see README) in <head>.
   ============================================================ */
(function () {
  var KEY = "html-tools-theme";

  function systemPref() {
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function current() {
    return localStorage.getItem(KEY) || systemPref();
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  // Apply as early as possible.
  apply(current());

  window.toggleTheme = function () {
    var next =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "light"
        : "dark";
    apply(next);
    localStorage.setItem(KEY, next);
  };

  // Wire up the toggle button once the DOM is ready.
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.querySelector("[data-theme-toggle]");
    if (btn) btn.addEventListener("click", window.toggleTheme);
  });
})();
