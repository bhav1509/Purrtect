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
  "ui/badge.js", "ui/click-warning.js", "content/site.js"];

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
