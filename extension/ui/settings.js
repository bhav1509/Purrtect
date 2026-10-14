// Side panel: Settings (General / Where to check / Privacy), with "Pause on this site" when the
// current tab is Gmail or WhatsApp, and a footer pinned to the bottom.
// settings.html?welcome=1 is the first-run onboarding in a full tab: consent + settings + Start.
(async function () {
  "use strict";
  await PurrPage.init();
  const welcome = new URLSearchParams(location.search).has("welcome") && !PurrStore.settings.onboarded;
  const app = document.getElementById("app");
  document.body.classList.add(welcome ? "purr-welcome" : "purr-panel");
  const CONFIG = self.PURRTECT_CONFIG || {};
  const WEBSITE = CONFIG.webUrl || "https://project-1e762a2b-4a0e-4e91-981.web.app";
  const FEEDBACK = CONFIG.feedbackUrl || "https://github.com/bhav1509/Purrtect/issues";
  const SITES = { "mail.google.com": "gmail", "web.whatsapp.com": "whatsapp" };

  let view = "settings";    // "settings" | "privacy"
  let page = null;          // { host, site, stats } for the active tab
  let savedTimer = null;

  const { el } = PurrUI;
  const t = (k, subs) => PurrUI.t(k, subs);

  // ---------- small building blocks ----------
  const ICON = {
    info: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="5" r="0.95" fill="currentColor"/><rect x="7.3" y="7" width="1.4" height="4.6" rx="0.7" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
  };
  const svgButton = (icon, label, onClick, cls) => {
    const b = el("button", { type: "button", class: cls || "icon-btn", "aria-label": label, title: label });
    if (onClick) b.addEventListener("click", onClick);
    b.innerHTML = ICON[icon];
    return b;
  };

  // ⓘ: explanation on hover, keyboard focus, or tap.
  function info(text) {
    const tip = el("span", { class: "set-tip", role: "tooltip" }, text);
    const btn = svgButton("info", t("moreInfo"), null, "set-info");
    btn.removeAttribute("title");
    btn.setAttribute("aria-expanded", "false");
    const wrap = el("span", { class: "set-info-wrap" }, btn, tip);
    // Place the bubble under its row (or above it when there's no room below), across the row's width.
    const place = () => {
      const row = (wrap.closest(".set-row") || wrap).getBoundingClientRect();
      tip.style.left = `${Math.round(row.left)}px`;
      tip.style.width = `${Math.round(row.width)}px`;
      const h = tip.offsetHeight;
      const below = row.bottom - 4;
      tip.style.top = `${Math.round(below + h <= innerHeight - 8 ? below : Math.max(8, row.top - h + 4))}px`;
    };
    wrap.addEventListener("mouseenter", () => requestAnimationFrame(place));
    addEventListener("scroll", () => { if (wrap.matches(":hover, :focus-within, .open")) place(); }, true);   // follow its row
    wrap.addEventListener("focusin", () => requestAnimationFrame(place));
    btn.addEventListener("click", () => requestAnimationFrame(place));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !wrap.classList.contains("open");
      document.querySelectorAll(".set-info-wrap.open").forEach((w) => w.classList.remove("open"));
      wrap.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    });
    return wrap;
  }
  document.addEventListener("click", () => document.querySelectorAll(".set-info-wrap.open").forEach((w) => w.classList.remove("open")));

  const row = (label, control, infoText, stacked) => el("div", { class: "set-row" + (stacked ? " set-row-stack" : "") },
    el("div", { class: "set-label" }, label, infoText ? info(infoText) : null),
    el("div", { class: "set-control" }, control));

  const section = (title, ...rows) => el("section", { class: "set-section" },
    el("h2", { class: "set-heading" }, title), el("div", { class: "set-group" }, rows));

  const select = (label, values, current, name, onPick) => {
    const sel = el("select", { class: "set-select", "aria-label": label },
      values.map((v) => el("option", { value: v, selected: v === current }, name(v))));
    sel.addEventListener("change", () => onPick(sel.value));
    return el("span", { class: "set-select-wrap" }, sel);
  };

  const segmented = (label, values, current, name, onPick) => el("div", { class: "set-seg", role: "radiogroup", "aria-label": label },
    values.map((v) => el("button", { type: "button", role: "radio", "aria-checked": String(v === current), onclick: () => onPick(v) }, name(v))));

  const toggle = (label, on, onFlip) => el("button", {
    type: "button", role: "switch", class: "set-switch", "aria-checked": String(!!on), "aria-label": label, onclick: () => onFlip(!on),
  }, el("span", { class: "set-knob" }));

  // ---------- saving with a brief "✓ Saved" ----------
  let pendingToast = null;
  function save(patch) {
    pendingToast = t("saved");
    PurrStore.saveSettings(patch); // re-renders through PurrPage.onChange, which shows the toast
  }
  function flashSaved(text) {
    const toast = document.getElementById("saved");
    if (!toast) return;
    toast.textContent = "✓ " + text;
    toast.classList.add("show");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => toast.classList.remove("show"), 1400);
  }

  // ---------- the current page (Home) ----------
  async function loadPage() {
    let tab = null;
    try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (_) { /* no tab */ }
    let host = null;
    try { host = tab && tab.url ? new URL(tab.url).hostname : null; } catch (_) { /* chrome:// etc. */ }
    const site = SITES[host] || "other";
    let stats = null;
    if (tab && site !== "other") {
      try { stats = await chrome.tabs.sendMessage(tab.id, { type: "stats" }); } catch (_) { stats = null; }
    }
    page = { host, site, stats };
  }

  // ---------- settings ----------
  function pauseRow() {
    const p = page || { site: "other" };
    if (p.site === "other") return null;
    const label = t("pauseOn", [t("source_" + p.site)]);
    return row(label, toggle(label, PurrStore.isPaused(p.host), async (on) => {
      pendingToast = t("saved");
      await PurrStore.setPaused(p.host, on);
    }), t("info_pause"));
  }

  // "On all websites" needs Chrome's all-sites permission: asked for here (it must come straight
  // from the click), given back when switched off. background.js loads the cat on the sites.
  const ALL_SITES = ["https://*/*", "http://*/*"];
  async function setEverywhere(on) {
    if (on && !(await chrome.permissions.request({ origins: ALL_SITES }).catch(() => false))) return;
    if (!on) chrome.permissions.remove({ origins: ALL_SITES }).catch(() => {});
    save({ catEverywhere: on });
  }

  function settingsView() {
    const s = PurrStore.settings;
    const clear = el("button", { type: "button", class: "set-small-btn" }, t("clearShort"));
    clear.addEventListener("click", async () => { pendingToast = t("cleared"); await PurrStore.clearData(); flashSaved(t("cleared")); });
    return el("div", { class: "settings" },
      section(t("sec_general"),
        row(t("set_country"), select(t("set_country"), ["IN", "SG", "AU", "ID", "PH", "JP"], s.country, (v) => t("country_" + v), (v) => save({ country: v })), t("info_country")),
        row(t("set_language"), select(t("set_language"), ["en", "hi", "ja", "zh_CN"], s.uiLang, (v) => t("langName_" + v), (v) => save({ uiLang: v })), t("info_language")),
        row(t("set_voice"), toggle(t("set_voice"), s.voice !== false, (on) => save({ voice: on })), t("info_voice")),
        row(t("set_cursorCat"), toggle(t("set_cursorCat"), s.cursorCat === true, (on) => save({ cursorCat: on })), t("info_cursorCat")),
        s.cursorCat === true ? row(t("set_catEverywhere"), toggle(t("set_catEverywhere"), s.catEverywhere === true, setEverywhere), t("info_catEverywhere")) : null),
      section(t("sec_where"),
        pauseRow(),
        row(t("set_mode_gmail"), segmented(t("set_mode_gmail"), ["auto", "manual"], s.modes.gmail, (v) => t("mode_" + v), (v) => save({ modes: { ...s.modes, gmail: v } })), t("modeHelp")),
        row(t("set_mode_whatsapp"), segmented(t("set_mode_whatsapp"), ["auto", "manual"], s.modes.whatsapp, (v) => t("mode_" + v), (v) => save({ modes: { ...s.modes, whatsapp: v } })), t("modeHelp")),
        row(t("set_sensitivity"), segmented(t("set_sensitivity"), ["relaxed", "normal", "strict"], s.sensitivity, (v) => t("sensitivity_" + v), (v) => save({ sensitivity: v })), t("info_careful"), true)),
      section(t("sec_privacy"),
        row(t("askBeforeSwitch"), toggle(t("askBeforeSwitch"), s.askBeforeSend !== false, (on) => save({ askBeforeSend: on })), t("askBeforeHelp")),
        row(t("set_data"), clear, t("dataHelp"))));
  }

  function privacyView() {
    return el("div", { class: "privacy" },
      el("ul", { class: "privacy-list" }, ["consent_checked", "consent_sent", "consent_never", "consent_secrets"].map((k) => el("li", {}, t(k)))));
  }

  // ---------- frame: header, content, pinned footer ----------
  function header() {
    const brand = el("a", { class: "set-brand", href: WEBSITE, target: "_blank", rel: "noopener", title: t("openWebsite") },
      el("img", { src: chrome.runtime.getURL("brand/logo.png"), alt: "", width: 44, height: 44 }),
      el("span", { class: "brand-text" }, el("span", { class: "brand-name" }, "Purrtect"), el("span", { class: "set-tagline" }, t("tagline"))));
    if (welcome) return el("header", { class: "bar" }, brand);
    if (view === "settings") return el("header", { class: "bar" }, brand);
    return el("header", { class: "bar bar-sub" },
      svgButton("back", t("back"), () => go("settings")),
      el("h1", { class: "bar-title" }, t("privacyTitle")));
  }

  function footer() {
    const version = "v" + chrome.runtime.getManifest().version;
    return el("footer", { class: "foot" },
      el("nav", { class: "foot-links" },
        view === "settings"
          ? el("button", { type: "button", class: "foot-link", onclick: async () => { pendingToast = t("resetDone"); await PurrStore.resetSettings(); } }, t("resetDefaults"))
          : [el("span", { class: "foot-version" }, version), el("a", { href: WEBSITE, target: "_blank", rel: "noopener" }, t("footer_website"))],
        el("button", { type: "button", class: "foot-link", onclick: () => go("privacy") }, t("footer_privacy")),
        el("a", { href: FEEDBACK, target: "_blank", rel: "noopener" }, t("footer_feedback"))));
  }

  function render() {
    const content = welcome
      ? el("main", { class: "content" },
          el("section", { class: "purr-consent" }, el("h2", {}, t("consentTitle")),
            el("ul", {}, ["consent_checked", "consent_sent", "consent_never", "consent_secrets"].map((k) => el("li", {}, t(k))))),
          settingsView(),
          el("button", { type: "button", class: "purr-btn purr-btn-primary purr-wide",
            onclick: async () => { await PurrStore.saveSettings({ onboarded: true }); window.close(); } }, t("startProtecting")))
      : el("main", { class: "content" }, view === "settings" ? settingsView() : privacyView());
    const toast = el("div", { class: "saved", id: "saved", role: "status", "aria-live": "polite" });
    // replaceChildren() would print a null child as the text "null", so pass the parts through el().
    app.replaceChildren(...el("div", {}, header(), content, welcome ? null : footer(), toast).childNodes);
    if (pendingToast) { flashSaved(pendingToast); pendingToast = null; }
  }

  async function go(next) {
    view = next;
    if (view === "settings") await loadPage();
    render();
  }

  PurrPage.onChange = render;
  if (!welcome) {
    await loadPage();
    // Keep Home current as you switch tabs or as messages get checked.
    const refresh = async () => {
      if (view !== "settings" || document.querySelector(".set-info-wrap.open, .set-info-wrap:hover, select:focus")) return;
      const before = page && page.host;
      await loadPage();
      if ((page && page.host) !== before) render(); // only when you switch to another site
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === "complete") refresh(); });
    setInterval(refresh, 4000);
  }
  render();
})();
