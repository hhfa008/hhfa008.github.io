#!/usr/bin/env python3
"""Normalize the img-gen Hanoi disk sprite.

Input : games/assets/art/arcade/hanoi/disk-raw.png  (img-gen, 2172x724 RGBA)
Output: games/assets/art/arcade/hanoi/disk.png      (640x160 RGBA transparent)

Rules (ART-GUIDE §4 + batch-2 acceptance):
  - alpha <= 8 (model halo) -> 0; alpha >= 240 (solid body) -> 255
  - crop to the alpha bbox, keep the cylinder aspect, fit inside 640x160
  - four corners alpha == 0, center alpha == 255
  - the sprite is displayed by CSS object-fit:fill at 30-270 x 18-30 px, so
    the 640x160 source keeps the wooden texture crisp at 2x the widest disk.

Run: python3 games/assets/art/arcade/hanoi/build-disk.py
"""
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "disk-raw.png"
DST = HERE / "disk.png"
W, H = 640, 160
MARGIN = 0.02

im = Image.open(SRC).convert("RGBA")
r, g, b, a = im.split()
a = a.point(lambda v: 0 if v <= 8 else (255 if v >= 240 else v))
im = Image.merge("RGBA", (r, g, b, a))

bbox = im.getchannel("A").getbbox()
if not bbox:
    raise SystemExit("empty alpha bbox")
body = im.crop(bbox)
max_w = W * (1 - MARGIN * 2)
max_h = H * (1 - MARGIN * 2)
scale = min(max_w / body.width, max_h / body.height)
body = body.resize((max(1, round(body.width * scale)), max(1, round(body.height * scale))), Image.LANCZOS)

canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
canvas.paste(body, ((W - body.width) // 2, (H - body.height) // 2), body)
canvas.save(DST)

px = canvas.load()
corners = [px[0, 0][3], px[W - 1, 0][3], px[0, H - 1][3], px[W - 1, H - 1][3]]
center = px[W // 2, H // 2][3]
print(f"wrote {DST} {canvas.size} body={body.size} corners={corners} center={center}")
if corners != [0, 0, 0, 0] or center != 255:
    raise SystemExit("alpha contract failed")
