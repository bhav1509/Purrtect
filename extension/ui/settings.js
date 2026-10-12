// Settings popup, and the first-run onboarding (settings.html?welcome=1).
(async function () {
  "use strict";
  await PurrPage.init();
  const welcome = new URLSearchParams(location.search).has("welcome") && !PurrStore.settings.onboarded;
  const app = document.getElementById("app");
  if (!welcome) document.body.classList.add("purr-popup");

  function radios(name, values, current, labelKey, onPick) {
    const { el, t } = PurrUI;
    return el("div", { class: "purr-choices", role: "radiogroup" }, values.map((v) => el("button", {
      type: "button", class: "purr-choice", "aria-pressed": String(v === current),
      onclick: () => onPick(v),
    }, typeof labelKey === "function" ? labelKey(v) : t(`${labelKey}_${v}`))));
  }

  function render() {
    const { el, t } = PurrUI;
    const s = PurrStore.settings;
    const set = (patch) => PurrStore.saveSettings(patch); // re-renders through PurrPage.onChange

    const mascots = el("div", { class: "purr-choices" }, ["cat", "dog", "bird"].map((m) => el("button", {
      type: "button", class: "purr-choice purr-mascot-choice", "aria-pressed": String(s.mascot === m),
      onclick: () => set({ mascot: m }),
    }, el("img", { src: chrome.runtime.getURL(`mascots/${m}/happy.png`), alt: "", width: 48, height: 48, class: "purr-mascot" }), t("mascot_" + m))));

    const clear = el("button", { type: "button", class: "purr-btn" }, t("clearData"));
    clear.addEventListener("click", async () => {
      await PurrStore.clearData();
      clear.textContent = t("cleared");
    });

    // replaceChildren() would print a null child as the text "null", so pass the parts through el().
    app.replaceChildren(...PurrUI.el("div", {},
      el("header", { class: "purr-page-head" },
        el("img", { src: chrome.runtime.getURL(`mascots/${s.mascot}/${welcome ? "happy" : "idle"}.png`), alt: "", width: 64, height: 64, class: "purr-mascot" }),
        el("div", {}, el("h1", {}, "Purrtect"), el("p", { class: "purr-note" }, t("tagline")))),
      welcome ? el("section", { class: "purr-consent" },
        el("h2", {}, t("consentTitle")),
        el("ul", {}, ["consent_checked", "consent_sent", "consent_never", "consent_secrets"].map((k) => el("li", {}, t(k))))) : null,
      el("h2", {}, t("set_country")),
      radios("country", ["IN", "SG", "AU", "ID", "PH", "JP"], s.country, "country", (v) => set({ country: v })),
      el("h2", {}, t("set_language")),
      radios("lang", ["en", "hi", "ja", "zh_CN"], s.uiLang, (v) => t("langName_" + v), (v) => set({ uiLang: v })),
      el("h2", {}, t("set_mascot")),
      mascots,
      el("h2", {}, t("set_voice")),
      radios("voice", ["on", "off"], s.voice ? "on" : "off", "voice", (v) => set({ voice: v === "on" })),
      el("h2", {}, t("set_mode_gmail")),
      radios("mode", ["auto", "manual"], s.modes.gmail, "mode", (v) => set({ modes: { ...s.modes, gmail: v } })),
      el("h2", {}, t("set_mode_whatsapp")),
      radios("mode", ["auto", "manual"], s.modes.whatsapp, "mode", (v) => set({ modes: { ...s.modes, whatsapp: v } })),
      el("p", { class: "purr-note" }, t("modeHelp")),
      el("h2", {}, t("set_sensitivity")),
      radios("sensitivity", ["relaxed", "normal", "strict"], s.sensitivity, "sensitivity", (v) => set({ sensitivity: v })),
      el("h2", {}, t("set_data")),
      el("p", { class: "purr-note" }, t("dataHelp")),
      clear,
      welcome ? el("button", { type: "button", class: "purr-btn purr-btn-primary purr-wide",
        onclick: async () => { await set({ onboarded: true }); window.close(); } }, t("startProtecting")) : null
    ).childNodes);
  }

  PurrPage.onChange = render;
  render();
})();
