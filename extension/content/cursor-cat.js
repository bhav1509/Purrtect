// Cursor cat (setting "Cursor cat", off by default): the white cat follows the cursor on Gmail
// and WhatsApp Web, and on every website with "On all websites" (content/everywhere.js).
// It never takes clicks (pointer-events: none) and respects "reduce motion".
// Animations come from mascots/cat/sheet.png + sheet.json (built by scripts/build_cursor_cat.py):
// sit (tail wag), sleep, box (pops out of a box), play (with a fish), run (also used, slower, for
// walking), safe (✓), notsafe (⚠), unsure (?). The running cat's head is held level in every frame.
//   follow: walks/runs after the cursor (leaning up or down when it runs diagonally), sits when
//           it stops (tail wagging), plays with a fish (~10 s), pops up in a box (~20 s), then naps (~30 s)
//   typing: sits and watches   scrolling: runs along   click: runs to the click
//   cursor on a link: looks at it and shows ✓ / ! / ⚠; at a risky one it gets scared ("notsafe")
//     the link card (link-card.js) underneath says where it goes
//   risky message on screen: runs to its ⚠ widget, scared, and stays beside it
//   click on a risky link: appears in front of it, scared (next to the click warning)
//   safe message, or cursor on a well-known site's link: a happy ✓
//   cursor on an unfamiliar link, or a button that hides its address: a puzzled "?"
// site.js and click-warning.js announce risk with "purr-risk-found", "purr-risk-click", "purr-safe-found".
(function () {
  "use strict";
  if (self.PurrCursorCat || !self.PurrSite || (PurrSite.SITE === "other" && !PurrSite.everywhere)) return;

  let ZOOM = 0.5;                          // 1 / sheet.density: the sheet is drawn at 2x, shown at exactly half
  const FLIP = new Set(["run", "play"]);   // side-on poses face the way the cat goes; the others face you
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let sheet = null;                        // sheet.json: { frameW, frameH, animations: { name: { row, frames, fps, loop } } }
  let CW = 48, CH = 48;                    // a cell on screen, px (set from the sheet)
  const ALIAS = { idle: "sit", jump: "run", walk: "run" };   // walking = the running frames, stepped slower (a trot)

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
  let odo = 0;                                       // distance walked (px): walk/run frames follow it, so feet don't slide
  let gait = "walk";                                 // walk or run, switched with a margin so it doesn't flicker
  let vel = 0;                                       // current speed, eased (px per frame)
  let running = false;
  const cooldown = {};

  const on = () => PurrStore.settings.cursorCat === true && (!PurrSite.everywhere || PurrStore.settings.catEverywhere === true);
  const enabled = () => on() && !PurrSite.quiet();   // paused, or Manual mode: no cat
  const reduce = () => reduceMotion.matches;

  async function mount() {
    if (root) return;
    sheet = await fetch(chrome.runtime.getURL("mascots/cat/sheet.json")).then((r) => r.json());
    const rows = Object.keys(sheet.animations).length;
    const cols = Math.max(...Object.values(sheet.animations).map((a) => a.frames));
    ZOOM = 1 / (sheet.density || 2);
    CW = Math.round(sheet.frameW * ZOOM); CH = Math.round(sheet.frameH * ZOOM);
    root = document.createElement("div");
    root.className = "purr-ccat";
    root.setAttribute("aria-hidden", "true");
    root.style.width = `${CW}px`; root.style.height = `${CH}px`;
    sprite = document.createElement("div");
    sprite.className = "purr-ccat-sprite";
    sprite.style.width = `${CW}px`; sprite.style.height = `${CH}px`;
    sprite.style.backgroundImage = `url("${chrome.runtime.getURL("mascots/cat/sheet.png")}")`;
    sprite.style.backgroundSize = `${cols * CW}px ${rows * CH}px`;
    bubble = document.createElement("span");
    bubble.className = "purr-ccat-bubble";
    root.append(sprite, bubble);
    document.body.append(root);
  }

  // Show animation `name`; restart it when it changes. Non-looping animations hold their last frame.
  function play(name) {
    const stride = name === "walk" ? 16 : 22;         // px moved per frame: unhurried steps, slower when walking
    name = ALIAS[name] || name;
    const now = performance.now();
    if (name !== anim) { anim = name; animStart = now; root.dataset.anim = name; }
    const a = sheet.animations[name];
    // Walking and running step with the distance covered (one frame per a.stride px); everything
    // else plays on time. Switching between walk and run keeps the step, so there's no jump.
    let f = reduce() ? 0 : name === "run" ? Math.floor(odo / stride)
      : Math.floor(((now - animStart) / 1000) * a.fps);
    f = a.loop ? f % a.frames : Math.min(f, a.frames - 1);
    sprite.style.backgroundPosition = `-${f * CW}px -${a.row * CH}px`;
    // A diagonal run is shown by leaning the whole cat along its path.
    // Only walking and running lean; every other pose stands straight at once (no wobble).
    if (name === "run") tilt += (wantTilt - tilt) * 0.2;
    else tilt = 0;
    // Front-facing poses are never mirrored, so the ✓, ! and ⚠ always read the right way round.
    sprite.style.transform = `scaleX(${FLIP.has(name) ? dir : 1}) rotate(${tilt.toFixed(1)}deg)`;
  }

  function hush() { bubble.className = "purr-ccat-bubble"; }


  function place() {
    // (x, y) is where the cat sits: the bottom centre of its 48 px box.
    // half-pixel steps (whole device pixels on Retina): smooth slow moves without blurring the art
    const hp = (v) => Math.round(v * 2) / 2;
    root.style.transform = `translate(${hp(x - CW / 2)}px, ${hp(y - CH)}px)`;
    // Keep a shown bubble (e.g. a long website name) inside the window.
    if (bubble.classList.contains("show")) {
      const half = bubble.offsetWidth / 2;
      const cx = x;
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
    // Lean along the path: up to 30° nose-up or nose-down; flat when running sideways.
    wantTilt = Math.max(-30, Math.min(30, (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI));
    const step = Math.min(d, speed);
    x += (dx / d) * step;
    y += (dy / d) * step;
    odo += step;
    return false;
  }

  function clampTarget(tx, ty) {
    return [Math.max(CW / 2, Math.min(innerWidth - CW / 2, tx)), Math.max(CH, Math.min(innerHeight - 4, ty))];
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
        play(there ? action.anim : action.moving || "run");
        if (there && !action.arrivedAt) action.arrivedAt = now;
        if (there && now - action.arrivedAt > action.hold) action = null;
      } else {
        play(action.anim);
        if (now > action.until) action = null;
      }
      place();
      return;
    }

    if (now < scrollUntil) { play(reduce() ? "sit" : "run"); place(); return; }
    if (now < typingUntil) { play("sit"); place(); return; }
    if (mouse.x === null) { play("sleep"); place(); return; }

    // Trail beside and slightly below the cursor, never under it. The cat keeps to the side of the
    // cursor it is already on and only switches once the cursor is clearly past it; it starts
    // moving only when clearly too far and stops once close (so it never jitters back and forth).
    if (x < mouse.x - 24) side = -1;
    else if (x > mouse.x + 24) side = 1;
    const [tx, ty] = clampTarget(mouse.x + side * 36, mouse.y + 30);
    const dist = Math.hypot(tx - x, ty - y);
    if (!moving && dist > 28) moving = true;
    if (moving && dist < 4) { moving = false; vel = 0; }
    if (moving) {
      // ease into and out of speed instead of jumping, so starts and stops look natural
      vel += (Math.min(5, 1 + dist * 0.045) - vel) * 0.08;
      const speed = vel;
      moveTo(tx, ty, speed);
      if (gait === "walk" && speed > 3.6) gait = "run";
      else if (gait === "run" && speed < 2.4) gait = "walk";
      play(reduce() ? "sit" : gait);
    } else {
      if (mouse.x > x + 14) dir = 1;          // face the cursor, with a dead zone
      else if (mouse.x < x - 14) dir = -1;
      const idle = Date.now() - lastActivity;
      play(idle > 30000 ? "sleep" : idle > 20000 ? "box" : idle > 10000 ? "play" : "sit");
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

  // The cursor rests on a link (link-card.js judged it): the cat looks at it and reacts with its own
  // sign (✓ / ? / ⚠ are part of the animations, so there's no extra bubble);
  // the link card underneath says where it goes. Risky: it looks scared ("notsafe"); well-known: a happy ✓.
  addEventListener("purr-link-hover", (e) => {
    if (!enabled() || !root || !sheet) return;
    const { el: link, level } = e.detail;
    if (action) return;
    const r = link.getBoundingClientRect();
    dir = r.left + r.width / 2 > x ? 1 : -1; // look at the link
    if ((level === "red" || level === "yellow") && react("hiss:" + (link.href || link.innerText), 4000)) {
      action = { anim: "notsafe", until: performance.now() + 1300 };
    } else if (level === "green" && react("tick:" + (link.href || link.innerText), 4000)) {
      action = { anim: "safe", until: performance.now() + 1400 };   // a happy ✓ for a well-known site
    } else if ((level === "unfamiliar" || level === "unknown") && react("unsure:" + (link.href || link.innerText), 4000)) {
      action = { anim: "unsure", until: performance.now() + 1600 }; // "?" for a site it doesn't know
    }
  });
  addEventListener("purr-link-leave", () => { if (root) hush(); });

  // The link card opened: walk over and sit beside it (right side, or left if there's no room),
  // showing the link's verdict, so the card never covers the cat. Back to following when it closes.
  const VERDICT = { green: "safe", unfamiliar: "unsure", unknown: "unsure", yellow: "notsafe", red: "notsafe" };
  addEventListener("purr-linkcard-open", (e) => {
    if (!enabled() || !root || !sheet) return;
    const { rect: r, level } = e.detail;
    const right = r.right + CW / 2 + 6 <= innerWidth;
    const [tx, ty] = clampTarget(right ? r.right + CW / 2 + 6 : r.left - CW / 2 - 6, r.bottom);
    action = { anim: VERDICT[level] || "sit", moving: "walk", target: [tx, ty], speed: 4.5, hold: 1e9, parked: true };
  });
  addEventListener("purr-linkcard-close", () => { if (action && action.parked) action = null; });

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
    action = { anim: "sit", moving: "run", target: [tx, ty], speed: 8, hold: 300 };
  }, true);

  // A risky message came on screen: run to its ⚠ widget and stay beside it.
  // (If the cat isn't on the page yet, remember the latest one and react once it is.)
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
    action = { anim: "notsafe", target: [tx, ty], speed: 7, hold: 2600, faceTo: 1 };
  }

  // A risky link was clicked: jump in front of it.
  addEventListener("purr-risk-click", (e) => {
    if (!enabled() || !root) return;
    const r = e.detail && e.detail.rect;
    if (r) { [x, y] = clampTarget(r.left + r.width / 2, r.bottom + CH); }
    document.body.append(root); // above the warning overlay
    root.classList.add("over");
    action = { anim: "notsafe", until: performance.now() + 2600 };
    setTimeout(() => root.classList.remove("over"), 2700);
  });

  // A safe message: now and then, plays with its yarn and shows a little heart.
  // A safe message came on screen: a happy ✓ every time (at most once every 6 s, so a page of
  // safe emails doesn't keep it busy). The fish play now happens on its own when idle.
  addEventListener("purr-safe-found", () => {
    if (!enabled() || !root || action || !react("tick", 6000)) return;
    action = { anim: "safe", until: performance.now() + 1600 };
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
