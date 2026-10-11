// Small mascot pill shown next to a scanned message. Clicking it opens the verdict card.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.badge) return;

  UI.badge = function badge(result, onOpen) {
    const state = result.verdict;
    const node = UI.el(
      "button",
      { class: `purr-badge purr-${state}`, type: "button", title: UI.t("badgeTitle") },
      UI.mascotImg(state, 20),
      UI.el("span", {}, UI.t("verdict_" + state))
    );
    node.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onOpen();
    });
    return node;
  };

  UI.updateBadge = function updateBadge(node, result) {
    node.className = `purr-badge purr-${result.verdict}`;
    const img = node.querySelector("img");
    img.dataset.purrState = result.verdict;
    img.src = UI.mascotImg(result.verdict, 20).src;
    node.querySelector("span").textContent = UI.t("verdict_" + result.verdict);
  };
})();
