# Cat artwork

Source images for Purrtect's cats. Not shipped as-is; the build scripts make the files the
extension and website use.

- `cat-fish-logo-2.png`: the Purrtect logo (white cat holding a fish). `scripts/build_cat_assets.py`
  makes the card mascots and toolbar icons from it; the website uses resized copies in `web/brand/`.
- `cursor-cat-source.png`: the cursor cat's animations (line-art white cat, one row per animation).
  `scripts/build_cursor_cat.py` cuts it into `extension/mascots/cat/sheet.png` + `sheet.json`.
- `cursor-cat-animations.pdf`: every cursor-cat animation with when it plays, for the team and the deck
  (`scripts/build_cat_pdf.py`).
- `cat-fish-logo.png`, `cat-logo.png`, `cat-white-pixel.png`, `cat-grey-pixel.png`: earlier logo
  options, kept for the demo video, deck or later use.
