// WhatsApp Web: scan incoming messages in the open chat. Only risky ones get a badge.
// WhatsApp's markup is undocumented; selectors may need updating.
(function () {
  "use strict";
  const INCOMING = "#main div.message-in";
  const TEXT = "span.selectable-text, div.copyable-text";

  function scanAll() {
    document.querySelectorAll(INCOMING).forEach((msg) => {
      const text = msg.querySelector(TEXT);
      if (!text || msg.dataset.purrScanned) return;
      msg.dataset.purrScanned = "1";
      PurrScan.process(text, { source: "whatsapp", anchor: text.parentElement || msg, showSafe: false });
    });
  }

  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scanAll(); }, 500);
  }).observe(document.body, { childList: true, subtree: true });
  scanAll();
})();
