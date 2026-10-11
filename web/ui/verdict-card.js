// Verdict card: headline, risk level and scam type, up to 3 red flags, advice, read aloud,
// and at most 3 action buttons. Docks to the side of the page, or renders inside a container.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.verdictCard) return;

  const STATE = { green: "happy", yellow: "careful", red: "stop" };
  let docked = null;

  function closeDocked() {
    if (docked) docked.remove();
    docked = null;
    if ("speechSynthesis" in self) speechSynthesis.cancel();
  }

  function spokenText(r) {
    return [r.headline, ...r.redFlags.map((f) => `${f.flag}. ${f.why}`), r.advice].filter(Boolean).join(". ");
  }

  // result: see PurrUI.resultFromApi / resultFromLocal, or { pending: true }.
  // opts.actions: [{ label, primary?, onClick }] (max 3), opts.container: render inline.
  UI.verdictCard = function verdictCard(result, opts) {
    opts = opts || {};
    const { t, el } = UI;
    const pending = !!result.pending;
    const level = pending ? null : result.level;
    const state = pending ? "thinking" : STATE[level];

    const header = el(
      "div",
      { class: "purr-card-head" },
      UI.mascotImg(state, 72),
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
      el(
        "div",
        { class: "purr-card-tools" },
        !pending && UI.env.settings.voice !== false
          ? el("button", { class: "purr-icon-btn", type: "button", title: t("readAloud"), "aria-label": t("readAloud"),
              onclick: () => UI.speak(spokenText(result), result.language) }, "🔊")
          : null,
        opts.container ? null : el("button", { class: "purr-icon-btn", type: "button", title: t("close"), "aria-label": t("close"), onclick: closeDocked }, "×")
      )
    );

    const body = pending ? null : [
      result.redFlags.length
        ? el("ul", { class: "purr-flags" }, result.redFlags.slice(0, 3).map((f) =>
            el("li", {}, el("strong", {}, f.flag), " ", f.why)))
        : null,
      result.advice ? el("p", { class: "purr-advice" }, result.advice) : null,
      result.basic ? el("p", { class: "purr-note" }, t("basicCheckOnly")) : null,
    ];

    const actions = pending ? [] : (opts.actions || []).slice(0, 3);
    const card = el(
      "section",
      { class: `purr-card purr-${level || "thinking"}` + (opts.container ? " purr-inline" : " purr-docked"), role: "dialog", "aria-live": "polite" },
      header,
      body,
      actions.length
        ? el("div", { class: "purr-actions" }, actions.map((a) =>
            el("button", { class: a.primary ? "purr-btn purr-btn-primary" : "purr-btn", type: "button",
              onclick: () => { if (!opts.container) closeDocked(); a.onClick(); } }, a.label)))
        : null
    );

    if (opts.container) {
      opts.container.replaceChildren(card);
    } else {
      closeDocked();
      docked = card;
      document.body.append(card);
    }
    if (!pending && level !== "green" && UI.env.settings.voice !== false && opts.autoSpeak) {
      UI.speak(spokenText(result), result.language);
    }
    return card;
  };

  UI.closeVerdictCard = closeDocked;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDocked(); });
})();
