// Verdict card: headline, risk level and scam type, up to 3 red flags, advice, read aloud,
// and at most 3 action buttons. Opens next to its anchor (a widget, the selection, a link),
// or renders inside a container (web checker).
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.verdictCard) return;

  const STATE = { green: "happy", yellow: "careful", red: "stop" };
  let floating = null;
  let unplace = null;

  function closeFloating() {
    if (unplace) unplace();
    if (floating) floating.remove();
    floating = null;
    unplace = null;
    UI.stopSpeech();
  }

  function spokenText(r) {
    return [r.headline, ...r.redFlags.map((f) => `${f.flag}. ${f.why}`), r.advice].filter(Boolean).join(". ");
  }

  // result: see PurrUI.resultFromApi / resultFromLocal, or { pending: true }.
  // opts.actions: [{ label, primary?, onClick }] (max 3)
  // opts.container: render inline; opts.anchor: Element or DOMRect to open next to.
  UI.verdictCard = function verdictCard(result, opts) {
    opts = opts || {};
    const { t, el } = UI;
    const pending = !!result.pending;
    const level = pending ? null : result.level;
    const state = pending ? "thinking" : STATE[level];
    UI.stopSpeech();

    const voice = !pending && UI.env.settings.voice !== false ? UI.speechControl(() => spokenText(result)) : null;
    const header = el(
      "div",
      { class: "purr-card-head" },
      UI.mascotImg(state, pending ? 40 : 64),
      el(
        "div",
        { class: "purr-card-heading" },
        el("div", { class: "purr-headline" }, pending ? (UI.mascotLine("thinking") || t("checking")) : result.headline),
        pending ? null : el(
          "div",
          { class: "purr-level" },
          el("span", { class: `purr-pill purr-${level}` }, t("level_" + level)),
          result.scamType && result.scamType !== "none" ? el("span", { class: "purr-type" }, t("type_" + result.scamType)) : null
        )
      ),
      opts.container ? null : el("div", { class: "purr-card-tools" },
        el("button", { class: "purr-icon-btn", type: "button", title: t("close"), "aria-label": t("close"), onclick: closeFloating }, "×"))
    );

    const body = pending ? null : [
      voice,
      result.redFlags.length
        ? el("ul", { class: "purr-flags" }, result.redFlags.slice(0, 3).map((f) =>
            el("li", {}, el("strong", {}, f.flag), " ", f.why)))
        : null,
      result.advice ? el("p", { class: "purr-advice" }, result.advice) : null,
      result.notSent ? el("p", { class: "purr-note" }, t("notSentNote"))
        : result.basic ? el("p", { class: "purr-note" }, t("basicCheckOnly")) : null,
      result.localOnly ? el("p", { class: "purr-note" }, t("localCheckOnly")) : null,
    ];

    const actions = pending ? [] : (opts.actions || []).slice(0, 3);
    const card = el(
      "section",
      { class: `purr-card purr-${level || "thinking"}` + (pending ? " purr-compact" : "") + (opts.container ? " purr-inline" : " purr-docked"), role: "dialog", "aria-live": "polite" },
      header,
      body,
      actions.length
        ? el("div", { class: "purr-actions" }, actions.map((a) =>
            el("button", { class: a.primary ? "purr-btn purr-btn-primary" : "purr-btn", type: "button",
              onclick: () => { if (!opts.container && !a.keepOpen) closeFloating(); a.onClick(card); } }, a.label)))
        : null
    );

    if (opts.container) {
      opts.container.replaceChildren(card);
    } else {
      closeFloating();
      floating = card;
      document.body.append(card);
      unplace = UI.placeNear(card, opts.anchor);
    }
    return card;
  };

  UI.closeVerdictCard = closeFloating;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFloating(); });
  // Clicking elsewhere closes a floating card (not the widget or the selection button that opened it).
  document.addEventListener("mousedown", (e) => {
    if (floating && !floating.contains(e.target) && !e.target.closest(".purr-widget, .purr-select-btn, .purr-recovery, .purr-overlay, .purr-send")) closeFloating();
  }, true);
})();
