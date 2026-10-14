// PurrUI setup for extension pages (settings, scan window). Content scripts use content/site.js.
self.PurrPage = {
  async init() {
    await PurrStore.ready;
    await this.loadLocale();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) this.loadLocale().then(() => this.onChange && this.onChange());
    });
  },
  async loadLocale() {
    const get = (lang) => fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`)).then((r) => r.json());
    const s = PurrStore.settings;
    const [messages, fallback] = await Promise.all([get(s.uiLang), get("en")]);
    PurrUI.configure({
      messages, fallback, settings: s,
      assetUrl: (p) => chrome.runtime.getURL(p),
      api: (path, body) => chrome.runtime.sendMessage({ type: "api", path, body }),
    });
    document.documentElement.lang = s.uiLang.replace("_", "-");
    this.applyTheme();
    document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = PurrUI.t(n.dataset.i18n); });
  },
  // Appearance: Automatic follows the computer's light / dark setting; Light and Dark force one.
  applyTheme() {
    const pick = PurrStore.settings.theme || "auto";
    const dark = pick === "dark" || (pick === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.purrTheme = dark ? "dark" : "light";
    if (!this.watching) { this.watching = true; matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme()); }
  },
  onChange: null,
};
