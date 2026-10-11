// Extension-only mascot surfaces: the corner buddy, the yellow badge with hover preview,
// the docked red alert, the "Good choice!" toast and the 10-minute "Entered anything?" banner.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.badge) return;
  const { el, t } = UI;

  // --- corner buddy: idle when nothing is found, thinking while checking ---
  let buddy = null;
  let busy = 0;
  UI.buddy = function buddyMount(onClick) {
    if (buddy) return buddy;
    buddy = el("button", { class: "purr-buddy", type: "button", title: t("buddyHint"), "aria-label": t("buddyHint"), onclick: onClick },
      UI.mascotImg("idle", 44));
    document.body.append(buddy);
    return buddy;
  };
  UI.buddyState = function buddyState(state) {
    if (!buddy) return;
    const img = buddy.querySelector("img");
    img.dataset.purrState = state;
    img.src = UI.mascotUrl(state);
  };
  UI.buddyBusy = function buddyBusy(delta) {
    busy = Math.max(0, busy + delta);
    UI.buddyState(busy ? "thinking" : "idle");
  };

  // --- yellow badge next to a message; hover shows the headline ---
  UI.badge = function badge(result, onOpen) {
    const node = el("span", { class: "purr-badge-wrap" });
    const render = (r) => {
      const state = r.pending ? "thinking" : r.level === "red" ? "stop" : "careful";
      const label = r.pending ? (UI.mascotLine("thinking") || t("checking")) : t("level_" + r.level);
      node.replaceChildren(
        el("button", { type: "button", class: `purr-badge purr-${r.pending ? "thinking" : r.level}`,
          onclick: (e) => { e.preventDefault(); e.stopPropagation(); onOpen(); } },
          UI.mascotImg(state, 24), el("span", {}, label)),
        r.pending ? null : el("span", { class: "purr-preview", role: "tooltip" }, r.headline)
      );
    };
    render(result);
    node.update = render;
    return node;
  };

  // --- red: larger docked mascot with a short warning ---
  let alertNode = null;
  UI.dockAlert = function dockAlert(result, onOpen) {
    if (alertNode) alertNode.remove();
    alertNode = el(
      "div",
      { class: "purr-alert", role: "alert" },
      UI.mascotImg("stop", 88),
      el("div", { class: "purr-alert-text" },
        el("div", { class: "purr-alert-line" }, UI.mascotLine("stop") || t("level_red")),
        el("div", { class: "purr-headline" }, result.headline),
        el("button", { type: "button", class: "purr-btn purr-btn-primary",
          onclick: () => { alertNode.remove(); alertNode = null; onOpen(); } }, t("whyRisky"))),
      el("button", { class: "purr-icon-btn", type: "button", "aria-label": t("close"),
        onclick: () => { alertNode.remove(); alertNode = null; } }, "×")
    );
    document.body.append(alertNode);
  };

  // --- short toast: "Good choice!" after Go back or "This is safe", and hints ---
  UI.toast = function toast(state, text, ms) {
    document.querySelectorAll(".purr-toast").forEach((n) => n.remove());
    const node = el("div", { class: "purr-toast", role: "status" }, UI.mascotImg(state, 56), el("span", {}, text));
    document.body.append(node);
    setTimeout(() => node.remove(), ms || 2500);
  };
  UI.happy = function happy() {
    UI.toast("happy", UI.mascotLine("happy") || t("goodChoice"));
  };

  // --- banner for 10 minutes after "Open anyway" ---
  let banner = null;
  let bannerTimer = null;
  UI.recoveryBanner = function recoveryBanner(openedAt, onOpen) {
    const left = openedAt + 10 * 60 * 1000 - Date.now();
    if (banner) { banner.remove(); banner = null; }
    clearTimeout(bannerTimer);
    if (left <= 0) return;
    banner = el("button", { type: "button", class: "purr-banner", onclick: onOpen }, UI.mascotImg("careful", 32), t("enteredAnything"));
    document.body.append(banner);
    bannerTimer = setTimeout(() => { if (banner) banner.remove(); banner = null; }, left);
  };
})();
