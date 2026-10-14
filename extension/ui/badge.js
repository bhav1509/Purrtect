// Extension-only surfaces: the corner buddy, the widget next to each checked message,
// the "Good choice!" toast and the 10-minute "Entered anything?" banner.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.widget) return;
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

  // --- widget next to each checked message: ✓ green, ! yellow, ⚠ red; click for details ---
  const ICON = { green: "✓", yellow: "!", red: "⚠", pending: "…" };
  UI.widget = function widget(result, onOpen) {
    const node = el("span", { class: "purr-widget-wrap" });
    const render = (r) => {
      const level = r.pending ? "pending" : r.level;
      const label = r.pending ? t("checking") : t("level_" + r.level);
      const button = el("button", { type: "button", class: `purr-widget purr-w-${level}`, title: label, "aria-label": `Purrtect: ${label}`,
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); onOpen(button); } },
        el("span", { class: "purr-widget-icon", "aria-hidden": "true" }, ICON[level]),
        el("span", { class: "purr-widget-label" }, label));
      node.replaceChildren(button);
      const preview = r.awaitingApproval ? t("tapToCheck") : r.headline;
      if (!r.pending && preview) node.append(el("span", { class: "purr-preview", role: "tooltip" }, preview));
    };
    render(result);
    node.update = render;
    node.button = () => node.querySelector(".purr-widget");
    return node;
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
