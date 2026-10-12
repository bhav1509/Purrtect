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

  // Gmail sometimes wraps links as https://www.google.com/url?q=<real link>.
  function realHref(a) {
    try {
      const u = new URL(a.href);
      if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === "/url") return u.searchParams.get("q") || a.href;
    } catch (_) { /* keep */ }
    return a.href;
  }

  function check(msg) {
    try {
      const body = msg.querySelector(SEL.body);
      if (!body || !body.innerText.trim() || msg.dataset.purrSeen) return;
      msg.dataset.purrSeen = "1";
      const chip = msg.querySelector(SEL.sender);
      const address = chip ? chip.getAttribute("email") || "" : "";
      const displayName = chip ? chip.getAttribute("name") || chip.textContent.trim() : "";
      const links = [...body.querySelectorAll("a[href]")].map(realHref).filter((h) => /^https?:/i.test(h));
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
    watch();
  });
})();
