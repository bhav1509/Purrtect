CAT GAME PIXEL PACK  (original art, free to use in your game)

ONE FILE:  cat_game_atlas.png  +  cat_game_atlas.json
  - "cats":    9 colours, each a 32x32 sheet with 8 animations (idle, sit, walk, run, sleep, jump, box, play).
               feetAnchor (16,29) = the point that touches the floor.
  - "rooms":   6 empty room styles. floorOrigin = screen position of the back floor corner (world 0,0,0).
  - "sprites": 199 furniture / accessory sprites.
               floor items: anchor = pixel that sits on the floor point you place it at.
               wall items:  _left / _right versions for each back wall.

SCALE: everything is drawn at the same scale (1 unit = 1.6 cm, floor tile 32x16 px).
  Draw at 1:1, then zoom the whole game by 2x/3x/4x (nearest-neighbour). Never resize single sprites.
  Isometric: world (x, y, z) -> screen (originX + x - y, originY + (x + y)/2 - z).

Loose files are in cats/, items/, rooms/. Previews in previews/. Python generators in source/ (run build_all.py).
