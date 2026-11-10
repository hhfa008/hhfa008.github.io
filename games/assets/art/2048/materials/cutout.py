#!/usr/bin/env python3
"""Cut a single blank tile out of a pure-white studio render.

Spec (games/ART-GUIDE.md section 4): never colorkey. Flood-fill only the
near-white background connected to the image border, keep the largest
foreground component (the tile), then erode alpha by 1 px. Interior white
highlights survive because they are not connected to the border.

Usage: python3 cutout.py in.png out.png [--margin 0.035]
"""
import argparse
import sys
from collections import deque

from PIL import Image, ImageFilter

SIZE = 1024


def cutout(src, margin_ratio=0.035, sat=0.08, val=240):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    px = im.load()

    # Silhouette mode (ART-GUIDE section 4): foreground = darker than the
    # seamless white or clearly coloured. This drops the light grey contact
    # shadow that a plain white flood fill leaves behind, while interior
    # highlights are restored by the hole fill below.
    fg = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            v = max(r, g, b)
            s = (v - min(r, g, b)) / 255.0
            if (val > 0 and v < val) or s > sat:
                fg[y * w + x] = 1

    # Fill holes: everything not foreground and not reachable from the border
    # belongs to the object interior.
    ext = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if fg[i] or not ext[i]:
                ext[i] = 1
                if not fg[i]:
                    q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if fg[i] or not ext[i]:
                ext[i] = 1
                if not fg[i]:
                    q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                i = ny * w + nx
                if not fg[i] and not ext[i]:
                    ext[i] = 1
                    q.append((nx, ny))
    for i in range(w * h):
        if not fg[i] and not ext[i]:
            fg[i] = 1

    # Keep the largest 4-connected foreground component (the tile).
    seen = bytearray(w * h)
    best = []
    for start in range(w * h):
        if not fg[start] or seen[start]:
            continue
        comp = []
        q = deque([start])
        seen[start] = 1
        while q:
            i = q.popleft()
            comp.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if fg[j] and not seen[j]:
                        seen[j] = 1
                        q.append(j)
        if len(comp) > len(best):
            best = comp

    if not best:
        raise SystemExit("no foreground component found")

    alpha = Image.new("L", (w, h), 0)
    ap = alpha.load()
    for i in best:
        ap[i % w, i // w] = 255
    alpha = alpha.filter(ImageFilter.MinFilter(3))  # 1 px erosion

    # The model sometimes leaves a soft shadow under the tile. Trim to the
    # solid body rows/columns (>= 90% of the widest span), then take the
    # largest centred square so every material maps onto a square cell.
    rows = [0] * h
    cols = [0] * w
    for i in best:
        rows[i // w] += 1
        cols[i % w] += 1
    row_max = max(rows) or 1
    col_max = max(cols) or 1
    solid_rows = [y for y in range(h) if rows[y] >= row_max * 0.9]
    solid_cols = [x for x in range(w) if cols[x] >= col_max * 0.9]
    if not solid_rows or not solid_cols:
        solid_rows = [y for y in range(h) if rows[y] > 0]
        solid_cols = [x for x in range(w) if cols[x] > 0]
    x0, x1 = min(solid_cols), max(solid_cols) + 1
    y0, y1 = min(solid_rows), max(solid_rows) + 1
    side = min(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = (round(cx - side / 2), round(cy - side / 2),
           round(cx + side / 2), round(cy + side / 2))
    rgba = im.convert("RGBA")
    rgba.putalpha(alpha)
    tile = rgba.crop(box)

    # Normalise to a transparent 1024 square: tile contained, consistent
    # margin on all sides so CSS can treat every material identically.
    margin = int(SIZE * margin_ratio)
    inner = SIZE - margin * 2
    tw, th = tile.size
    scale = min(inner / tw, inner / th)
    nw, nh = max(1, round(tw * scale)), max(1, round(th * scale))
    tile = tile.resize((nw, nh), Image.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(tile, ((SIZE - nw) // 2, (SIZE - nh) // 2), tile)

    ap = out.load()
    center = ap[SIZE // 2, SIZE // 2][3]
    corners = [ap[0, 0][3], ap[SIZE - 1, 0][3], ap[0, SIZE - 1][3], ap[SIZE - 1, SIZE - 1][3]]
    if center != 255 or any(corners):
        raise SystemExit(
            f"alpha check failed: center={center} corners={corners}"
        )

    opaque = 0
    total = SIZE * SIZE
    for a in out.getchannel("A").getdata():
        if a > 8:
            opaque += 1
    print(
        f"{src} -> {out.filename if hasattr(out, 'filename') else 'memory'}: "
        f"bbox={box} aspect={tw / th:.3f} scale={scale:.3f} "
        f"opaque={opaque / total:.1%} center_alpha={center} corners={corners}"
    )
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--margin", type=float, default=0.035)
    p.add_argument("--sat", type=float, default=0.08, help="saturation threshold")
    p.add_argument("--val", type=float, default=240, help="brightness threshold (0 disables)")
    args = p.parse_args()
    out = cutout(args.src, args.margin, args.sat, args.val)
    out.save(args.dst)
    print("saved", args.dst)


if __name__ == "__main__":
    sys.exit(main())
