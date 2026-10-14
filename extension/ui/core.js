// Platform-neutral UI helpers, shared by the extension and the web checker.
// Each host calls PurrUI.configure(env) once:
//   env.messages     i18n table for the chosen UI language (chrome _locales format)
//   env.fallback     English table, used for missing keys
//   env.assetUrl(p)  absolute URL for a packaged file such as "mascots/cat/stop.png"
//   env.api(path, body) -> Promise<{ ok, status, data }>
//   env.settings     { mascot, voice, country, uiLang }
(function () {
  "use strict";
  if (self.PurrUI) return;

  let env = null;

  function configure(e) {
    env = e;
    document.querySelectorAll("img[data-purr-state]").forEach((img) => { img.src = mascotUrl(img.dataset.purrState); });
  }

  function t(key, subs) {
    const entry = (env && (env.messages[key] || env.fallback[key])) || null;
    if (!entry) return key;
    return [].concat(subs || []).reduce((s, v, i) => s.split("$" + (i + 1)).join(String(v)), entry.message);
  }

  // UI language code for the API: zh_CN -> zh.
  function apiLang() {
    return (env.settings.uiLang || "en").replace("zh_CN", "zh");
  }

  // Mood images are still pictures (the logo cat with a small badge), so "reduce motion" needs nothing extra.
  function mascotUrl(state) {
    return env.assetUrl(`mascots/cat/${state}.png`);
  }

  function mascotImg(state, size, extraClass) {
    const img = el("img", { class: "purr-mascot " + (extraClass || ""), alt: "", width: size, height: size, draggable: "false" });
    img.dataset.purrState = state;
    img.src = mascotUrl(state);
    return img;
  }

  function mascotLine(state) {
    const key = `line_${env.settings.mascot || "cat"}_${state}`;
    const line = t(key);
    return line === key ? "" : line;
  }

  // el("div", { class: "x", onclick: fn }, child, "text", [more])
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // ----- read aloud: one button that cycles Listen -> Pause -> Resume, in the UI language -----
  const SPEECH_LANG = { en: "en-US", hi: "hi-IN", ja: "ja-JP", zh: "zh-CN" };
  let speechButton = null;

  function voices() {
    const list = speechSynthesis.getVoices();
    if (list.length) return Promise.resolve(list);
    return new Promise((resolve) => {
      const done = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener("voiceschanged", done, { once: true });
      setTimeout(done, 1000);
    });
  }

  function setSpeechLabel(button, state) {
    if (!button) return;
    const [icon, key] = { idle: ["▶", "listen"], playing: ["⏸", "pause"], paused: ["▶", "resume"] }[state];
    button.dataset.state = state;
    button.replaceChildren(el("span", { "aria-hidden": "true" }, icon), " ", t(key));
  }

  function stopSpeech() {
    if ("speechSynthesis" in self) speechSynthesis.cancel();
    setSpeechLabel(speechButton, "idle");
    speechButton = null;
  }

  // Returns the button; text() is read when it is first pressed.
  function speechControl(text) {
    if (!("speechSynthesis" in self)) return null;
    const button = el("button", { type: "button", class: "purr-voice", "data-state": "idle" });
    const note = el("span", { class: "purr-note purr-voice-note", hidden: true }, t("noVoice"));
    button.addEventListener("click", async () => {
      const state = button.dataset.state;
      if (speechButton === button && state === "playing") { speechSynthesis.pause(); setSpeechLabel(button, "paused"); return; }
      if (speechButton === button && state === "paused") { speechSynthesis.resume(); setSpeechLabel(button, "playing"); return; }
      stopSpeech();
      const lang = SPEECH_LANG[apiLang()] || "en-US";
      const voice = (await voices()).find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
      if (!voice) { note.hidden = false; return; }  // never read Hindi/Japanese/Chinese in an English voice
      const u = new SpeechSynthesisUtterance(text());
      u.lang = lang;
      u.voice = voice;
      u.rate = 0.95;
      u.onend = () => { if (speechButton === button) { setSpeechLabel(button, "idle"); speechButton = null; } };
      speechButton = button;
      setSpeechLabel(button, "playing");
      speechSynthesis.speak(u);
    });
    setSpeechLabel(button, "idle");
    return el("span", { class: "purr-voice-wrap" }, button, note);
  }

  // ----- popups open next to whatever opened them (a widget, the selection, a link) -----
  // anchor: an Element (followed on scroll) or a DOMRect. Without one, the popup docks top-right.
  function placeNear(node, anchor) {
    node.classList.add("purr-floating");
    const place = (e) => {
      if (!node.isConnected) { cleanup(); return; }
      if (e && e.type === "scroll" && e.target instanceof Node && node.contains(e.target)) return;   // scrolling inside the card itself
      const r = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
      if (!r) return;
      const gap = 8;
      const w = node.offsetWidth;
      const keep = node.scrollTop;                     // measuring resets the card's own scroll; put it back after
      node.style.maxHeight = "";                       // measure at full height first
      const h = node.offsetHeight;
      const below = innerHeight - r.bottom - gap - 8;  // room under the anchor
      const above = r.top - gap - 8;                   // room over it
      // Below if it fits, else above if it fits, else the roomier side, scrolling inside itself:
      // the card never covers what opened it (the badge, the link, the selected text).
      const goBelow = h <= below || (h > above && below >= above);
      const room = goBelow ? below : above;
      if (h > room) node.style.maxHeight = `${Math.max(160, Math.floor(room))}px`;
      const shown = Math.min(h, Math.max(160, room));
      let top = goBelow ? r.bottom + gap : r.top - gap - shown;
      top = Math.max(8, Math.min(top, innerHeight - shown - 8));
      let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
      node.style.top = `${Math.round(top)}px`;
      node.style.left = `${Math.round(left)}px`;
      node.scrollTop = keep;
    };
    // Place again when the card's content changes size ("checking…" becomes the verdict, the mascot
    // image loads), so a card that grows still fits the window and scrolls instead of running off it.
    let queued = false;
    const later = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; place(); }); } };
    const sizes = new ResizeObserver(later);
    const watchChildren = () => { sizes.disconnect(); sizes.observe(node); [...node.children].forEach((c) => sizes.observe(c)); };
    const changes = new MutationObserver(() => { watchChildren(); later(); });
    const cleanup = () => {
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
      sizes.disconnect();
      changes.disconnect();
    };
    if (anchor) {
      node.style.right = "auto";
      requestAnimationFrame(place);
      addEventListener("scroll", place, true);
      addEventListener("resize", place);
      watchChildren();
      changes.observe(node, { childList: true });
    }
    return cleanup;
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const old = button.textContent;
      button.textContent = t("copied");
      setTimeout(() => { button.textContent = old; }, 1500);
    } catch (_) { /* clipboard blocked; the text is still selectable */ }
  }

  // Turns an API scan reply, or a local-only score, into what the verdict card shows.
  const LEVEL_OF = { safe: "green", suspicious: "yellow", scam: "red" };

  function resultFromApi(data, local) {
    return {
      level: LEVEL_OF[data.verdict] || "yellow",
      basic: false,
      headline: data.headline,
      scamType: data.scam_type,
      redFlags: data.red_flags || [],
      advice: data.advice,
      local,
    };
  }

  // basic=true: the backend was unavailable. basic=false: green, judged in the browser only.
  function resultFromLocal(local, basic) {
    return {
      level: local.level,
      basic: basic !== false,
      localOnly: basic === false,
      headline: t("headline_" + local.level),
      scamType: null,
      redFlags: local.level === "green" ? [] : local.hits.slice(0, 3).map((h) => ({ flag: t("hit_" + h), why: t("hitwhy_" + h) })),
      advice: t("advice_" + local.level),
      local,
    };
  }

  self.PurrUI = {
    configure, t, apiLang, el, mascotImg, mascotUrl, mascotLine, speechControl, stopSpeech, placeNear, copyText,
    resultFromApi, resultFromLocal,
    get env() { return env; },
  };
})();
