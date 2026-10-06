"""Ritar Milon-PT:s ikon: en vit hantel på appens gröna accentfärg."""
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
GREEN = (47, 111, 79, 255)   # --accent (ljust läge)
WHITE = (255, 255, 255, 255)
N = 1024

def dumbbell(draw, scale=1.0):
    c = N / 2
    def rect(cx, w, h, r):
        x0, x1 = c + (cx - w / 2) * scale, c + (cx + w / 2) * scale
        y0, y1 = c - h / 2 * scale, c + h / 2 * scale
        draw.rounded_rectangle([x0, y0, x1, y1], radius=r * scale, fill=WHITE)
    rect(0, 520, 64, 20)              # stången
    for side in (-1, 1):
        rect(side * 175, 84, 340, 26)  # inre vikt
        rect(side * 262, 64, 240, 24)  # yttre vikt

def icon(rounded: bool, scale: float):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=GREEN)
    else:
        d.rectangle([0, 0, N, N], fill=GREEN)
    dumbbell(d, scale)
    return img

# "any": rundade hörn. maskable: helt fyllt, hanteln inom säkra zonen (80 % cirkel).
icon(True, 1.0).resize((512, 512), Image.LANCZOS).save(f'{OUT}/icon-512.png')
icon(True, 1.0).resize((192, 192), Image.LANCZOS).save(f'{OUT}/icon-192.png')
icon(False, 0.82).resize((512, 512), Image.LANCZOS).save(f'{OUT}/maskable-512.png')
# iOS rundar själv och vill inte ha genomskinlighet.
icon(False, 0.9).convert('RGB').resize((180, 180), Image.LANCZOS).save(f'{OUT}/apple-touch-icon.png')
