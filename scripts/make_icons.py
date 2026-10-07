"""Draws the Milon-PT icons: the logo (an M that is also a dumbbell, assets/logo/logo.svg) in mint on near black."""
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
BG = (10, 10, 11, 255)        # --bg #0A0A0B
MINT = (94, 234, 212, 255)    # --accent #5EEAD4
N = 1024

# Same geometry as logo.svg (viewBox 0 0 96 96): vertical strokes and the V, round caps.
BARS = [(30, 28, 68), (66, 28, 68), (16, 40, 56), (80, 40, 56)]
V = [(30, 40), (48, 58), (66, 40)]

def logo(draw, scale, stroke):
    k = N / 96 * scale
    p = lambda x, y: (N / 2 + (x - 48) * k, N / 2 + (y - 48) * k)
    r = stroke / 2 * k
    for x, y0, y1 in BARS:
        (cx, a), (_, b) = p(x, y0), p(x, y1)
        draw.rounded_rectangle([cx - r, a - r, cx + r, b + r], radius=r, fill=MINT)
    pts = [p(x, y) for x, y in V]
    draw.line(pts, fill=MINT, width=round(2 * r), joint='curve')
    for x, y in pts:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=MINT)

def icon(rounded: bool, scale: float, stroke: float = 8):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, N, N], fill=BG)
    logo(d, scale, stroke)
    return img

# "any": rounded corners. maskable: fully filled, logo inside the safe zone (80 % circle).
icon(True, 1.0).resize((512, 512), Image.LANCZOS).save(f'{OUT}/icon-512.png')
icon(True, 1.0).resize((192, 192), Image.LANCZOS).save(f'{OUT}/icon-192.png')
icon(False, 0.85).resize((512, 512), Image.LANCZOS).save(f'{OUT}/maskable-512.png')
# Favicon: larger and slightly thicker so it reads in a tab at 16 px. favicon.ico for tools that request it directly.
icon(True, 1.12, 9).save(f'{OUT}/../favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
# iOS rounds the corners itself and doesn't want transparency.
icon(False, 0.9).convert('RGB').resize((180, 180), Image.LANCZOS).save(f'{OUT}/apple-touch-icon.png')
