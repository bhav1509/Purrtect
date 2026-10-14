"""Build Purrtect's cat images from the Cat Game Pixel Pack (orange tabby).

Reads cat-game-pack/cat_game_atlas.png + .json and writes:
  extension/mascots/cat/<mood>.png        animated PNG (APNG) per mood: idle, thinking, careful, stop, happy
  extension/mascots/cat/<mood>-still.png  first frame, for people with "reduce motion" on
  extension/mascots/cat/icon.png          the cat holding a magnifying glass (side panel / website logo)
  extension/mascots/icon-{16,32,48,128}.png   toolbar / browser icons
  extension/mascots/cat/sheet.png         the cursor cat's animation sheet, recoloured neon orange (+ sheet.json)

Pixel art is kept crisp: drawn at 1:1 on a 40 x 40 canvas, then scaled 4x with nearest-neighbour.
Usage (needs Pillow):  python3 scripts/build_cat_assets.py   then   ./scripts/sync.sh
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / "cat-game-pack"
OUT = ROOT / "extension" / "mascots"
CAT = "orange_tabby"
SCALE = 4
CANVAS = 40            # cat frame (32) + room for a symbol above and beside it
CAT_AT = (2, 7)        # where the 32 x 32 frame sits on the canvas

# Pack palette (orange tabby outline) so added symbols match the art.
INK = (110, 58, 34, 255)
RED = (214, 58, 48, 255)
YEL = (245, 176, 40, 255)
BLUE = (70, 120, 210, 255)
PINK = (232, 86, 112, 255)
LENS = (196, 228, 246, 255)
LENS_SHINE = (255, 255, 255, 255)
RIM = (59, 111, 216, 255)
WOOD = (150, 96, 54, 255)

atlas = Image.open(PACK / "cat_game_atlas.png").convert("RGBA")
meta = json.loads((PACK / "cat_game_atlas.json").read_text())
cat = meta["cats"][CAT]
anims = cat["animations"]


def frames(name):
    return [atlas.crop((x, y, x + w, y + h)) for x, y, w, h in anims[name]["rects"]]


def px(d, x, y, c):
    d.point((x, y), fill=c)


def rect(d, x0, y0, x1, y1, c):
    d.rectangle((x0, y0, x1, y1), fill=c)


def bang(d, x, y, c):
    """Pixel '!' with outline, 3 px wide, 9 px tall, top-left at (x, y)."""
    rect(d, x - 1, y - 1, x + 3, y + 6, INK); rect(d, x, y, x + 2, y + 5, c)
    rect(d, x - 1, y + 7, x + 3, y + 10, INK); rect(d, x, y + 8, x + 2, y + 9, c)


def heart(d, x, y):
    for (dx, dy) in [(1, 0), (2, 0), (4, 0), (5, 0), (0, 1), (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1),
                     (0, 2), (1, 2), (2, 2), (3, 2), (4, 2), (5, 2), (6, 2), (1, 3), (2, 3), (3, 3), (4, 3), (5, 3),
                     (2, 4), (3, 4), (4, 4), (3, 5)]:
        px(d, x + dx, y + dy, PINK)


def dots(d, x, y, n):
    for i in range(n):
        rect(d, x + i * 4, y, x + i * 4 + 1, y + 1, BLUE)


def compose(frame, overlay=None, i=0):
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    img.alpha_composite(frame, CAT_AT)
    if overlay:
        overlay(ImageDraw.Draw(img), i)
    return img


def big(img, scale=SCALE):
    return img.resize((img.width * scale, img.height * scale), Image.NEAREST)


def save_apng(path, imgs, fps):
    imgs = [big(i) for i in imgs]
    # disposal=0 (keep) + blend=0 (each frame replaces the canvas): Chrome draws nothing with disposal=1.
    imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=int(1000 / fps), loop=0, disposal=0, blend=0)
    imgs[0].save(path.with_name(path.stem + "-still.png"))


# ---------- moods ----------
MOODS = {
    # mood: (pack animation, fps, overlay)
    "idle": ("sleep", 3, None),                                                     # the pack draws its own "z"
    "thinking": ("sit", 4, lambda d, i: dots(d, 28, 4, 1 + i % 3)),                 # "…" grows
    "careful": ("idle", 6, lambda d, i: bang(d, 34, 2, YEL)),
    "stop": ("idle", 6, lambda d, i: (bang(d, 29, 2 - i % 2, RED), bang(d, 35, 2 - i % 2, RED))),  # "!!" bounces
    "happy": ("play", 8, lambda d, i: heart(d, 31, 1 if i % 2 else 2)),
}
(OUT / "cat").mkdir(parents=True, exist_ok=True)
for mood, (anim, fps, overlay) in MOODS.items():
    save_apng(OUT / "cat" / f"{mood}.png", [compose(f, overlay, i) for i, f in enumerate(frames(anim))], fps)


# ---------- icon: sitting cat holding a magnifying glass ----------
def magnifier(d, cx, cy):
    # handle (down-left, held by the cat), rim, lens, shine
    for t in range(5):
        rect(d, cx - 5 - t, cy + 4 + t, cx - 4 - t, cy + 5 + t, INK)
    for t in range(4):
        px(d, cx - 5 - t, cy + 5 + t, WOOD)
    d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=INK)
    d.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=RIM)
    d.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=LENS)
    px(d, cx - 1, cy - 2, LENS_SHINE); px(d, cx - 2, cy - 1, LENS_SHINE)


sit0 = frames("sit")[0]
icon = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
icon.alpha_composite(sit0, (-3, 0))
magnifier(ImageDraw.Draw(icon), 24, 18)
big(icon).save(OUT / "cat" / "icon.png")
for size in (16, 32, 48, 128):
    icon.resize((size, size), Image.NEAREST if size % 32 == 0 else Image.LANCZOS).save(OUT / f"icon-{size}.png")


# ---------- cursor cat: the orange cat's animation sheet, in neon orange ----------
# Tabby fur colours -> brighter, more saturated ones (the glow is added in CSS). Eyes, nose,
# yarn and the outline's darkness stay, so it still reads as the same cat.
NEON = {
    (228, 134, 66): (255, 106, 26),    # main fur
    (190, 100, 44): (226, 58, 0),      # stripes
    (184, 128, 74): (214, 78, 10),
    (222, 166, 104): (255, 146, 56),
    (218, 164, 112): (255, 152, 70),
    (238, 190, 140): (255, 180, 104),
    (240, 196, 138): (255, 190, 112),
    (250, 214, 168): (255, 214, 150),  # belly
    (110, 58, 34): (92, 28, 6),        # outline
}


def neon(img):
    px_ = img.load()
    for yy in range(img.height):
        for xx in range(img.width):
            r, g, b, a = px_[xx, yy]
            if a and (r, g, b) in NEON:
                px_[xx, yy] = (*NEON[(r, g, b)], a)
    return img


names = list(anims)
cols = max(a["frames"] for a in anims.values())
sheet = Image.new("RGBA", (cols * 32, len(names) * 32), (0, 0, 0, 0))
info = {"frame": 32, "feet": cat["feetAnchor"], "animations": {}}
for row, name in enumerate(names):
    for col, f in enumerate(frames(name)):
        sheet.alpha_composite(f, (col * 32, row * 32))
    info["animations"][name] = {"row": row, "frames": anims[name]["frames"], "fps": anims[name]["fps"], "loop": anims[name]["loop"]}
neon(sheet).save(OUT / "cat" / "sheet.png")
(OUT / "cat" / "sheet.json").write_text(json.dumps(info, indent=1) + "\n")

print("built:", sorted(p.name for p in (OUT / "cat").iterdir()), sorted(p.name for p in OUT.glob("icon-*.png")))
