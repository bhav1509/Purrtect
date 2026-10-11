// Intercepts link clicks inside a flagged message and asks "are you sure?" before opening.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.guardLinks) return;

  function confirmOpen(href, result) {
    return new Promise((resolve) => {
      let host = href;
      try { host = new URL(href).hostname; } catch (_) { /* keep raw */ }
      const done = (ok) => { overlay.remove(); resolve(ok); };
      const overlay = UI.el(
        "div",
        { class: "purr-overlay", onclick: (e) => { if (e.target === overlay) done(false); } },
        UI.el(
          "div",
          { class: `purr-warning purr-${result.verdict}`, role: "alertdialog" },
          UI.mascotImg(result.verdict, 96),
          UI.el("h3", {}, UI.t("clickWarningTitle")),
          UI.el("p", {}, UI.t("clickWarningBody", [host])),
          UI.el(
            "div",
            { class: "purr-warning-actions" },
            UI.el("button", { class: "purr-btn-safe", type: "button", onclick: () => done(false) }, UI.t("goBack")),
            UI.el("button", { class: "purr-btn-risky", type: "button", onclick: () => done(true) }, UI.t("openAnyway"))
          )
        )
      );
      document.body.append(overlay);
      overlay.querySelector(".purr-btn-safe").focus();
    });
  }

  // getResult is read at click time so a later AI verdict (e.g. downgrade to safe) applies.
  UI.guardLinks = function guardLinks(container, getResult) {
    if (container.dataset.purrGuarded) return;
    container.dataset.purrGuarded = "1";
    container.addEventListener(
      "click",
      async (e) => {
        const a = e.target.closest("a[href]");
        const result = getResult();
        if (!a || !result || result.verdict === "safe" || a.dataset.purrAllowed) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (await confirmOpen(a.href, result)) {
          window.open(a.href, "_blank", "noopener,noreferrer");
        }
      },
      true
    );
  };
})();
