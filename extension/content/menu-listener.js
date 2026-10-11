// Receives verdicts from the right-click menu (background.js) and shows the card.
(function () {
  "use strict";
  if (self.purrMenuListener) return;
  self.purrMenuListener = true;

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "ping") reply(true);
    else if (msg.type === "showVerdict") PurrUI.verdictCard(msg.result);
  });
})();
