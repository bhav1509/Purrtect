// Text contrast checker for the browser tests (WCAG 2.1): every element with its own visible text,
// against the colour behind it (walking up through see-through layers; for gradients the worst stop).
// Normal text needs 4.5:1; large text (24 px+, or 18.66 px+ bold) needs 3:1.
"use strict";

// Runs inside the page. root: a selector; returns [{ text, ratio, need, fg, bg }] for failing elements.
function auditContrast(rootSelector) {
  const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // background layers from the element up to the page; gradients give several candidate colours
  const backgrounds = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);
      if (stops.length) { layers.push(stops); if (stops.every((s) => s[3] >= 1)) break; }
      const bg = parse(cs.backgroundColor);
      if (bg && bg[3] > 0) { layers.push([bg]); if (bg[3] >= 1) break; }
    }
    const page = parse(getComputedStyle(document.documentElement).backgroundColor);
    let result = [page && page[3] > 0 ? page : parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1]];
    if (result[0][3] < 1) result = [[255, 255, 255, 1]];
    for (let i = layers.length - 1; i >= 0; i--) result = layers[i].flatMap((top) => result.map((u) => over(top, u)));
    return result;
  };
  const root = document.querySelector(rootSelector) || document;
  const bad = [];
  for (const el of root.querySelectorAll("*")) {
    const own = [...el.childNodes].filter((t) => t.nodeType === 3).map((t) => t.textContent.trim()).join(" ").trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || r.width === 0 || r.height === 0 || +cs.opacity === 0) continue;
    if (el.closest("[hidden], .sr-only, [aria-hidden='true']")) continue;
    // gradient-painted text (background-clip: text): the text colours are the gradient's stops, the
    // background is whatever is behind the element
    const clipText = /text/.test(cs.webkitBackgroundClip || cs.backgroundClip || "");
    const fgs = clipText ? (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean) : [parse(cs.color)];
    if (!fgs.length || !fgs[0]) continue;
    const bgs = backgrounds(clipText ? el.parentElement : el);
    // text inside a dimmed area (e.g. settings while Purrtect is off) is meant to look disabled: skip
    let dim = 1; for (let n = el; n; n = n.parentElement) dim *= +getComputedStyle(n).opacity;
    if (dim < 0.95) continue;
    const size = parseFloat(cs.fontSize), weight = +cs.fontWeight || 400;
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const worst = Math.min(...fgs.flatMap((fg) => bgs.map((b) => ratio(over(fg, b), b))));
    if (worst < need - 0.05) bad.push({ text: own.slice(0, 40), ratio: Math.round(worst * 100) / 100, need, fg: clipText ? "gradient" : cs.color, bg: `rgb(${bgs[0].slice(0, 3).map(Math.round).join(",")})` });
  }
  return bad;
}

// From the test: list failing text inside rootSelector on page.
const contrastFailures = (page, rootSelector = "body") => page.evaluate(auditContrast, rootSelector);
module.exports = { contrastFailures, auditContrast };
