"""Build the cursor cat's animation sheet from assets/cats/cursor-cat-source.png (the line-art white
cat, laid out like assets/cats/cursor-cat-animations.pdf: numbered frame tiles, one row per animation).

Each tile is cut out, its frame number blanked, and the cream tile / white page made transparent.
The cat's white fur is kept (it sits inside the black outline), and the soft grey anti-aliasing just
outside the outline becomes a proper transparent edge, so there is no light halo on dark pages.
All frames are scaled by the same amount; frames of a row keep their places in the tile (so hops
and bobs stay), the cat's feet sit on the bottom of the cell, and frames are lined up so the body
doesn't shake. The running row is lined up on the eyes, so the head stays level.

Writes extension/mascots/cat/sheet.png + sheet.json (used by content/cursor-cat.js) and
dist/cursor-cat-preview.png (all rows on light and dark, for review; not committed).
Usage (needs Pillow, NumPy, SciPy):  python3 scripts/build_cursor_cat.py   then copy mascots to web/
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "cats" / "cursor-cat-source.png"
OUT = ROOT / "extension" / "mascots" / "cat"
PREVIEW = ROOT / "dist" / "cursor-cat-preview.png"       # review image; dist/ is not committed

# name: (row y from-to, x from-to, frames, fps, loop) - measured on the source sheet
ROWS = {
    "sit":     (195, 315, 50, 691, 6, 6, True),
    "run":     (431, 552, 50, 691, 6, 14, True),
    "safe":    (668, 792, 50, 644, 5, 6, False),
    "unsure":  (908, 1032, 50, 696, 6, 6, False),
    "notsafe": (196, 322, 764, 1399, 5, 6, False),
    "play":    (423, 556, 765, 1400, 5, 6, False),
    "box":     (657, 792, 765, 1403, 6, 8, False),
    "sleep":   (889, 1012, 766, 1272, 4, 2, True),
}
TILE = np.array([250, 247, 239])       # the frame tiles' cream
SIT_H_OUT = 86                         # sitting cat height in the sheet (43 px on screen)
DENSITY = 2                            # sheet px per screen px: shown at exactly half size (1:1 on Retina)
EYE_ALIGN = {"run"}                    # leaping poses: keep the head level instead of the feet on the ground

src = np.asarray(Image.open(SRC).convert("RGB")).astype(int)


def tiles(y0, y1, x0, x1):
    """x ranges of the tiles in a row: split at the thin gaps that are neither cream nor drawing."""
    tilec = (np.abs(src - TILE).max(2) <= 6)[y0 + 8:y1 - 8, x0:x1 + 1].mean(0)
    ink = (src.min(2) < 200)[y0 + 8:y1 - 8, x0:x1 + 1].any(0)
    sep = (tilec < 0.5) & ~ink
    segs, start = [], None
    for i, v in enumerate(sep):
        if not v and start is None:
            start = i
        if v and start is not None:
            segs.append((x0 + start, x0 + i)); start = None
    if start is not None:
        segs.append((x0 + start, x1 + 1))
    return [s for s in segs if s[1] - s[0] > 50]


def cut(y0, y1, tx0, tx1):
    crop = src[y0:y1, tx0:tx1].copy()
    crop[:26, :24] = TILE                                  # the frame number in the corner
    light = (crop.min(2) > 200) & (crop.max(2) - crop.min(2) < 28)
    lab, _ = nd.label(light)
    edge_ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge_ids))
    alpha = np.where(bg, 0, 255).astype(float)
    rgb = crop.astype(float)
    # anti-aliased edge: a grey pixel next to the background is the dark line partly over the tile;
    # turn it into the line colour with matching transparency (no light halo on dark pages)
    near = nd.binary_dilation(bg, iterations=2) & ~bg
    grey = (crop.max(2) - crop.min(2) < 28) & near
    lum = crop.mean(2)
    line = 35.0
    a = np.clip((TILE.mean() - lum) / (TILE.mean() - line), 0, 1)
    alpha[grey] = np.minimum(alpha[grey], a[grey] * 255)
    rgb[grey] = line
    rgb[bg] = line                                          # transparent pixels carry the line colour
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA")


def white_tick(img):
    """The "safe" badge: make the dark check mark inside the green circle white (anti-aliased edges
    become a white-green blend), so it reads like a real ✓ badge."""
    a = np.asarray(img).astype(float)
    rgb, alpha = a[..., :3], a[..., 3]
    green = (rgb[..., 1] > rgb[..., 0] + 40) & (rgb[..., 1] > rgb[..., 2] + 25) & (alpha > 0)
    if green.sum() < 50:
        return img
    disc = nd.binary_erosion(nd.binary_fill_holes(green), iterations=3)     # inside the circle's outline
    g = rgb[green].mean(0)
    gl = g.mean()
    lum = rgb.mean(2)
    tick = disc & ~green & (lum < gl + 10)
    t = np.clip((lum - 35) / max(1, gl - 35), 0, 1)[..., None]        # 0 = dark tick, 1 = green
    rgb[tick] = (255 * (1 - t) + g * t)[tick]
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA")


rows = {}
for name, (y0, y1, x0, x1, count, fps, loop) in ROWS.items():
    ts = tiles(y0, y1, x0, x1)
    assert len(ts) == count, (name, len(ts), count)
    rows[name] = [cut(y0, y1, a, b) for a, b in ts]
rows["safe"] = [white_tick(f) for f in rows["safe"]]

# one scale for everything: the sitting cat comes out SIT_H_OUT px tall
sit_h = np.median([f.getbbox()[3] - f.getbbox()[1] for f in rows["sit"]])
k = SIT_H_OUT / sit_h
rows = {n: [f.resize((round(f.width * k), round(f.height * k)), Image.LANCZOS) for f in fs] for n, fs in rows.items()}


def eyes(img):
    """Centre (x, y) of the two eyes: two similar dark round dots side by side, the topmost pair."""
    a = np.asarray(img).astype(int)
    dark = (a[..., 3] > 160) & (a[..., :3].max(2) < 70)
    lab, _ = nd.label(dark)
    blobs = []
    for i, sl in enumerate(nd.find_objects(lab)):
        size = int((lab[sl] == i + 1).sum()); h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        if 6 <= size <= 120 and 0.6 < h / max(w, 1) < 1.7:
            blobs.append(((sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2, size))
    pairs = [((y1 + y2) / 2, (x1 + x2) / 2) for i, (y1, x1, s1) in enumerate(blobs) for (y2, x2, s2) in blobs[i + 1:]
             if abs(y1 - y2) < 4 and 6 < abs(x1 - x2) < 30 and 0.6 < s1 / s2 < 1.6]
    if not pairs:
        return None
    y, x = min(pairs)
    return x, y


def align(frames):
    """Horizontal offset per frame that best overlaps the first one (the body stays put)."""
    ref = np.asarray(frames[0])[..., 3] > 128
    out = [(0, 0)]
    for f in frames[1:]:
        a = np.asarray(f)[..., 3] > 128
        h = min(ref.shape[0], a.shape[0])
        best, best_dx = -1, 0
        for dx in range(-20, 21):
            x0, x1 = max(0, dx), min(ref.shape[1], a.shape[1] + dx)
            if x1 <= x0:
                continue
            score = (ref[:h, x0:x1] & a[:h, x0 - dx:x1 - dx]).sum()
            if score > best:
                best, best_dx = score, dx
        out.append((best_dx, 0))
    return out


def align_on_eyes(frames):
    e0 = eyes(frames[0])
    out = []
    for f in frames:
        e = eyes(f)
        out.append((round(e0[0] - e[0]), round(e0[1] - e[1])) if e and e0 else (0, 0))
    return out


offsets = {n: (align_on_eyes(fs) if n in EYE_ALIGN else align(fs)) for n, fs in rows.items()}

cell_w = max(f.getbbox()[2] - f.getbbox()[0] + abs(dx) * 2 for n, fs in rows.items() for f, (dx, dy) in zip(fs, offsets[n])) + 6
cell_h = max(max(f.getbbox()[3] + dy for f, (dx, dy) in zip(fs, offsets[n])) - min(f.getbbox()[1] + dy for f, (dx, dy) in zip(fs, offsets[n]))
             for n, fs in rows.items()) + 6
cell_w += cell_w % 2; cell_h += cell_h % 2
cols = max(len(fs) for fs in rows.values())
sheet = Image.new("RGBA", (cols * cell_w, len(rows) * cell_h), (0, 0, 0, 0))
meta = {"frameW": cell_w, "frameH": cell_h, "density": DENSITY, "animations": {}}
for r, (name, fs) in enumerate(rows.items()):
    y0, y1, x0, x1, count, fps, loop = ROWS[name]
    bottom = max(f.getbbox()[3] + offsets[name][c][1] for c, f in enumerate(fs))
    b0 = fs[0].getbbox()
    left = (cell_w - (b0[2] - b0[0])) // 2 - b0[0]       # frame 0's drawing centred; the rest line up with it
    for c, f in enumerate(fs):
        dx, dy = offsets[name][c]
        box = f.getbbox()
        piece = f.crop(box)
        x = c * cell_w + left + dx + box[0]
        y = r * cell_h + cell_h - 3 - (bottom - box[1] - dy)
        sheet.alpha_composite(piece, (x, y))
    meta["animations"][name] = {"row": r, "frames": len(fs), "fps": fps, "loop": loop}

OUT.mkdir(parents=True, exist_ok=True)
# 256-colour palette: looks the same, about a sixth of the size (method 2 = fast octree, keeps transparency)
sheet.quantize(colors=256, method=2, dither=0).save(OUT / "sheet.png", optimize=True)
(OUT / "sheet.json").write_text(json.dumps(meta, indent=1) + "\n")
prev = Image.new("RGBA", (sheet.width, sheet.height * 2), (0, 0, 0, 0))
for i, bg in enumerate(((250, 246, 240, 255), (32, 33, 36, 255))):
    t = Image.new("RGBA", sheet.size, bg); t.alpha_composite(sheet); prev.alpha_composite(t, (0, i * sheet.height))
PREVIEW.parent.mkdir(exist_ok=True)
prev.save(PREVIEW, optimize=True)
print("sheet", sheet.size, "cell", cell_w, "x", cell_h, "scale", round(k, 3), {n: len(v) for n, v in rows.items()})
print("run offsets", offsets["run"])
