"""Build Chrome Web Store screenshots at 1280x800, 24-bit RGB, no alpha.

The captured UI is composited at its own pixels — scaled and cropped only.
Nothing regenerates or repaints it, so the listing shows the real extension.
The backdrop (store-backdrop.png) is the one generated asset, and it never
sits under the UI.

Usage:  python design/build-store-shots.py

Inputs are the raw captures in the project root, which .gitignore keeps out of
the repo because they can contain real profile data. The three used here are
from 2026-08-17 and hold test data only (Peter Griffin / John Doe). Re-taking
them means re-checking the crop_top values below: they trim the browser chrome
above the side panel and are measured per capture, not detected.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
import os

SRC = 'C:/Users/Schoo/EasyApply'
OUT = os.path.join(SRC, 'design', 'store')
BG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'store-backdrop.png')

W, H = 1280, 800

# The extension's own palette, so the frame and the UI agree.
BG_BASE = (26, 22, 18)      # --bg
AMBER = (212, 165, 116)     # --primary
TEXT = (245, 241, 237)      # --text
MUTED = (162, 151, 144)     # --text-muted
BORDER = (58, 53, 49)       # --border

F = 'C:/Windows/Fonts/'
font_eyebrow = ImageFont.truetype(F + 'consolab.ttf', 14)
font_h1 = ImageFont.truetype(F + 'seguisb.ttf', 40)
font_h1_wide = ImageFont.truetype(F + 'seguisb.ttf', 36)
font_sub = ImageFont.truetype(F + 'segoeui.ttf', 19)


def backdrop(path, w, h, dim=118, blur=7, vignette=150):
    """Cover-fit, darken and soften, then vignette. Atmosphere, not a subject."""
    im = Image.open(path).convert('RGB')
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    im = im.crop(((im.width - w) // 2, (im.height - h) // 2,
                  (im.width - w) // 2 + w, (im.height - h) // 2 + h))
    im = im.filter(ImageFilter.GaussianBlur(blur))
    im = ImageChops.multiply(im, Image.new('RGB', (w, h), (dim,) * 3))
    im = ImageChops.add(im, Image.new('RGB', (w, h), (14, 11, 9)))

    # Radial vignette so the centre stays the darkest, quietest area.
    vig = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(vig)
    d.ellipse((-w * 0.35, -h * 0.55, w * 1.35, h * 1.55), fill=vignette)
    vig = vig.filter(ImageFilter.GaussianBlur(round(min(w, h) * 0.22)))
    return Image.composite(im, Image.new('RGB', (w, h), BG_BASE), vig)


def rounded(im, r=13):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), r, fill=255)
    out = im.convert('RGBA')
    out.putalpha(mask)
    return out


def paste_card(canvas, shot, x, y, r=13):
    """Screenshot as a card: soft shadow, hairline border, rounded corners."""
    pad = 60
    sh = Image.new('RGBA', (shot.width + pad * 2, shot.height + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        (pad, pad + 12, pad + shot.width, pad + shot.height + 12), r + 4, fill=(0, 0, 0, 165))
    sh = sh.filter(ImageFilter.GaussianBlur(22))
    canvas.paste(sh, (x - pad, y - pad), sh)

    card = rounded(shot, r)
    canvas.paste(card, (x, y), card)

    edge = Image.new('RGBA', shot.size, (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        (0, 0, shot.width - 1, shot.height - 1), r, outline=BORDER + (190,), width=1)
    canvas.paste(edge, (x, y), edge)


def tracked(draw, xy, text, font, fill, track=2.4):
    """Letter-spaced small caps for the eyebrow — PIL has no tracking."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + track
    return x


def wrap(draw, text, font, max_w):
    lines, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if draw.textlength(trial, font=font) <= max_w:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def block_height(draw, headline, sub, h_font, max_w):
    return (22 + 34
            + len(wrap(draw, headline, h_font, max_w)) * (h_font.size + 12)
            + 10
            + len(wrap(draw, sub, font_sub, max_w)) * 29)


def block(draw, x, y, eyebrow, headline, sub, h_font, max_w):
    """Amber rule, eyebrow, headline, supporting copy. Returns the bottom y."""
    draw.rectangle((x, y, x + 34, y + 3), fill=AMBER)
    y += 22
    tracked(draw, (x, y), eyebrow.upper(), font_eyebrow, AMBER)
    y += 34
    for ln in wrap(draw, headline, h_font, max_w):
        draw.text((x, y), ln, font=h_font, fill=TEXT)
        y += h_font.size + 12
    y += 10
    for ln in wrap(draw, sub, font_sub, max_w):
        draw.text((x, y), ln, font=font_sub, fill=MUTED)
        y += 29
    return y


def load(name, crop_top=0):
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    return im.crop((0, crop_top, im.width, im.height)) if crop_top else im


def fit_h(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def fit_w(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


base = backdrop(BG, W, H)
os.makedirs(OUT, exist_ok=True)

def panel_shot(name, out, crop_top, eyebrow, headline, sub):
    """Tall side-panel capture on the right, copy centred against it."""
    c = base.copy()
    d = ImageDraw.Draw(c)
    shot = fit_h(load(name, crop_top=crop_top), 690)
    paste_card(c, shot, W - 96 - shot.width, (H - shot.height) // 2)
    max_w = W - 96 - shot.width - 150
    y = (H - block_height(d, headline, sub, font_h1, max_w)) // 2
    block(d, 92, y, eyebrow, headline, sub, font_h1, max_w)
    c.convert('RGB').save(os.path.join(OUT, out))


# --- 01  Wide: the panel filling a live Workday form ------------------------
c = base.copy()
d = ImageDraw.Draw(c)
bottom = block(d, 92, 52,
               'Autofill active page',
               'Your saved profile, straight into the form',
               'Name, address, education, work history, languages and the '
               'voluntary disclosures — in one click.',
               font_h1_wide, 1040)
# Trims a clipped label at the top and the window edge at the bottom, then
# takes whatever height is left under the copy. Scale and crop only.
src = load('Screenshot 2026-08-17 134555.png', crop_top=14)
src = src.crop((0, 0, src.width, src.height - 8))
shot = fit_h(src, H - bottom - 34 - 40)
paste_card(c, shot, (W - shot.width) // 2, bottom + 34)
c.convert('RGB').save(os.path.join(OUT, 'v13-01-in-action.png'))

# --- 02  Panel: the profile you fill in once --------------------------------
panel_shot('Screenshot 2026-08-17 134905.png', 'v13-02-profile.png', 118,
           'Profile settings',
           'Fill it in once. Reuse it everywhere.',
           'Skills, languages and voluntary self-identification are stored '
           'on your own machine and reused on every application.')

# --- 03  Panel: the new blank-field notice ----------------------------------
panel_shot('Screenshot 2026-08-17 135004.png', 'v13-03-blank-fields.png', 25,
           'New in 1.3',
           'It tells you what it left blank',
           'On a job page a skipped field looks exactly like a filled one. '
           'The panel names the ones it will pass over, so nothing goes '
           'missing quietly.')

# --- Small promo tile, 440x280 ----------------------------------------------
# A marketing tile, not a screenshot, so generated art is fair here — but the
# mark and the wording are still drawn locally. A model asked to render
# "Better Autofill" produces something that only looks like letters.
TW, TH = 440, 280
f_tile_eyebrow = ImageFont.truetype(F + 'consolab.ttf', 11)
f_tile_name = ImageFont.truetype(F + 'seguisb.ttf', 30)
f_tile_sub = ImageFont.truetype(F + 'segoeui.ttf', 13)

t = backdrop(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'tile-backdrop.png'), TW, TH, dim=146, blur=3, vignette=178)
d = ImageDraw.Draw(t)

# icons/icon128.png is the only source with a real alpha channel — design/
# Icon.png has a checkerboard painted into it and no transparency at all.
icon = Image.open(os.path.join(SRC, 'icons', 'icon128.png')).convert('RGBA')
ICON = 112
icon = icon.resize((ICON, ICON), Image.LANCZOS)
ix, iy = 34, (TH - ICON) // 2

# A warm bloom behind the mark so the blue tile separates from the warm ground.
glow = Image.new('RGBA', (TW, TH), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((ix - 34, iy - 34, ix + ICON + 34, iy + ICON + 34),
                             fill=AMBER + (46,))
t = Image.alpha_composite(t.convert('RGBA'), glow.filter(ImageFilter.GaussianBlur(28)))
d = ImageDraw.Draw(t)
t.paste(icon, (ix, iy), icon)

tx = ix + ICON + 30
ty = 99  # optical centre against the mark, not the arithmetic one
tracked(d, (tx, ty), 'WORKDAY', f_tile_eyebrow, AMBER, track=3.2)
d.text((tx, ty + 22), 'Better Autofill', font=f_tile_name, fill=TEXT)
d.text((tx, ty + 62), 'Your profile, filled in one click.', font=f_tile_sub, fill=MUTED)

t.convert('RGB').save(os.path.join(OUT, 'v13-promo-tile-440x280.png'))

for f in sorted(os.listdir(OUT)):
    if f.startswith('v13'):
        im = Image.open(os.path.join(OUT, f))
        kb = os.path.getsize(os.path.join(OUT, f)) / 1024
        print(f'{f:28s} {im.size[0]}x{im.size[1]}  {im.mode}  '
              f'alpha={"YES" if im.mode in ("RGBA", "LA") or "transparency" in im.info else "no"}  '
              f'{kb:.0f} KB')
