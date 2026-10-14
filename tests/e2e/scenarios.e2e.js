// Browser tests for the "Try by hand" checklist (To Do List, step 3), section by section, so the whole
// list can be checked with one command. A fake backend answers inside the test browser (no Gemini calls).
//
//   cd tests/e2e && npm install && npm run scenarios
//
// Uses your installed Chrome (CHROME=/path/to/chrome) with the unpacked extension/ (or the release ZIP).
// What can't run headless is noted where it applies: Chrome's permission prompt is skipped by using a
// copy of the extension that already has the all-sites permission.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { ROOT, CHROME, sleep, check, failures, launch, setSettings, gmailPage, gmailMessage, rightClickScan, centre,
  fakeBackend, puppeteer } = require("./helpers");
const { contrastFailures } = require("./contrast");

const visible = (page, selector) => page.evaluate((s) =>
  [...document.querySelectorAll(s)].filter((n) => !n.hidden && getComputedStyle(n).display !== "none" && getComputedStyle(n).visibility !== "hidden").length, selector);
const clickIn = (page, selector, index = 0) => page.evaluate((s, i) => document.querySelectorAll(s)[i].click(), selector, index);
const stored = (worker) => worker.evaluate(async () => (await chrome.storage.local.get("settings")).settings);
const errorsOf = (page) => (page.errors && page.errors.length ? ": " + page.errors[0] : "");

// Three emails: a normal one, a suspicious one and a scam (as the local rules will score them).
const INBOX = `<!doctype html><html><body style="margin:0;height:2400px;font:16px sans-serif;padding:40px">
  <div class="adn" id="m1"><h3 class="iw"><span class="gD" email="friend@gmail.com" name="Asha">Asha</span></h3>
    <div class="a3s"><p>Lunch tomorrow? Notes: <a id="known" href="https://github.com/bhav1509/Purrtect">github.com/bhav1509/Purrtect</a></p></div></div>
  <div class="adn" id="m2" style="margin-top:120px"><h3 class="iw"><span class="gD" email="offers@shop-deals.xyz" name="Deals">Deals</span></h3>
    <div class="a3s"><p>Big sale, see <a id="unf" href="https://example.org/sale">example.org/sale</a> and claim your bonus.</p></div></div>
  <div class="adn" id="m3" style="margin-top:120px"><h3 class="iw"><span class="gD" email="kyc@hdfc-alerts.top" name="HDFC Bank">HDFC Bank</span></h3>
    <div class="a3s"><p>URGENT: your account is blocked today. Update your KYC now: <a id="bad" href="http://hdfc-kyc-update.top/login">update KYC</a> and share the OTP.</p></div></div>
</body></html>`;

// ---------------------------------------------------------------------------------------------
async function install() {
  console.log("\nInstall");
  const zip = path.join(ROOT, "dist", "purrtect-extension.zip");
  if (!fs.existsSync(zip)) execFileSync(path.join(ROOT, "scripts", "package-extension.sh"), { stdio: "ignore" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purrtect-zip-"));
  execFileSync("unzip", ["-q", zip, "-d", dir]);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "purrtect-e2e-"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, enableExtensions: true, pipe: true, args: ["--no-first-run"] });
  try {
    const id = await browser.installExtension(dir);
    check(id === "pohoamnapbegmpnhdkiimajhkhhaiaja", "the release ZIP loads unpacked, with the fixed ID");
    const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id), { timeout: 10000 }).catch(() => null);
    check(!!sw, "its service worker starts (no manifest or script errors)");
    const welcome = await browser.waitForTarget((t) => t.url().includes("settings.html?welcome=1"), { timeout: 10000 }).catch(() => null);
    check(!!welcome, "the first-run page opens by itself");
    if (welcome) {
      const page = await welcome.page();
      await page.waitForSelector(".purr-consent", { timeout: 5000 }).catch(() => {});
      const w = await page.evaluate(() => ({
        consent: document.querySelectorAll(".purr-consent li").length,
        selects: document.querySelectorAll(".set-select").length,
        start: !!document.querySelector(".purr-wide"),
      }));
      check(w.consent >= 3 && w.selects >= 2 && w.start, `first-run page: privacy points (${w.consent}), country and language pickers, Start button`);
      const worker = await sw.worker();
      await page.evaluate(() => document.querySelector(".purr-wide").click()).catch(() => {});
      await sleep(500);
      check((await stored(worker)).onboarded === true, "Start marks the welcome as done");
    }
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
async function settingsPanel({ browser, id, worker }) {
  console.log("\nSettings (side panel)");
  await setSettings(worker, { enabled: true, uiLang: "en", voice: true, country: "IN", sensitivity: "normal" });
  const page = await browser.newPage(); page.errors = []; page.on("pageerror", (e) => page.errors.push(e.message));
  await page.setViewport({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${id}/ui/settings.html`, { waitUntil: "networkidle0" }); await sleep(300);
  const toast = () => page.$eval("#saved", (n) => n.className.includes("show") ? n.textContent : "").catch(() => "");

  // switches and pickers save, with "✓ Saved"
  await page.evaluate(() => [...document.querySelectorAll(".set-switch")].find((b) => /voice|listen/i.test(b.getAttribute("aria-label"))).click()); await sleep(250);
  check((await stored(worker)).voice === false && /saved/i.test(await toast()), "Voice switch saves, with \"✓ Saved\"");
  await page.select(".set-select", "JP"); await sleep(250);
  check((await stored(worker)).country === "JP", "country picker saves (Japan)");
  await page.evaluate(() => [...document.querySelectorAll('.set-seg [role="radio"]')].find((b) => /strict/i.test(b.textContent)).click()); await sleep(250);
  check((await stored(worker)).sensitivity === "strict", "How careful saves (Strict)");
  await page.evaluate(() => [...document.querySelectorAll(".set-row")].find((r) => /gmail/i.test(r.innerText))
    .querySelectorAll('[role="radio"]').forEach((b) => /auto/i.test(b.textContent) && b.click())); await sleep(250);
  check((await stored(worker)).modes.gmail === "auto", "Gmail mode saves (Auto)");
  await page.evaluate(() => [...document.querySelectorAll('.set-seg [role="radio"]')].find((b) => /^\s*dark\s*$/i.test(b.textContent)).click()); await sleep(250);
  check((await stored(worker)).theme === "dark" && await page.evaluate(() => document.documentElement.dataset.theme) === "dark",
    "Appearance saves (Dark) and the panel turns dark straight away");
  await page.evaluate(() => [...document.querySelectorAll('.set-seg [role="radio"]')].find((b) => /^\s*light\s*$/i.test(b.textContent)).click()); await sleep(250);
  check((await stored(worker)).theme === "light" && await page.evaluate(() => document.documentElement.dataset.theme) === "light", "Appearance saves (Light)");
  // ⓘ tips (detailed checks are in regressions.e2e.js) and scrolling on a short window
  const tips = await page.$$eval(".set-tip", (n) => n.filter((t) => t.textContent.trim().length > 10).length);
  check(tips >= 8, `every setting has an ⓘ explanation (${tips})`);
  const scroll = await page.evaluate(async () => { const c = document.querySelector(".content"); c.scrollTop = 0; c.scrollTop = 300; return { can: c.scrollHeight > c.clientHeight, moved: c.scrollTop > 0 }; });
  check(scroll.can && scroll.moved, "settings scroll on a short (640 px) window");

  // language switches the panel
  const heading = () => page.$eval(".set-heading", (n) => n.textContent.trim());
  const en = await heading();
  const langSelect = await page.$$(".set-select");
  await page.evaluate(() => { const s = [...document.querySelectorAll(".set-select")].find((x) => [...x.options].some((o) => o.value === "hi")); s.value = "hi"; s.dispatchEvent(new Event("change")); });
  await page.waitForFunction((was) => document.querySelector(".set-heading")?.textContent.trim() !== was, { timeout: 4000 }, en).catch(() => {});
  const hi = await heading();
  check(langSelect.length >= 2 && hi !== en && /[ऀ-ॿ]/.test(hi), `language change switches the panel (English "${en}" -> Hindi "${hi}")`);
  for (const [code, re, name] of [["ja", /[぀-ヿ一-鿿]/, "Japanese"], ["zh_CN", /[一-鿿]/, "Chinese"], ["en", /^[A-Z\s]+$/i, "English"]]) {
    await page.evaluate((c) => { const s = [...document.querySelectorAll(".set-select")].find((x) => [...x.options].some((o) => o.value === c)); s.value = c; s.dispatchEvent(new Event("change")); }, code);
    await page.waitForFunction((r) => new RegExp(r).test(document.querySelector(".set-heading")?.textContent.trim() || ""), { timeout: 4000 }, re.source).catch(() => {});
    check(re.test(await heading()), `panel in ${name}`);
  }

  // footer: Reset to defaults, Privacy, Feedback, logo link
  await page.evaluate(() => [...document.querySelectorAll(".foot-link")][0].click()); await sleep(400);
  const s = await stored(worker);
  check(s.voice === true && s.sensitivity === "normal" && s.modes.gmail === "manual" && s.uiLang === "en", "Reset to defaults restores the defaults (keeps the language)");
  await page.evaluate(() => [...document.querySelectorAll(".foot-link")].find((b) => /privacy/i.test(b.textContent)).click()); await sleep(300);
  check(await page.$$eval(".privacy-list li", (n) => n.length) >= 3, "Privacy opens the privacy page");
  await page.evaluate(() => document.querySelector(".bar-sub button").click()); await sleep(300);
  const links = await page.evaluate(() => ({ feedback: [...document.querySelectorAll(".foot-links a")].map((a) => a.href).find((h) => /github|issues|feedback/i.test(h)) || "",
    logo: document.querySelector(".set-brand").href }));
  check(/^https:\/\//.test(links.feedback), `Feedback links to ${links.feedback}`);
  check(/web\.app|firebaseapp/.test(links.logo), "the logo links to the Purrtect website");
  check(!page.errors.length, "no page errors" + errorsOf(page));
  await page.close();
}

// ---------------------------------------------------------------------------------------------
async function gmailAuto({ browser, worker, api }) {
  console.log("\nGmail in Auto");
  await setSettings(worker, { enabled: true, uiLang: "en", country: "JP", askBeforeSend: true, modes: { gmail: "auto" } });
  await browser.defaultBrowserContext().overridePermissions("https://mail.google.com", ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await gmailPage(browser, INBOX, { width: 1100, height: 760 });
  await sleep(800);
  const levels = await page.evaluate(() => ["#m1", "#m2", "#m3"].map((m) => (document.querySelector(`${m} .purr-widget`)?.className.match(/purr-w-(\w+)/) || [])[1] || "none"));
  check(levels[0] === "green" && levels[2] === "red" && levels[1] !== "none", `every email gets a badge: normal ${levels[0]}, deals ${levels[1]}, scam ${levels[2]}`);

  // clicking a badge opens the card beside it; approval first; Send -> checking -> verdict
  await clickIn(page, "#m3 .purr-widget"); await sleep(600);
  check(await visible(page, ".purr-send") === 1, "clicking the scam's badge asks before sending (approval box)");
  const before = api.requests.length;
  await page.evaluate(() => document.querySelector(".purr-send .purr-btn-primary").click());
  await sleep(150);
  const sawChecking = await visible(page, ".purr-card.purr-compact") > 0 || await visible(page, ".purr-card") > 0;
  await page.waitForFunction(() => [...document.querySelectorAll(".purr-headline")].some((h) => /\[en\]/.test(h.textContent)), { timeout: 8000 }).catch(() => {});
  const sent = api.requests.slice(before).find((r) => r.path === "/api/scan");
  check(!!sent && sent.body.ui_lang === "en" && sent.body.country === "JP", "Send calls the backend with the chosen language and country");
  check(sent && !/OTP\s*\d/.test(sent.body.text), "what's sent is masked");
  // the card sits right below its badge, or right above it when there's no room below
  const card = await page.evaluate(() => { const h = [...document.querySelectorAll(".purr-card .purr-headline")].find((x) => /\[en\]/.test(x.textContent)); const c = h && h.closest(".purr-card"); const w = document.querySelector("#m3 .purr-widget").getBoundingClientRect();
    if (!c) return null; const r = c.getBoundingClientRect();
    return { text: h.textContent, gap: Math.round(Math.max(r.top - w.bottom, w.top - r.bottom)), dx: Math.round(r.left - w.left) }; });
  check(sawChecking && card && /Do not click/.test(card.text), `"checking…" then the verdict (${card ? card.text : "none"})`);
  check(card && card.gap >= -4 && card.gap < 40 && Math.abs(card.dx) < 260, `the card opens right next to its badge (gap ${card ? card.gap : "?"} px, x offset ${card ? card.dx : "?"})`);

  // Listen
  const voice = await page.evaluate(async () => { const b = document.querySelector(".purr-card .purr-voice"); if (!b) return null; b.click(); await new Promise((r) => setTimeout(r, 1200));
    const note = b.parentElement.querySelector(".purr-voice-note"); return { state: b.dataset.state, noVoice: note && !note.hidden }; });
  check(voice && (voice.state === "playing" || voice.noVoice), `Listen reads the verdict (state: ${voice && (voice.noVoice ? "no voice installed for this language" : voice.state)})`);

  // I clicked or paid -> recovery: country's payment options, drafts in the country's language, Copy
  await page.evaluate(() => [...document.querySelectorAll(".purr-card .purr-btn-primary")].find((b) => /clicked|paid/i.test(b.textContent)).click()); await sleep(600);
  const pay = await page.$$eval(".purr-recovery .purr-choices", (g) => g.map((x) => x.innerText.replace(/\n/g, " ")));
  check(pay.some((t) => /PayPay/.test(t)), "recovery form shows Japan's ways to pay (PayPay…)");
  await page.evaluate(() => { const r = document.querySelector(".purr-recovery"); r.querySelector('[data-value="paid"]').click(); r.querySelector('[data-value="gift_card"]')?.click(); r.querySelector(".purr-btn-primary").click(); });
  await page.waitForSelector(".purr-plan", { timeout: 8000 }).catch(() => {});
  const plan = await page.evaluate(() => ({ drafts: [...document.querySelectorAll(".purr-draft pre")].map((p) => p.textContent), note: document.querySelector(".purr-draft-lang")?.textContent || "",
    contacts: !!document.querySelector(".purr-contacts") }));
  check(plan.drafts.length === 3 && plan.drafts.every((d) => d.startsWith("[ja]")), "drafts come back in Japan's language (3 drafts)");
  check(/Japanese/i.test(plan.note) && plan.contacts, "a note says which language the drafts are in; verified contacts shown");
  const copied = await page.evaluate(async () => { const b = document.querySelector(".purr-copy"); b.click(); await new Promise((r) => setTimeout(r, 300)); return b.textContent; });
  check(/copied/i.test(copied), `Copy works ("${copied}")`);
  await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelectorAll(".purr-card").forEach((c) => c.remove()));

  // clicking a red link: stop screen; Open anyway -> 10-minute banner
  await page.mouse.move(5, 5);
  await page.evaluate(() => { document.querySelector("#bad").scrollIntoView({ block: "center" }); });
  await sleep(300);
  await page.evaluate(() => document.querySelector("#bad").click()); await sleep(500);
  const warn = await page.evaluate(() => { const w = document.querySelector(".purr-warning"); return w ? [...w.querySelectorAll(".purr-btn")].map((b) => b.textContent.trim()) : null; });
  check(warn && warn.length === 3, `clicking a red link shows the stop screen (${warn ? warn.join(" / ") : "none"})`);
  const pagesBefore = (await browser.pages()).length;
  await page.evaluate(() => document.querySelector(".purr-warning .purr-btn-quiet").click()); await sleep(900);
  check((await browser.pages()).length > pagesBefore, "Open anyway opens the link");
  check(await visible(page, ".purr-banner") === 1, "…and the \"Entered anything?\" banner appears");
  check(!page.errors.length, "no page errors" + errorsOf(page));
  for (const p of await browser.pages()) if (p !== page && /hdfc-kyc/.test(p.url())) await p.close();
  await page.close();
  await worker.evaluate(() => chrome.storage.local.set({ riskyOpenedAt: 0 }));
}

// ---------------------------------------------------------------------------------------------
async function linkCardsAndLanguage({ browser, worker, api }) {
  console.log("\nLink cards, and verdicts in the chosen language");
  await setSettings(worker, { enabled: true, uiLang: "en", modes: { gmail: "auto" } });
  const page = await gmailPage(browser, INBOX, { width: 1100, height: 760 });
  const hover = async (sel) => {
    await page.mouse.move(1050, 700); await sleep(400);
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel); await sleep(200);
    const c = await centre(page, sel); await page.mouse.move(c[0], c[1], { steps: 4 }); await sleep(1300);
    return page.evaluate(() => { const n = document.querySelector(".purr-linkcard"); return n ? (n.className.match(/lv-(\w+)/) || [])[1] : null; });
  };
  check(await hover("#known") === "green", "well-known link: ✓ card");
  check(await hover("#unf") !== null && await hover("#unf") !== "green", "unfamiliar link: ? or ! card (not ✓)");
  check(await hover("#bad") === "red", "risky link: ⚠ card");
  const why = await page.evaluate(() => { const b = document.querySelector(".purr-linkcard button"); b.click(); return document.querySelector(".purr-linkcard-why")?.innerText || ""; });
  check(why.length > 20, "Why? lists the reasons");
  const before = api.requests.length;
  await page.evaluate(() => [...document.querySelectorAll(".purr-linkcard button")].pop().click()); await sleep(600);
  check(await visible(page, ".purr-send") === 1, "Check with Gemini opens the approval box");
  await page.evaluate(() => document.querySelector(".purr-send .purr-btn-primary").click()); await sleep(1200);
  const sent = api.requests.slice(before).find((r) => r.path === "/api/scan");
  check(sent && sent.body.links.some((l) => /hdfc-kyc-update\.top/.test(l)), "…and sends that link");
  await page.close();

  // Hindi: badges, cards and verdicts follow the chosen language
  await setSettings(worker, { uiLang: "hi" });
  const hiPage = await gmailPage(browser, INBOX, { width: 1100, height: 760 });
  const label = await hiPage.$eval("#m1 .purr-widget-label", (n) => n.textContent).catch(() => "");
  check(/[ऀ-ॿ]/.test(label), `badges in Hindi ("${label}")`);
  const b2 = api.requests.length;
  await clickIn(hiPage, "#m3 .purr-widget"); await sleep(500);
  await hiPage.evaluate(() => document.querySelector(".purr-send .purr-btn-primary")?.click()); await sleep(1200);
  const hiSent = api.requests.slice(b2).find((r) => r.path === "/api/scan");
  check(hiSent && hiSent.body.ui_lang === "hi", "the backend is asked for a Hindi verdict");
  check(await hiPage.evaluate(() => [...document.querySelectorAll(".purr-headline")].some((h) => /\[hi\]/.test(h.textContent))), "the Hindi verdict is shown");
  await hiPage.close();
  await setSettings(worker, { uiLang: "en" });
}

// ---------------------------------------------------------------------------------------------
async function whatsapp({ browser, worker }) {
  console.log("\nWhatsApp Web");
  await setSettings(worker, { enabled: true, modes: { whatsapp: "auto" } });
  const WA = `<!doctype html><html><body style="margin:0;background:#111;color:#eee;font:16px sans-serif"><div id="main"><header><span dir="auto" title="Masters Union">Masters Union</span></header>
    <div style="padding:40px"><div role="row"><div data-id="false_1@c.us_A"><div class="message-in" style="width:420px;background:#222;padding:10px">
      <div class="copyable-text" data-pre-plain-text="[7:31 pm] Masters: "><span class="selectable-text">Join the Masters WhatsApp Channel and follow their journey!</span></div></div>
      <div style="width:420px"><div id="explore" title="Explore the Channel" style="cursor:pointer;padding:12px;text-align:center;color:#3c3"><span><svg width="16" height="16"></svg></span><span>Explore the Channel</span></div></div>
    </div></div></div></div></body></html>`;
  const page = await browser.newPage(); page.errors = []; page.on("pageerror", (e) => page.errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => r.url().startsWith("https://web.whatsapp.com/") ? r.respond({ status: 200, contentType: "text/html", body: WA }) : r.continue());
  await page.setViewport({ width: 1000, height: 650 });
  await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded" }); await sleep(1800);
  check(await visible(page, ".purr-widget-wrap") >= 1, "an incoming chat message gets a badge");
  const c = await centre(page, "#explore span:last-child");
  await page.mouse.move(c[0] - 40, c[1] + 40); await page.mouse.move(c[0], c[1], { steps: 4 }); await sleep(1300);
  const card = await page.evaluate(() => { const n = document.querySelector(".purr-linkcard"); return n ? n.className + " | " + n.innerText : null; });
  check(card && /lv-unknown/.test(card), "a business button (\"Explore the Channel\") shows \"?\" — can't see where it goes");
  check(!page.errors.length, "no page errors" + errorsOf(page));
  await page.close();
}

// ---------------------------------------------------------------------------------------------
async function otherWebsites() {
  console.log("\nOther websites (uses a copy of the extension that already has the all-sites permission —");
  console.log("Chrome's permission prompt can't be clicked in a headless browser)");
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "purrtect-allsites-"));
  fs.cpSync(path.join(ROOT, "extension"), copy, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(copy, "manifest.json"), "utf8"));
  mf.host_permissions.push("https://*/*", "http://*/*");
  fs.writeFileSync(path.join(copy, "manifest.json"), JSON.stringify(mf));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "purrtect-e2e-"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, enableExtensions: true, pipe: true, args: ["--no-first-run"] });
  try {
    const id = await browser.installExtension(copy);
    const worker = await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id))).worker();
    await setSettings(worker, { enabled: true, askBeforeSend: true, cursorCat: false, catEverywhere: false });
    const BLOG = `<!doctype html><html><body style="margin:0;height:1200px;font:16px sans-serif;padding:60px"><h1>A news site</h1><p>Read <a id="o" href="https://example.org/post">this post</a> about parcel scams.</p></body></html>`;
    const page = await browser.newPage(); page.errors = []; page.on("pageerror", (e) => page.errors.push(e.message));
    await page.setRequestInterception(true);
    page.on("request", (r) => r.url().startsWith("https://news.example.net/") ? r.respond({ status: 200, contentType: "text/html", body: BLOG }) : r.continue());
    await page.setViewport({ width: 1000, height: 650 });
    await page.goto("https://news.example.net/", { waitUntil: "domcontentloaded" }); await sleep(800);

    // right-click scan on a normal site: the popup opens on the page
    await worker.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: "https://news.example.net/*" }); await self.purrHandleMenuClick({ menuItemId: "purrtect-scan", selectionText: "Read this post about parcel scams, pay the fee today" }, tab); });
    await sleep(1200);
    check(await visible(page, ".purr-send") === 1, "right-click → Scan with Purrtect on a normal site opens the approval box there");
    await page.evaluate(() => document.querySelector(".purr-send .purr-btn")?.click()); await sleep(300);

    // a page Chrome blocks: a small result window opens instead
    const blocked = await browser.newPage();
    await blocked.goto("chrome://version").catch(() => {});
    await worker.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: "chrome://version/*" }); await self.purrHandleMenuClick({ menuItemId: "purrtect-scan", selectionText: "Your parcel is held, pay the customs fee" }, tab); });
    const win = await browser.waitForTarget((t) => t.url().includes("/ui/scan.html"), { timeout: 6000 }).catch(() => null);
    check(!!win, "on a page Chrome blocks (chrome://), a small result window opens instead");

    // On all websites: cat and link cards appear on other sites; off removes them
    await setSettings(worker, { cursorCat: true, catEverywhere: true }); await sleep(800);
    const reg = await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
    check(reg.includes("purrtect-everywhere"), "On all websites: Purrtect is set up for other sites");
    await page.reload({ waitUntil: "domcontentloaded" }); await sleep(1500);
    check(await visible(page, ".purr-ccat") === 1, "…the cursor cat shows on the news site");
    const c = await centre(page, "#o"); await page.mouse.move(c[0] - 30, c[1] + 30); await page.mouse.move(c[0], c[1], { steps: 4 }); await sleep(1300);
    check(await visible(page, ".purr-linkcard") === 1, "…and resting on a link shows its link card");
    await setSettings(worker, { catEverywhere: false }); await sleep(800);
    const reg2 = await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
    await page.reload({ waitUntil: "domcontentloaded" }); await sleep(1200);
    check(!reg2.includes("purrtect-everywhere") && await visible(page, ".purr-ccat") === 0, "switching it off removes them");
    check(!page.errors.length, "no page errors" + errorsOf(page));
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(copy, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
async function cursorCat({ browser, worker }) {
  console.log("\nCursor cat (about 35 s: it waits to see the cat sit, play, box and sleep)");
  await setSettings(worker, { enabled: true, cursorCat: true, modes: { gmail: "auto" } });
  // following: on a calm page (a risky email would send the cat to its badge instead)
  let page = await gmailPage(browser, gmailMessage("<p>Lunch tomorrow?</p>"), { width: 1100, height: 760 });
  const cat = () => page.evaluate(() => { const c = document.querySelector(".purr-ccat"); const r = c.getBoundingClientRect(); return { anim: c.dataset.anim, x: r.x + r.width / 2, y: r.bottom }; });
  await page.mouse.move(1000, 650); await sleep(4000);
  const start = await cat();
  await page.mouse.move(150, 650, { steps: 3 }); await sleep(250);
  const moving = await cat();
  check(moving.anim === "run", `follows the cursor, running (${moving.anim})`);
  await sleep(4500);
  const arrived = await cat();
  check(Math.abs(arrived.x - 150) < 90 && arrived.x < start.x, `catches up beside the cursor (x ${Math.round(start.x)} -> ${Math.round(arrived.x)})`);
  check(arrived.anim === "sit", `sits when the cursor stops (${arrived.anim})`);
  await page.close();
  // reactions and idle routine: on the inbox with a normal, a deals and a scam email
  page = await gmailPage(browser, INBOX, { width: 1100, height: 760 });
  await sleep(7000);   // first the cat runs to the scam email's badge (its own reaction); let that finish
  // reactions: ✓ / ? / ⚠ on links, and sitting beside the link card
  const react = async (sel) => {
    await page.mouse.move(1050, 700); await sleep(500);
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel); await sleep(300);
    const c = await centre(page, sel); await page.mouse.move(c[0], c[1], { steps: 4 }); await sleep(500);
    const now = await cat();
    await sleep(4500);   // time to walk over and sit beside the link card
    const overlap = await page.evaluate(() => { const a = document.querySelector(".purr-linkcard")?.getBoundingClientRect(), b = document.querySelector(".purr-ccat").getBoundingClientRect();
      if (!a) return -1; return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); });
    return { anim: now.anim, parked: (await cat()).anim, overlap };
  };
  const k = await react("#known");
  check(k.anim === "safe" || k.parked === "safe", `well-known link: happy ✓ (${k.anim}/${k.parked})`);
  const u = await react("#unf");
  check(["unsure", "notsafe"].includes(u.anim) || ["unsure", "notsafe"].includes(u.parked), `unfamiliar link: ? or ! (${u.anim}/${u.parked})`);
  const b = await react("#bad");
  check(b.anim === "notsafe" || b.parked === "notsafe", `risky link: ⚠ (${b.anim}/${b.parked})`);
  check(k.overlap === 0 && u.overlap === 0 && b.overlap === 0, "sits beside the link card, never under it");
  // idle: play (10 s), box (20 s), sleep (30 s)
  await page.mouse.move(600, 720, { steps: 2 }); await sleep(1000);
  const seen = new Set();
  for (let t = 0; t < 33; t++) { seen.add((await cat()).anim); await sleep(1000); }
  check(seen.has("play") && seen.has("box") && seen.has("sleep"), `when idle it plays with the fish, pops out of the box, then sleeps (${[...seen].join(", ")})`);
  check(!page.errors.length, "no page errors" + errorsOf(page));
  await page.close();
  await setSettings(worker, { cursorCat: false });
}

// ---------------------------------------------------------------------------------------------
async function darkMode({ browser, id, worker }) {
  console.log("\nLight and dark mode: every text readable (WCAG AA: 4.5:1, large text 3:1)");
  const fmt = (bad) => (bad.length ? " — " + bad.slice(0, 3).map((b) => `"${b.text}" ${b.ratio}:1`).join(", ") : "");
  for (const theme of ["light", "dark", "auto"]) {
    const dark = theme !== "light";                       // "auto" runs with the computer set to dark
    await setSettings(worker, { theme, enabled: true, cursorCat: true, askBeforeSend: true, modes: { gmail: "auto" } });

    // side panel, on and off
    const panel = await browser.newPage(); await panel.setViewport({ width: 360, height: 1200 });
    await panel.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
    await panel.goto(`chrome-extension://${id}/ui/settings.html`, { waitUntil: "networkidle0" }); await sleep(300);
    check(await panel.evaluate(() => document.documentElement.dataset.theme) === (dark ? "dark" : "light"), `${theme}: side panel is ${dark ? "dark" : "light"}`);
    let bad = await contrastFailures(panel); check(!bad.length, `${theme}: side panel readable${fmt(bad)}`);
    const tag = await panel.$eval(".set-tagline", (n) => ({ cut: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1, ell: getComputedStyle(n).textOverflow }));
    check(!tag.cut && tag.ell !== "ellipsis", `${theme}: the whole tagline shows (no "…")`);
    await setSettings(worker, { enabled: false }); await sleep(400);
    bad = await contrastFailures(panel); check(!bad.length, `${theme}: side panel readable when off${fmt(bad)}`);
    await setSettings(worker, { enabled: true }); await panel.close();

    // Gmail: badges, link card, approval box, verdict, recovery
    const page = await browser.newPage(); page.errors = []; page.on("pageerror", (e) => page.errors.push(e.message));
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
    await page.setRequestInterception(true);
    page.on("request", (r) => r.url().startsWith("https://mail.google.com/") ? r.respond({ status: 200, contentType: "text/html",
      body: INBOX.replace('<body style="', `<body style="background:${dark ? "#1f1f1f;color:#e8eaed" : "#fff"};`) }) : r.continue());
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto("https://mail.google.com/mail/u/0/", { waitUntil: "domcontentloaded" }); await sleep(1800);
    const audit = async (name, sel) => { const b = await contrastFailures(page, sel); check(!b.length, `${theme}: ${name} readable${fmt(b)}`); };
    await audit("badges", ".purr-widget-wrap");
    const c = await centre(page, "#unf"); await page.mouse.move(c[0], c[1], { steps: 3 }); await sleep(1300);
    await page.evaluate(() => document.querySelector(".purr-linkcard button")?.click()); await sleep(200);
    await audit("link card", ".purr-linkcard");
    await page.mouse.move(1000, 850); await sleep(500);
    await clickIn(page, "#m3 .purr-widget"); await sleep(500);
    await audit("approval box", ".purr-send");
    await clickIn(page, ".purr-send .purr-btn-primary"); await sleep(1500);
    await audit("verdict card", ".purr-card");
    await page.evaluate(() => [...document.querySelectorAll(".purr-card .purr-btn-primary")].find((b) => /clicked|paid/i.test(b.textContent)).click()); await sleep(500);
    await page.evaluate(() => { const r = document.querySelector(".purr-recovery"); r.querySelector('[data-value="paid"]').click(); r.querySelector(".purr-btn-primary").click(); }); await sleep(1500);
    await audit("recovery plan", ".purr-recovery");
    if (dark) {
      const filter = await page.$eval(".purr-ccat-sprite", (n) => getComputedStyle(n).filter).catch(() => "missing");
      check(filter === "none", `${theme}: no glow around the cursor cat (filter: ${filter})`);
    }
    check(!page.errors.length, `${theme}: no page errors${errorsOf(page)}`);
    await page.close();
  }
  await setSettings(worker, { theme: "auto", cursorCat: false });
}

// ---------------------------------------------------------------------------------------------
(async () => {
  await install();
  await otherWebsites();
  const ctx = await launch();
  ctx.api = await fakeBackend(ctx.browser, ctx.id);
  try {
    await settingsPanel(ctx);
    await gmailAuto(ctx);
    await linkCardsAndLanguage(ctx);
    await whatsapp(ctx);
    await darkMode(ctx);
    await cursorCat(ctx);
  } finally {
    await ctx.close();
  }
  console.log("\nAlso covered in regressions.e2e.js: Manual mode, one box only, On / Off, popup scrolling, info bubbles,");
  console.log("\"Refresh this page\" after a reload. Language / country sync: sync_prefs.e2e.js.");
  console.log(failures() ? `\nFAILED: ${failures()}` : "\nall passed");
  process.exit(failures() ? 1 : 0);
})().catch((e) => { console.error("FAILED", e.stack || e.message); process.exit(1); });
