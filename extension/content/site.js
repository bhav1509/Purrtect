// Content-script pipeline. Runs on Gmail and WhatsApp Web, and is injected into other pages
// when someone uses right-click "Scan with Purrtect".
// Auto mode: every message that comes on screen is scored locally and gets a widget
//   (✓ / ! / ⚠). Only yellow and red are sent (masked) to the backend; green stays here.
// Manual mode: nothing is checked until text is selected and "Check with Purrtect" is pressed.
// "Ask me every time" (default): nothing is sent to Gemini until the person approves the masked request.
// Other websites (only with "Cursor cat" > "On all websites"): manual mode only — the cat, link hover
//   and "Check with Purrtect" on selected text; nothing is checked automatically.
(function () {
  "use strict";
  if (self.PurrSite) return;

  const HOST = location.hostname;
  const SITE = HOST === "web.whatsapp.com" ? "whatsapp" : HOST === "mail.google.com" ? "gmail" : "other";
  const UI = self.PurrUI;
  const stats = { checked: 0, warnings: 0 }; // this page only; shown on the side panel's Home view
  const paused = () => !PurrStore.enabled;   // the overall switch is Off: Purrtect does nothing

  // After Purrtect is updated or reloaded, this page still runs the old copy until it's refreshed;
  // the old copy can't talk to Chrome any more. Instead of buttons quietly doing nothing, say so.
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  function showUpdated() {
    if (document.querySelector(".purr-updated")) return;
    const bar = UI.el("div", { class: "purr-updated", role: "alert" },
      UI.el("span", {}, UI.t("updatedRefresh")),
      UI.el("button", { type: "button", class: "purr-btn purr-btn-primary", onclick: () => location.reload() }, UI.t("refresh")),
      UI.el("button", { type: "button", class: "purr-icon-btn", "aria-label": UI.t("close"), onclick: () => bar.remove() }, "×"));
    document.body.append(bar);
  }
  // Any click on Purrtect's own buttons while out of date shows the notice (and does nothing else).
  addEventListener("click", (e) => {
    if (alive() || !e.target.closest || !e.target.closest(".purr-linkcard, .purr-card, .purr-widget-wrap, .purr-select-btn, .purr-overlay")) return;
    if (e.target.closest(".purr-updated")) return;
    e.preventDefault(); e.stopPropagation(); showUpdated();
  }, true);
  const manual = () => SITE !== "other" && (PurrStore.settings.modes || {})[SITE] === "manual";
  const quiet = () => paused() || manual();
  const everywhere = SITE === "other" && self.PurrEverywhere === true; // loaded by "On all websites"
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
      if (changes.settings) { loadLocale(); showPaused(); }
      if (changes.riskyOpenedAt && SITE !== "other") showBanner();
    });
    showPaused();
    if (SITE !== "other") showBanner();
  })();

  // "Pause on this site": hide the widgets and stop automatic checks until it's switched back on.
  // Paused, or Manual mode on Gmail / WhatsApp: quiet. No badges, link cards or cursor cat; checks
  // run only when asked (selected text, right-click). Back to Auto: check what's on screen now.
  function showPaused() {
    const root = document.documentElement;
    const was = root.classList.contains("purr-paused") || root.classList.contains("purr-manual");
    root.classList.toggle("purr-paused", paused());
    root.classList.toggle("purr-manual", manual());
    if (was && !quiet()) dispatchEvent(new Event("purr-rescan"));
  }

  function showBanner() {
    if (PurrStore.riskyOpenedAt) UI.recoveryBanner(PurrStore.riskyOpenedAt, () => openRecovery(null));
  }

  function openRecovery(anchor) {
    UI.closeVerdictCard();
    UI.recoveryPanel({ anchor, onCountry: (c) => PurrStore.saveSettings({ country: c }) });
  }

  // Gmail sometimes wraps links as https://www.google.com/url?q=<real link>.
  function realHref(a) {
    try {
      const u = new URL(a.href);
      if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === "/url") return u.searchParams.get("q") || a.href;
    } catch (_) { /* keep */ }
    return a.href;
  }

  // Where a link really goes and how risky it looks, judged in the browser only (nothing is sent).
  // Used by the link card and the cursor cat. Each link gets its own level: green (a well-known
  // website), unfamiliar (no warning signs, but not on the trusted list), yellow or red. A link that
  // looks fine but sits in a message flagged as risky is shown as "careful".
  async function linkInfo(a) {
    await ready;
    const href = realHref(a);
    if (!/^https?:/i.test(href)) return null;
    const r = PurrRules.scoreLink(href, rules);
    if (!r) return null;
    if (PurrStore.isSafeLink(await PurrStore.hash(href))) return { host: r.host, level: "green", hits: [] };
    let level = PurrRules.levelFor(r.points, rules, PurrStore.settings.sensitivity);
    // Only well-known websites get ✓; anything else that looks fine is "unfamiliar", never "safe".
    if (level === "green" && !r.trusted) level = "unfamiliar";
    const inRiskyMessage = !!a.dataset.purrRisk && a.dataset.purrRisk !== "green";
    if (inRiskyMessage && (level === "green" || level === "unfamiliar")) level = "yellow";
    return { host: r.host, level, hits: r.hits, inRiskyMessage };
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

  const askFirst = () => PurrStore.settings.askBeforeSend !== false;

  // The only way anything reaches Gemini. With "Ask me every time" on, the person sees the
  // masked request first; "Don't send" returns the in-browser result instead.
  async function askBackend(text, links, local, senderIsNew, anchor, onApproved) {
    const body = scanBody(text, links, local, senderIsNew);
    if (askFirst()) {
      const answer = await UI.confirmSend(body, anchor);
      if (answer.dontAskAgain) PurrStore.saveSettings({ askBeforeSend: false });
      if (!answer.send) return { ...UI.resultFromLocal(local, true), notSent: true };
    }
    if (onApproved) onApproved();
    const res = await UI.env.api("/api/scan", body);
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
    if (PurrStore.settings.modes[SITE] === "manual" || paused()) return;
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
    const widget = UI.widget(result, (button) => onWidgetClick(button));
    item.anchor.prepend(widget);
    stats.checked++;
    // Tell the cursor cat (and mark risky links so it hisses when the cursor gets near them).
    function noteWarning(r) {
      if (r.pending) return;
      if (r.level === "green") {
        if (!item.safeNoted) { item.safeNoted = true; dispatchEvent(new CustomEvent("purr-safe-found")); }
        return;
      }
      item.el.querySelectorAll("a[href]").forEach((a) => { a.dataset.purrRisk = r.level; });
      if (item.noted) return;
      item.noted = true;
      stats.warnings++;
      dispatchEvent(new CustomEvent("purr-risk-found", { detail: { el: widget.button(), level: r.level } }));
    }

    function setGreen() {
      item.el.querySelectorAll("a[data-purr-risk]").forEach((a) => { delete a.dataset.purrRisk; });
      result = { ...result, level: "green", headline: UI.t("headline_green"), redFlags: [], advice: UI.t("advice_green"),
        awaitingApproval: false, notSent: false };
      widget.update(result);
    }
    function openCard(button) {
      if (result.pending) return;
      UI.verdictCard(result, { anchor: button, actions: cardActions(item, result, setGreen, () => widget.button()) });
    }
    function onWidgetClick(button) {
      if (result.pending) return;
      if (result.awaitingApproval) runCheck(button); // "Ask me every time": ask now, next to the widget
      else openCard(button);
    }
    UI.guardLinks(item.el, () => result, {
      onBack: () => UI.happy(),
      onWhy: (link) => UI.verdictCard(result, { anchor: link, actions: cardActions(item, result, setGreen, () => link) }),
      onOpen: (href) => { PurrStore.setRiskyOpened(); window.open(href, "_blank", "noopener,noreferrer"); },
    });

    // Sends for the detailed check (after approval, if asked for) and updates the widget.
    // button: the widget that was clicked (null when sending automatically).
    let checking = false;
    async function runCheck(button) {
      if (checking) return;
      checking = true;
      const r = await askBackend(isNew ? item.text : "", item.links, local, isNew, button, () => {
        widget.update({ pending: true });
        if (button) UI.verdictCard({ pending: true }, { anchor: widget.button() });
      });
      checking = false;
      if (r.notSent) {
        result = { ...r, awaitingApproval: true }; // asked again next time the sign is clicked
        widget.update(result);
        if (button) openCard(widget.button());
        return;
      }
      result = r;
      if (!result.basic && kept.length) PurrStore.cacheLinks(kept.map((x) => x.hash), result);
      if (result.level === "green" && item.senderHash) PurrStore.recordGreen(item.senderHash);
      widget.update(result);
      noteWarning(result);
      if (button) openCard(widget.button());
    }

    if (local.level === "green") {
      if (item.senderHash && !correctedSafe) PurrStore.recordGreen(item.senderHash);
      noteWarning(result);
      return;
    }
    if (item.senderHash) PurrStore.resetGreen(item.senderHash);

    // Known sender whose links were all judged in the last 24 h: reuse that verdict (nothing is sent).
    const cached = !isNew && kept.length ? kept.map((x) => PurrStore.cachedLink(x.hash)) : [];
    const rank = { green: 0, yellow: 1, red: 2 };
    if (cached.length && cached.every(Boolean)) {
      result = cached.map((c) => c.result).sort((a, b) => rank[b.level] - rank[a.level])[0];
      widget.update(result);
      noteWarning(result);
    } else if (askFirst()) {
      // Show the in-browser result now; nothing leaves the browser until the sign is clicked and approved.
      result = { ...UI.resultFromLocal(local, true), notSent: true, awaitingApproval: true };
      widget.update(result);
      noteWarning(result);
    } else {
      await runCheck(null);
    }
  }

  // Manual check of selected text (or a right-clicked link). Sent to the backend, masked,
  // after approval when "Ask me every time" is on.
  async function manualScan(text, links, anchor) {
    hideSelectBtn();                                     // one box at a time: the scan replaces the button
    if (!alive()) { showUpdated(); return; }
    if (paused()) return;                                // Purrtect is switched off: nothing is checked or sent
    await ready;
    const local = PurrRules.scoreMessage({ text, links, scanText: true, sender: { isNew: true } }, rules, PurrStore.settings.sensitivity);
    const result = await askBackend(text, local.links.map((l) => l.url), local, true, anchor,
      () => UI.verdictCard({ pending: true }, { anchor }));
    // "Don't send" or ✕ on the approval popup: the person said no, so nothing else opens (one box only).
    if (result.notSent) return;
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
  // Only one way to check at a time: while a link card is open (it has its own "Check with Gemini"),
  // the "Check with Purrtect" button for selected text stays away.
  let linkCardOpen = false;
  addEventListener("purr-linkcard-open", () => { linkCardOpen = true; hideSelectBtn(); });
  addEventListener("purr-linkcard-close", () => { linkCardOpen = false; });
  if (SITE !== "other" || everywhere) {
    document.addEventListener("mousedown", (e) => { if (selectBtn && !selectBtn.contains(e.target)) hideSelectBtn(); }, true);
    document.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;                       // right-click (context menu) never brings the button back
      if (e.target.closest && e.target.closest(".purr-card, .purr-select-btn, .purr-overlay, .purr-widget-wrap")) return;
      setTimeout(() => {
        const sel = getSelection();
        const text = String(sel || "").trim();
        if (!UI.env || text.length < 8 || !sel.rangeCount || linkCardOpen || paused()) return;
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
    else if (msg.type === "stats") {
      reply({ site: SITE, host: HOST, checked: stats.checked, warnings: stats.warnings,
        mode: PurrStore.settings.modes[SITE] || null, paused: paused() });
    }
    else if (msg.type === "manualScan") manualScan(msg.text || "", msg.links || [], contextAnchor(msg.links));
  });

  self.PurrSite = { ready, process, SITE, paused, quiet, realHref, linkInfo, manualScan, everywhere };
})();
