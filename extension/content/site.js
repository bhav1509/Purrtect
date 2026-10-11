// Shared content-script pipeline for Gmail and WhatsApp Web.
// Auto mode: local rules on every message; yellow/red go to the backend (masked); green never leaves.
// Manual mode: selected text via the mascot button or the right-click menu, always sent.
(function () {
  "use strict";
  if (self.PurrSite) return;

  const SITE = location.hostname === "web.whatsapp.com" ? "whatsapp" : "gmail";
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
      if (changes.riskyOpenedAt) showBanner();
    });
    UI.buddy(onBuddyClick);
    showBanner();
  })();

  function showBanner() {
    if (PurrStore.riskyOpenedAt) UI.recoveryBanner(PurrStore.riskyOpenedAt, () => openRecovery());
  }

  function openRecovery() {
    UI.recoveryPanel({ onCountry: (c) => PurrStore.saveSettings({ country: c }) });
  }

  function onBuddyClick() {
    const text = String(getSelection() || "").trim();
    if (text.length >= 8) manualScan(text, []);
    else UI.toast("idle", UI.t("buddyHint"), 4000);
  }

  function scanBody(text, links, local, senderIsNew) {
    const s = PurrStore.settings;
    return {
      text: PurrRules.mask(text),
      links: links.map((l) => PurrRules.mask(l)),
      sender: senderIsNew ? "new" : "known",
      source: SITE,
      local_score: local.score,
      local_hits: local.hits,
      ui_lang: UI.apiLang(),
      country: s.country,
    };
  }

  async function askBackend(text, links, local, senderIsNew) {
    UI.buddyBusy(+1);
    const res = await UI.env.api("/api/scan", scanBody(text, links, local, senderIsNew));
    UI.buddyBusy(-1);
    return res.ok ? UI.resultFromApi(res.data, local) : UI.resultFromLocal(local, true);
  }

  function cardActions(item, getResult, setGreen) {
    const actions = [{
      label: UI.t("thisIsSafe"),
      onClick: async () => {
        const hashes = await Promise.all(item.links.map((l) => PurrStore.hash(l)));
        await PurrStore.markSafe(hashes, item.senderHash);
        setGreen();
        UI.happy();
      },
    }];
    if (item.senderHash) {
      actions.push({ label: UI.t("trustSender"), onClick: async () => { await PurrStore.trust(item.senderHash); UI.happy(); } });
    }
    actions.push({ label: UI.t("iClicked"), primary: true, onClick: openRecovery });
    return actions;
  }

  // item: { el, anchor, text, links[], sender?: { key, displayName, address, business, verified, newHint } }
  async function process(item) {
    await ready;
    if (PurrStore.settings.modes[SITE] === "manual") return;
    const s = PurrStore.settings;

    item.senderHash = item.sender && item.sender.key ? await PurrStore.hash(SITE + ":" + item.sender.key) : null;
    if (item.senderHash && PurrStore.isSafeSender(item.senderHash)) return; // corrected by the user: green

    const linkHashes = await Promise.all(item.links.map((l) => PurrStore.hash(l)));
    const kept = item.links.map((l, i) => ({ url: l, hash: linkHashes[i] })).filter((x) => !PurrStore.isSafeLink(x.hash));
    item.links = kept.map((x) => x.url);

    const known = item.senderHash ? PurrStore.isKnown(item.senderHash) : false;
    const isNew = item.sender ? item.sender.newHint !== false && !known : true;
    const sender = item.sender ? { ...item.sender, isNew } : { isNew };
    const local = PurrRules.scoreMessage({ text: item.text, links: item.links, scanText: isNew, sender }, rules, s.sensitivity);

    if (local.level === "green") {
      if (item.senderHash) PurrStore.recordGreen(item.senderHash);
      return;
    }
    if (item.senderHash) PurrStore.resetGreen(item.senderHash);

    let result = { pending: true };
    const badge = UI.badge(result, () => UI.verdictCard(result, { actions: cardActions(item, () => result, setGreen) }));
    item.anchor.prepend(badge);
    function setGreen() {
      result = { ...result, level: "green" };
      badge.remove();
    }
    UI.guardLinks(item.el, () => result, {
      onBack: () => UI.happy(),
      onWhy: () => UI.verdictCard(result, { actions: cardActions(item, () => result, setGreen) }),
      onOpen: (href) => { PurrStore.setRiskyOpened(); window.open(href, "_blank", "noopener,noreferrer"); },
    });

    // Known sender, links already judged in the last 24 h: reuse that verdict.
    const cached = !isNew && kept.length ? kept.map((x) => PurrStore.cachedLink(x.hash)) : [];
    const rank = { green: 0, yellow: 1, red: 2 };
    if (cached.length && cached.every(Boolean)) {
      result = cached.map((c) => c.result).sort((a, b) => rank[b.level] - rank[a.level])[0];
    } else {
      result = await askBackend(isNew ? item.text : "", item.links, local, isNew);
      if (!result.basic && kept.length) PurrStore.cacheLinks(kept.map((x) => x.hash), result);
    }

    if (result.level === "green") {
      badge.remove();
      if (item.senderHash) PurrStore.recordGreen(item.senderHash);
      return;
    }
    badge.update(result);
    if (result.level === "red") {
      UI.dockAlert(result, () => UI.verdictCard(result, { actions: cardActions(item, () => result, setGreen) }));
    }
  }

  // Manual scan: always goes to the backend (after masking), whatever the local score.
  async function manualScan(text, links) {
    await ready;
    const local = PurrRules.scoreMessage({ text, links, scanText: true, sender: { isNew: true } }, rules, PurrStore.settings.sensitivity);
    UI.verdictCard({ pending: true });
    const result = await askBackend(text, local.links.map((l) => l.url), local, true);
    UI.verdictCard(result, { actions: [{ label: UI.t("iClicked"), primary: true, onClick: openRecovery }] });
  }

  // Mascot button beside selected text.
  let selectBtn = null;
  function hideSelectBtn() { if (selectBtn) { selectBtn.remove(); selectBtn = null; } }
  document.addEventListener("mousedown", (e) => { if (selectBtn && !selectBtn.contains(e.target)) hideSelectBtn(); }, true);
  document.addEventListener("mouseup", (e) => {
    if (e.target.closest && e.target.closest(".purr-card, .purr-select-btn, .purr-overlay")) return;
    setTimeout(() => {
      const sel = getSelection();
      const text = String(sel || "").trim();
      if (!PurrUI.env || text.length < 8 || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const links = [...range.cloneContents().querySelectorAll("a[href]")].map((a) => a.href);
      hideSelectBtn();
      selectBtn = UI.el("button", { type: "button", class: "purr-select-btn",
        onclick: () => { hideSelectBtn(); manualScan(text, links); } }, UI.mascotImg("idle", 32), UI.t("checkThis"));
      selectBtn.style.left = `${Math.min(rect.right + scrollX + 6, scrollX + innerWidth - 180)}px`;
      selectBtn.style.top = `${rect.bottom + scrollY + 6}px`;
      document.body.append(selectBtn);
    }, 10);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "ping") reply(true);
    else if (msg.type === "manualScan") manualScan(msg.text || "", msg.links || []);
  });

  self.PurrSite = { ready, process, SITE };
})();
