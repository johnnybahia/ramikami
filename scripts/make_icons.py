"""Gera public/icons/*.png (rode: python3 scripts/make_icons.py). Precisa de Pillow."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)


def tile_icon(size: int, maskable: bool) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (12, 20, 16, 255))
    # feltro com gradiente radial
    bg = Image.new("RGBA", (s, s))
    px = bg.load()
    cx = cy = s / 2
    for y in range(s):
        for x in range(s):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / (s * 0.72)
            k = max(0.0, 1 - d)
            px[x, y] = (int(14 + 18 * k), int(38 + 70 * k), int(28 + 46 * k), 255)
    img = bg
    # pedra
    scale = 0.52 if maskable else 0.6
    tw, th = int(s * scale * 0.72), int(s * scale * 1.0)
    tile = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    r = int(tw * 0.14)
    d.rounded_rectangle((0, 0, tw - 1, th - 1), r, fill=(246, 239, 220, 255), outline=(190, 170, 120, 255), width=max(2, s // 128))
    f = ImageFont.truetype(FONT, int(th * 0.46))
    txt = "13"
    bb = d.textbbox((0, 0), txt, font=f)
    d.text(((tw - (bb[2] - bb[0])) / 2 - bb[0], th * 0.12 - bb[1]), txt, font=f, fill=(209, 43, 43, 255))
    rr = int(tw * 0.17)
    d.ellipse((tw / 2 - rr, th * 0.70 - rr, tw / 2 + rr, th * 0.70 + rr), outline=(209, 43, 43, 255), width=max(3, s // 60))
    tile = tile.rotate(-9, expand=True, resample=Image.BICUBIC)
    shadow = Image.new("RGBA", tile.size, (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 120), mask=tile.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(s // 40))
    px0 = (s - tile.width) // 2
    py0 = (s - tile.height) // 2
    img.alpha_composite(shadow, (px0 + s // 50, py0 + s // 36))
    img.alpha_composite(tile, (px0, py0))
    if not maskable:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), int(s * 0.22), fill=255)
        img.putalpha(mask)
    return img


for name, size, maskable in [("icon-192.png", 192, False), ("icon-512.png", 512, False), ("icon-maskable-512.png", 512, True)]:
    tile_icon(size, maskable).save(os.path.join(OUT, name))
    print("ok", name)
