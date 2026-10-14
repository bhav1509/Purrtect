"""Build Purrtect's cat images from the logo (assets/cats/cat-fish-logo-2.png: white cat holding a fish).

Writes:
  extension/mascots/cat/<mood>.png        the logo cat with a small mood badge: idle (none), thinking (…),
                                          careful (yellow !), stop (red !!), happy (pink heart)
  extension/mascots/cat/icon.png          the logo cat on its own (side panel / pages)
  extension/mascots/icon-{16,32,48,128}.png   toolbar / browser icons

Usage (needs Pillow):  python3 scripts/build_cat_assets.py   then   ./scripts/sync.sh
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "assets" / "cats" / "cat-fish-logo-2.png"
OUT = ROOT / "extension" / "mascots"
S = 512                      # draw large, then scale down smoothly
FINAL = 192                  # mood images (shown at 28-112 px)

OUTLINE = (124, 124, 120, 255)   # the logo's grey line
WHITE = (255, 255, 255, 255)
YELLOW = (232, 163, 23, 255)
RED = (200, 50, 31, 255)
BLUE = (110, 104, 98, 255)
PINK = (232, 96, 124, 255)

logo = Image.open(LOGO).convert("RGBA")
logo = logo.crop(logo.getbbox())


def fit(img, size):
    """Scale img to fit in a size x size box, keeping its shape."""
    k = size / max(img.size)
    return img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)


def canvas_with_cat(scale=0.86):
    """The logo cat on a square canvas, nudged down-left to leave the top-right corner for a badge."""
    c = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cat = fit(logo, int(S * scale))
    c.alpha_composite(cat, (int(S * 0.02), S - cat.height))
    return c


def badge(d, fill):
    """Round badge in the top-right corner with the logo's outline; returns its centre and radius."""
    r = int(S * 0.17)
    cx, cy = S - r - 6, r + 6
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=OUTLINE)
    d.ellipse((cx - r + 12, cy - r + 12, cx + r - 12, cy + r - 12), fill=fill)
    return cx, cy, r


def bang(d, x, cy, colour=WHITE):
    d.rounded_rectangle((x - 11, cy - 46, x + 11, cy + 14), radius=10, fill=colour)
    d.ellipse((x - 12, cy + 24, x + 12, cy + 48), fill=colour)


def heart(d, cx, cy, s, colour):
    d.ellipse((cx - s, cy - s * 0.75, cx, cy + s * 0.25), fill=colour)
    d.ellipse((cx, cy - s * 0.75, cx + s, cy + s * 0.25), fill=colour)
    d.polygon([(cx - s * 0.97, cy - 0.1 * s), (cx + s * 0.97, cy - 0.1 * s), (cx, cy + s)], fill=colour)


def mood(name):
    img = canvas_with_cat()
    d = ImageDraw.Draw(img)
    if name == "thinking":
        cx, cy, r = badge(d, WHITE)
        for i in (-1, 0, 1):
            d.ellipse((cx + i * 30 - 11, cy - 11, cx + i * 30 + 11, cy + 11), fill=BLUE)
    elif name == "careful":
        cx, cy, r = badge(d, YELLOW)
        bang(d, cx, cy)
    elif name == "stop":
        cx, cy, r = badge(d, RED)
        bang(d, cx - 20, cy)
        bang(d, cx + 20, cy)
    elif name == "happy":
        cx, cy, r = badge(d, WHITE)
        heart(d, cx, cy - 4, 36, PINK)
    return img.resize((FINAL, FINAL), Image.LANCZOS)


(OUT / "cat").mkdir(parents=True, exist_ok=True)
for name in ("idle", "thinking", "careful", "stop", "happy"):
    img = mood(name)
    img.save(OUT / "cat" / f"{name}.png", optimize=True)

# The logo cat on its own: page logo and toolbar icons. (The cursor cat: scripts/build_cursor_cat.py.)
square = Image.new("RGBA", (S, S), (0, 0, 0, 0))
cat = fit(logo, S)
square.alpha_composite(cat, ((S - cat.width) // 2, (S - cat.height) // 2))
square.resize((192, 192), Image.LANCZOS).save(OUT / "cat" / "icon.png", optimize=True)
for size in (16, 32, 48, 128):
    square.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)

print("built:", sorted(p.name for p in (OUT / "cat").iterdir()), sorted(p.name for p in OUT.glob("icon-*.png")))
