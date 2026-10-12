// Content-script pipeline. Runs on Gmail and WhatsApp Web, and is injected into other pages
// when someone uses right-click "Scan with Purrtect".
// Auto mode: every message that comes on screen is scored locally and gets a widget
//   (✓ / ! / ⚠). Only yellow and red are sent (masked) to the backend; green stays here.
// Manual mode: nothing is checked until text is selected and "Check with Purrtect" is pressed.
(function () {
  "use strict";
  if (self.PurrSite) return;

  const HOST = location.hostname;
  const SITE = HOST === "web.whatsapp.com" ? "whatsapp" : HOST === "mail.google.com" ? "gmail" : "other";
  const UI = self.PurrUI;
  const send = (msg) => chrome.runtime.sendMessage(msg);
  let rules = null;

  async function loadLocale() {
    const s = PurrStore.settings;
    const [messages, fallback] = await Promise.all([send({ type: "getLocale", lang: s.uiLang }), send({ type: "getLocale", lang: "en" })]);
    UI.configure({ messages, fallback, settings: s, assetUrl: (p) => chrome.runtime.getURL(p),
      api: (path, body) => send({ type: "api", path, body }) });
  }

  const ready = (async () => {
    await PurrStore.ready;
    rules = await send({ type: "getRules" });
    await loadLocale();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings) loadLocale();
      if (changes.riskyOpenedAt && SITE !== "other") showBanner();
    });
    if (SITE !== "other") {
      UI.buddy(onBuddyClick);
      showBanner();
    }
  })();

  function showBanner() {
    if (PurrStore.riskyOpenedAt) UI.recoveryBanner(PurrStore.riskyOpenedAt, () => openRecovery(null));
  }

  function openRecovery(anchor) {
    UI.closeVerdictCard();
    UI.recoveryPanel({ anchor, onCountry: (c) => PurrStore.saveSettings({ country: c }) });
  }

  function onBuddyClick() {
    const sel = getSelection();
    const text = String(sel || "").trim();
    if (text.length >= 8 && sel.rangeCount) manualScan(text, [], sel.getRangeAt(0).getBoundingClientRect());
    else UI.toast("idle", UI.t("buddyHint"), 4000);
  }

  function scanBody(text, links, local, senderIsNew) {
    return {
      text: PurrRules.mask(text),
      links: links.map((l) => PurrRules.mask(l)),
      sender: senderIsNew ? "new" : "known",
      source: SITE === "other" ? "web" : SITE,
      local_score: local.score,
      local_hits: local.hits,
      ui_lang: UI.apiLang(),
      country: PurrStore.settings.country,
    };
  }

  async function askBackend(text, links, local, senderIsNew) {
    UI.buddyBusy && UI.buddyBusy(+1);
    const res = await UI.env.api("/api/scan", scanBody(text, links, local, senderIsNew));
    UI.buddyBusy && UI.buddyBusy(-1);
    return res.ok ? UI.resultFromApi(res.data, local) : UI.resultFromLocal(local, true);
  }

  // Up to 3 buttons: This is safe (not on green), Trust this sender (if there is one), I clicked or paid.
  function cardActions(item, result, setGreen, anchor) {
    const actions = [];
    if (result.level !== "green") {
      actions.push({
        label: UI.t("thisIsSafe"),
        onClick: async () => {
          const hashes = await Promise.all(item.links.map((l) => PurrStore.hash(l)));
          await PurrStore.markSafe(hashes, item.senderHash);
          setGreen();
          UI.happy();
        },
      });
    }
    if (item.senderHash && !PurrStore.isKnown(item.senderHash)) {
      actions.push({ label: UI.t("trustSender"), onClick: async () => { await PurrStore.trust(item.senderHash); UI.happy(); } });
    }
    actions.push({ label: UI.t("iClicked"), primary: true, onClick: () => openRecovery(anchor()) });
    return actions;
  }

  // Auto mode. item: { el, anchor, text, links[], sender?: { key, displayName, address, business, verified, newHint } }
  async function process(item) {
    await ready;
    if (PurrStore.settings.modes[SITE] === "manual") return;
    const s = PurrStore.settings;

    item.senderHash = item.sender && item.sender.key ? await PurrStore.hash(SITE + ":" + item.sender.key) : null;
    const correctedSafe = item.senderHash && PurrStore.isSafeSender(item.senderHash);

    const linkHashes = await Promise.all(item.links.map((l) => PurrStore.hash(l)));
    const kept = item.links.map((l, i) => ({ url: l, hash: linkHashes[i] })).filter((x) => !PurrStore.isSafeLink(x.hash));
    item.links = kept.map((x) => x.url);

    const known = item.senderHash ? PurrStore.isKnown(item.senderHash) : false;
    const isNew = item.sender ? item.sender.newHint !== false && !known : true;
    const sender = item.sender ? { ...item.sender, isNew } : { isNew };
    const local = correctedSafe
      ? { score: 0, level: "green", hits: [], links: [] }
      : PurrRules.scoreMessage({ text: item.text, links: item.links, scanText: isNew, sender }, rules, s.sensitivity);

    let result = local.level === "green" ? UI.resultFromLocal(local, false) : { pending: true };
    const widget = UI.widget(result, (button) => openCard(button));
    item.anchor.prepend(widget);

    function setGreen() {
      result = { ...result, level: "green", headline: UI.t("headline_green"), redFlags: [], advice: UI.t("advice_green") };
      widget.update(result);
    }
    function openCard(button) {
      if (result.pending) return;
      UI.verdictCard(result, { anchor: button, actions: cardActions(item, result, setGreen, () => widget.button()) });
    }
    UI.guardLinks(item.el, () => result, {
      onBack: () => UI.happy(),
      onWhy: (link) => UI.verdictCard(result, { anchor: link, actions: cardActions(item, result, setGreen, () => link) }),
      onOpen: (href) => { PurrStore.setRiskyOpened(); window.open(href, "_blank", "noopener,noreferrer"); },
    });

    if (local.level === "green") {
      if (item.senderHash && !correctedSafe) PurrStore.recordGreen(item.senderHash);
      return;
    }
    if (item.senderHash) PurrStore.resetGreen(item.senderHash);

    // Known sender whose links were all judged in the last 24 h: reuse that verdict.
    const cached = !isNew && kept.length ? kept.map((x) => PurrStore.cachedLink(x.hash)) : [];
    const rank = { green: 0, yellow: 1, red: 2 };
    if (cached.length && cached.every(Boolean)) {
      result = cached.map((c) => c.result).sort((a, b) => rank[b.level] - rank[a.level])[0];
    } else {
      result = await askBackend(isNew ? item.text : "", item.links, local, isNew);
      if (!result.basic && kept.length) PurrStore.cacheLinks(kept.map((x) => x.hash), result);
    }
    if (result.level === "green" && item.senderHash) PurrStore.recordGreen(item.senderHash);
    widget.update(result);
  }

  // Manual check of selected text (or a right-clicked link): always sent to the backend, masked.
  async function manualScan(text, links, anchor) {
    await ready;
    const local = PurrRules.scoreMessage({ text, links, scanText: true, sender: { isNew: true } }, rules, PurrStore.settings.sensitivity);
    UI.verdictCard({ pending: true }, { anchor });
    const result = await askBackend(text, local.links.map((l) => l.url), local, true);
    UI.verdictCard(result, { anchor, actions: [{ label: UI.t("iClicked"), primary: true, onClick: () => openRecovery(anchor) }] });
  }

  // Where a right-click scan should open: next to the selection, or the link that was clicked.
  function contextAnchor(links) {
    const sel = getSelection();
    if (sel && sel.rangeCount && String(sel).trim()) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) return r;
    }
    if (links && links[0]) {
      const a = [...document.querySelectorAll("a[href]")].find((x) => x.href === links[0]);
      if (a) return a;
    }
    return null;
  }

  // "Check with Purrtect" button beside selected text (Gmail and WhatsApp, any mode).
  let selectBtn = null;
  function hideSelectBtn() { if (selectBtn) { selectBtn.remove(); selectBtn = null; } }
  if (SITE !== "other") {
    document.addEventListener("mousedown", (e) => { if (selectBtn && !selectBtn.contains(e.target)) hideSelectBtn(); }, true);
    document.addEventListener("mouseup", (e) => {
      if (e.target.closest && e.target.closest(".purr-card, .purr-select-btn, .purr-overlay, .purr-widget-wrap")) return;
      setTimeout(() => {
        const sel = getSelection();
        const text = String(sel || "").trim();
        if (!UI.env || text.length < 8 || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const links = [...range.cloneContents().querySelectorAll("a[href]")].map((a) => a.href);
        hideSelectBtn();
        selectBtn = UI.el("button", { type: "button", class: "purr-select-btn",
          onclick: () => { hideSelectBtn(); manualScan(text, links, rect); } }, UI.mascotImg("idle", 28), UI.t("checkWithPurrtect"));
        selectBtn.style.left = `${Math.min(rect.right + scrollX + 6, scrollX + innerWidth - 220)}px`;
        selectBtn.style.top = `${rect.bottom + scrollY + 6}px`;
        document.body.append(selectBtn);
      }, 10);
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "ping") reply(true);
    else if (msg.type === "manualScan") manualScan(msg.text || "", msg.links || [], contextAnchor(msg.links));
  });

  self.PurrSite = { ready, process, SITE };
})();
