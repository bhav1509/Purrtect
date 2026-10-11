// Service worker: "Scan with Purrtect" right-click menu, onboarding, and every backend call.
importScripts("config.js");

const MENU_ID = "purrtect-scan";
const API_TIMEOUT_MS = 25000; // backend caps scans at 8 s and recovery plans at 20 s; allow for the network
const CONTENT_SITES = [/^https:\/\/mail\.google\.com\//, /^https:\/\/web\.whatsapp\.com\//];

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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = info.selectionText || "";
  const links = info.linkUrl ? [info.linkUrl] : [];
  if (!text.trim() && !links.length) return;

  // On Gmail and WhatsApp the card opens in the page; anywhere else, in a small window.
  if (tab && tab.id && CONTENT_SITES.some((re) => re.test(tab.url || ""))) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "manualScan", text, links });
      return;
    } catch (_) { /* content script not ready; fall through */ }
  }
  await chrome.storage.session.set({ pendingScan: { text, links } });
  chrome.windows.create({ url: chrome.runtime.getURL("ui/scan.html"), type: "popup", width: 460, height: 720 });
});
