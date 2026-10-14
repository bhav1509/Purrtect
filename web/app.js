// Web checker with Gemini Pre-Flight Confirmation & Transparency Inspector.
// Masks all sensitive personal data in-browser (< 5 ms) before sending to Gemini.
(async function () {
  "use strict";

  const URL_API = new URLSearchParams(location.search).get("api");
  // Default to local backend if running on localhost; fallback to deployed Cloud Run
  let API = URL_API !== null ? URL_API : (location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://localhost:8080" : "");
  const DEPLOYED_FALLBACK_API = "https://purrtect-api-fzrq3bgblq-el.a.run.app";

  const COUNTRIES = ["IN", "SG", "AU", "ID", "PH", "JP"];
  const $ = (id) => document.getElementById(id);

  function stored(key, fallback, allowed) {
    try {
      const v = localStorage.getItem("purr-" + key);
      return allowed ? (allowed.includes(v) ? v : fallback) : (v !== null ? v : fallback);
    } catch (_) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem("purr-" + key, value); } catch (_) { /* storage blocked */ }
  }

  // --- detectCountry: same code in extension/lib/store.js and web/app.js (tests check they match) ---
  // The country Purrtect's helplines are for, guessed on this device only (no location permission,
  // nothing sent): first the computer's time zone, then the browser's region (e.g. "en-IN").
  // Anywhere else falls back to India.
  function detectCountry() {
    const SUPPORTED = ["IN", "SG", "AU", "ID", "PH", "JP"];
    const BY_ZONE = {
      "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Singapore": "SG", "Asia/Jakarta": "ID",
      "Asia/Pontianak": "ID", "Asia/Makassar": "ID", "Asia/Jayapura": "ID", "Asia/Manila": "PH", "Asia/Tokyo": "JP",
    };
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (BY_ZONE[zone]) return BY_ZONE[zone];
      if (zone.startsWith("Australia/")) return "AU";
    } catch (_) { /* no time zone available */ }
    const langs = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || [];
    for (const l of langs) {
      const region = String(l || "").split("-")[1];
      if (region && SUPPORTED.includes(region.toUpperCase())) return region.toUpperCase();
    }
    return "IN";
  }
  // --- end detectCountry ---

  const settings = {
    uiLang: stored("lang", "en", ["en", "hi", "ja", "zh_CN"]),          // English by default
    mascot: "cat",
    country: stored("country", detectCountry(), COUNTRIES),            // guessed on this device
    voice: true,
    confirmBeforeSend: stored("confirm-gemini", "true", ["true", "false"]) === "true",
  };

  const loadMessages = (lang) => fetch(`_locales/${lang}/messages.json`).then((r) => r.json());
  const [rules, fallback] = await Promise.all([fetch("rules.json").then((r) => r.json()), loadMessages("en")]);

  // Check health and fall back gracefully if local server is unreachable or AI is unavailable
  async function checkBackendHealth() {
    const statusPill = $("aiStatusPill");
    try {
      const res = await fetch((API || "") + "/health", { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const h = await res.json();
        if (h.ai_configured && !h.error) {
          if (statusPill) {
            statusPill.title = `Connected to ${h.model || "Gemini 3.5 Flash"}`;
            statusPill.querySelector(".status-label").textContent = h.model || "Gemini 3.5 Flash";
          }
          return;
        }
      }
    } catch (_) {}

    // If local was tried and failed or lacked AI credentials, check deployed fallback
    if (API !== DEPLOYED_FALLBACK_API) {
      try {
        const res2 = await fetch(DEPLOYED_FALLBACK_API + "/health", { signal: AbortSignal.timeout(3500) });
        if (res2.ok) {
          const h2 = await res2.json();
          if (h2.ai_configured) {
            API = DEPLOYED_FALLBACK_API;
            if (statusPill) {
              statusPill.title = `Connected to Cloud Run (${h2.model || "Gemini 3.5 Flash"})`;
              statusPill.querySelector(".status-label").textContent = h2.model || "Gemini 3.5 Flash";
            }
            return;
          }
        }
      } catch (_) {}
    }

    if (statusPill) {
      statusPill.title = "Local heuristic checks active";
      statusPill.querySelector(".status-label").textContent = "Local Protection";
      statusPill.classList.remove("connected");
    }
  }

  checkBackendHealth();

  async function api(path, body) {
    try {
      let targetApi = API || "";
      let res = await fetch(targetApi + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      // If local returns 503 (ai_unavailable) and we're not on deployed, attempt fallback
      if (!res.ok && targetApi !== DEPLOYED_FALLBACK_API && (res.status === 503 || res.status === 0)) {
        try {
          const fallbackRes = await fetch(DEPLOYED_FALLBACK_API + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          if (fallbackRes.ok) {
            API = DEPLOYED_FALLBACK_API;
            const data = await fallbackRes.json().catch(() => null);
            return { ok: true, status: fallbackRes.status, data };
          }
        } catch (_) {}
      }
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch (_) {
      // Network failure on local: attempt deployed API fallback
      if (API !== DEPLOYED_FALLBACK_API) {
        try {
          const fallbackRes = await fetch(DEPLOYED_FALLBACK_API + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const data = await fallbackRes.json().catch(() => null);
          if (fallbackRes.ok) API = DEPLOYED_FALLBACK_API;
          return { ok: fallbackRes.ok, status: fallbackRes.status, data };
        } catch (__) {}
      }
      return { ok: false, status: 0, data: null };
    }
  }

  let activeSample = null;
  let lastPayload = null;
  let lastResult = null;
  let lastLatencyMs = 0;

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

  function showPanel(which) {
    $("empty").hidden = which !== "empty";
    $("result").hidden = which !== "result";
    if (which === "empty") {
      $("geminiPayloadSection").hidden = true;
    }
  }

  function showRecovery() {
    PurrUI.stopSpeech();
    PurrUI.recoveryPanel({
      container: $("recovery"),
      onCountry: (c) => {
        settings.country = c;
        store("country", c);
        $("country").value = c;
        shareWithExtension();
      }
    });
    $("recoveryDialog").showModal();
    $("recoveryDialog").scrollTop = 0;
  }

  // ----- Tabs (Text / Link / Image) -----
  let mode = "text";
  function selectTab(name) {
    mode = name;
    document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  }
  document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));

  // ----- Character Count & Text Helpers -----
  function updateCharCount() {
    const len = $("text").value.length;
    $("charCount").textContent = `${len} char${len === 1 ? "" : "s"}`;
  }
  $("text").addEventListener("input", () => {
    updateCharCount();
    if (activeSample && $("text").value !== activeSample.text) {
      activeSample = null;
      showSampleTag();
    }
  });
  $("clearTextBtn").addEventListener("click", () => {
    $("text").value = "";
    activeSample = null;
    showSampleTag();
    updateCharCount();
    $("text").focus();
  });

  // ----- Image Drag & Drop Handling -----
  let currentImageFile = null;
  const dropZone = $("dropZone");
  const fileInput = $("image");
  const previewWrap = $("imagePreviewWrap");
  const imageThumb = $("imageThumb");
  const fileNameEl = $("imageFileName");
  const fileSizeEl = $("imageFileSize");

  function handleImageSelected(file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      $("formError").textContent = PurrUI.t("web_image_label");
      $("formError").hidden = false;
      return;
    }
    $("formError").hidden = true;
    currentImageFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    const reader = new FileReader();
    reader.onload = (e) => {
      imageThumb.src = e.target.result;
      previewWrap.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) handleImageSelected(e.target.files[0]);
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImageSelected(e.dataTransfer.files[0]);
    }
  });
  $("removeImageBtn").addEventListener("click", () => {
    currentImageFile = null;
    fileInput.value = "";
    imageThumb.src = "";
    previewWrap.hidden = true;
  });

  // ----- Samples -----
  function showSampleTag() {
    const tag = $("sampleTag");
    tag.hidden = !activeSample;
    if (activeSample) tag.textContent = PurrUI.t("web_sample_testing", [activeSample.label]);
    document.querySelectorAll(".sample").forEach((b, i) => b.setAttribute("aria-pressed", String(self.PURR_SAMPLES[i] === activeSample)));
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Format masked tokens with highlight badge tokens
  function formatMaskedHtml(text) {
    if (!text) return "";
    const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escaped = escape(text);
    return escaped.replace(/\[(PHONE|EMAIL|CARD|ACCOUNT|ID|OTP)\]/g, '<span class="mask-token">[$1]</span>');
  }

  function countMaskTokens(text) {
    if (!text) return 0;
    const matches = text.match(/\[(PHONE|EMAIL|CARD|ACCOUNT|ID|OTP)\]/g);
    return matches ? matches.length : 0;
  }

  // Synchronize confirmation preference
  const confirmToggle = $("confirmToggle");
  const modalConfirmRemember = $("modalConfirmRemember");

  function updateConfirmPreference(val) {
    settings.confirmBeforeSend = !!val;
    store("confirm-gemini", String(settings.confirmBeforeSend));
    confirmToggle.checked = settings.confirmBeforeSend;
    modalConfirmRemember.checked = settings.confirmBeforeSend;
  }

  confirmToggle.addEventListener("change", (e) => updateConfirmPreference(e.target.checked));
  modalConfirmRemember.addEventListener("change", (e) => updateConfirmPreference(e.target.checked));
  updateConfirmPreference(settings.confirmBeforeSend);

  // ----- Pre-Flight Confirmation Modal Flow -----
  let pendingScanAction = null;

  async function initiateCheck(text, link, imageFile) {
    const err = $("formError");
    err.hidden = true;
    if (!text.trim() && !link.trim() && !imageFile) {
      err.textContent = PurrUI.t("web_error");
      err.hidden = false;
      return;
    }

    // 1. Run local rules and masking immediately in browser
    const local = PurrRules.scoreMessage({
      text,
      links: link ? [link] : [],
      scanText: true,
      sender: { isNew: true }
    }, rules, "normal");

    const maskedText = PurrRules.mask(text);
    const maskedLinks = local.links.map((l) => PurrRules.mask(l.url));
    const imageBase64 = imageFile ? await readImage(imageFile) : null;

    const payload = {
      text: maskedText,
      links: maskedLinks,
      image_base64: imageBase64,
      sender: "new",
      source: "web",
      local_score: local.score,
      local_hits: local.hits,
      ui_lang: PurrUI.apiLang(),
      country: settings.country,
    };

    // 2. If confirmation before sending to Gemini is enabled, show confirmation modal
    if (settings.confirmBeforeSend) {
      showConfirmationModal(payload, local, imageFile, () => {
        executeScan(payload, local, imageFile);
      });
    } else {
      executeScan(payload, local, imageFile);
    }
  }

  function showConfirmationModal(payload, local, imageFile, onConfirm) {
    pendingScanAction = onConfirm;

    // Display formatted masked text
    $("confirmPreviewText").innerHTML = formatMaskedHtml(payload.text) || "<em>(No text entered - link/screenshot check)</em>";
    const maskCount = countMaskTokens(payload.text);
    $("confirmMaskBadges").textContent = maskCount > 0 ? `${maskCount} personal detail${maskCount === 1 ? "" : "s"} masked` : "No raw identifiers found";

    // Display links if any
    const linksWrap = $("confirmPreviewLinksWrap");
    if (payload.links.length > 0) {
      linksWrap.hidden = false;
      $("confirmPreviewLinks").textContent = payload.links.join(", ");
    } else {
      linksWrap.hidden = true;
    }

    // Display image if attached
    const imageWrap = $("confirmPreviewImageWrap");
    if (imageFile) {
      imageWrap.hidden = false;
      $("confirmPreviewImage").textContent = `${imageFile.name} (${(imageFile.size / 1024).toFixed(1)} KB)`;
    } else {
      imageWrap.hidden = true;
    }

    // Metadata
    $("confirmPreviewScore").textContent = `${local.score} / 100`;
    $("confirmPreviewHits").textContent = local.hits.length ? local.hits.join(", ") : "none detected";
    $("confirmPreviewCountry").textContent = `${settings.country} (${PurrUI.t("country_" + settings.country)})`;

    $("confirmModal").showModal();
  }

  $("confirmSendBtn").addEventListener("click", () => {
    $("confirmModal").close();
    if (typeof pendingScanAction === "function") {
      const act = pendingScanAction;
      pendingScanAction = null;
      act();
    }
  });

  $("confirmCancelBtn").addEventListener("click", () => {
    $("confirmModal").close();
    pendingScanAction = null;
    if (mode === "text") $("text").focus();
  });

  // ----- Execution & "What Was Sent to Gemini" Inspector Rendering -----
  async function executeScan(payload, local, imageFile) {
    $("submit").disabled = true;
    const spinner = $("submit").querySelector(".btn-spinner");
    if (spinner) spinner.hidden = false;

    showPanel("result");
    PurrUI.verdictCard({ pending: true }, { container: $("result") });
    if (matchMedia("(max-width: 899px)").matches) {
      $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const startTime = performance.now();
    const res = await api("/api/scan", payload);
    const latencyMs = Math.round(performance.now() - startTime);

    $("submit").disabled = false;
    if (spinner) spinner.hidden = true;

    lastPayload = payload;
    lastResult = res.data;
    lastLatencyMs = latencyMs;

    if (!res.ok && imageFile) {
      $("result").replaceChildren(PurrUI.el("p", { class: "error" }, PurrUI.t("web_image_needs_ai")));
      return;
    }

    const result = res.ok ? PurrUI.resultFromApi(res.data, local) : PurrUI.resultFromLocal(local, true);
    PurrUI.verdictCard(result, {
      container: $("result"),
      actions: [{ label: PurrUI.t("iClicked"), primary: true, onClick: showRecovery }],
    });

    // Render "What was sent to Gemini" inspection console
    renderGeminiInspector(payload, local, res.data, latencyMs, imageFile);
  }

  function renderGeminiInspector(payload, local, apiResponse, latencyMs, imageFile) {
    const inspectorSection = $("geminiPayloadSection");
    inspectorSection.hidden = false;

    // Badges
    const latencyBadge = $("inspectLatencyBadge");
    latencyBadge.textContent = `${(latencyMs / 1000).toFixed(2)}s`;
    latencyBadge.hidden = false;

    // Visual Panel: Masked Text & Mask Count
    const maskedBox = $("inspectMaskedText");
    maskedBox.innerHTML = formatMaskedHtml(payload.text) || "<em>(None)</em>";
    const maskCount = countMaskTokens(payload.text);
    $("inspectMaskCount").textContent = `${maskCount} privacy mask${maskCount === 1 ? "" : "s"} applied`;

    // Visual Panel: Links
    const linksField = $("inspectLinksField");
    const linksList = $("inspectLinksList");
    if (payload.links.length > 0) {
      linksField.hidden = false;
      linksList.replaceChildren(...payload.links.map((l) => PurrUI.el("li", {}, l)));
    } else {
      linksField.hidden = true;
      linksList.replaceChildren();
    }

    // Visual Panel: Screenshot
    const imageField = $("inspectImageField");
    if (imageFile) {
      imageField.hidden = false;
      $("inspectImageMeta").textContent = `${imageFile.name} · ${(imageFile.size / 1024).toFixed(1)} KB · ${imageFile.type || "image"}`;
    } else {
      imageField.hidden = true;
    }

    // Visual Panel: Grid Signals
    $("inspectLocalScore").textContent = `${local.score} / 100`;
    const hitsContainer = $("inspectLocalHits");
    if (local.hits.length > 0) {
      hitsContainer.replaceChildren(...local.hits.map((h) => PurrUI.el("span", { class: "grid-tag-pill" }, h)));
    } else {
      hitsContainer.textContent = "None (normal)";
    }
    $("inspectCountry").textContent = `${payload.country} (${PurrUI.t("country_" + payload.country)})`;

    // Raw Request JSON Panel (Truncate image base64 if present so code stays legible)
    const cleanPayloadForDisplay = Object.assign({}, payload);
    if (cleanPayloadForDisplay.image_base64) {
      cleanPayloadForDisplay.image_base64 = `[Base64 image data: ${(cleanPayloadForDisplay.image_base64.length / 1024).toFixed(1)} KB]`;
    }
    $("rawRequestCode").textContent = JSON.stringify(cleanPayloadForDisplay, null, 2);

    // Raw Response JSON Panel
    $("rawResponseCode").textContent = JSON.stringify(apiResponse || { note: "Local client-side fallback used" }, null, 2);
  }

  // ----- Inspector Tab Switching -----
  document.querySelectorAll("[data-inspect-tab]").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      document.querySelectorAll("[data-inspect-tab]").forEach((b) => b.classList.remove("active"));
      tabBtn.classList.add("active");
      const target = tabBtn.dataset.inspectTab;
      $("inspectVisual").hidden = target !== "visual";
      $("inspectRawRequest").hidden = target !== "raw-request";
      $("inspectRawResponse").hidden = target !== "raw-response";
    });
  });

  // ----- Copy JSON Buttons -----
  function setupCopyButton(btnId, getCodeFn) {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const code = getCodeFn();
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        const originalText = btn.querySelector("span").textContent;
        btn.querySelector("span").textContent = "Copied!";
        setTimeout(() => { btn.querySelector("span").textContent = originalText; }, 2000);
      } catch (_) {}
    });
  }

  setupCopyButton("copyRequestBtn", () => $("rawRequestCode").textContent);
  setupCopyButton("copyResponseBtn", () => $("rawResponseCode").textContent);

  // ----- Form Submission -----
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const file = currentImageFile || $("image").files[0];
    if (mode === "image" && file && file.size > 4 * 1024 * 1024) {
      $("formError").textContent = PurrUI.t("web_image_label");
      $("formError").hidden = false;
      return;
    }
    initiateCheck(mode === "text" ? $("text").value : "", mode === "link" ? $("link").value : "", mode === "image" ? file : null);
  });

  // ----- Language and country: shared with the Purrtect extension, if it's installed -----
  // The extension lists this site under "externally_connectable", so the page can ask it for the
  // two settings and tell it about changes. Without the extension this does nothing.
  const EXTENSION_ID = "pohoamnapbegmpnhdkiimajhkhhaiaja";
  function askExtension(msg) {
    return new Promise((resolve) => {
      try {
        if (!(self.chrome && chrome.runtime && chrome.runtime.sendMessage)) return resolve(null);
        chrome.runtime.sendMessage(EXTENSION_ID, msg, (reply) => resolve(chrome.runtime.lastError ? null : reply));
      } catch (_) { resolve(null); }
    });
  }
  const shareWithExtension = () => askExtension({ type: "setPrefs", uiLang: settings.uiLang, country: settings.country });

  // ----- Top Bar Controls -----
  $("lang").addEventListener("change", async () => {
    settings.uiLang = $("lang").value;
    store("lang", settings.uiLang);
    shareWithExtension();
    PurrUI.stopSpeech();
    await applyLanguage();
    showPanel("empty");
  });
  $("country").addEventListener("change", () => {
    settings.country = $("country").value;
    store("country", settings.country);
    shareWithExtension();
  });
  $("howInstall").addEventListener("click", () => $("installDialog").showModal());

  $("lang").value = settings.uiLang;

  // ----- Initialize Sample Buttons -----
  $("samples").replaceChildren(...self.PURR_SAMPLES.map((s) => PurrUI.el("button", {
    type: "button",
    class: "sample",
    title: s.text,
    "aria-pressed": "false",
    onclick: () => {
      selectTab("text");
      activeSample = s;
      $("text").value = s.text;
      updateCharCount();
      showSampleTag();
      initiateCheck(s.text, "", null);
    },
  }, s.label)));

  // The extension's choice wins when the page opens (it is where most people set it).
  const fromExtension = await askExtension({ type: "getPrefs" });
  if (fromExtension) {
    if (["en", "hi", "ja", "zh_CN"].includes(fromExtension.uiLang)) { settings.uiLang = fromExtension.uiLang; store("lang", settings.uiLang); }
    if (COUNTRIES.includes(fromExtension.country)) { settings.country = fromExtension.country; store("country", settings.country); }
    $("lang").value = settings.uiLang;
  }

  await applyLanguage();
  updateCharCount();
  showPanel("empty");
})();
