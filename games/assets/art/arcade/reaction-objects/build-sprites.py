#!/usr/bin/env python3
"""Normalize reaction-objects sprites to 1024x1024 transparent PNG.

Rules (task 2026-11-10):
  - four corners alpha == 0
  - center alpha == 255
  - opaque body kept, no colorkey
  - 8% transparent margin around the alpha bbox

Run:
  python3 games/assets/art/arcade/reaction-objects/build-sprites.py
"""
import json
import pathlib
import sys

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
SIZE = 1024
MARGIN = 0.08
MODEL = "gpt-image-2"
NAMES = ["mole", "target", "signal-lamp"]
PROMPTS = {
    "mole": "A single cute cartoon mole head and shoulders popping up, flat vector style, bold clean outlines, warm brown fur, pink nose, small paws, centered, full object visible, no hole, no ground, no shadow, no text, no letters, no logo, pure transparent background, game sprite asset, 1024x1024",
    "target": "A single circular bullseye target board, flat vector style, bold clean outlines, concentric rings alternating bright red and warm ivory white, small dark center dot, slight three-quarter tilt, centered, full object visible, no stand, no ground, no shadow, no text, no letters, no logo, pure transparent background, game sprite asset, 1024x1024",
    "signal-lamp": "A single round signal lamp, flat vector style, bold clean outlines, dark metal housing, bright glowing green glass lens, small base, centered, full object visible, no pole, no ground, no shadow, no text, no letters, no logo, pure transparent background, game sprite asset, 1024x1024",
}

records = []
for name in NAMES:
    src = HERE / f"{name}-raw.png"
    dst = HERE / f"{name}.png"
    im = Image.open(src).convert("RGBA")
    # Anti-aliased interior came back at alpha 252-254. Anything >=240 is
    # solid body; promote it to fully opaque so the center contract is exact.
    r, g, b, a = im.split()
    a = a.point(lambda v: 255 if v >= 240 else v)
    im = Image.merge("RGBA", (r, g, b, a))

    bbox = im.getchannel("A").getbbox()
    if not bbox:
        raise SystemExit(f"{name}: empty alpha")
    body = im.crop(bbox)
    side = max(body.size)
    side = int(round(side * (1 + MARGIN * 2)))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(body, ((side - body.width) // 2, (side - body.height) // 2), body)
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    canvas.save(dst)

    px = canvas.load()
    corners = [px[0, 0][3], px[SIZE - 1, 0][3], px[0, SIZE - 1][3], px[SIZE - 1, SIZE - 1][3]]
    center = px[SIZE // 2, SIZE // 2][3]
    if corners != [0, 0, 0, 0]:
        raise SystemExit(f"{name}: corner alpha {corners}")
    if center != 255:
        raise SystemExit(f"{name}: center alpha {center}")
    records.append({
        "name": name,
        "file": f"games/assets/art/arcade/reaction-objects/{name}.png",
        "raw": f"games/assets/art/arcade/reaction-objects/{name}-raw.png",
        "model": MODEL,
        "prompt": PROMPTS[name],
        "size": [SIZE, SIZE],
        "alpha": {"corners": corners, "center": center},
    })
    print(f"ok {name}: {canvas.size} corners={corners} center={center}")

(HERE / "sprites.json").write_text(json.dumps({"version": 1, "family": "reaction", "sprites": records}, indent=2) + "\n")
print("wrote sprites.json")
