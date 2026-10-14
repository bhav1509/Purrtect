// "Send this for a detailed check?" — shows exactly what would go to Gemini (already masked)
// and waits for Send / Don't send. Used when the "Ask me every time" setting is on.
// Platform-neutral (only PurrUI helpers), so the web checker can reuse it.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.confirmSend) return;

  let open = null; // { node, unplace, resolve }

  function finish(answer) {
    if (!open) return;
    const { node, unplace, resolve } = open;
    open = null;
    if (unplace) unplace();
    node.remove();
    resolve(answer);
  }

  function row(label, value) {
    return UI.el("div", { class: "purr-send-row" }, UI.el("span", { class: "purr-send-label" }, label), UI.el("span", {}, value));
  }

  // body: the exact /api/scan request body (text and links already masked).
  // anchor: Element or DOMRect to open next to. Resolves to { send: boolean, dontAskAgain: boolean }.
  UI.confirmSend = function confirmSend(body, anchor) {
    const { el, t } = UI;
    finish({ send: false, dontAskAgain: false }); // only one at a time
    UI.closeVerdictCard && UI.closeVerdictCard();

    const hits = (body.local_hits || []).map((h) => t("hit_" + h)).join(", ") || t("confirmNoHits");
    const dontAsk = el("input", { type: "checkbox", id: "purr-dont-ask" });
    const node = el(
      "section",
      { class: "purr-card purr-send purr-docked", role: "dialog", "aria-labelledby": "purr-send-title" },
      el("div", { class: "purr-card-head" },
        UI.mascotImg("thinking", 56),
        el("div", { class: "purr-card-heading" },
          el("div", { class: "purr-headline", id: "purr-send-title" }, t("confirmTitle")),
          el("p", { class: "purr-note" }, t("confirmIntro"))),
        el("div", { class: "purr-card-tools" },
          el("button", { class: "purr-icon-btn", type: "button", "aria-label": t("close"),
            onclick: () => finish({ send: false, dontAskAgain: false }) }, "×"))),
      el("h4", {}, t("confirmMasked")),
      el("pre", { class: "purr-send-text" }, body.text || t("confirmNoText")),
      body.links && body.links.length
        ? [el("h4", {}, t("confirmLinks")), el("ul", { class: "purr-send-links" }, body.links.map((l) => el("li", {}, l)))]
        : null,
      el("h4", {}, t("confirmOther")),
      el("div", { class: "purr-send-rows" },
        row(t("confirmSender"), t("confirmSender_" + body.sender)),
        row(t("confirmSource"), t("source_" + body.source)),
        row(t("confirmQuick"), `${body.local_score}/100 · ${hits}`),
        row(t("confirmLanguage"), t("langName_" + (body.ui_lang === "zh" ? "zh_CN" : body.ui_lang))),
        row(t("confirmCountry"), t("country_" + body.country))),
      el("p", { class: "purr-note" }, t("confirmNever")),
      el("label", { class: "purr-check", for: "purr-dont-ask" }, dontAsk, t("dontAskAgain")),
      el("div", { class: "purr-actions" },
        el("button", { type: "button", class: "purr-btn", onclick: () => finish({ send: false, dontAskAgain: false }) }, t("dontSend")),
        el("button", { type: "button", class: "purr-btn purr-btn-primary", onclick: () => finish({ send: true, dontAskAgain: dontAsk.checked }) }, t("sendForCheck")))
    );
    document.body.append(node);
    return new Promise((resolve) => {
      open = { node, unplace: UI.placeNear(node, anchor), resolve };
      node.querySelector(".purr-btn-primary").focus({ preventScroll: true });
    });
  };

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") finish({ send: false, dontAskAgain: false }); });
})();
