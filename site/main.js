const themeButton = document.querySelector(".theme-toggle");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : systemTheme.matches;
}
function updateThemeLabel() {
  const dark = isDark();
  themeButton.dataset.themeState = dark ? "dark" : "light";
  themeButton.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
}
themeButton.hidden = false;
updateThemeLabel();
systemTheme.addEventListener("change", updateThemeLabel);
themeButton.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("cliplink-theme", next);
  } catch {
    /* Theme still applies for this visit. */
  }
  updateThemeLabel();
});

const examples = {
  link: {
    source: "developer.mozilla.org",
    title: "CSS: Cascading Style Sheets",
    body: "For the days when I know what a property does, but not quite what it’s called.",
    tag: "Link + your note",
    command: "clip https://developer.mozilla.org/en-US/docs/Web/CSS",
    url: "https://developer.mozilla.org/en-US/docs/Web/CSS",
  },
  note: {
    source: "A note to myself",
    title: "Leave a little room to wander",
    body: "The best thing I read today was three links away from the thing I was looking for.",
    tag: "A note in your collection",
    command: "clip - < note.md",
  },
};
const picker = document.querySelector(".example-picker");
const saveButton = document.querySelector("#save-example");
const sampleSheet = document.querySelector(".sample-sheet");
const demoStatus = document.querySelector("#demo-status");
picker.hidden = false;
saveButton.hidden = false;
picker.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-example]");
  if (!button || button.getAttribute("aria-pressed") === "true") return;
  const example = examples[button.dataset.example];
  picker
    .querySelectorAll("button")
    .forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  const title = document.querySelector("#sample-title");
  if (example.url) {
    const link = document.createElement("a");
    link.href = example.url;
    link.textContent = example.title;
    title.replaceChildren(link);
  } else {
    title.textContent = example.title;
  }
  document.querySelector("#sample-source").textContent = example.source;
  document.querySelector("#sample-body").textContent = example.body;
  document.querySelector("#sample-tag").textContent = example.tag;
  document.querySelector("#sample-command").textContent = example.command;
  sampleSheet.classList.remove("is-saved");
  saveButton.removeAttribute("aria-disabled");
  saveButton.querySelector("span").textContent = "Clip it";
  demoStatus.textContent = "";
});
saveButton.addEventListener("click", () => {
  if (saveButton.getAttribute("aria-disabled") === "true") return;
  sampleSheet.classList.add("is-saved");
  saveButton.setAttribute("aria-disabled", "true");
  saveButton.querySelector("span").textContent = "Clipped";
  demoStatus.textContent = "Added to this example.";
});

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.hidden = false;
  let reset;
  button.addEventListener("click", async () => {
    clearTimeout(reset);
    const code = button.parentElement.querySelector("code");
    const status = document.querySelector("#copy-status");
    try {
      await navigator.clipboard.writeText(code.textContent.trim());
      button.textContent = "Copied";
      status.textContent = "Commands copied to clipboard.";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "Select";
      status.textContent =
        "Copy is unavailable. The command is selected; press Control+C or Command+C to copy it.";
    }
    reset = setTimeout(() => {
      button.textContent = "Copy";
    }, 2000);
  });
});
