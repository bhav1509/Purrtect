// Shared helpers for the UI pieces: settings, i18n, mascot images, element builder.
(function () {
  "use strict";
  if (self.PurrUI) return; // already injected into this tab

  const DEFAULTS = { mascot: "cat", country: "IN", lang: "auto", apiBase: "http://localhost:8000" };
  const MASCOTS = ["cat", "dog", "bird"];
  const STATE_IMAGE = { safe: "safe", suspicious: "suspicious", dangerous: "dangerous", checking: "checking", help: "help" };

  let settings = { ...DEFAULTS };
  chrome.storage.sync.get(DEFAULTS, (s) => { settings = s; });
  chrome.storage.onChanged.addListener((changes) => {
    for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
    document.querySelectorAll("img[data-purr-state]").forEach((img) => {
      img.src = mascotUrl(img.dataset.purrState);
    });
  });

  function t(key, subs) {
    return chrome.i18n.getMessage(key, subs) || key;
  }

  function lang() {
    if (settings.lang !== "auto") return settings.lang;
    const ui = chrome.i18n.getUILanguage();
    if (ui.startsWith("hi")) return "hi";
    if (ui.startsWith("ja")) return "ja";
    if (ui.startsWith("zh")) return "zh_CN";
    return "en";
  }

  function mascotUrl(state) {
    return chrome.runtime.getURL(`mascots/${settings.mascot}/${STATE_IMAGE[state] || "checking"}.png`);
  }

  function mascotImg(state, size) {
    const img = el("img", { class: "purr-mascot", alt: "", width: size, height: size });
    img.dataset.purrState = state;
    img.src = mascotUrl(state);
    return img;
  }

  // el("div", {class: "x", onclick: fn}, child, "text", ...)
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function send(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  self.PurrUI = {
    t, lang, el, send, mascotImg, MASCOTS,
    get settings() { return settings; },
    setSetting(key, value) { chrome.storage.sync.set({ [key]: value }); },
  };
})();
