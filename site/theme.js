(() => {
  let theme;
  try {
    theme = localStorage.getItem("cliplink-theme");
  } catch {
    // System preference still works when storage is unavailable.
  }
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
})();
