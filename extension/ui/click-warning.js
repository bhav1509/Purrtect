// Click blocking: a red link opens this warning first.
// Go back (recommended) / Why is this risky? / Open anyway.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.guardLinks) return;
  const { el, t } = UI;

  function warn(href, result, handlers, link) {
    let host = href;
    try { host = new URL(href).hostname; } catch (_) { /* keep raw */ }
    const done = () => overlay.remove();
    const overlay = el(
      "div",
      { class: "purr-overlay", onclick: (e) => { if (e.target === overlay) { done(); handlers.onBack(); } } },
      el(
        "div",
        { class: "purr-warning", role: "alertdialog", "aria-labelledby": "purr-warning-title" },
        UI.mascotImg("stop", 112),
        el("div", { class: "purr-alert-line" }, UI.mascotLine("stop")),
        el("h2", { id: "purr-warning-title", class: "purr-headline" }, result.headline || t("clickWarningTitle")),
        el("p", {}, t("clickWarningBody", [host])),
        el(
          "div",
          { class: "purr-actions purr-actions-stack" },
          el("button", { type: "button", class: "purr-btn purr-btn-safe", onclick: () => { done(); handlers.onBack(); } }, t("goBack")),
          el("button", { type: "button", class: "purr-btn", onclick: () => { done(); handlers.onWhy(link); } }, t("whyRisky")),
          el("button", { type: "button", class: "purr-btn purr-btn-quiet", onclick: () => { done(); handlers.onOpen(href); } }, t("openAnyway"))
        )
      )
    );
    document.body.append(overlay);
    overlay.querySelector(".purr-btn-safe").focus();
  }

  // getResult is read at click time, so a later verdict (or "This is safe") applies.
  UI.guardLinks = function guardLinks(container, getResult, handlers) {
    if (container.dataset.purrGuarded) return;
    container.dataset.purrGuarded = "1";
    container.addEventListener(
      "click",
      (e) => {
        const a = e.target.closest("a[href]");
        const result = getResult();
        if (!a || !result || result.level !== "red" || a.dataset.purrAllowed) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        warn(a.href, result, handlers, a);
      },
      true
    );
  };
})();
