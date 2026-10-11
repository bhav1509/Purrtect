// "I clicked / I paid" panel: asks what happened, then shows calm, ordered recovery steps.
(function () {
  "use strict";
  const UI = self.PurrUI;
  if (UI.recoveryPanel) return;

  const HAPPENINGS = ["clicked_link", "entered_password", "shared_otp", "paid_money", "installed_app", "shared_id"];
  const COUNTRIES = ["IN", "US", "GB", "JP", "CN", "SG", "AU"];
  const STATIC_STEPS = ["static_step1", "static_step2", "static_step3", "static_step4"];

  function stepList(steps) {
    return UI.el(
      "ol",
      { class: "purr-steps" },
      steps.map((s) => UI.el("li", { class: s.urgent ? "purr-urgent" : "" }, UI.el("strong", {}, s.title), UI.el("div", {}, s.detail)))
    );
  }

  function contacts(country) {
    if (!country) return null;
    return UI.el(
      "div",
      { class: "purr-contacts" },
      UI.el("h4", {}, UI.t("officialHelp", [country.name])),
      UI.el(
        "ul",
        {},
        country.helplines.map((h) => UI.el("li", {}, `${h.label}: `, UI.el("strong", {}, h.number))),
        country.report_sites.map((s) => UI.el("li", {}, UI.el("a", { href: s.url, target: "_blank", rel: "noopener", "data-purr-allowed": "1" }, s.label)))
      )
    );
  }

  UI.recoveryPanel = function recoveryPanel() {
    document.querySelector(".purr-recovery")?.remove();

    const checks = HAPPENINGS.map((h) =>
      UI.el("label", { class: "purr-check" }, UI.el("input", { type: "checkbox", value: h }), UI.t("happened_" + h))
    );
    const countrySelect = UI.el(
      "select",
      { class: "purr-select" },
      COUNTRIES.map((c) => UI.el("option", { value: c }, UI.t("country_" + c)))
    );
    countrySelect.value = UI.settings.country;
    const details = UI.el("textarea", { class: "purr-textarea", rows: 3, placeholder: UI.t("detailsPlaceholder") });
    const output = UI.el("div", { class: "purr-recovery-output" });

    const submit = UI.el("button", { class: "purr-help-btn", type: "button" }, UI.t("getHelp"));
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      output.replaceChildren(UI.el("p", {}, UI.t("checking")));
      UI.setSetting("country", countrySelect.value);
      const res = await UI.send({
        type: "recover",
        payload: {
          what_happened: checks.map((c) => c.querySelector("input")).filter((i) => i.checked).map((i) => i.value),
          details: details.value,
          country: countrySelect.value,
          lang: UI.lang(),
        },
      });
      submit.disabled = false;
      const steps = res?.steps?.length
        ? res.steps
        : STATIC_STEPS.map((k, i) => ({ title: UI.t(k + "_title"), detail: UI.t(k + "_detail"), urgent: i < 2 }));
      output.replaceChildren(
        UI.el("p", { class: "purr-reassure" }, res?.reassurance || UI.t("reassurance")),
        stepList(steps),
        contacts(res?.country)
      );
    });

    const panel = UI.el(
      "div",
      { class: "purr-card purr-recovery purr-help", role: "dialog" },
      UI.el("button", { class: "purr-close", type: "button", "aria-label": UI.t("close"), onclick: () => panel.remove() }, "×"),
      UI.el("div", { class: "purr-card-head" }, UI.mascotImg("help", 72), UI.el("div", { class: "purr-card-title" }, UI.t("recoveryTitle"))),
      UI.el("p", {}, UI.t("reassurance")),
      UI.el("h4", {}, UI.t("whatHappened")),
      checks,
      UI.el("label", { class: "purr-field" }, UI.t("yourCountry"), countrySelect),
      details,
      submit,
      output
    );
    document.body.append(panel);
  };
})();
