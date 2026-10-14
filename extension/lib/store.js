// Browser-only storage (chrome.storage.local): settings, known senders, "This is safe"
// corrections and the 24-hour link verdict cache. Senders and links are stored as hashes.
(function () {
  "use strict";
  if (self.PurrStore) return;

  const DAY = 24 * 60 * 60 * 1000;
  const GREENS_TO_KNOWN = 3;

  function defaultLang() {
    const ui = (chrome.i18n.getUILanguage() || "en").toLowerCase();
    if (ui.startsWith("hi")) return "hi";
    if (ui.startsWith("ja")) return "ja";
    if (ui.startsWith("zh")) return "zh_CN";
    return "en";
  }

  const DEFAULT_SETTINGS = {
    onboarded: false,
    country: "IN",
    uiLang: defaultLang(),
    mascot: "cat",
    voice: true,
    sensitivity: "normal",
    askBeforeSend: true, // show the masked request and wait for approval before every Gemini check
    cursorCat: false, // a small cat that follows the cursor on Gmail and WhatsApp Web
    catEverywhere: false, // ...and on all other websites, in manual mode (asks for Chrome's permission)
    modes: { gmail: "auto", whatsapp: "auto" },
    pausedSites: [], // hostnames where automatic checks are paused ("Pause on this site")
  };
  const DEFAULT_DATA = { knownSenders: [], greenCounts: {}, safeLinks: [], safeSenders: [], linkCache: {}, riskyOpenedAt: 0 };

  let state = null;
  const ready = chrome.storage.local.get({ settings: DEFAULT_SETTINGS, ...DEFAULT_DATA }).then((s) => {
    s.settings = { ...DEFAULT_SETTINGS, ...s.settings, modes: { ...DEFAULT_SETTINGS.modes, ...(s.settings.modes || {}) } };
    s.settings.mascot = "cat"; // only the orange cat is used
    chrome.storage.local.remove("recentChecks"); // no longer kept (removed feature)
    state = s;
    return state;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !state) return;
    for (const [k, v] of Object.entries(changes)) state[k] = v.newValue === undefined ? DEFAULT_DATA[k] : v.newValue;
  });

  function save(patch) {
    Object.assign(state, patch);
    return chrome.storage.local.set(patch);
  }

  async function hash(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text).toLowerCase().trim()));
    return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  self.PurrStore = {
    ready,
    hash,
    DEFAULT_SETTINGS,
    get settings() { return state.settings; },
    saveSettings(patch) { return save({ settings: { ...state.settings, ...patch } }); },

    isKnown: (h) => state.knownSenders.includes(h),
    trust(h) {
      if (!h || state.knownSenders.includes(h)) return Promise.resolve();
      return save({ knownSenders: [...state.knownSenders, h] });
    },
    // A sender becomes known after 3 green messages in a row.
    recordGreen(h) {
      const n = (state.greenCounts[h] || 0) + 1;
      if (n >= GREENS_TO_KNOWN) {
        const { [h]: _, ...rest } = state.greenCounts;
        return save({ greenCounts: rest, knownSenders: state.knownSenders.includes(h) ? state.knownSenders : [...state.knownSenders, h] });
      }
      return save({ greenCounts: { ...state.greenCounts, [h]: n } });
    },
    resetGreen(h) {
      if (!state.greenCounts[h]) return Promise.resolve();
      const { [h]: _, ...rest } = state.greenCounts;
      return save({ greenCounts: rest });
    },

    isSafeLink: (h) => state.safeLinks.includes(h),
    isSafeSender: (h) => state.safeSenders.includes(h),
    markSafe(linkHashes, senderHash) {
      const links = [...new Set([...state.safeLinks, ...linkHashes])];
      const senders = senderHash && !state.safeSenders.includes(senderHash) ? [...state.safeSenders, senderHash] : state.safeSenders;
      return save({ safeLinks: links, safeSenders: senders });
    },

    cachedLink(h) {
      const c = state.linkCache[h];
      return c && Date.now() - c.ts < DAY ? c : null;
    },
    cacheLinks(hashes, result) {
      const now = Date.now();
      const cache = Object.fromEntries(Object.entries(state.linkCache).filter(([, v]) => now - v.ts < DAY));
      for (const h of hashes) cache[h] = { ts: now, result };
      return save({ linkCache: cache });
    },

    get riskyOpenedAt() { return state.riskyOpenedAt; },
    setRiskyOpened() { return save({ riskyOpenedAt: Date.now() }); },

    isPaused: (host) => (state.settings.pausedSites || []).includes(host),
    setPaused(host, paused) {
      const list = (state.settings.pausedSites || []).filter((h) => h !== host);
      return save({ settings: { ...state.settings, pausedSites: paused ? [...list, host] : list } });
    },

    clearData() { return save({ ...DEFAULT_DATA }); },
    // Keeps onboarding done and the chosen language; everything else back to the defaults.
    resetSettings() {
      return save({ settings: { ...DEFAULT_SETTINGS, onboarded: state.settings.onboarded, uiLang: state.settings.uiLang } });
    },
  };
})();
