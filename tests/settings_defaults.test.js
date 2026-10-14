// Settings defaults and "Reset to defaults", without a browser.
// Runs extension/lib/store.js with a stand-in for chrome.storage, under different time zones and
// browser languages. Prints a JSON list of [ok, message] results.
// Run by tests/run_tests.py; on its own: node tests/settings_defaults.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const STORE_JS = fs.readFileSync(path.join(ROOT, "extension/lib/store.js"), "utf8");
const results = [];
const check = (ok, message) => results.push([!!ok, message]);

// Load store.js as a fresh install would see it: given time zone, browser languages and saved data.
async function loadStore({ zone = "UTC", langs = ["en-US"], saved = {} } = {}) {
  let data = JSON.parse(JSON.stringify(saved));
  const listeners = [];
  const chrome = {
    storage: {
      local: {
        get: async (defaults) => {
          const out = {};
          for (const [k, v] of Object.entries(defaults)) out[k] = k in data ? JSON.parse(JSON.stringify(data[k])) : v;
          return out;
        },
        set: async (patch) => {
          const changes = {};
          for (const [k, v] of Object.entries(patch)) { changes[k] = { newValue: v }; data[k] = JSON.parse(JSON.stringify(v)); }
          listeners.forEach((fn) => fn(changes, "local"));
        },
        remove: async () => {},
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    i18n: { getUILanguage: () => langs[0] },
  };
  const RealDTF = Intl.DateTimeFormat;
  const FakeIntl = { ...Intl, DateTimeFormat: function (...a) { const f = new RealDTF(...a); return { ...f, resolvedOptions: () => ({ ...f.resolvedOptions(), timeZone: zone }) }; } };
  const sandbox = { chrome, Intl: FakeIntl, navigator: { language: langs[0], languages: langs }, crypto: globalThis.crypto, TextEncoder, console };
  sandbox.self = sandbox;
  vm.runInNewContext(STORE_JS, sandbox);
  await sandbox.PurrStore.ready;
  return { store: sandbox.PurrStore, data: () => data };
}

(async () => {
  // --- 1. defaults on a fresh install -------------------------------------------------------------
  const cases = [
    ["Asia/Kolkata", ["en-US"], "IN"],
    ["Asia/Calcutta", ["en-US"], "IN"],
    ["Asia/Singapore", ["en-US"], "SG"],
    ["Australia/Sydney", ["en-US"], "AU"],
    ["Australia/Perth", ["en-AU"], "AU"],
    ["Asia/Jakarta", ["id-ID"], "ID"],
    ["Asia/Makassar", ["en-US"], "ID"],
    ["Asia/Manila", ["en-US"], "PH"],
    ["Asia/Tokyo", ["ja-JP"], "JP"],
    ["UTC", ["en-SG", "en"], "SG"],          // no known time zone: the browser's region decides
    ["Europe/London", ["en-GB"], "IN"],      // not a supported country: India
    ["America/New_York", ["en-US"], "IN"],
  ];
  for (const [zone, langs, want] of cases) {
    const { store } = await loadStore({ zone, langs });
    check(store.settings.country === want, `fresh install in ${zone} (${langs[0]}) -> country ${want} (got ${store.settings.country})`);
  }
  for (const langs of [["ja-JP"], ["hi-IN"], ["zh-CN"], ["en-US"]]) {
    const { store } = await loadStore({ zone: "Asia/Tokyo", langs });
    check(store.settings.uiLang === "en", `fresh install with browser in ${langs[0]} -> language English (got ${store.settings.uiLang})`);
  }
  {
    const { store } = await loadStore();
    const s = store.settings;
    check(s.voice === true && s.sensitivity === "normal" && s.askBeforeSend === true && s.cursorCat === false &&
      s.catEverywhere === false && s.modes.gmail === "manual" && s.modes.whatsapp === "manual" && s.enabled === true && s.onboarded === false && s.theme === "auto",
      "fresh install: on, Appearance Auto, voice on, Normal, ask before sending, cursor cat off, Manual on Gmail and WhatsApp");
  }

  // --- 2. saved choices win over the defaults ------------------------------------------------------
  {
    const { store } = await loadStore({ zone: "Asia/Tokyo", saved: { settings: { country: "SG", uiLang: "hi" } } });
    check(store.settings.country === "SG" && store.settings.uiLang === "hi", "saved country and language are kept (not re-detected)");
  }

  // --- 3. Reset to defaults ----------------------------------------------------------------------
  {
    const custom = {
      onboarded: true, uiLang: "hi", country: "JP", voice: false, sensitivity: "strict", askBeforeSend: false,
      cursorCat: true, catEverywhere: true, modes: { gmail: "auto", whatsapp: "auto" }, enabled: false, theme: "dark",
    };
    const yourData = { safeLinks: ["a1"], safeSenders: ["s1"], knownSenders: ["k1"], greenCounts: { k1: 2 }, linkCache: { a1: { ts: 1 } } };
    const { store, data } = await loadStore({ zone: "Asia/Singapore", saved: { settings: custom, ...yourData } });
    await store.resetSettings();
    const s = data().settings;
    check(s.voice === true, "reset: Voice back on");
    check(s.sensitivity === "normal", "reset: How careful back to Normal");
    check(s.askBeforeSend === true, "reset: Ask before sending back on");
    check(s.cursorCat === false && s.catEverywhere === false, "reset: Cursor cat and On all websites off");
    check(s.modes.gmail === "manual" && s.modes.whatsapp === "manual", "reset: Gmail and WhatsApp back to Manual");
    check(s.enabled === true, "reset: Purrtect switched back on");
    check(s.theme === "auto", "reset: Appearance back to Auto");
    check(s.country === "SG", `reset: country back to the detected one (Singapore here, got ${s.country})`);
    check(s.uiLang === "hi", "reset: keeps the chosen language");
    check(s.onboarded === true, "reset: welcome page stays done");
    const d = data();
    check(JSON.stringify([d.safeLinks, d.safeSenders, d.knownSenders, d.greenCounts, d.linkCache]) ===
      JSON.stringify([yourData.safeLinks, yourData.safeSenders, yourData.knownSenders, yourData.greenCounts, yourData.linkCache]),
      "reset: your data (trusted senders, \"This is safe\", saved link checks) is untouched");
    check(store.settings.voice === true && store.settings.uiLang === "hi", "reset: the open panel sees the new settings straight away");
  }

  // --- 4. the overall On / Off switch -----------------------------------------------------------
  {
    const { store, data } = await loadStore();
    check(store.enabled === true, "switch: on by default");
    await store.setEnabled(false);
    check(store.enabled === false && data().settings.enabled === false, "switch: turning it off is saved");
    await store.setEnabled(true);
    check(store.enabled === true && data().settings.enabled === true, "switch: turning it back on is saved");
    const old = await loadStore({ saved: { settings: { pausedSites: ["mail.google.com"] } } });
    check(old.store.enabled === true, "switch: an older install (per-site pause) starts switched on");
  }

  // --- 5. website and extension guess the country the same way -----------------------------------
  const block = (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const m = src.match(/\/\/ --- detectCountry:[\s\S]*?\/\/ --- end detectCountry ---/);
    return m ? m[0] : null;
  };
  const a = block("extension/lib/store.js"), b = block("web/app.js");
  check(a && b && a === b, "detectCountry() is the same in the extension and on the website");
  const webJs = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");
  check(/stored\("lang", "en"/.test(webJs) && /stored\("country", detectCountry\(\)/.test(webJs), "website defaults: English, detected country");

  process.stdout.write(JSON.stringify(results));
})().catch((e) => { process.stdout.write(JSON.stringify([[false, "settings_defaults.test.js crashed: " + e.message]])); });
