// Shared helpers for the browser tests: Chrome with the unpacked extension, fake Gmail pages,
// settings, and simple pass / fail reporting.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, message) => { console.log((ok ? "  ok    " : "  FAIL  ") + message); if (!ok) failed++; };
const failures = () => failed;

// A fresh Chrome profile with Purrtect loaded from extension/.
async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "purrtect-e2e-"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile,
    enableExtensions: true, pipe: true, args: ["--no-first-run"] });
  const id = await browser.installExtension(path.join(ROOT, "extension"));
  const worker = await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id))).worker();
  const close = async () => { await browser.close(); fs.rmSync(profile, { recursive: true, force: true }); };
  return { browser, id, worker, close };
}

// Merge into the extension's saved settings (modes merged too).
function setSettings(worker, patch) {
  return worker.evaluate(async (p) => {
    const { settings } = await chrome.storage.local.get("settings");
    const s = { ...(settings || {}), onboarded: true, ...p };
    if (p.modes) s.modes = { ...((settings || {}).modes || {}), ...p.modes };
    await chrome.storage.local.set({ settings: s });
  }, patch);
}

// A tab showing `html` at a Gmail address, so the extension treats it as Gmail. Collects page errors.
async function gmailPage(browser, html, viewport = { width: 1000, height: 650 }) {
  const page = await browser.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("https://mail.google.com/")
    ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.continue()));
  await page.setViewport(viewport);
  await page.goto("https://mail.google.com/mail/u/0/", { waitUntil: "domcontentloaded" });
  await sleep(1800);
  return page;
}

// One Gmail message: sender chip + body.
const gmailMessage = (body, sender = { email: "team@gmail.com", name: "Team" }) =>
  `<!doctype html><html><body style="margin:0;height:1400px;font:16px sans-serif;padding:50px"><div class="adn">` +
  `<h3 class="iw"><span class="gD" email="${sender.email}" name="${sender.name}">${sender.name}</span></h3>` +
  `<div class="a3s">${body}</div></div></body></html>`;

// Ask the service worker to run the right-click "Scan with Purrtect" on the Gmail tab.
const rightClickScan = (worker, info) => worker.evaluate(async (i) => {
  const [tab] = await chrome.tabs.query({ url: "https://mail.google.com/*" });
  await self.purrHandleMenuClick({ menuItemId: "purrtect-scan", ...i }, tab);
}, info);

// Centre of the first element matching selector.
const centre = (page, selector) => page.$eval(selector, (n) => { const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });

// A stand-in for the Cloud Run backend, answered inside the test browser (no Gemini calls, no cost).
// /api/scan: verdict from the local score (60+ scam, 30+ suspicious, else safe), headline tagged with the
// requested ui_lang; /api/recover: steps + drafts in the country's language, contacts from countries.json.
// Returns { requests } so tests can look at what was sent.
const COUNTRIES = JSON.parse(fs.readFileSync(path.join(ROOT, "backend", "countries.json"), "utf8"));
const DRAFT_LANG = { IN: "en", SG: "en", AU: "en", PH: "en", ID: "id", JP: "ja" };
async function fakeBackend(browser, id) {
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id));
  const cdp = await target.createCDPSession();
  const requests = [];
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://purrtect-api-*" }] });
  cdp.on("Fetch.requestPaused", async (e) => {
    const url = new URL(e.request.url);
    const body = e.request.postData ? JSON.parse(e.request.postData) : null;
    requests.push({ path: url.pathname, body });
    let out = { ok: true };
    if (url.pathname === "/api/scan") {
      const score = body.local_score || 0;
      const verdict = score >= 60 ? "scam" : score >= 30 ? "suspicious" : "safe";
      out = { verdict, risk_score: score, scam_type: verdict === "safe" ? "none" : "bank_kyc",
        headline: `[${body.ui_lang}] ${verdict === "scam" ? "Do not click this link" : verdict === "safe" ? "Looks fine" : "Be careful"}`,
        red_flags: verdict === "safe" ? [] : [{ flag: "Fake bank link", why: "The link is not the bank's website." }],
        advice: "Delete the message.", message_language: "en" };
    } else if (url.pathname === "/api/recover") {
      const lang = body.country === "IN" && body.lang === "hi" ? "hi" : DRAFT_LANG[body.country] || "en";
      out = { now: ["Call your bank now."], today: ["Report it online."], next_days: ["Watch your statements."],
        report_draft: `[${lang}] report draft`, bank_message_draft: `[${lang}] bank draft`, timeline: `[${lang}] timeline`,
        country: body.country, draft_lang: lang, contacts: COUNTRIES[body.country] };
    }
    await cdp.send("Fetch.fulfillRequest", { requestId: e.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(out)).toString("base64") });
  });
  return { requests };
}

module.exports = { fakeBackend, COUNTRIES, ROOT, CHROME, sleep, check, failures, launch, setSettings, gmailPage, gmailMessage, rightClickScan, centre, puppeteer };
