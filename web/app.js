// Web checker. Uses the same rules and UI as the extension. Every scan goes to the backend,
// because the person chose to check it. Firebase Hosting rewrites /api/** to Cloud Run.
// Local development: open index.html?api=http://localhost:8080
(async function () {
  "use strict";

  const API = new URLSearchParams(location.search).get("api") || "";
  const COUNTRIES = ["IN", "SG", "AU", "ID", "PH", "JP"];
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
    mascot: "cat",
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

  let activeSample = null;

  async function applyLanguage() {
    const messages = settings.uiLang === "en" ? fallback : await loadMessages(settings.uiLang);
    PurrUI.configure({ messages, fallback, settings, api, assetUrl: (p) => p });
    document.documentElement.lang = settings.uiLang.replace("_", "-");
    document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = PurrUI.t(n.dataset.i18n); });
    document.querySelectorAll("[data-i18n-aria]").forEach((n) => n.setAttribute("aria-label", PurrUI.t(n.dataset.i18nAria)));
    $("text").placeholder = PurrUI.t("web_text_placeholder");
    $("country").replaceChildren(...COUNTRIES.map((c) => PurrUI.el("option", { value: c }, PurrUI.t("country_" + c))));
    $("country").value = settings.country;
    showSampleTag();
  }

  // ----- right panel: empty state or verdict; recovery opens as a popup -----
  function showPanel(which) {
    $("empty").hidden = which !== "empty";
    $("result").hidden = which !== "result";
  }

  function showRecovery() {
    PurrUI.stopSpeech();
    PurrUI.recoveryPanel({ container: $("recovery"), onCountry: (c) => { settings.country = c; store("country", c); $("country").value = c; } });
    $("recoveryDialog").showModal();
    $("recoveryDialog").scrollTop = 0;
  }

  // ----- tabs -----
  let mode = "text";
  function selectTab(name) {
    mode = name;
    document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  }
  document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));

  // ----- samples: show exactly which scam is being tested -----
  function showSampleTag() {
    const tag = $("sampleTag");
    tag.hidden = !activeSample;
    if (activeSample) tag.textContent = PurrUI.t("web_sample_testing", [activeSample.label]);
    document.querySelectorAll(".sample").forEach((b, i) => b.setAttribute("aria-pressed", String(self.PURR_SAMPLES[i] === activeSample)));
  }

  $("text").addEventListener("input", () => {
    if (activeSample && $("text").value !== activeSample.text) { activeSample = null; showSampleTag(); }
  });

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function check(text, link, imageFile) {
    const err = $("formError");
    err.hidden = true;
    if (!text.trim() && !link.trim() && !imageFile) {
      err.textContent = PurrUI.t("web_error");
      err.hidden = false;
      return;
    }
    $("submit").disabled = true;
    showPanel("result");
    PurrUI.verdictCard({ pending: true }, { container: $("result") });
    if (matchMedia("(max-width: 899px)").matches) $("result").scrollIntoView({ behavior: "smooth", block: "start" });

    const local = PurrRules.scoreMessage({ text, links: link ? [link] : [], scanText: true, sender: { isNew: true } }, rules, "normal");
    const res = await api("/api/scan", {
      text: PurrRules.mask(text),
      links: local.links.map((l) => PurrRules.mask(l.url)),
      image_base64: imageFile ? await readImage(imageFile) : null,
      sender: "new",
      source: "web",
      local_score: local.score,
      local_hits: local.hits,
      ui_lang: PurrUI.apiLang(),
      country: settings.country,
    });
    $("submit").disabled = false;

    if (!res.ok && imageFile) {
      $("result").replaceChildren(PurrUI.el("p", { class: "error" }, PurrUI.t("web_image_needs_ai")));
      return;
    }
    const result = res.ok ? PurrUI.resultFromApi(res.data, local) : PurrUI.resultFromLocal(local, true);
    PurrUI.verdictCard(result, {
      container: $("result"),
      actions: [{ label: PurrUI.t("iClicked"), primary: true, onClick: showRecovery }],
    });
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const file = $("image").files[0];
    if (mode === "image" && file && file.size > 4 * 1024 * 1024) {
      $("formError").textContent = PurrUI.t("web_image_label");
      $("formError").hidden = false;
      return;
    }
    check(mode === "text" ? $("text").value : "", mode === "link" ? $("link").value : "", mode === "image" ? file : null);
  });

  // ----- top bar -----
  $("lang").addEventListener("change", async () => {
    settings.uiLang = $("lang").value;
    store("lang", settings.uiLang);
    PurrUI.stopSpeech();
    await applyLanguage();
    showPanel("empty");
  });
  $("country").addEventListener("change", () => { settings.country = $("country").value; store("country", settings.country); });
  $("howInstall").addEventListener("click", () => $("installDialog").showModal());

  $("lang").value = settings.uiLang;
  $("samples").replaceChildren(...self.PURR_SAMPLES.map((s) => PurrUI.el("button", {
    type: "button", class: "sample", title: s.text, "aria-pressed": "false",
    onclick: () => {
      selectTab("text");
      activeSample = s;
      $("text").value = s.text;
      showSampleTag();
      check(s.text, "", null);
    },
  }, s.label)));
  await applyLanguage();
  showPanel("empty");
})();
