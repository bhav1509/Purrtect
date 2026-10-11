// Gmail: check each opened message on screen once.
// Gmail's markup is undocumented and changes; all selectors live here. Failures are silent.
(function () {
  "use strict";
  const SEL = {
    message: "div.adn",          // one message in a thread
    body: "div.a3s",             // message body
    sender: "span.gD",           // sender chip: attributes email="…" name="…"
    anchor: "h3.iw",             // sender line; the badge goes here
  };

  // Gmail sometimes wraps links as https://www.google.com/url?q=<real link>.
  function realHref(a) {
    try {
      const u = new URL(a.href);
      if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === "/url") return u.searchParams.get("q") || a.href;
    } catch (_) { /* keep */ }
    return a.href;
  }

  function scan() {
    document.querySelectorAll(SEL.message).forEach((msg) => {
      try {
        if (msg.dataset.purrSeen || !msg.offsetParent) return;
        const body = msg.querySelector(SEL.body);
        if (!body || !body.innerText.trim()) return;
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
      } catch (_) { /* markup changed; manual scan still works */ }
    });
  }

  let timer = null;
  PurrSite.ready.then(() => {
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 300); })
      .observe(document.body, { childList: true, subtree: true });
    scan();
  });
})();
