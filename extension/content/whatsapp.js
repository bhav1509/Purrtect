// WhatsApp Web: check incoming messages in the open chat when they come on screen
// (older history is only checked if you scroll to it). WhatsApp's markup is undocumented;
// all selectors live here, with fallbacks. Failures are silent (manual checks still work).
(function () {
  "use strict";
  const SEL = {
    header: "#main header",
    title: "#main header span[dir='auto'][title], #main header span[title], #main header span[dir='auto']",
    verified: "#main header [data-icon*='verified'], #main header [aria-label*='erified']",
    business: "#main header [data-icon*='business'], #main header [title*='usiness account']",
    incoming: "#main .message-in",
    incomingFallback: "#main [data-id^='false_']",   // incoming message ids start with "false_"
    text: ".copyable-text[data-pre-plain-text] .selectable-text, span.selectable-text, .copyable-text",
  };
  const PHONE_TITLE = /^\+?[\d\s\-()]{7,}$/;

  // A phone number in the header means not saved; a business without the badge is new.
  function chatSender() {
    const titleEl = document.querySelector(SEL.title);
    const title = titleEl ? (titleEl.getAttribute("title") || titleEl.textContent || "").trim() : "";
    if (!title) return null;
    const business = !!document.querySelector(SEL.business);
    const verified = !!document.querySelector(SEL.verified);
    return {
      key: title.toLowerCase(),
      displayName: title,
      business,
      verified,
      newHint: PHONE_TITLE.test(title) || (business && !verified),
    };
  }

  function check(msg) {
    try {
      if (msg.dataset.purrSeen) return;
      msg.dataset.purrSeen = "1";
      const textEl = msg.querySelector(SEL.text);
      const links = [...msg.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => /^https?:/i.test(h));
      // Business template messages (title, body, "View details" buttons) keep their text outside
      // the usual selectable span, so fall back to the whole bubble.
      const text = (textEl && textEl.innerText.trim()) ? textEl.innerText : msg.innerText;
      if (!text.trim() && !links.length) return;
      const sender = chatSender();
      PurrSite.process({
        el: msg,
        anchor: (textEl && textEl.parentElement) || msg,
        text,
        links: [...new Set(links)],
        sender: sender && { ...sender },
      });
    } catch (_) { /* markup changed */ }
  }

  const onScreen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      onScreen.unobserve(e.target);
      check(e.target);
    }
  }, { threshold: 0.3 });

  function watch() {
    let rows = document.querySelectorAll(SEL.incoming);
    if (!rows.length) rows = document.querySelectorAll(SEL.incomingFallback);
    rows.forEach((msg) => {
      if (msg.dataset.purrWatched) return;
      msg.dataset.purrWatched = "1";
      onScreen.observe(msg);
    });
  }

  let timer = null;
  PurrSite.ready.then(() => {
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(watch, 300); })
      .observe(document.body, { childList: true, subtree: true });
    watch();
  });
})();
