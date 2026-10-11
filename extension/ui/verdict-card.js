// Floating card with the verdict, reasons, advice, mascot picker and a "something went wrong" button.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.verdictCard) return;

  let current = null;

  function close() {
    if (current) current.remove();
    current = null;
  }

  function list(items) {
    return items.length ? UI.el("ul", {}, items.map((i) => UI.el("li", {}, i))) : null;
  }

  // result: { verdict, score, summary?, red_flags?, what_to_do?, rules: {reasons}, pending? }
  UI.verdictCard = function verdictCard(result) {
    close();
    const state = result.pending ? "checking" : result.verdict;
    const ruleReasons = (result.rules?.reasons || []).filter((r) => r.points > 0).map((r) => UI.t("reason_" + r.code) + (r.detail ? ` (${r.detail})` : ""));

    const picker = UI.el(
      "div",
      { class: "purr-picker" },
      UI.MASCOTS.map((m) =>
        UI.el(
          "button",
          {
            type: "button",
            class: "purr-pick" + (UI.settings.mascot === m ? " purr-picked" : ""),
            title: UI.t("mascot_" + m),
            onclick: () => { UI.setSetting("mascot", m); },
          },
          UI.t("mascot_" + m)
        )
      )
    );

    current = UI.el(
      "div",
      { class: `purr-card purr-${state}`, role: "dialog", "aria-label": UI.t("extName") },
      UI.el("button", { class: "purr-close", type: "button", "aria-label": UI.t("close"), onclick: close }, "×"),
      UI.el(
        "div",
        { class: "purr-card-head" },
        UI.mascotImg(state, 72),
        UI.el(
          "div",
          {},
          UI.el("div", { class: "purr-card-title" }, result.pending ? UI.t("checking") : UI.t("verdict_" + result.verdict)),
          result.pending ? null : UI.el("div", { class: "purr-card-score" }, UI.t("riskScore", [String(result.score)]))
        )
      ),
      result.summary ? UI.el("p", { class: "purr-summary" }, result.summary) : null,
      (result.red_flags?.length || ruleReasons.length)
        ? UI.el("div", {}, UI.el("h4", {}, UI.t("redFlags")), list(result.red_flags?.length ? result.red_flags : ruleReasons))
        : null,
      result.what_to_do?.length ? UI.el("div", {}, UI.el("h4", {}, UI.t("whatToDo")), list(result.what_to_do)) : null,
      result.offline ? UI.el("p", { class: "purr-note" }, UI.t("offlineNote")) : null,
      UI.el("button", { class: "purr-help-btn", type: "button", onclick: () => { close(); UI.recoveryPanel(); } }, UI.t("iClickedIt")),
      picker
    );
    document.body.append(current);
    return current;
  };

  UI.closeVerdictCard = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
