"""Gera public/icons/*.png (rode: python3 scripts/make_icons.py). Precisa de Pillow."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)


def draw_joker(tile: Image.Image, tw: int, th: int) -> None:
    """Coringa do jogo: rosto sorridente com anel em degradê e chapéu de bobo (mesmo desenho da pedra no jogo)."""
    k = 4
    W, H = tw * k, th * k
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    u = W / 200.0
    cx, cy = W / 2, H * 0.60
    R = 78 * u * 0.78
    d.ellipse((cx - R, cy - R, cx + R, cy + R), outline=255, width=int(12 * u))
    for sx in (-28, 28):
        e = 11 * u
        d.ellipse((cx + sx * u - e, cy - 18 * u - e, cx + sx * u + e, cy - 18 * u + e), fill=255)
    m = 40 * u
    d.arc((cx - m, cy + 6 * u - m, cx + m, cy + 6 * u + m), 27, 153, fill=255, width=int(11 * u))
    for dx in (-46, 0, 46):
        x = cx + dx * u
        top = cy - R - 28 * u
        d.polygon([(x - 18 * u, cy - R + 4 * u), (x, top), (x + 18 * u, cy - R + 4 * u)], fill=255)
        d.ellipse((x - 7 * u, top - 7 * u, x + 7 * u, top + 7 * u), fill=255)
    grad = Image.new("RGBA", (W, H))
    gp = grad.load()
    stops = [(0.0, (123, 47, 190)), (0.5, (209, 43, 122)), (1.0, (229, 138, 28))]
    for y in range(H):
        for x in range(W):
            t = min(1.0, max(0.0, (x / W + y / H) / 2))
            for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
                if t <= t1:
                    f = (t - t0) / (t1 - t0)
                    gp[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * f) for i in range(3)) + (255,)
                    break
    grad.putalpha(mask)
    tile.alpha_composite(grad.resize((tw, th), Image.LANCZOS))


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
    draw_joker(tile, tw, th)
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
