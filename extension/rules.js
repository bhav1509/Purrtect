// Local scoring and masking, shared by the extension, the web checker and the tests (Node).
// Rules data is rules.json, a copy of shared/rules.json (scripts/sync.sh keeps copies in step).
(function (root) {
  "use strict";

  const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'`)\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'`)\]]*)/gi;
  const IP_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  const ASCII_RE = /^[\x00-\x7f]+$/;
  const SUFFIX_LABELS = new Set(["com", "co", "net", "org", "gov", "go", "or", "ne", "ac", "bank", "jp", "in", "au", "sg", "id", "ph", "cn", "uk", "www"]);

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ASCII terms match whole words; other scripts (Devanagari, CJK, Tamil) match as substrings.
  function hasTerm(lowerText, term) {
    const t = term.toLowerCase();
    if (!ASCII_RE.test(t)) return lowerText.includes(t);
    return new RegExp("(^|[^a-z0-9])" + escapeRe(t) + "($|[^a-z0-9])").test(lowerText);
  }

  function parseUrl(raw) {
    const clean = String(raw).trim().replace(/[.,;:!?]+$/, "");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(clean) ? clean : "http://" + clean;
    try {
      const u = new URL(withScheme);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
      return {
        url: clean,
        host: u.hostname.toLowerCase().replace(/^www\./, ""),
        path: decodeURIComponent(u.pathname + u.search).toLowerCase(),
        explicitHttp: /^http:\/\//i.test(clean),
      };
    } catch (_) {
      return null;
    }
  }

  function extractLinks(text) {
    const out = [];
    for (const m of String(text || "").matchAll(URL_RE)) out.push(m[1].replace(/[.,;:!?]+$/, ""));
    return out;
  }

  function hostIs(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  function mainLabel(domain) {
    return domain.split(".").filter((l) => !SUFFIX_LABELS.has(l)).sort((a, b) => b.length - a.length)[0] || domain;
  }

  function editDistanceIsOne(a, b) {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) === 1;
  }

  // "paypa1-secure.top", "amazon-in.verify.xyz", "hdfcbank.co" -> lookalike of a brand it isn't.
  function lookalikeBrand(host, rules) {
    if (host.split(".").some((l) => l.startsWith("xn--"))) return "punycode";
    const tokens = host.split(/[.-]/);
    const squashed = host.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/1/g, "l")
      .replace(/3/g, "e").replace(/5/g, "s").replace(/-/g, "");
    for (const brand of rules.brands) {
      if (brand.domains.some((d) => hostIs(host, d))) continue;
      for (const d of brand.domains) {
        const label = mainLabel(d);
        if (label.length < 3) continue;
        if (tokens.includes(label) ||
            (label.length >= 6 && squashed.includes(label)) ||
            (label.length >= 6 && tokens.some((t) => editDistanceIsOne(t, label)))) {
          return brand.name;
        }
      }
    }
    return null;
  }

  // A well-known website (or a bank/brand's own domain). Free-hosting sites never count:
  // anyone can put a page on sites.google.com, github.io, web.app and the like.
  function isTrusted(host, rules) {
    if ((rules.trusted_domains || []).includes(host)) return true;   // an exact address (e.g. our own web.app site)
    if ((rules.free_hosting || []).some((d) => hostIs(host, d))) return false;
    return (rules.trusted_domains || []).some((d) => hostIs(host, d)) ||
      rules.brands.some((b) => b.domains.some((d) => hostIs(host, d)));
  }

  // Words match whole parts of the address ("bet" in bet-365.com, not in alphabet.com);
  // longer words (5+ letters) also match inside a part ("1337x" in x1337x).
  function hasWord(parts, words, allowInside) {
    return words.some((w) => parts.some((p) => p === w || (allowInside && w.length >= 5 && p.includes(w))));
  }

  // Tricks in the shape of the address: digits mixed into the name (x1337x, paypa1), lots of
  // hyphens or dots, or a very long name.
  function oddAddress(host) {
    const name = mainLabel(host);
    const mixed = /[a-z]/.test(name) && /\d/.test(name) && !/^\d+[a-z]{1,3}$/.test(name);
    return mixed || (host.match(/-/g) || []).length >= 3 || host.split(".").length >= 5 || host.length > 35;
  }

  // Points for one link, from the link rules only. trusted=true: a well-known website.
  function scoreLink(raw, rules) {
    const parsed = parseUrl(raw);
    if (!parsed) return null;
    const { host, path } = parsed;
    const P = rules.points;
    const hits = [];
    const trusted = isTrusted(host, rules);
    if (parsed.explicitHttp) hits.push("plain_http");
    if (!trusted) {
      const hostParts = host.split(/[.-]/);
      const pathParts = path.split(/[^a-z0-9]+/).filter(Boolean);
      if (IP_HOST_RE.test(host)) hits.push("ip_link");
      if (lookalikeBrand(host, rules)) hits.push("lookalike");
      if (rules.shorteners.some((s) => hostIs(host, s))) hits.push("shortener");
      if (rules.risky_tlds.some((t) => host.endsWith(t))) hits.push("risky_tld");
      if (hasWord(hostParts, rules.risky_site_words || [], true)) hits.push("risky_site");
      if (hasWord([...hostParts, ...pathParts], rules.lure_words || [], false)) hits.push("lure_word");
      if (!IP_HOST_RE.test(host) && oddAddress(host)) hits.push("odd_address");
      if ((rules.free_hosting || []).some((d) => hostIs(host, d))) hits.push("free_hosting");
    }
    const points = hits.reduce((sum, h) => sum + (P[h] || 0), 0);
    return { url: parsed.url, host, hits, points, brand: lookalikeBrand(host, rules), trusted };
  }

  // Display name or WhatsApp business name claims a bank/courier/government it can't back up.
  function claimsInstitution(sender, rules) {
    if (!sender || !sender.displayName) return false;
    const name = sender.displayName.toLowerCase();
    const brand = rules.brands.find((b) => b.aliases.some((a) => hasTerm(name, a)));
    const claims = !!brand || rules.claim_words.some((w) => hasTerm(name, w));
    if (!claims) return false;
    if (sender.business) return !sender.verified;
    const domain = (sender.address || "").split("@")[1];
    if (!domain) return false;
    if (brand) return !brand.domains.some((d) => hostIs(domain.toLowerCase(), d));
    return rules.free_mail_domains.includes(domain.toLowerCase());
  }

  function levelFor(score, rules, sensitivity) {
    const shift = (rules.sensitivity_shift || {})[sensitivity || "normal"] || 0;
    if (score >= rules.levels.red + shift) return "red";
    if (score >= rules.levels.yellow + shift) return "yellow";
    return "green";
  }

  // item: { text, links?, scanText, sender?: { isNew, displayName, address, business, verified } }
  // scanText=false (known sender in Auto mode) checks links and the display name only.
  function scoreMessage(item, rules, sensitivity) {
    const P = rules.points;
    const hits = new Set();
    const text = String(item.text || "");
    const lower = text.toLowerCase();

    if (item.scanText !== false) {
      if (rules.keywords.urgency.some((t) => hasTerm(lower, t))) hits.add("urgency");
      if (rules.keywords.money_secret.some((t) => hasTerm(lower, t))) hits.add("money_secret");
    }
    if (item.sender && item.sender.isNew) hits.add("new_sender");
    if (claimsInstitution(item.sender, rules)) hits.add("display_name_claim");

    const seen = new Set();
    const linkResults = [];
    for (const raw of [...(item.links || []), ...extractLinks(text)]) {
      const r = scoreLink(raw, rules);
      if (!r || seen.has(r.url)) continue;
      seen.add(r.url);
      r.level = levelFor(r.points, rules, sensitivity);
      linkResults.push(r);
      r.hits.forEach((h) => hits.add(h));
    }

    const score = Math.min(100, [...hits].reduce((sum, h) => sum + P[h], 0));
    return { score, level: levelFor(score, rules, sensitivity), hits: [...hits], links: linkResults };
  }

  // Replace personal data with tags before anything leaves the browser. Link hosts stay readable.
  const MASKS = [
    [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[EMAIL]"],
    [/((?:otp|one-time password|code|passcode|pin|ओटीपी|कोड|認証コード|暗証番号|验证码|ஓடிபி|kode)[^\d\n]{0,20})\d{4,8}\b/gi, "$1[OTP]"],
    [/\b\d{4,8}(?=[^\d\n]{0,20}\b(?:is your|is the)\s+(?:otp|code|one-time password)\b)/gi, "[OTP]"],
    [/\b(?:\d{4}[ -]){3}\d{1,7}\b|\b[3-6]\d{12,18}\b/g, "[CARD]"],
    [/\b\d{4}[ -]\d{4}[ -]\d{4}\b|\b[2-9]\d{11}\b/g, "[ID]"],      // Aadhaar / My Number (12 digits)
    [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[ID]"],                         // India PAN
    [/\b[STFGM]\d{7}[A-Z]\b/g, "[ID]"],                          // Singapore NRIC/FIN
    [/\b\d{16}\b/g, "[ID]"],                                      // Indonesia NIK
    [/\+\d{1,3}(?:[\s-]?\d){6,12}\b|\b00\d{1,3}[\s-]\d(?:[\s-]?\d){5,11}\b/g, "[PHONE]"],
    [/\b0\d{1,4}[\s-]\d{1,4}[\s-]\d{3,4}\b/g, "[PHONE]"],        // 090-1234-5678, 0812-3456-7890
    [/\b[6-9]\d{9}\b/g, "[PHONE]"],                              // India mobile
    [/\b08\d{8,11}\b/g, "[PHONE]"],                              // Indonesia mobile
    [/\b09\d{9}\b/g, "[PHONE]"],                                  // Philippines mobile
    [/\b1[3-9]\d{9}\b/g, "[PHONE]"],                             // China mobile
    [/\b\d{9,18}\b/g, "[ACCOUNT]"],
  ];

  function mask(text) {
    let out = String(text || "");
    for (const [re, tag] of MASKS) out = out.replace(re, tag);
    return out;
  }

  const api = { scoreMessage, scoreLink, isTrusted, claimsInstitution, levelFor, extractLinks, parseUrl, mask };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PurrRules = api;
})(typeof self !== "undefined" ? self : this);
