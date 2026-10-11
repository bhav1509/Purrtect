// Scan pipeline shared by gmail.js and whatsapp.js:
// local score -> badge -> (if risky) masked AI check via background -> link guard.
(function () {
  "use strict";
  if (self.PurrScan) return;
  const UI = self.PurrUI;

  const rulesReady = UI.send({ type: "getRules" });

  // Visible text plus real link targets, since "amazon.in" link text can point anywhere.
  function messageText(el) {
    const hrefs = [...el.querySelectorAll("a[href]")]
      .map((a) => a.href)
      .filter((h) => /^https?:/i.test(h));
    return el.innerText + (hrefs.length ? "\n" + hrefs.join("\n") : "");
  }

  async function aiCheck(text, source) {
    const res = await UI.send({ type: "scan", payload: { text: PurrRules.mask(text), source, lang: UI.lang() } });
    return res && !res.error ? res : null;
  }

  // el: the message body. anchor: where the badge goes. showSafe: badge even when safe.
  async function process(el, { source, anchor, showSafe }) {
    if (el.dataset.purrScanned) return;
    el.dataset.purrScanned = "1";

    const rules = await rulesReady;
    const text = messageText(el);
    if (!text.trim()) return;
    const local = PurrRules.score(text, rules);
    let result = { ...local, rules: local };
    let aiDone = false;

    async function upgrade() {
      if (aiDone) return;
      aiDone = true;
      const ai = await aiCheck(text, source);
      if (ai) result = ai;
      else result = { ...result, offline: true };
      if (badge) UI.updateBadge(badge, result);
    }

    async function open() {
      if (!aiDone) {
        UI.verdictCard({ ...result, pending: true });
        await upgrade();
      }
      UI.verdictCard(result);
    }

    let badge = null;
    if (local.verdict !== "safe" || showSafe) {
      badge = UI.badge(result, open);
      anchor.prepend(badge);
    }
    UI.guardLinks(el, () => result);
    if (local.verdict !== "safe") upgrade();
  }

  self.PurrScan = { process };
})();
