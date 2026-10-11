// WhatsApp Web: check incoming messages in the open chat.
// WhatsApp's markup is undocumented and changes; all selectors live here. Confirm them on
// build day (chat header, business label, verified badge). Failures are silent.
(function () {
  "use strict";
  const SEL = {
    header: "#main header",
    title: "#main header span[dir='auto']",
    verified: "#main header [data-icon*='verified'], #main header [aria-label*='erified']",
    business: "#main header [data-icon*='business'], #main header [title*='usiness account']",
    incoming: "#main div.message-in",
    text: "span.selectable-text",
  };
  const PHONE_TITLE = /^\+?[\d\s\-()]{7,}$/;

  // Who is this chat with? A phone number means not saved; a business without the badge is new.
  function chatSender() {
    const titleEl = document.querySelector(SEL.title);
    const title = titleEl ? (titleEl.getAttribute("title") || titleEl.textContent || "").trim() : "";
    if (!title) return null;
    const business = !!document.querySelector(SEL.business);
    const verified = !!document.querySelector(SEL.verified);
    const unsaved = PHONE_TITLE.test(title);
    return {
      key: title.toLowerCase(),
      displayName: title,
      business,
      verified,
      // Saved personal contacts and verified businesses are known; everyone else starts new.
      newHint: unsaved || (business && !verified),
    };
  }

  function scan() {
    const sender = chatSender();
    document.querySelectorAll(SEL.incoming).forEach((msg) => {
      try {
        if (msg.dataset.purrSeen) return;
        msg.dataset.purrSeen = "1";
        const textEl = msg.querySelector(SEL.text);
        const links = [...msg.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => /^https?:/i.test(h));
        const text = textEl ? textEl.innerText : "";
        if (!text.trim() && !links.length) return;
        PurrSite.process({
          el: msg,
          anchor: (textEl && textEl.parentElement) || msg,
          text,
          links: [...new Set(links)],
          sender: sender && { ...sender },
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
