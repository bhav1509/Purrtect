// Local scoring and masking. Runs in content scripts, the service worker and Node (tests).
// Rules come from rules.json, a copy of shared/rules.json (see README).
(function (root) {
  "use strict";

  const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')\]]*)?)/gi;
  const IP_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  const ASCII_RE = /^[\x00-\x7f]+$/;

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ASCII terms match on word boundaries, CJK/Devanagari terms match as substrings.
  function termMatches(text, term) {
    const t = term.toLowerCase();
    if (!ASCII_RE.test(t)) return text.includes(t);
    return new RegExp("(^|[^a-z0-9])" + escapeRe(t) + "($|[^a-z0-9])", "i").test(text);
  }

  function extractLinks(text) {
    const links = [];
    for (const m of text.matchAll(URL_RE)) {
      let raw = m[1].replace(/[.,;:!?]+$/, "");
      const withScheme = /^https?:\/\//i.test(raw) ? raw : "http://" + raw;
      try {
        const host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
        if (host.includes(".")) links.push({ raw, host });
      } catch (_) { /* not a URL */ }
    }
    return links;
  }

  function hostMatchesDomain(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  // "amaz0n-in.com", "paypal.secure-login.top": brand name inside a host it doesn't own.
  function looksLikeBrand(host, brand) {
    const squashed = host.replace(/0/g, "o").replace(/1/g, "l").replace(/[-_]/g, "");
    return brand.domains.some((d) => {
      const label = d.split(".")[0];
      return label.length >= 4 && squashed.includes(label);
    });
  }

  function score(text, rules) {
    const lower = (text || "").toLowerCase();
    const P = rules.points;
    const reasons = [];
    let total = 0;

    for (const [category, cfg] of Object.entries(rules.keywords)) {
      const hits = cfg.terms.filter((t) => termMatches(lower, t));
      if (!hits.length) continue;
      const pts = Math.max(-P.max_per_category, Math.min(hits.length * cfg.points, P.max_per_category));
      total += pts;
      reasons.push({ code: "keyword_" + category, points: pts, detail: hits.slice(0, 3).join(", ") });
    }

    const links = extractLinks(text || "");
    const seen = new Set();
    for (const { host } of links) {
      if (seen.has(host)) continue;
      seen.add(host);
      if (IP_HOST_RE.test(host)) {
        total += P.ip_address_link;
        reasons.push({ code: "ip_address_link", points: P.ip_address_link, detail: host });
      }
      if (host.split(".").some((part) => part.startsWith("xn--"))) {
        total += P.punycode_link;
        reasons.push({ code: "punycode_link", points: P.punycode_link, detail: host });
      }
      const ending = rules.risky_domain_endings.find((e) => host.endsWith(e));
      if (ending) {
        total += P.risky_domain_ending;
        reasons.push({ code: "risky_domain_ending", points: P.risky_domain_ending, detail: host });
      }
      if (rules.url_shorteners.some((s) => hostMatchesDomain(host, s))) {
        total += P.url_shortener;
        reasons.push({ code: "url_shortener", points: P.url_shortener, detail: host });
      }
      for (const brand of rules.brands) {
        const official = brand.domains.some((d) => hostMatchesDomain(host, d));
        if (!official && looksLikeBrand(host, brand)) {
          total += P.lookalike_domain;
          reasons.push({ code: "lookalike_domain", points: P.lookalike_domain, detail: host + " ≠ " + brand.name });
        }
      }
    }
    if (seen.size >= 4) {
      total += P.many_links;
      reasons.push({ code: "many_links", points: P.many_links, detail: String(seen.size) });
    }

    // Brand named in the text, but links point somewhere that brand doesn't own.
    if (seen.size) {
      for (const brand of rules.brands) {
        if (!brand.aliases.some((a) => termMatches(lower, a))) continue;
        const offsite = [...seen].filter((h) => !brand.domains.some((d) => hostMatchesDomain(h, d)));
        if (offsite.length === seen.size) {
          total += P.brand_impersonation;
          reasons.push({ code: "brand_impersonation", points: P.brand_impersonation, detail: brand.name + " → " + offsite[0] });
          break;
        }
      }
    }

    total = Math.max(0, Math.min(total, 100));
    const verdict =
      total >= rules.thresholds.dangerous ? "dangerous" :
      total >= rules.thresholds.suspicious ? "suspicious" : "safe";
    return { score: total, verdict, reasons, links: [...seen] };
  }

  // Mask personal data before anything leaves the browser. Link hosts stay visible.
  const MASKS = [
    [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[EMAIL]"],
    [/\b(?:\d{4}[ -]){3}\d{1,7}\b|\b[3-6]\d{12,18}\b/g, "[CARD]"],
    [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[ID_NUMBER]"],          // Aadhaar-style 12 digits
    [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[ID_NUMBER]"],             // PAN
    [/\+\d{1,3}(?:[\s-]?\d){6,12}\b|\b00\d{1,3}[\s-]\d(?:[\s-]?\d){5,11}\b/g, "[PHONE]"],
    [/\b0\d{1,4}[\s-]\d{1,4}[\s-]\d{3,4}\b/g, "[PHONE]"],   // JP/UK style 090-1234-5678
    [/\b[6-9]\d{9}\b/g, "[PHONE]"],                          // IN mobile
    [/\b1[3-9]\d{9}\b/g, "[PHONE]"],                         // CN mobile
    [/\b\d{9,18}\b/g, "[ACCOUNT]"],
    [/((?:otp|code|pin|passcode|ओटीपी|验证码|認証コード|暗証番号)[^\d\n]{0,20})\d{4,8}/gi, "$1[CODE]"]
  ];

  function mask(text) {
    let out = text || "";
    for (const [re, label] of MASKS) out = out.replace(re, label);
    return out;
  }

  const api = { score, mask, extractLinks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PurrRules = api;
})(typeof self !== "undefined" ? self : this);
