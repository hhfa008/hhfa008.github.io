#!/usr/bin/env python3
"""Alpha/size contract check for arcade in-game sprites.

Usage:
  python3 games/assets/art/arcade/engine/verify-alpha.py <png> [<png> ...]

Checks: four corners alpha == 0, center alpha == 255, RGBA mode.
Exits non-zero on the first violation so a silent pass is impossible.
"""
import sys
from PIL import Image

fail = 0
for p in sys.argv[1:]:
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
    center = px[w // 2, h // 2][3]
    ok = corners == [0, 0, 0, 0] and center == 255
    if not ok:
        fail += 1
    print(f"{'OK' if ok else 'FAIL'} {p} {w}x{h} corners={corners} center={center}")

sys.exit(1 if fail else 0)
