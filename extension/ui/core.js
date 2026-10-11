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

  function mascotUrl(state) {
    return env.assetUrl(`mascots/${env.settings.mascot || "cat"}/${state}.png`);
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

  const SPEECH_LANG = { en: "en-US", hi: "hi-IN", ja: "ja-JP", zh: "zh-CN", ta: "ta-IN", id: "id-ID", ms: "ms-MY", tl: "fil-PH" };

  function speak(text, lang) {
    if (!("speechSynthesis" in self) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANG[lang] || lang || "en-US";
    u.rate = 0.95;
    speechSynthesis.speak(u);
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
      language: data.message_language,
      local,
    };
  }

  function resultFromLocal(local, basic) {
    return {
      level: local.level,
      basic: basic !== false,
      headline: t("headline_" + local.level),
      scamType: null,
      redFlags: local.hits.slice(0, 3).map((h) => ({ flag: t("hit_" + h), why: t("hitwhy_" + h) })),
      advice: t("advice_" + local.level),
      language: apiLang(),
      local,
    };
  }

  self.PurrUI = {
    configure, t, apiLang, el, mascotImg, mascotUrl, mascotLine, speak, copyText,
    resultFromApi, resultFromLocal,
    get env() { return env; },
  };
})();
