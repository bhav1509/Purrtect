// Service worker: right-click "Check with Purrtect", and the only place that talks to the backend.
importScripts("rules.js");

const DEFAULTS = { apiBase: "http://localhost:8000" };
const UI_FILES = ["rules.js", "ui/common.js", "ui/badge.js", "ui/verdict-card.js", "ui/click-warning.js", "ui/recovery-panel.js"];
const MENU_ID = "purrtect-check";

let rulesPromise = null;
function getRules() {
  rulesPromise ??= fetch(chrome.runtime.getURL("rules.json")).then((r) => r.json());
  return rulesPromise;
}

async function api(path, payload) {
  const { apiBase } = await chrome.storage.sync.get(DEFAULTS);
  try {
    const res = await fetch(apiBase.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: chrome.i18n.getMessage("menuCheck"),
    contexts: ["selection", "link"],
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "getRules") getRules().then(reply);
  else if (msg.type === "scan") api("/api/scan", msg.payload).then(reply);
  else if (msg.type === "recover") api("/api/recover", msg.payload).then(reply);
  else return false;
  return true; // reply asynchronously
});

// Make sure the UI scripts are in the tab (they already are on Gmail/WhatsApp).
async function ensureUI(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
  } catch (_) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["ui/ui.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: [...UI_FILES, "content/menu-listener.js"] });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const text = [info.selectionText, info.linkUrl].filter(Boolean).join("\n");
  if (!text.trim()) return;

  const rules = await getRules();
  const local = PurrRules.score(text, rules);
  try {
    await ensureUI(tab.id);
  } catch (_) {
    return; // chrome:// pages, the Web Store, etc. can't be scripted
  }
  chrome.tabs.sendMessage(tab.id, { type: "showVerdict", result: { ...local, rules: local, pending: true } });

  const { lang } = await chrome.storage.sync.get({ lang: "auto" });
  const ai = await api("/api/scan", { text: PurrRules.mask(text), source: "selection", lang: resolveLang(lang) });
  const result = ai && !ai.error ? ai : { ...local, rules: local, offline: true };
  chrome.tabs.sendMessage(tab.id, { type: "showVerdict", result });
});

function resolveLang(lang) {
  if (lang !== "auto") return lang;
  const ui = chrome.i18n.getUILanguage();
  return ui.startsWith("hi") ? "hi" : ui.startsWith("ja") ? "ja" : ui.startsWith("zh") ? "zh_CN" : "en";
}
