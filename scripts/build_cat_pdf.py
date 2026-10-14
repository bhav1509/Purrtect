"""One PDF showing every cursor-cat animation (frames, name, when it plays), for the team / deck.

Reads extension/mascots/cat/sheet.png + sheet.json, writes assets/cats/cursor-cat-animations.pdf.
Usage (needs Pillow):  python3 scripts/build_cat_pdf.py
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "extension" / "mascots" / "cat"
OUT = ROOT / "assets" / "cats" / "cursor-cat-animations.pdf"

# What each animation is for, in the order shown.
INFO = [
    ("sit", "Sit & tail wag", "Standing still or while you type. Tail wags on one side."),
    ("run", "Run (also walk)", "Following the cursor. Frames follow the distance moved; slower steps = walking."),
    ("safe", "Safe (tick)", "A safe message comes on screen, or the cursor rests on a well-known site's link."),
    ("unsure", "Unsure (?)", "The cursor rests on an unfamiliar link, or a button that hides its web address."),
    ("notsafe", "Not safe (warning)", "A risky link is hovered, a risky message is on screen, or a risky link is clicked."),
    ("play", "Fish play", "Idle for about 10 seconds."),
    ("box", "Box pop", "Idle for about 20 seconds."),
    ("sleep", "Sleep", "Idle for about 30 seconds."),
]

sheet = Image.open(CAT / "sheet.png").convert("RGBA")
meta = json.loads((CAT / "sheet.json").read_text())
FW, FH = meta["frameW"], meta["frameH"]

PAGE_W, PAGE_H = 1754, 1240            # A4 landscape at 150 dpi
MARGIN, ZOOM = 70, 1                    # frames shown at their sheet size (2x screen): crisp pixel art
BG, INK, MUTED, LINE = (255, 255, 255), (43, 39, 35), (122, 114, 106), (235, 228, 218)
TILE = (250, 246, 240)


def font(size, bold=False):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size, index=1 if bold else 0)
    except OSError:
        return ImageFont.load_default()


def frames_of(name):
    a = meta["animations"][name]
    return [sheet.crop((c * FW, a["row"] * FH, (c + 1) * FW, (a["row"] + 1) * FH)) for c in range(a["frames"])], a


pages, page, y = [], None, 0
ROW_H = FH * ZOOM + 110


def new_page(first):
    p = Image.new("RGB", (PAGE_W, PAGE_H), BG)
    d = ImageDraw.Draw(p)
    d.text((MARGIN, 50), "Purrtect cursor cat — animations" if first else "Purrtect cursor cat — animations (continued)",
           font=font(40, True), fill=INK)
    d.text((MARGIN, 104), "Each row is one animation, frames left to right. Shown at 2x the on-screen size.",
           font=font(22), fill=MUTED)
    return p, 160


page, y = new_page(True)
for name, title, when in INFO:
    if name not in meta["animations"]:
        continue
    if y + ROW_H > PAGE_H - MARGIN:
        pages.append(page)
        page, y = new_page(False)
    d = ImageDraw.Draw(page)
    fs, a = frames_of(name)
    loop = "loops" if a["loop"] else "plays once"
    d.text((MARGIN, y), title, font=font(30, True), fill=INK)
    d.text((MARGIN + 330, y + 6), (f"{a['frames']} frames · {loop} — " if name == "run" else f"{a['frames']} frames · {a['fps']} fps · {loop} — ") + when, font=font(21), fill=MUTED)
    x, ty = MARGIN, y + 46
    for k, f in enumerate(fs):
        tile = Image.new("RGBA", (FW * ZOOM, FH * ZOOM), TILE + (255,))
        tile.alpha_composite(f.resize((FW * ZOOM, FH * ZOOM), Image.NEAREST))
        page.paste(tile.convert("RGB"), (x, ty))
        d.text((x + 6, ty + 4), str(k + 1), font=font(16), fill=MUTED)
        x += FW * ZOOM + 14
    y += ROW_H
    d.line((MARGIN, y - 22, PAGE_W - MARGIN, y - 22), fill=LINE, width=2)
pages.append(page)

OUT.parent.mkdir(parents=True, exist_ok=True)
pages[0].save(OUT, save_all=True, append_images=pages[1:], resolution=150)
print("wrote", OUT, "pages:", len(pages))
