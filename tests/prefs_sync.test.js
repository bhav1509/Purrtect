// Language / country sync between the website and the extension, without a browser.
// Loads extension/background.js with a stand-in for Chrome's APIs and talks to it the way the website
// does (chrome.runtime.sendMessage(EXTENSION_ID, ...)). Prints a JSON list of [ok, message] results.
// Run by tests/run_tests.py; on its own: node tests/prefs_sync.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const results = [];
const check = (ok, message) => results.push([!!ok, message]);

// --- 1. the website knows the extension's real ID ------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "extension/manifest.json"), "utf8"));
const idFromKey = (key) => [...crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const extId = manifest.key ? idFromKey(manifest.key) : null;
const appJs = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");
const siteId = (appJs.match(/EXTENSION_ID\s*=\s*"([a-p]{32})"/) || [])[1];
check(!!manifest.key, "manifest has a key, so the extension ID is fixed");
check(extId && siteId === extId, `website's EXTENSION_ID matches the manifest key (${siteId} = ${extId})`);

// --- 2. the extension lets the website in --------------------------------------------------------
const matches = ((manifest.externally_connectable || {}).matches) || [];
const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, "web/.firebaserc"), "utf8")).projects.default;
check(matches.includes(`https://${firebase}.web.app/*`), "externally_connectable lists the live website");
check(matches.some((m) => m.startsWith("http://localhost")), "externally_connectable lists localhost (local testing)");

// --- 3. the extension's message handler ----------------------------------------------------------
let stored = { settings: { uiLang: "hi", country: "JP", voice: true } };
let handler = null;
const any = new Proxy(function () {}, {            // every other Chrome API: harmless no-op
  get: (_t, k) => (k === "then" ? undefined : any),
  apply: () => any,
});
const chrome = new Proxy({}, {
  get: (_t, k) => {
    if (k === "storage") return { local: {
      get: async (key) => ({ [key]: stored[key] }),
      set: async (obj) => { stored = { ...stored, ...JSON.parse(JSON.stringify(obj)) }; },
    }, onChanged: any, session: any };
    if (k === "runtime") return new Proxy({}, { get: (_r, rk) => (rk === "onMessageExternal"
      ? { addListener: (fn) => { handler = fn; } } : any) });
    return any;
  },
});
const sandbox = { chrome, self: {}, console, setTimeout, clearTimeout, fetch: async () => ({ json: async () => ({}) }),
  importScripts: () => {}, URL, AbortController, structuredClone };
sandbox.self = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "extension/background.js"), "utf8"), sandbox);
check(typeof handler === "function", "background.js listens for messages from the website");

const send = (msg) => new Promise((resolve) => { const keep = handler(msg, { origin: "http://localhost:5500" }, resolve); if (keep !== true) resolve("NO-ASYNC"); });

(async () => {
  if (handler) {
    const got = await send({ type: "getPrefs" });
    check(got && got.uiLang === "hi" && got.country === "JP", `getPrefs returns the extension's choice (${JSON.stringify(got)})`);

    await send({ type: "setPrefs", uiLang: "ja", country: "SG" });
    check(stored.settings.uiLang === "ja" && stored.settings.country === "SG", "setPrefs from the website is saved (ja, SG)");
    check(stored.settings.voice === true, "setPrefs keeps the other settings");

    await send({ type: "setPrefs", uiLang: "xx", country: "ZZ" });
    check(stored.settings.uiLang === "ja" && stored.settings.country === "SG", "setPrefs ignores unknown languages and countries");

    await send({ type: "setPrefs", uiLang: "zh_CN" });
    check(stored.settings.uiLang === "zh_CN" && stored.settings.country === "SG", "setPrefs can change just one of the two");

    const other = await send({ type: "deleteEverything" });
    check(other === null, "anything else from the website is refused");
  }
  process.stdout.write(JSON.stringify(results));
})();
