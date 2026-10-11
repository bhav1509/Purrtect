// "I clicked or paid": up to 4 tap-only questions, then a Now / Today / Next days plan,
// verified contacts and ready-to-copy drafts. Shared by the extension and the web checker.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.recoveryPanel) return;

  const HAPPENED = ["opened_link", "typed_password", "shared_otp", "paid", "installed_app", "shared_id"];
  const COUNTRIES = ["IN", "SG", "AU", "ID", "PH", "JP"];
  const PAYMENT = ["card", "bank_transfer", "upi_or_wallet", "none"];
  const WHEN = ["minutes", "hours", "days"];
  let docked = null;

  function choiceGroup(name, values, multi, selected) {
    const { el, t } = UI;
    return el(
      "div",
      { class: "purr-choices", role: multi ? "group" : "radiogroup" },
      values.map((v) => {
        const b = el("button", { type: "button", class: "purr-choice", "aria-pressed": String(selected.includes(v)), "data-value": v }, t(`${name}_${v}`));
        b.addEventListener("click", () => {
          const on = multi ? b.getAttribute("aria-pressed") !== "true" : true;
          if (!multi) b.parentElement.querySelectorAll(".purr-choice").forEach((o) => o.setAttribute("aria-pressed", "false"));
          b.setAttribute("aria-pressed", String(on));
        });
        return b;
      })
    );
  }

  function picked(group) {
    return [...group.querySelectorAll('.purr-choice[aria-pressed="true"]')].map((b) => b.dataset.value);
  }

  function contactsBlock(row) {
    const { el, t } = UI;
    if (!row) return el("div", { class: "purr-contacts" }, el("p", {}, t("callBankFallback")));
    const item = (c) => el(
      "li",
      {},
      c.label,
      c.number ? [": ", el("a", { href: "tel:" + c.number.replace(/[^\d+#]/g, ""), class: "purr-number" }, c.number)] : null,
      c.url ? [": ", el("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", "data-purr-allowed": "1" }, c.url.replace(/^https?:\/\//, ""))] : null,
      c.email ? [": ", el("a", { href: "mailto:" + c.email }, c.email)] : null
    );
    return el(
      "div",
      { class: "purr-contacts" },
      el("h4", {}, t("officialHelp", [row.name])),
      el("h5", {}, t("callFirst")), el("ul", {}, row.call_first.map(item)),
      el("h5", {}, t("reportOnline")), el("ul", {}, row.report_online.map(item)),
      row.other.length ? [el("h5", {}, t("otherHelp")), el("ul", {}, row.other.map(item))] : null
    );
  }

  function draft(titleKey, text) {
    const { el, t } = UI;
    const btn = el("button", { type: "button", class: "purr-btn purr-copy" }, t("copy"));
    btn.addEventListener("click", () => UI.copyText(text, btn));
    return el("div", { class: "purr-draft" }, el("div", { class: "purr-draft-head" }, el("h5", {}, t(titleKey)), btn), el("pre", {}, text));
  }

  function planView(plan, row, basic) {
    const { el, t } = UI;
    const steps = (key, list) => list.length ? [el("h4", {}, t(key)), el("ol", { class: "purr-steps" }, list.map((s) => el("li", {}, s)))] : null;
    return el(
      "div",
      { class: "purr-plan" },
      el("p", { class: "purr-reassure" }, t("reassurance")),
      steps("planNow", plan.now),
      contactsBlock(row),
      steps("planToday", plan.today),
      steps("planNextDays", plan.next_days),
      plan.report_draft ? draft("draftReport", plan.report_draft) : null,
      plan.bank_message_draft ? draft("draftBank", plan.bank_message_draft) : null,
      plan.timeline ? draft("draftTimeline", plan.timeline) : null,
      basic ? el("p", { class: "purr-note" }, t("basicPlanOnly")) : null
    );
  }

  function basicPlan() {
    const t = UI.t;
    return {
      now: [t("basic_now_1"), t("basic_now_2"), t("basic_now_3")],
      today: [t("basic_today_1"), t("basic_today_2")],
      next_days: [t("basic_next_1"), t("basic_next_2")],
    };
  }

  // opts.container: render inline (web checker); otherwise a docked side panel.
  UI.recoveryPanel = function recoveryPanel(opts) {
    opts = opts || {};
    const { el, t } = UI;
    if (!opts.container && docked) docked.remove();

    const settings = UI.env.settings;
    const qHappened = choiceGroup("happened", HAPPENED, true, []);
    const qCountry = choiceGroup("country", COUNTRIES, false, [settings.country || "IN"]);
    const qPayment = choiceGroup("payment", PAYMENT, false, ["none"]);
    const qWhen = choiceGroup("when", WHEN, false, ["minutes"]);
    const output = el("div", { class: "purr-recovery-output", "aria-live": "polite" });
    const submit = el("button", { type: "button", class: "purr-btn purr-btn-primary" }, t("showPlan"));

    submit.addEventListener("click", async () => {
      submit.disabled = true;
      output.replaceChildren(el("p", { class: "purr-thinking" }, UI.mascotImg("thinking", 40), t("makingPlan")));
      const body = {
        what_happened: picked(qHappened),
        country: picked(qCountry)[0] || "IN",
        payment_method: picked(qPayment)[0] || "none",
        when: picked(qWhen)[0] || "minutes",
        lang: UI.apiLang(),
      };
      if (opts.onCountry) opts.onCountry(body.country);
      const res = await UI.env.api("/api/recover", body);
      submit.disabled = false;
      if (res.ok) output.replaceChildren(planView(res.data, res.data.contacts, false));
      else output.replaceChildren(planView(basicPlan(), res.data && res.data.contacts, true));
      output.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const close = opts.container ? null : el("button", { class: "purr-icon-btn", type: "button", "aria-label": t("close"),
      onclick: () => { panel.remove(); docked = null; } }, "×");

    const panel = el(
      "section",
      { class: "purr-card purr-recovery " + (opts.container ? "purr-inline" : "purr-docked"), role: "dialog" },
      el("div", { class: "purr-card-head" }, UI.mascotImg("careful", 64),
        el("div", { class: "purr-card-heading" }, el("div", { class: "purr-headline" }, t("recoveryTitle"))),
        el("div", { class: "purr-card-tools" }, close)),
      el("p", { class: "purr-never" }, t("neverAsk")),
      el("h4", {}, t("q_happened")), qHappened,
      el("h4", {}, t("q_country")), qCountry,
      el("h4", {}, t("q_payment")), qPayment,
      el("h4", {}, t("q_when")), qWhen,
      submit,
      output
    );

    if (opts.container) opts.container.replaceChildren(panel);
    else { docked = panel; document.body.append(panel); }
    return panel;
  };
})();
