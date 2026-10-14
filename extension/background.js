// Service worker: "Scan with Purrtect" right-click menu, onboarding, and every backend call.
importScripts("config.js");

const MENU_ID = "purrtect-scan";
const API_TIMEOUT_MS = 25000; // backend caps scans at 8 s and recovery plans at 20 s; allow for the network

let rulesPromise = null;
const localeCache = {};

function getRules() {
  rulesPromise ??= fetch(chrome.runtime.getURL("rules.json")).then((r) => r.json());
  return rulesPromise;
}

function getLocale(lang) {
  const safe = ["en", "hi", "ja", "zh_CN"].includes(lang) ? lang : "en";
  localeCache[safe] ??= fetch(chrome.runtime.getURL(`_locales/${safe}/messages.json`)).then((r) => r.json());
  return localeCache[safe];
}

async function api(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(self.PURRTECT_CONFIG.apiBase.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

// The toolbar button opens settings in Chrome's side panel (like MetaMask), not a dropdown.
function useSidePanel() {
  if (chrome.sidePanel) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
useSidePanel();
chrome.runtime.onStartup.addListener(useSidePanel);

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({ id: MENU_ID, title: chrome.i18n.getMessage("menuScan"), contexts: ["selection", "link"] });
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("ui/settings.html?welcome=1") });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "getRules") getRules().then(reply);
  else if (msg.type === "getLocale") getLocale(msg.lang).then(reply);
  else if (msg.type === "api") api(msg.path, msg.body).then(reply);
  else return false;
  return true; // reply asynchronously
});

// Files injected into a page the first time "Scan with Purrtect" is used there
// (Gmail and WhatsApp already have them as content scripts).
const INJECT_JS = ["rules.js", "lib/store.js", "ui/core.js", "ui/verdict-card.js", "ui/recovery-panel.js",
  "ui/confirm-send.js", "ui/badge.js", "ui/click-warning.js", "content/site.js"];

async function ensureInPage(tabId) {
  try {
    if (await chrome.tabs.sendMessage(tabId, { type: "ping" })) return true;
  } catch (_) { /* not injected yet */ }
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["ui/ui.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: INJECT_JS });
    return true;
  } catch (_) {
    return false; // chrome:// pages, the Web Store, PDFs: Chrome doesn't allow scripts there
  }
}

// Shows the result as a popup on the same page, next to the selection or the link.
async function handleMenuClick(info, tab) {
  if (info.menuItemId !== MENU_ID) return;
  const text = info.selectionText || "";
  const links = info.linkUrl ? [info.linkUrl] : [];
  if (!text.trim() && !links.length) return;

  if (tab && tab.id && await ensureInPage(tab.id)) {
    await chrome.tabs.sendMessage(tab.id, { type: "manualScan", text, links });
    return;
  }
  // Pages where Chrome blocks extensions: fall back to a small result window.
  await chrome.storage.session.set({ pendingScan: { text, links } });
  chrome.windows.create({ url: chrome.runtime.getURL("ui/scan.html"), type: "popup", width: 460, height: 720 });
}
chrome.contextMenus.onClicked.addListener(handleMenuClick);
self.purrHandleMenuClick = handleMenuClick; // used by the end-to-end test

// "Cursor cat" > "On all websites": Chrome's all-sites permission is asked for only when that
// switch is turned on. While both switches are on and the permission is granted, the cat, link
// hover and "Check with Purrtect" load on every other website, in manual mode.
const EVERYWHERE_ID = "purrtect-everywhere";
const ALL_SITES = ["https://*/*", "http://*/*"];

async function syncEverywhere() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    const want = !!(settings && settings.cursorCat === true && settings.catEverywhere === true) &&
      await chrome.permissions.contains({ origins: ALL_SITES });
    const have = (await chrome.scripting.getRegisteredContentScripts({ ids: [EVERYWHERE_ID] })).length > 0;
    if (want && !have) {
      await chrome.scripting.registerContentScripts([{
        id: EVERYWHERE_ID,
        matches: ALL_SITES,
        excludeMatches: ["https://mail.google.com/*", "https://web.whatsapp.com/*"],
        js: ["content/everywhere.js", ...INJECT_JS, "content/link-card.js", "content/cursor-cat.js"],
        css: ["ui/ui.css"],
        runAt: "document_idle",
      }]);
    } else if (!want && have) {
      await chrome.scripting.unregisterContentScripts({ ids: [EVERYWHERE_ID] });
    }
  } catch (_) { /* tried again on the next settings change */ }
}
syncEverywhere();
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.settings) syncEverywhere(); });
chrome.permissions.onAdded.addListener(syncEverywhere);
chrome.permissions.onRemoved.addListener(async () => {
  // Permission taken back in chrome://extensions: switch the setting off to match.
  if (await chrome.permissions.contains({ origins: ALL_SITES })) return;
  const { settings } = await chrome.storage.local.get("settings");
  if (settings && settings.catEverywhere) await chrome.storage.local.set({ settings: { ...settings, catEverywhere: false } });
  syncEverywhere();
});

// Language and country are shared with Purrtect's website (listed under "externally_connectable"
// in the manifest), so choosing them in one place sets them in both. Only these two settings, only
// with that site, only on this computer; nothing goes to the backend.
const SHARED_LANGS = ["en", "hi", "ja", "zh_CN"];
const SHARED_COUNTRIES = ["IN", "SG", "AU", "ID", "PH", "JP"];
chrome.runtime.onMessageExternal.addListener((msg, _sender, reply) => {
  (async () => {
    const { settings } = await chrome.storage.local.get("settings");
    const s = settings || {};
    if (msg && msg.type === "getPrefs") {
      reply({ uiLang: s.uiLang || null, country: s.country || null });
    } else if (msg && msg.type === "setPrefs") {
      const patch = {};
      if (SHARED_LANGS.includes(msg.uiLang)) patch.uiLang = msg.uiLang;
      if (SHARED_COUNTRIES.includes(msg.country)) patch.country = msg.country;
      if (Object.keys(patch).length) await chrome.storage.local.set({ settings: { ...s, ...patch } });
      reply({ ok: true });
    } else {
      reply(null);
    }
  })();
  return true; // reply comes after the storage read
});
