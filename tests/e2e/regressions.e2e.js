// Browser regression tests: one section per bug that broke Purrtect, so none of them comes back.
//
//   cd tests/e2e && npm install && npm test          (runs this and sync_prefs.e2e.js)
//   node regressions.e2e.js                          (just this file)
//
// Uses your installed Chrome (CHROME=/path/to/chrome to change) with the unpacked extension/.
"use strict";
const { sleep, check, failures, launch, setSettings, gmailPage, gmailMessage, rightClickScan, centre, fakeBackend } = require("./helpers");

const visible = (page, selector) => page.evaluate((s) =>
  [...document.querySelectorAll(s)].filter((n) => !n.hidden && getComputedStyle(n).display !== "none" && getComputedStyle(n).visibility !== "hidden").length, selector);

async function sidePanelDrawsInEveryState({ browser, id, worker }) {
  console.log("\nSide panel draws in every state (bug: blank panel with the cursor cat on)");
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 640 });
  for (const cursorCat of [false, true]) {
    for (const enabled of [true, false]) {
      await setSettings(worker, { cursorCat, enabled });
      const errors = [];
      const onError = (e) => errors.push(e.message);
      page.on("pageerror", onError);
      await page.goto(`chrome-extension://${id}/ui/settings.html`, { waitUntil: "networkidle0" });
      await sleep(300);
      const s = await page.evaluate(() => ({
        header: !!document.querySelector("header .set-brand"),
        sw: document.querySelector(".set-power")?.getAttribute("aria-checked"),
        rows: document.querySelectorAll(".set-row").length,
        everywhereRow: [...document.querySelectorAll(".set-row")].some((r) => r.querySelector('[role="switch"]') && /website/i.test(r.innerText)),
        offNote: !!document.querySelector(".off-note"),
      }));
      page.off("pageerror", onError);
      const label = `cursor cat ${cursorCat ? "on" : "off"}, Purrtect ${enabled ? "on" : "off"}`;
      check(s.header && s.rows >= 8 && !errors.length, `${label}: panel drawn, ${s.rows} rows, no errors${errors.length ? " (" + errors[0] + ")" : ""}`);
      check(s.sw === String(enabled), `${label}: header switch shows ${enabled ? "On" : "Off"}`);
      check(s.everywhereRow === cursorCat, `${label}: "On all websites" row ${cursorCat ? "shown" : "hidden"}`);
      check(s.offNote === !enabled, `${label}: "Purrtect is off" note ${enabled ? "hidden" : "shown"}`);
    }
  }
  // the switch itself works from the panel
  await setSettings(worker, { enabled: true, cursorCat: false });
  await page.goto(`chrome-extension://${id}/ui/settings.html`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelector(".set-power").click()); await sleep(400);
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get("settings")).settings.enabled);
  check(saved === false, "clicking the header switch turns Purrtect off");
  await page.close();
  await setSettings(worker, { enabled: true });
}

async function onOffSwitch({ browser, worker }) {
  console.log("\nOverall On / Off switch");
  await setSettings(worker, { enabled: true, cursorCat: true, modes: { gmail: "auto" } });
  const page = await gmailPage(browser, gmailMessage(`<p style="margin-top:40px">Update KYC now: <a href="http://hdfc-kyc.top/login">verify</a> or your account is blocked today.</p>`,
    { email: "x@unknown.top", name: "Bank KYC" }));
  const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));
  check(await visible(page, ".purr-widget-wrap") === 1 && await visible(page, ".purr-ccat") === 1, "on: badge and cursor cat shown");
  await setSettings(worker, { enabled: false }); await sleep(600);
  check(await visible(page, ".purr-widget-wrap") === 0 && await visible(page, ".purr-ccat") === 0, "off: badges and cursor cat hidden at once");
  check(await badge() === "OFF", "off: toolbar icon shows OFF");
  const p = await page.$eval("p", (n) => n.getBoundingClientRect().toJSON());
  await page.mouse.move(p.x + 2, p.y + 10); await page.mouse.down(); await page.mouse.move(p.x + 300, p.y + 10, { steps: 5 }); await page.mouse.up(); await sleep(400);
  check(await visible(page, ".purr-select-btn") === 0, "off: selecting text shows no \"Check with Purrtect\" button");
  await rightClickScan(worker, { linkUrl: "http://hdfc-kyc.top/login" }); await sleep(600);
  check(await visible(page, ".purr-card") === 0, "off: right-click scan opens nothing");
  await setSettings(worker, { enabled: true }); await sleep(1500);
  check(await visible(page, ".purr-widget-wrap") === 1 && await visible(page, ".purr-ccat") === 1 && await badge() === "", "back on: badge, cat and normal toolbar icon return");
  check(!page.errors.length, "no page errors" + (page.errors.length ? ": " + page.errors[0] : ""));
  await page.close();
  await setSettings(worker, { cursorCat: false });
}

async function oneBoxOnly({ browser, worker }) {
  console.log("\nOnly one box at a time (bugs: second box after declining; button next to the popup)");
  await setSettings(worker, { enabled: true, askBeforeSend: true, modes: { gmail: "manual" } });
  const page = await gmailPage(browser, gmailMessage(`<p style="margin-top:60px">Please check this text about a parcel delivery fee today.</p>`));
  for (const how of ["Don't send", "the close button"]) {
    await rightClickScan(worker, { linkUrl: "https://www.bitbrowser.net/blog/best-kickass-torrents-alternatives" }); await sleep(700);
    check(await visible(page, ".purr-send") === 1, `right-click scan opens one approval box (then ${how})`);
    await page.evaluate((h) => { const p = document.querySelector(".purr-send");
      (h === "the close button" ? p.querySelector(".purr-icon-btn") : [...p.querySelectorAll(".purr-btn")].find((b) => !b.classList.contains("purr-btn-primary"))).click(); }, how);
    await sleep(600);
    check(await visible(page, ".purr-card") === 0, `declining with ${how} leaves nothing open`);
  }
  const p = await page.$eval("p", (n) => n.getBoundingClientRect().toJSON());
  await page.mouse.move(p.x + 2, p.y + 10); await page.mouse.down(); await page.mouse.move(p.x + 300, p.y + 10, { steps: 5 }); await page.mouse.up(); await sleep(400);
  check(await visible(page, ".purr-select-btn") === 1, "selecting text shows \"Check with Purrtect\"");
  await page.mouse.move(p.x + 100, p.y + 10); await page.mouse.down({ button: "right" }); await page.mouse.up({ button: "right" }); await sleep(300);
  check(await visible(page, ".purr-select-btn") === 0, "a right-click doesn't bring the button back");
  await rightClickScan(worker, { selectionText: "Please check this text about a parcel delivery fee today." }); await sleep(700);
  check(await visible(page, ".purr-send") === 1 && await visible(page, ".purr-select-btn") === 0, "scan from the menu: only the approval box, no button");
  check(!page.errors.length, "no page errors" + (page.errors.length ? ": " + page.errors[0] : ""));
  await page.close();
}

async function popupScrolls({ browser, worker }) {
  console.log("\nLong approval popup scrolls (bug: it couldn't)");
  await setSettings(worker, { enabled: true, askBeforeSend: true, modes: { gmail: "auto" } });
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i}: https://url41.example-shop.com/ls/click?upn=${"A".repeat(60)}`).join("\n");
  const page = await gmailPage(browser, gmailMessage(`<pre>${long}</pre><p>Your KYC is pending, verify now: <a href="http://shop-kyc.top/login">verify</a></p>`,
    { email: "shop@unknown-store.top", name: "Shop Deals" }), { width: 1000, height: 700 });
  await page.evaluate(() => document.querySelector(".purr-widget").click()); await sleep(800);
  const box = await page.$(".purr-send");
  check(!!box, "approval popup opens for a long email");
  if (box) {
    const before = await page.evaluate(() => { const p = document.querySelector(".purr-send"); return { top: p.scrollTop, more: p.scrollHeight > p.clientHeight, y: scrollY }; });
    const r = await page.evaluate(() => document.querySelector(".purr-send").getBoundingClientRect().toJSON());
    await page.mouse.move(r.x + r.width / 2, r.y + r.height - 160); await page.mouse.wheel({ deltaY: 400 }); await sleep(400);
    const after = await page.evaluate(() => ({ top: document.querySelector(".purr-send").scrollTop, y: scrollY }));
    check(before.more && after.top > before.top, `the popup scrolls with the mouse wheel (${before.top} -> ${after.top})`);
    check(after.y === before.y, "the email behind doesn't scroll");
    check(await visible(page, ".purr-send .purr-actions") === 1, "Send / Don't send stay visible");
  }
  await page.close();
}

async function tooltipDoesntBlockLinks({ browser, worker }) {
  console.log("\nBadge tooltip never covers links (bug: it trapped the mouse over the email)");
  await setSettings(worker, { enabled: true, modes: { gmail: "auto" } });
  const page = await gmailPage(browser, gmailMessage(`<p>Docs: <a id="gh" href="https://example.org/docs">example.org/docs</a></p>`));
  const w = await centre(page, ".purr-widget");
  const l = await centre(page, "#gh");
  await page.mouse.move(w[0], w[1]); await sleep(300);                 // show the badge's tooltip
  await page.mouse.move(l[0], l[1], { steps: 6 }); await sleep(1300);   // then rest on the link below it
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className || "", l);
  check(!String(under).includes("purr-preview"), "the link, not the tooltip, is under the cursor");
  check(await visible(page, ".purr-linkcard") === 1, "resting on the link opens its link card");
  await page.close();
}

async function manualModeIsQuiet({ browser, worker }) {
  console.log("\nManual mode is quiet (bug: cat and link cards still showed)");
  await setSettings(worker, { enabled: true, cursorCat: true, modes: { gmail: "manual" } });
  const page = await gmailPage(browser, gmailMessage(`<p style="margin-top:40px">Docs: <a id="l" href="https://example.org/x">example.org</a></p>`));
  let l = await centre(page, "#l");
  await page.mouse.move(l[0], l[1], { steps: 4 }); await sleep(1300);
  check(await visible(page, ".purr-widget-wrap") === 0, "manual: no badges");
  check(await visible(page, ".purr-ccat") === 0, "manual: no cursor cat");
  check(await visible(page, ".purr-linkcard") === 0, "manual: no link card on hover");
  await page.mouse.move(900, 600); await setSettings(worker, { modes: { gmail: "auto" } }); await sleep(1500);
  l = await centre(page, "#l");
  await page.mouse.move(l[0], l[1], { steps: 4 }); await sleep(1300);
  check(await visible(page, ".purr-widget-wrap") === 1 && await visible(page, ".purr-ccat") === 1, "switched to Auto: badge and cat appear without a refresh");
  check(await visible(page, ".purr-linkcard") === 1, "switched to Auto: link card on hover");
  await page.close();
  await setSettings(worker, { cursorCat: false });
}

async function trustedLinkInRiskyEmail({ browser, worker }) {
  console.log("\nWell-known link inside a risky email (bug: github.com showed \"!\" in one email and \u2713 in another)");
  await setSettings(worker, { enabled: true, modes: { gmail: "auto" } });
  const page = await gmailPage(browser, gmailMessage(
    `<p style="margin-top:40px">URGENT: update your KYC today or your account is blocked. Share the OTP.</p>` +
    `<p>Code: <a id="gh" href="https://github.com/bhav1509/Purrtect">github.com/bhav1509/Purrtect</a></p>` +
    `<p style="margin-top:160px">More: <a id="ex" href="https://example.org/post">example.org</a></p>`,
    { email: "kyc-team@unknown-bank.top", name: "Bank KYC Team" }));
  const level = await page.evaluate(() => document.querySelector(".purr-widget")?.className || "");
  check(/purr-w-(red|yellow)/.test(level), "the email itself is flagged (badge yellow or red)");
  const card = async (sel) => {
    await page.mouse.move(900, 600); await sleep(500);
    const c = await centre(page, sel);
    await page.mouse.move(c[0], c[1], { steps: 4 }); await sleep(1300);
    return page.evaluate(() => { const n = document.querySelector(".purr-linkcard"); return n ? { cls: n.className, text: n.innerText } : null; });
  };
  const gh = await card("#gh");
  check(gh && /lv-green/.test(gh.cls), "github.com keeps its \u2713 even in a risky email" + (gh ? "" : " (no card)"));
  check(gh && /message around this link looks risky/i.test(gh.text), "its card notes that the message around it looks risky");
  const ex = await card("#ex");
  check(ex && /lv-yellow/.test(ex.cls), "an unfamiliar link in the same email is \"careful\" (!)");
  await page.close();
}

async function verdictCardScrolls({ browser, worker }) {
  console.log("\nTall verdict card beside its badge scrolls (bug: a card that grew ran off the window and couldn't scroll)");
  await setSettings(worker, { enabled: true, askBeforeSend: false, modes: { gmail: "auto" } });
  const page = await gmailPage(browser, gmailMessage(`<p style="margin-top:20px">URGENT: parcel on hold. Pay the fee in 24 hours:
    <a href="http://indiapost-pay.top/fee">pay</a> and share the OTP.</p>`, { email: "track@indiapost-delivery.xyz", name: "India Post" }), { width: 1000, height: 600 });
  await page.evaluate(() => document.querySelector(".purr-widget").click()); await sleep(2000);
  // a longer verdict (more red flags, slow mascot image) makes the card grow after it was placed
  await page.evaluate(() => { const d = document.createElement("div"); d.style.height = "400px"; const c = document.querySelector(".purr-card.purr-floating"); c.insertBefore(d, c.lastElementChild); });
  await sleep(500);
  const before = await page.evaluate(() => { const c = document.querySelector(".purr-card.purr-floating"); const r = c.getBoundingClientRect();
    return c && { more: c.scrollHeight > c.clientHeight + 20, fits: r.bottom <= innerHeight, y: scrollY }; });
  check(before && before.fits, "a card that grows after opening still fits in the window");
  check(before && before.more, "the verdict card is taller than the window, so it has to scroll");
  if (before) {
    const r = await page.evaluate(() => document.querySelector(".purr-card.purr-floating").getBoundingClientRect().toJSON());
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.wheel({ deltaY: 200 }); await sleep(300); await page.mouse.wheel({ deltaY: 200 }); await sleep(500);
    const after = await page.evaluate(() => { const c = document.querySelector(".purr-card.purr-floating"); return { top: c.scrollTop, end: c.scrollTop + c.clientHeight >= c.scrollHeight - 2, y: scrollY }; });
    check(after.top > 0, `the mouse wheel scrolls the card and it stays scrolled (scrollTop ${after.top})`);
    check(after.end, "the bottom of the card (\"I clicked or paid\") can be reached");
    check(after.y === before.y, "the email behind doesn't scroll");
  }
  await page.close();
}

async function cardNeverCoversItsBadge({ browser, worker }) {
  console.log("\nA tall card never covers what opened it (bug: the verdict card hid its own badge and the email)");
  await setSettings(worker, { enabled: true, askBeforeSend: true, modes: { gmail: "auto" } });
  // the scam email sits low on a short window, so the card fits neither fully below nor fully above
  const page = await gmailPage(browser, `<!doctype html><html><body style="margin:0;height:1400px;font:16px sans-serif;padding:40px">
    <div style="height:380px"></div><div class="adn"><h3 class="iw"><span class="gD" email="kyc@hdfc-alerts.top" name="HDFC Bank">HDFC Bank</span></h3>
    <div class="a3s"><p>URGENT: your account is blocked today. Update KYC: <a href="http://hdfc-kyc-update.top/login">update</a>, share the OTP.</p></div></div></body></html>`,
    { width: 1000, height: 640 });
  for (const step of ["approval box", "verdict card"]) {
    if (step === "approval box") await page.evaluate(() => document.querySelector(".purr-widget").click());
    else await page.evaluate(() => document.querySelector(".purr-send .purr-btn")?.click());   // Don't send: then reopen as a local verdict
    await sleep(700);
    if (step === "verdict card") { await page.evaluate(() => document.querySelector(".purr-widget").click()); await sleep(700); }
    const r = await page.evaluate(() => { const w = document.querySelector(".purr-widget").getBoundingClientRect(); const c = document.querySelector(".purr-card");
      if (!c) return null; const k = c.getBoundingClientRect();
      return { overlap: Math.max(0, Math.min(k.bottom, w.bottom) - Math.max(k.top, w.top)) * Math.max(0, Math.min(k.right, w.right) - Math.max(k.left, w.left)),
        onScreen: k.top >= 0 && k.bottom <= innerHeight, scrolls: c.scrollHeight <= c.clientHeight + 1 || getComputedStyle(c).overflowY === "auto" }; });
    check(r && r.overlap === 0 && r.onScreen && r.scrolls, `${step}: doesn't cover its badge, stays on screen, scrolls if it's tall` + (r ? "" : " (no card)"));
  }
  await page.close();
}

async function infoBubblesSteady({ browser, id }) {
  console.log("\nSettings info bubbles are steady (bug: flicker on the last row)");
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${id}/ui/settings.html`, { waitUntil: "networkidle0" }); await sleep(300);
  const n = await page.$$eval(".set-info", (x) => x.length);
  let bad = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => document.querySelectorAll(".set-info")[k].scrollIntoView({ block: "nearest" }), i); await sleep(100);
    const c = await page.evaluate((k) => { const b = document.querySelectorAll(".set-info")[k].getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, i);
    await page.mouse.move(c[0], c[1]);
    const samples = [];
    for (let k = 0; k < 16; k++) {
      samples.push(await page.evaluate((j) => {
        const wrap = document.querySelectorAll(".set-info-wrap")[j], tip = wrap.querySelector(".set-tip"), box = document.querySelector(".content");
        const t = tip.getBoundingClientRect(), row = wrap.closest(".set-row").getBoundingClientRect(), cs = getComputedStyle(tip);
        return { shown: cs.display !== "none" && cs.visibility !== "hidden", layout: `${box.scrollHeight}/${box.clientWidth}`,
          onScreen: t.top >= 0 && t.bottom <= innerHeight, placedRight: t.bottom <= row.top + 6 || t.top >= row.bottom - 6 };
      }, i));
      await sleep(k < 6 ? 15 : 60);
    }
    if (!samples.every((s) => s.shown && s.onScreen && s.placedRight) || new Set(samples.map((s) => s.layout)).size > 1) bad.push(i);
    await page.mouse.move(2, 2); await sleep(80);
  }
  check(n >= 8 && bad.length === 0, `all ${n} info bubbles stay shown, on screen, beside their row, with no layout jump` + (bad.length ? ` (problems: ${bad})` : ""));
  await page.close();
}

async function staleTabSaysRefresh({ browser, worker }) {
  console.log("\nOld tab after Purrtect reloads (bug: \"Check with Gemini\" silently did nothing) — runs last");
  await setSettings(worker, { enabled: true, modes: { gmail: "auto" } });
  const page = await gmailPage(browser, gmailMessage(`<p style="margin-top:60px">See <a id="l" href="https://example.org/post">example.org</a></p>`));
  await worker.evaluate(() => setTimeout(() => chrome.runtime.reload(), 50)).catch(() => {});
  await sleep(2500);
  const l = await centre(page, "#l");
  await page.mouse.move(l[0], l[1], { steps: 4 }); await sleep(1300);
  const btn = await page.evaluate(() => { const b = [...document.querySelectorAll(".purr-linkcard button")].pop(); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  if (btn) { await page.mouse.move(btn[0], btn[1], { steps: 4 }); await page.mouse.click(btn[0], btn[1]); }
  await sleep(1000);
  check(!!btn, "the old tab still shows the link card");
  check(await visible(page, ".purr-updated") === 1, "clicking \"Check with Gemini\" shows \"Refresh this page\" instead of nothing");
  await page.close();
}

(async () => {
  const ctx = await launch();
  await fakeBackend(ctx.browser, ctx.id);
  try {
    await sidePanelDrawsInEveryState(ctx);
    await onOffSwitch(ctx);
    await oneBoxOnly(ctx);
    await popupScrolls(ctx);
    await tooltipDoesntBlockLinks(ctx);
    await manualModeIsQuiet(ctx);
    await trustedLinkInRiskyEmail(ctx);
    await cardNeverCoversItsBadge(ctx);
    await verdictCardScrolls(ctx);
    await infoBubblesSteady(ctx);
    await staleTabSaysRefresh(ctx);            // last: it reloads the extension
  } finally {
    await ctx.close();
  }
  console.log(failures() ? `\nFAILED: ${failures()}` : "\nall passed");
  process.exit(failures() ? 1 : 0);
})().catch((e) => { console.error("FAILED", e.stack || e.message); process.exit(1); });
