// Gmail: check each opened message when it comes on screen. Gmail's markup is undocumented;
// all selectors live here, with fallbacks. Failures are silent (manual checks still work).
(function () {
  "use strict";
  const SEL = {
    message: "div.adn, div[data-message-id]",   // one message in a thread
    body: "div.a3s, div.ii.gt",                 // message body
    sender: "span.gD[email], span[email][name]", // sender chip: email="…" name="…"
    anchor: "h3.iw, .gE",                         // sender line; the widget goes here
  };

  function check(msg) {
    try {
      const body = msg.querySelector(SEL.body);
      if (!body || !body.innerText.trim() || msg.dataset.purrSeen || PurrSite.quiet()) return;
      msg.dataset.purrSeen = "1";
      const chip = msg.querySelector(SEL.sender);
      const address = chip ? chip.getAttribute("email") || "" : "";
      const displayName = chip ? chip.getAttribute("name") || chip.textContent.trim() : "";
      // Only links the reader can see: Gmail keeps quoted earlier mails (the "•••") hidden in the body.
      const links = [...body.querySelectorAll("a[href]")].filter((a) => a.getClientRects().length)
        .map(PurrSite.realHref).filter((h) => /^https?:/i.test(h));
      PurrSite.process({
        el: body,
        anchor: msg.querySelector(SEL.anchor) || body,
        text: body.innerText,
        links: [...new Set(links)],
        sender: address ? { key: address.toLowerCase(), displayName, address } : null,
      });
    } catch (_) { /* markup changed */ }
  }

  // Only messages actually on screen are checked.
  const onScreen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      onScreen.unobserve(e.target);
      check(e.target);
    }
  }, { threshold: 0.1 });

  function watch() {
    document.querySelectorAll(SEL.message).forEach((msg) => {
      if (msg.dataset.purrWatched || msg.parentElement.closest(SEL.message)) return; // skip nested matches
      msg.dataset.purrWatched = "1";
      onScreen.observe(msg);
    });
    // A collapsed message that gets expanded: check it again once its body appears.
    document.querySelectorAll(`[data-purr-watched]:not([data-purr-seen])`).forEach((msg) => {
      const r = msg.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) check(msg);
    });
  }

  let timer = null;
  PurrSite.ready.then(() => {
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(watch, 300); })
      .observe(document.body, { childList: true, subtree: true });
    addEventListener("purr-rescan", watch);
    watch();
  });
})();
