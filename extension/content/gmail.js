// Gmail: scan each opened email body. Gmail's markup is undocumented; selectors may need updating.
(function () {
  "use strict";
  const BODY = "div.a3s"; // message body
  const MESSAGE = "div.adn"; // one message in a thread (header + body)

  function scanAll() {
    document.querySelectorAll(BODY).forEach((body) => {
      if (body.dataset.purrScanned || !body.offsetParent) return;
      const message = body.closest(MESSAGE);
      PurrScan.process(body, { source: "gmail", anchor: message || body, showSafe: true });
    });
  }

  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scanAll(); }, 400);
  }).observe(document.body, { childList: true, subtree: true });
  scanAll();
})();
