// Cursor cat (setting "Cursor cat", off by default): the orange pixel cat follows the cursor on Gmail
// and WhatsApp Web, and on every website with "On all websites" (content/everywhere.js).
// It never takes clicks (pointer-events: none) and respects "reduce motion".
// Animations come from mascots/cat/sheet.png (Cat Game Pixel Pack, orange tabby recoloured neon; see sheet.json).
//   follow: walks/runs after the cursor (leaning up or down when it runs diagonally), sits when
//           it stops, hops in its box, then naps (~30 s)
//   typing: sits and watches, tail swishing   scrolling: runs along   click: little jump
//   cursor on a link: looks at it and shows ✓ / ! / ⚠ (puffs up and hisses at risky ones);
//     the link card (link-card.js) underneath says where it goes
//   risky message on screen: runs to its ⚠ widget and stays beside it
//   click on a risky link: jumps in front of it (next to the click warning)
//   safe message: now and then plays with its yarn, with a little heart
// site.js and click-warning.js announce risk with "purr-risk-found", "purr-risk-click", "purr-safe-found".
(function () {
  "use strict";
  if (self.PurrCursorCat || !self.PurrSite || (PurrSite.SITE === "other" && !PurrSite.everywhere)) return;

  const ZOOM = 1.5;                        // 32 px pixel-art frames shown at 48 px (3 device px per art px on Retina)
  const FRAME = 32 * ZOOM;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let sheet = null;                        // sheet.json: { frame, feet: [16, 29], animations: { name: { row, frames, fps, loop } } }

  let root = null, sprite = null, bubble = null;
  let x = innerWidth - 80, y = innerHeight - 24;     // the cat's feet, viewport px
  let dir = -1;                                      // 1 = facing right, -1 = facing left
  let tilt = 0, wantTilt = 0;                        // body angle (deg) when running diagonally; < 0 = nose up
  let side = -1;                                     // which side of the cursor the cat keeps to (-1 left, 1 right)
  let moving = false;                                // following the cursor right now
  let mouse = { x: null, y: null };
  let lastActivity = Date.now();
  let action = null;                                 // a reaction in progress
  let typingUntil = 0, scrollUntil = 0;
  let anim = "", animStart = 0;
  let running = false;
  const cooldown = {};

  const on = () => PurrStore.settings.cursorCat === true && (!PurrSite.everywhere || PurrStore.settings.catEverywhere === true);
  const enabled = () => on() && !PurrSite.paused();
  const reduce = () => reduceMotion.matches;

  async function mount() {
    if (root) return;
    sheet = await fetch(chrome.runtime.getURL("mascots/cat/sheet.json")).then((r) => r.json());
    const rows = Object.keys(sheet.animations).length;
    const cols = Math.max(...Object.values(sheet.animations).map((a) => a.frames));
    root = document.createElement("div");
    root.className = "purr-ccat";
    root.setAttribute("aria-hidden", "true");
    sprite = document.createElement("div");
    sprite.className = "purr-ccat-sprite";
    sprite.style.backgroundImage = `url("${chrome.runtime.getURL("mascots/cat/sheet.png")}")`;
    sprite.style.backgroundSize = `${cols * FRAME}px ${rows * FRAME}px`;
    bubble = document.createElement("span");
    bubble.className = "purr-ccat-bubble";
    root.append(sprite, bubble);
    document.body.append(root);
  }

  // Show animation `name`; restart it when it changes. Non-looping animations hold their last frame.
  function play(name, now) {
    if (name !== anim) { anim = name; animStart = now; root.dataset.anim = name; }
    const a = sheet.animations[name];
    let f = reduce() ? 0 : Math.floor(((now - animStart) / 1000) * a.fps);
    f = a.loop ? f % a.frames : Math.min(f, a.frames - 1);
    sprite.style.backgroundPosition = `-${f * FRAME}px -${a.row * FRAME}px`;
    // The art is side-on only, so a diagonal run is shown by leaning the whole cat along its path.
    const target = /^(walk|run|jump)$/.test(name) ? wantTilt : 0;
    tilt += (target - tilt) * 0.2;
    if (Math.abs(tilt) < 0.5 && !target) tilt = 0;
    sprite.style.transform = `scaleX(${dir}) rotate(${tilt.toFixed(1)}deg)`;
  }

  function hush() { clearTimeout(say.t); bubble.className = "purr-ccat-bubble"; }
  function say(text, kind, ms) {
    bubble.textContent = text;
    bubble.className = `purr-ccat-bubble show ${kind || ""}`;
    clearTimeout(say.t);
    say.t = setTimeout(() => { bubble.className = "purr-ccat-bubble"; }, ms || 1400);
  }

  function place() {
    const [fx, fy] = sheet.feet; // feet anchor inside the 32 px frame
    root.style.transform = `translate(${Math.round(x - fx * ZOOM)}px, ${Math.round(y - fy * ZOOM)}px)`;
    // Keep a shown bubble (e.g. a long website name) inside the window.
    if (bubble.classList.contains("show")) {
      const half = bubble.offsetWidth / 2;
      const cx = x - fx * ZOOM + FRAME / 2;
      const shift = Math.max(0, 6 - (cx - half)) + Math.min(0, innerWidth - 6 - (cx + half));
      bubble.style.marginLeft = `${Math.round(shift)}px`;
    }
  }

  // Move toward (tx, ty); returns true when there. Turns to face the way it's going
  // only when clearly moving sideways, so small adjustments don't flip it back and forth.
  function moveTo(tx, ty, speed) {
    const dx = tx - x, dy = ty - y;
    const d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 12) dir = dx > 0 ? 1 : -1;
    if (d < 3 || reduce()) { x = tx; y = ty; wantTilt = 0; return true; }
    // Lean along the path: up to 45° nose-up or nose-down; flat when running sideways.
    wantTilt = Math.max(-45, Math.min(45, (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI));
    const step = Math.min(d, speed);
    x += (dx / d) * step;
    y += (dy / d) * step;
    return false;
  }

  function clampTarget(tx, ty) {
    return [Math.max(FRAME / 2, Math.min(innerWidth - FRAME / 2, tx)), Math.max(FRAME, Math.min(innerHeight - 4, ty))];
  }

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    if (!sheet) return;
    if (!enabled()) { root.hidden = true; return; }
    root.hidden = false;

    // A reaction in progress (run to a warning, jump, hiss, block...).
    if (action) {
      if (action.target) {
        const [tx, ty] = action.target;
        const there = moveTo(tx, ty, action.speed || 9);
        if (there && action.faceTo !== undefined) dir = action.faceTo;
        play(there ? action.anim : action.moving || "run", now);
        if (there && !action.arrivedAt) action.arrivedAt = now;
        if (there && now - action.arrivedAt > action.hold) action = null;
      } else {
        play(action.anim, now);
        if (now > action.until) { action = null; root.classList.remove("puff"); }
      }
      place();
      return;
    }

    root.classList.toggle("swish", now < typingUntil);
    if (now < scrollUntil) { play(reduce() ? "sit" : "run", now); place(); return; }
    if (now < typingUntil) { play("sit", now); place(); return; }
    if (mouse.x === null) { play("sleep", now); place(); return; }

    // Trail beside and slightly below the cursor, never under it. The cat keeps to the side of the
    // cursor it is already on and only switches once the cursor is clearly past it; it starts
    // moving only when clearly too far and stops once close (so it never jitters back and forth).
    if (x < mouse.x - 24) side = -1;
    else if (x > mouse.x + 24) side = 1;
    const [tx, ty] = clampTarget(mouse.x + side * 36, mouse.y + 30);
    const dist = Math.hypot(tx - x, ty - y);
    if (!moving && dist > 28) moving = true;
    if (moving && dist < 4) moving = false;
    if (moving) {
      const speed = Math.min(9, 1.5 + dist * 0.08);
      moveTo(tx, ty, speed);
      play(reduce() ? "sit" : speed > 4.5 ? "run" : "walk", now);
    } else {
      if (mouse.x > x + 14) dir = 1;          // face the cursor, with a dead zone
      else if (mouse.x < x - 14) dir = -1;
      const idle = Date.now() - lastActivity;
      play(idle > 30000 ? "sleep" : idle > 15000 ? "box" : idle > 4000 ? "sit" : "idle", now);
    }
    place();
  }

  async function start() {
    await mount();
    if (!running) { running = true; requestAnimationFrame(tick); }
    if (pendingRisk) { const d = pendingRisk; pendingRisk = null; onRiskFound(d); }
  }

  function react(key, ms) {
    const now = Date.now();
    if (cooldown[key] && now - cooldown[key] < ms) return false;
    cooldown[key] = now;
    return true;
  }

  // ---------- events ----------
  addEventListener("mousemove", (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    lastActivity = Date.now();
  }, { passive: true });

  // The cursor rests on a link (link-card.js judged it): the cat looks at it and shows the sign;
  // the link card underneath says where it goes. Risky: it also puffs up and hisses.
  const SIGN = { green: ["✓", "ok"], yellow: ["!", "warn"], red: ["⚠", "danger"], unknown: ["?", ""] };
  addEventListener("purr-link-hover", (e) => {
    if (!enabled() || !root || !sheet) return;
    const { el: link, level } = e.detail;
    const [sign, kind] = SIGN[level] || SIGN.unknown;
    say(sign, kind, 60000); // stays while the cursor is on the link
    if (action) return;
    const r = link.getBoundingClientRect();
    dir = r.left + r.width / 2 > x ? 1 : -1; // look at the link
    if (level === "red" && react("hiss:" + (link.href || link.innerText), 4000)) {
      action = { anim: "idle", until: performance.now() + 1300 };
      root.classList.add("puff");
    }
  });
  addEventListener("purr-link-leave", () => { if (root) hush(); });

  addEventListener("keydown", (e) => {
    const t = e.target;
    if (!t || !(t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
    lastActivity = Date.now();
    typingUntil = performance.now() + 1500;
    const r = t.getBoundingClientRect();
    dir = r.left + r.width / 2 > x ? 1 : -1; // look at the text box
  }, true);

  addEventListener("scroll", () => {
    lastActivity = Date.now();
    scrollUntil = performance.now() + 700;
  }, { capture: true, passive: true });

  addEventListener("click", (e) => {
    lastActivity = Date.now();
    if (!enabled() || !root || reduce() || action) return;
    if (e.target.closest && e.target.closest(".purr-card, .purr-overlay, .purr-widget-wrap, .purr-select-btn, a[data-purr-risk]")) return;
    const [tx, ty] = clampTarget(e.clientX - dir * 24, e.clientY + 34);
    action = { anim: "sit", moving: "jump", target: [tx, ty], speed: 20, hold: 300 };
  }, true);

  // A risky message came on screen: run to its ⚠ widget and stay beside it.
  // (If the cat is still loading its sheet, remember the latest one and react once it's ready.)
  let pendingRisk = null;
  addEventListener("purr-risk-found", (e) => onRiskFound(e.detail));
  function onRiskFound(detail) {
    if (!enabled()) return;
    if (!root || !sheet) { pendingRisk = detail; return; }
    const w = detail && detail.el;
    if (!w || !w.isConnected || !react("found", 6000)) return;
    const r = w.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    const [tx, ty] = clampTarget(r.left - 30, r.bottom + 44);
    action = { anim: "idle", target: [tx, ty], speed: 11, hold: 2600, faceTo: 1 };
    say("!", detail.level === "red" ? "danger" : "warn", 3200);
  }

  // A risky link was clicked: jump in front of it.
  addEventListener("purr-risk-click", (e) => {
    if (!enabled() || !root) return;
    const r = e.detail && e.detail.rect;
    if (r) { [x, y] = clampTarget(r.left + r.width / 2, r.bottom + FRAME); }
    document.body.append(root); // above the warning overlay
    root.classList.add("over");
    action = { anim: "jump", until: performance.now() + 2600 };
    say("!", "danger", 2600);
    setTimeout(() => root.classList.remove("over"), 2700);
  });

  // A safe message: now and then, plays with its yarn and shows a little heart.
  addEventListener("purr-safe-found", () => {
    if (!enabled() || !root || action || Math.random() > 0.35 || !react("heart", 20000)) return;
    action = { anim: "play", until: performance.now() + 1600 };
    say("♥", "love", 1600);
  });

  PurrSite.ready.then(() => {
    const sync = () => {
      document.documentElement.classList.toggle("purr-ccat-on", on());
      if (on()) start();
    };
    sync();
    chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.settings) sync(); });
  });

  self.PurrCursorCat = true;
})();
