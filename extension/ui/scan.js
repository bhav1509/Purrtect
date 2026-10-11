// Result window for "Scan with Purrtect" on sites other than Gmail and WhatsApp.
(async function () {
  "use strict";
  await PurrPage.init();
  const { pendingScan } = await chrome.storage.session.get("pendingScan");
  await chrome.storage.session.remove("pendingScan");
  const card = document.getElementById("card");
  const recovery = document.getElementById("recovery");
  if (!pendingScan) {
    card.textContent = PurrUI.t("nothingToScan");
    return;
  }
  const rules = await fetch(chrome.runtime.getURL("rules.json")).then((r) => r.json());
  const { text, links } = pendingScan;
  const local = PurrRules.scoreMessage({ text, links, scanText: true, sender: { isNew: true } }, rules, PurrStore.settings.sensitivity);
  PurrUI.verdictCard({ pending: true }, { container: card });
  const res = await PurrUI.env.api("/api/scan", {
    text: PurrRules.mask(text),
    links: local.links.map((l) => PurrRules.mask(l.url)),
    sender: "new",
    source: "web",
    local_score: local.score,
    local_hits: local.hits,
    ui_lang: PurrUI.apiLang(),
    country: PurrStore.settings.country,
  });
  const result = res.ok ? PurrUI.resultFromApi(res.data, local) : PurrUI.resultFromLocal(local, true);
  PurrUI.verdictCard(result, {
    container: card,
    actions: [{ label: PurrUI.t("iClicked"), primary: true, onClick: () => PurrUI.recoveryPanel({ container: recovery,
      onCountry: (c) => PurrStore.saveSettings({ country: c }) }) }],
  });
})();
