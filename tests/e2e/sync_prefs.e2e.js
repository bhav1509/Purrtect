// Browser test: language and country are shared between the website and the extension.
// Uses your installed Chrome with the unpacked extension (extension/) and serves web/ itself.
//
//   cd tests/e2e && npm install && npm test
//   (Chrome elsewhere?  CHROME="/path/to/chrome" npm test)
//
// Steps: extension set to Hindi + Japan -> website opens in Hindi with Japan; website changed to
// Japanese + Singapore -> the extension saves that; website reloaded -> still Japanese + Singapore.
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, message) => { console.log((ok ? "  ok    " : "  FAIL  ") + message); if (!ok) failed++; };

function serveWeb() {   // web/ on a free localhost port (the extension accepts localhost on any port)
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, "web", decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
    if (!file.startsWith(path.join(ROOT, "web")) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

(async () => {
  const server = await serveWeb();
  const site = `http://localhost:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "purrtect-e2e-"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile,
    enableExtensions: true, pipe: true, args: ["--no-first-run"] });
  try {
    const id = await browser.installExtension(path.join(ROOT, "extension"));
    check(id === "pohoamnapbegmpnhdkiimajhkhhaiaja", `extension has its fixed ID (${id})`);
    const worker = await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id))).worker();
    const extPrefs = () => worker.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); return { uiLang: settings.uiLang, country: settings.country }; });
    await worker.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...(settings || {}), onboarded: true, uiLang: "hi", country: "JP" } }); });

    const page = await browser.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const sitePrefs = () => page.evaluate(() => ({ uiLang: document.getElementById("lang").value, country: document.getElementById("country").value, lang: document.documentElement.lang }));

    await page.goto(site, { waitUntil: "networkidle0" }); await sleep(500);
    let s = await sitePrefs();
    check(s.uiLang === "hi" && s.country === "JP" && s.lang === "hi", `website opens with the extension's choice: Hindi + Japan (${JSON.stringify(s)})`);

    await page.select("#lang", "ja"); await page.select("#country", "SG"); await sleep(600);
    const e = await extPrefs();
    check(e.uiLang === "ja" && e.country === "SG", `change on the website reaches the extension: Japanese + Singapore (${JSON.stringify(e)})`);

    await page.reload({ waitUntil: "networkidle0" }); await sleep(500);
    s = await sitePrefs();
    check(s.uiLang === "ja" && s.country === "SG", `after a reload the website still shows Japanese + Singapore (${JSON.stringify(s)})`);

    // without the extension the website still works on its own choice
    const plain = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true });
    const p2 = await plain.newPage(); const errs2 = []; p2.on("pageerror", (er) => errs2.push(er.message));
    await p2.goto(site, { waitUntil: "networkidle0" }); await p2.select("#lang", "zh_CN"); await sleep(500);
    check(await p2.$eval("#lang", (x) => x.value) === "zh_CN" && !errs2.length, "without the extension the website works as before");
    await plain.close();
    check(!errors.length, "no page errors" + (errors.length ? `: ${errors.join("; ")}` : ""));
  } finally {
    await browser.close(); server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(failed ? `\nFAILED: ${failed}` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error("FAILED", err.message); process.exit(1); });
