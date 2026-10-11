// Web checker. Talks to the backend at /api (Firebase rewrites it to Cloud Run).
// For local dev, open index.html?api=http://localhost:8000
(function () {
  "use strict";

  const API = new URLSearchParams(location.search).get("api") || "";
  const LABELS = { safe: "Looks safe", suspicious: "Be careful", dangerous: "Likely a scam" };
  const $ = (id) => document.getElementById(id);

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (_) { /* storage blocked */ }
    return null;
  }

  function setMascot(state) {
    $("mascot").src = `mascots/${$("pet").value}/${state}.png`;
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    children.flat().forEach((c) => c != null && node.append(c));
    return node;
  }

  async function post(path, body) {
    const res = await fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function list(title, items) {
    return items && items.length ? [el("h3", {}, title), el("ul", {}, items.map((i) => el("li", {}, i)))] : null;
  }

  function showResult(r) {
    const out = $("result");
    out.className = `card ${r.verdict}`;
    const flags = r.red_flags && r.red_flags.length
      ? r.red_flags
      : (r.rules?.reasons || []).filter((x) => x.points > 0).map((x) => `${x.code.replace(/_/g, " ")} (${x.detail})`);
    out.replaceChildren(
      el("div", { class: "verdict" }, LABELS[r.verdict]),
      el("div", { class: "score" }, `Risk score: ${r.score} / 100`),
      r.summary ? el("p", { class: "summary" }, r.summary) : null,
      list("Warning signs", flags),
      list("What to do", r.what_to_do),
      r.source === "rules" ? el("p", { class: "note" }, "Quick check only — the AI check was not available.") : null
    );
    out.hidden = false;
    $("recover").hidden = r.verdict === "safe";
    setMascot(r.verdict);
  }

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("submit");
    btn.disabled = true;
    btn.textContent = "Checking…";
    setMascot("checking");
    try {
      showResult(await post("/api/scan", { text: $("text").value, source: "web", lang: $("lang").value }));
    } catch (err) {
      $("result").className = "card";
      $("result").replaceChildren(el("p", {}, "Sorry, the checker is not reachable right now. Please try again in a minute."));
      $("result").hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Check message";
    }
  });

  $("recoverBtn").addEventListener("click", async () => {
    const out = $("recoverOut");
    out.replaceChildren(el("p", {}, "Getting your steps…"));
    setMascot("help");
    store("purr-country", $("country").value);
    try {
      const r = await post("/api/recover", {
        what_happened: [...document.querySelectorAll("#happened input:checked")].map((i) => i.value),
        country: $("country").value,
        lang: $("lang").value,
      });
      const c = r.country;
      out.replaceChildren(
        r.reassurance ? el("p", { class: "summary" }, r.reassurance) : null,
        r.steps.length
          ? el("ol", {}, r.steps.map((s) => el("li", { class: s.urgent ? "urgent" : "" }, el("strong", {}, s.title), el("div", {}, s.detail))))
          : el("p", {}, "Call your bank using the number on your card, change your passwords, and report it to the police."),
        c ? el("div", { class: "contacts" },
          el("h3", {}, `Official help in ${c.name}`),
          el("ul", {},
            c.helplines.map((h) => el("li", {}, `${h.label}: `, el("strong", {}, h.number))),
            c.report_sites.map((s) => el("li", {}, el("a", { href: s.url, target: "_blank", rel: "noopener" }, s.label))))) : null
      );
    } catch (_) {
      out.replaceChildren(el("p", {}, "Call your bank using the number on your card, change your passwords, and report it to the police."));
    }
  });

  $("pet").addEventListener("change", () => { store("purr-pet", $("pet").value); setMascot("checking"); });
  $("lang").addEventListener("change", () => store("purr-lang", $("lang").value));
  $("pet").value = store("purr-pet") || "cat";
  $("lang").value = store("purr-lang") || "en";
  $("country").value = store("purr-country") || "IN";
  setMascot("checking");
})();
