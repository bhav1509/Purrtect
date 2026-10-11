// Web checker. Uses the same rules and UI as the extension. Every scan goes to the backend,
// because the person chose to check it. Firebase Hosting rewrites /api/** to Cloud Run.
// Local development: open index.html?api=http://localhost:8080
(async function () {
  "use strict";

  const API = new URLSearchParams(location.search).get("api") || "";
  const COUNTRIES = ["IN", "SG", "AU", "ID", "PH", "JP"];
  const PETS = ["cat", "dog", "bird"];
  const $ = (id) => document.getElementById(id);

  function stored(key, fallback, allowed) {
    try {
      const v = localStorage.getItem("purr-" + key);
      return allowed.includes(v) ? v : fallback;
    } catch (_) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem("purr-" + key, value); } catch (_) { /* storage blocked */ }
  }

  function browserLang() {
    const l = (navigator.language || "en").toLowerCase();
    return l.startsWith("hi") ? "hi" : l.startsWith("ja") ? "ja" : l.startsWith("zh") ? "zh_CN" : "en";
  }

  const settings = {
    uiLang: stored("lang", browserLang(), ["en", "hi", "ja", "zh_CN"]),
    mascot: stored("pet", "cat", PETS),
    country: stored("country", "IN", COUNTRIES),
    voice: true,
  };

  const loadMessages = (lang) => fetch(`_locales/${lang}/messages.json`).then((r) => r.json());
  const [rules, fallback] = await Promise.all([fetch("rules.json").then((r) => r.json()), loadMessages("en")]);

  async function api(path, body) {
    try {
      const res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch (_) {
      return { ok: false, status: 0, data: null };
    }
  }

  async function applyLanguage() {
    const messages = settings.uiLang === "en" ? fallback : await loadMessages(settings.uiLang);
    PurrUI.configure({ messages, fallback, settings, api, assetUrl: (p) => p });
    document.documentElement.lang = settings.uiLang.replace("_", "-");
    document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = PurrUI.t(n.dataset.i18n); });
    $("text").placeholder = PurrUI.t("web_text_placeholder");
    $("country").replaceChildren(...COUNTRIES.map((c) => PurrUI.el("option", { value: c }, PurrUI.t("country_" + c))));
    $("country").value = settings.country;
    renderPets();
  }

  function setMascot(state) {
    $("mascot").src = `mascots/${settings.mascot}/${state}.png`;
  }

  function renderPets() {
    $("pets").replaceChildren(...PETS.map((p) => PurrUI.el("button", {
      type: "button", class: "pet", "aria-pressed": String(settings.mascot === p), title: PurrUI.t("mascot_" + p),
      onclick: () => { settings.mascot = p; store("pet", p); renderPets(); setMascot("happy"); PurrUI.configure(PurrUI.env); },
    }, PurrUI.el("img", { src: `mascots/${p}/happy.png`, alt: "", width: 40, height: 40, class: "purr-mascot" }), PurrUI.t("mascot_" + p))));
  }

  // tabs
  let mode = "text";
  document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
    mode = tab.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== mode; });
  }));

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function showRecovery() {
    setMascot("careful");
    PurrUI.recoveryPanel({ container: $("recovery"), onCountry: (c) => { settings.country = c; store("country", c); $("country").value = c; } });
    $("recovery").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function check(text, link, imageFile) {
    const err = $("formError");
    err.hidden = true;
    if (!text.trim() && !link.trim() && !imageFile) {
      err.textContent = PurrUI.t("web_error");
      err.hidden = false;
      return;
    }
    $("recovery").replaceChildren();
    $("submit").disabled = true;
    setMascot("thinking");
    PurrUI.verdictCard({ pending: true }, { container: $("result") });
    $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });

    const local = PurrRules.scoreMessage({ text, links: link ? [link] : [], scanText: true, sender: { isNew: true } }, rules, "normal");
    const body = {
      text: PurrRules.mask(text),
      links: local.links.map((l) => PurrRules.mask(l.url)),
      image_base64: imageFile ? await readImage(imageFile) : null,
      sender: "new",
      source: "web",
      local_score: local.score,
      local_hits: local.hits,
      ui_lang: PurrUI.apiLang(),
      country: settings.country,
    };
    const res = await api("/api/scan", body);
    $("submit").disabled = false;

    if (!res.ok && imageFile) {
      setMascot("idle");
      $("result").replaceChildren(PurrUI.el("p", { class: "error" }, PurrUI.t("web_image_needs_ai")));
      return;
    }
    const result = res.ok ? PurrUI.resultFromApi(res.data, local) : PurrUI.resultFromLocal(local, true);
    setMascot({ green: "happy", yellow: "careful", red: "stop" }[result.level]);
    PurrUI.verdictCard(result, {
      container: $("result"),
      actions: [{ label: PurrUI.t("iClicked"), primary: true, onClick: showRecovery }],
    });
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const file = $("image").files[0];
    if (file && file.size > 4 * 1024 * 1024) {
      $("formError").textContent = PurrUI.t("web_image_label");
      $("formError").hidden = false;
      return;
    }
    check(mode === "text" ? $("text").value : "", mode === "link" ? $("link").value : "", mode === "image" ? file : null);
  });

  $("lang").addEventListener("change", async () => { settings.uiLang = $("lang").value; store("lang", settings.uiLang); await applyLanguage(); });
  $("country").addEventListener("change", () => { settings.country = $("country").value; store("country", settings.country); });

  $("lang").value = settings.uiLang;
  await applyLanguage();
  setMascot("idle");

  $("samples").replaceChildren(...self.PURR_SAMPLES.map((s) => PurrUI.el("button", {
    type: "button", class: "purr-btn sample",
    onclick: () => {
      document.querySelector('[data-tab="text"]').click();
      $("text").value = s.text;
      check(s.text, "", null);
    },
  }, s.label)));
})();
