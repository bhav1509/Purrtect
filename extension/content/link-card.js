// Link card: rest the cursor on a link for a moment and a small card pins under it, showing where
// the link really goes (✓ fine, ! careful, ⚠ risky), judged in the browser; nothing is sent.
//   "Why?"               the reasons, from the local rules
//   "Check with Gemini"  a manual check of the link (masked, after approval when "Ask me" is on)
// Works with or without the cursor cat. On WhatsApp, message buttons that hide their address
// (e.g. "Explore the Channel") get "? Can't see where this goes".
// Announces "purr-link-hover" { el, level } and "purr-link-leave" for the cursor cat.
(function () {
  "use strict";
  if (self.PurrLinkCard || !self.PurrSite || (PurrSite.SITE === "other" && !PurrSite.everywhere)) return;
  const UI = self.PurrUI;
  const { el, t } = UI;

  const SHOW_AFTER = 700;   // ms resting on a link before the card opens
  const HIDE_AFTER = 300;   // ms after leaving both the link and the card
  const SIGN = { green: "✓", yellow: "!", red: "⚠", unknown: "?" };

  let target = null;        // the link (or button) under the cursor
  let card = null, cardFor = null, unplace = null;
  let showTimer = null, hideTimer = null;

  const enabled = () => !PurrSite.paused() && (!PurrSite.everywhere || PurrStore.settings.catEverywhere === true);

  // A real web link, or on WhatsApp a button inside a checked message that hides its address.
  function linkFrom(node) {
    if (!node || !node.closest || node.closest(".purr-linkcard, .purr-card, .purr-overlay, .purr-widget-wrap, .purr-select-btn")) return null;
    const a = node.closest("a[href]");
    if (a) return /^https?:/i.test(PurrSite.realHref(a)) ? a : null;
    if (PurrSite.SITE !== "whatsapp") return null;
    return hiddenButton(node);
  }

  // WhatsApp business messages put "Explore the Channel", "View details" etc. under the text as
  // buttons that never show their address. Found loosely, since the markup is undocumented: a
  // short, clickable, labelled element (icon or tooltip) below the text in the same chat row.
  function hiddenButton(node) {
    const b = node.closest("[role='button'], button, [title]");
    if (!b || b.closest("header, footer, a[href]") || b.querySelector("a[href]")) return null;
    const row = b.closest("[data-id], .message-in, .message-out, [role='row']");
    if (!row || !row.closest("#main")) return null;
    const label = (b.innerText || b.getAttribute("title") || "").trim();
    if (label.length < 3 || label.length > 40) return null;
    const clickable = b.matches("[role='button'], button") || getComputedStyle(b).cursor === "pointer";
    const labelled = b.querySelector("svg, img, [data-icon]") || b.hasAttribute("title");
    if (!clickable || !labelled) return null;
    const text = row.querySelector(".copyable-text, .selectable-text");
    if (text && (text.contains(b) || b.contains(text) || !(text.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))) return null;
    return b;
  }

  async function infoFor(node) {
    if (node.tagName !== "A") return { level: "unknown", host: t("lc_hidden"), hits: [] };
    return PurrSite.linkInfo(node);
  }

  function reasons(info) {
    if (info.level === "unknown") return [t("lc_whyHidden")];
    const list = info.hits.map((h) => `${t("hit_" + h)}: ${t("hitwhy_" + h)}`);
    if (info.inRiskyMessage) list.push(t("lc_whyMessage"));
    return list.length ? list : [t("lc_whyNone")];
  }

  function close() {
    clearTimeout(hideTimer);
    if (unplace) unplace();
    if (card) card.remove();
    card = cardFor = unplace = null;
  }

  function open(node, info) {
    close();
    const why = el("ul", { class: "purr-linkcard-why", hidden: true }, reasons(info).map((r) => el("li", {}, r)));
    const whyBtn = el("button", { type: "button", class: "purr-btn", "aria-expanded": "false" }, t("lc_why"));
    whyBtn.addEventListener("click", () => {
      why.hidden = !why.hidden;
      whyBtn.setAttribute("aria-expanded", String(!why.hidden));
    });
    const gemini = el("button", { type: "button", class: "purr-btn purr-btn-primary" }, t("lc_checkGemini"));
    gemini.addEventListener("click", () => {
      const rect = node.getBoundingClientRect();
      close();
      if (node.tagName === "A") {
        const href = PurrSite.realHref(node);
        PurrSite.manualScan(href, [href], rect);
      } else {
        const msg = node.closest("[data-purr-seen], [data-id], .message-in, [role='row']");
        PurrSite.manualScan((msg || node).innerText, [], rect);
      }
    });
    card = el("div", { class: `purr-linkcard lv-${info.level}`, role: "dialog", "aria-label": t("lc_label") },
      el("div", { class: "purr-linkcard-head" },
        el("span", { class: "purr-linkcard-sign", "aria-hidden": "true" }, SIGN[info.level]),
        el("span", {}, info.host)),
      why,
      el("div", { class: "purr-linkcard-actions" }, whyBtn, gemini));
    card.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    card.addEventListener("mouseleave", scheduleHide);
    document.body.append(card);
    cardFor = node;
    unplace = UI.placeNear(card, node);
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(close, HIDE_AFTER);
  }

  async function enter(node) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    target = node;
    const info = await infoFor(node).catch(() => null);
    if (!info || target !== node) return;
    dispatchEvent(new CustomEvent("purr-link-hover", { detail: { el: node, level: info.level } }));
    if (cardFor === node) return;
    showTimer = setTimeout(() => { if (target === node) open(node, info); }, SHOW_AFTER);
  }

  function leave() {
    clearTimeout(showTimer);
    target = null;
    dispatchEvent(new CustomEvent("purr-link-leave"));
    if (card) scheduleHide();
  }

  addEventListener("mouseover", (e) => {
    if (!enabled()) return;
    if (card && card.contains(e.target)) return;
    const node = linkFrom(e.target);
    if (node === target) return;
    if (node) enter(node);
    else if (target) leave();
  }, { passive: true });

  // Opening the link, or scrolling it away, closes the card.
  addEventListener("click", (e) => { if (card && !card.contains(e.target)) close(); }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  self.PurrLinkCard = true;
})();
