#!/usr/bin/env bash
# Generate square PWA icons from a wide (or square) source logo.
# Usage:
#   ./make-icons.sh [source-image]
# Default source is web-flat/logo.png (created/updated when you pass a path).
# Output (in web-flat/):
#   icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png  favicon-32.png
#   admin-icon-192.png  admin-icon-512.png  admin-icon-maskable-512.png  admin-apple-touch-icon.png
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# Works both in this box layout (script lives next to web-flat/)
# and when the script is uploaded to the GitHub Pages repo root.
if [[ -d "$ROOT/web-flat" ]]; then
  OUT="$ROOT/web-flat"
else
  OUT="$ROOT"
fi
DEFAULT_SRC="$OUT/logo.png"
SRC="${1:-$DEFAULT_SRC}"

if [[ ! -f "$SRC" ]]; then
  echo "Source image not found: $SRC" >&2
  echo "Usage: $0 [source-image]" >&2
  exit 1
fi

# Keep a canonical copy next to the site files (unless the source already is that file).
mkdir -p "$OUT"
SRC_ABS="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"
if [[ "$SRC_ABS" != "$(cd "$OUT" && pwd)/logo.png" ]]; then
  cp -f "$SRC_ABS" "$OUT/logo.png"
  echo "Copied source → $OUT/logo.png"
fi
SRC="$OUT/logo.png"

python3 - "$SRC" "$OUT" << 'PY'
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

src_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
FALLBACK_BG = (204, 29, 106)  # #CC1D6A, sampled from the Fest7 Express logo
FONT_TTC = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

src = Image.open(src_path).convert("RGBA")


def sample_bg(im):
    w, h = im.size
    samples = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1)]
    colors = []
    for x, y in samples:
        px = im.getpixel((x, y))
        if len(px) == 4 and px[3] < 200:
            continue
        colors.append(px[:3])
    if not colors:
        return FALLBACK_BG
    # Median-ish by picking the most common exact corner color; else average
    from collections import Counter
    c, n = Counter(colors).most_common(1)[0]
    if n >= 2:
        return c
    r = sum(t[0] for t in colors) // len(colors)
    g = sum(t[1] for t in colors) // len(colors)
    b = sum(t[2] for t in colors) // len(colors)
    return (r, g, b)


def darken(rgb, factor=0.82):
    return tuple(max(0, min(255, int(round(c * factor)))) for c in rgb)


def clamp8(v):
    return 0 if v < 0 else 255 if v > 255 else int(round(v))


def punch_background(im, bg):
    """Treat the sampled source background as transparent (GIMP-style color-to-alpha),
    so the logo can sit on a darker admin canvas without a visible rectangle."""
    im = im.convert("RGBA")
    pixels = list(im.getdata())
    br, bgc, bb = bg
    out = []
    for r, g, b, a in pixels:
        def chan_alpha(c, bc):
            if c == bc:
                return 0.0
            if c > bc:
                return (c - bc) / (255.0 - bc) if bc < 255 else 1.0
            return (bc - c) / float(bc) if bc > 0 else 1.0
        alpha = max(chan_alpha(r, br), chan_alpha(g, bgc), chan_alpha(b, bb))
        if alpha < 0.02:
            out.append((0, 0, 0, 0))
            continue
        fr = clamp8(br + (r - br) / alpha)
        fg = clamp8(bgc + (g - bgc) / alpha)
        fb = clamp8(bb + (b - bb) / alpha)
        out.append((fr, fg, fb, clamp8(alpha * a)))
    punched = Image.new("RGBA", im.size)
    punched.putdata(out)
    return punched


def fit_logo(logo, canvas_size, width_ratio):
    max_w = max(1, int(round(canvas_size * width_ratio)))
    max_h = max(1, int(round(canvas_size * 0.72)))
    lw, lh = logo.size
    scale = min(max_w / lw, max_h / lh)
    nw, nh = max(1, int(round(lw * scale))), max(1, int(round(lh * scale)))
    return logo.resize((nw, nh), Image.Resampling.LANCZOS)


def paste_center(canvas, logo):
    x = (canvas.size[0] - logo.size[0]) // 2
    y = (canvas.size[1] - logo.size[1]) // 2
    canvas.alpha_composite(logo, (x, y))
    return y, y + logo.size[1]


def draw_badge(canvas, text, below_y, bg, font_path=FONT_TTC):
    """Subtle bottom-center '后台' pill, kept inside the central area."""
    size = canvas.size[0]
    # Font scales with canvas; keep modest
    font_size = max(12, int(round(size * 0.07)))
    font = None
    if Path(font_path).exists():
        try:
            font = ImageFont.truetype(font_path, font_size, index=2)  # Noto Sans CJK SC
        except Exception:
            try:
                font = ImageFont.truetype(font_path, font_size)
            except Exception:
                font = None
    if font is None:
        font = ImageFont.load_default()

    tmp = ImageDraw.Draw(canvas)
    bbox = tmp.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = int(size * 0.035), int(size * 0.016)
    bw, bh = tw + pad_x * 2, th + pad_y * 2
    radius = bh // 2
    bx = (size - bw) // 2
    # Place just below the logo, but not lower than 78% (maskable-safe-ish)
    by = min(max(below_y + int(size * 0.04), int(size * 0.68)), int(size * 0.78) - bh)
    if by < below_y + 4:
        by = min(int(size * 0.78) - bh, below_y + 4)

    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    fill = darken(bg, 0.55) + (210,)
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=radius, fill=fill)
    # text baseline correction
    tx, ty = bx + pad_x - bbox[0], by + pad_y - bbox[1]
    d.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))
    canvas.alpha_composite(overlay)


def make_icon(logo, size, width_ratio, bg, badge=False, punched=None):
    canvas = Image.new("RGBA", (size, size), bg + (255,))
    fitted = fit_logo(punched if punched is not None else logo, size, width_ratio)
    _top, bottom = paste_center(canvas, fitted)
    if badge:
        draw_badge(canvas, "后台", bottom, bg)
    return canvas.convert("RGB")


bg = sample_bg(src)
admin_bg = darken(bg, 0.82)
punched = punch_background(src, bg)
print("Background:", "#{:02X}{:02X}{:02X}".format(*bg))
print("Admin background:", "#{:02X}{:02X}{:02X}".format(*admin_bg))

jobs = [
    ("icon-192.png", 192, 0.80, bg, False),
    ("icon-512.png", 512, 0.80, bg, False),
    ("icon-maskable-512.png", 512, 0.60, bg, False),
    ("apple-touch-icon.png", 180, 0.80, bg, False),
    ("favicon-32.png", 32, 0.86, bg, False),
    ("admin-icon-192.png", 192, 0.80, admin_bg, True),
    ("admin-icon-512.png", 512, 0.80, admin_bg, True),
    ("admin-icon-maskable-512.png", 512, 0.60, admin_bg, True),
    ("admin-apple-touch-icon.png", 180, 0.80, admin_bg, True),
]

for name, size, ratio, color, badge in jobs:
    path = out_dir / name
    im = make_icon(src, size, ratio, color, badge=badge, punched=punched)
    im.save(path, "PNG", optimize=True)
    print("Wrote", path.name, im.size)
PY
