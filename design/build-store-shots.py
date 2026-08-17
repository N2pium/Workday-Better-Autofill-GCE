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


def backdrop():
    """Cover-fit, darken and soften, then vignette. Atmosphere, not a subject."""
    im = Image.open(BG).convert('RGB')
    s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    im = im.crop(((im.width - W) // 2, (im.height - H) // 2,
                  (im.width - W) // 2 + W, (im.height - H) // 2 + H))
    im = im.filter(ImageFilter.GaussianBlur(7))
    im = ImageChops.multiply(im, Image.new('RGB', (W, H), (118, 118, 118)))
    im = ImageChops.add(im, Image.new('RGB', (W, H), (14, 11, 9)))

    # Radial vignette so the centre stays the darkest, quietest area.
    vig = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(vig)
    d.ellipse((-W * 0.35, -H * 0.55, W * 1.35, H * 1.55), fill=150)
    vig = vig.filter(ImageFilter.GaussianBlur(180))
    return Image.composite(im, Image.new('RGB', (W, H), BG_BASE), vig)


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


base = backdrop()
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

for f in sorted(os.listdir(OUT)):
    if f.startswith('v13'):
        im = Image.open(os.path.join(OUT, f))
        kb = os.path.getsize(os.path.join(OUT, f)) / 1024
        print(f'{f:28s} {im.size[0]}x{im.size[1]}  {im.mode}  '
              f'alpha={"YES" if im.mode in ("RGBA", "LA") or "transparency" in im.info else "no"}  '
              f'{kb:.0f} KB')
