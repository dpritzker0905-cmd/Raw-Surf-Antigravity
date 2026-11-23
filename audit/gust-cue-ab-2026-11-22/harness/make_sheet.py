"""Evidence sheets + clips for the gust cue A/B.
For each view: one PNG sheet, a block per theme; rows = cues (none, flicker, width, hatch), columns = the four G/W bands,
cells = the LUMINANCE crop (what a viewer reads with colour removed) at one frame, plus each arm's full-colour screenshot
thumbnail. For each view x theme: an animated GIF (4 cues x 4 bands, luminance) so the flicker can be seen moving.
Usage: python make_sheet.py <ab dir> <out dir> <metrics json>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

AB, OUT, MET = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
CUES = ['none', 'flicker', 'width', 'hatch']
CUE_NAME = {'none': 'D none (colour only)', 'flicker': 'A flicker (today)', 'width': 'B width', 'hatch': 'C hatch'}
THEMES = ['dark', 'light', 'beach']
FACT = ['G/W 1.0', 'G/W 1.4', 'G/W 1.7', 'G/W 2.3']
try:
    FONT = ImageFont.truetype('arial.ttf', 15); FONT_B = ImageFont.truetype('arialbd.ttf', 17)
except OSError:
    FONT = FONT_B = ImageFont.load_default()
met = json.loads(MET.read_text(encoding='utf-8'))
DET = {'flicker': '0.9 Hz', 'width': 'level', 'hatch': 'hatch'}


def load(view, theme, cue):
    d = AB / f'{view}-{theme}-{cue}'
    m = json.loads((d / 'meta.json').read_text(encoding='utf-8'))
    cw, ch = m['crops']['CW'], m['crops']['CH']
    raw = np.frombuffer((d / 'frames.y8').read_bytes(), dtype=np.uint8)
    t = len(raw) // (4 * cw * ch)
    return m, raw[: t * 4 * cw * ch].reshape(t, 4, ch, cw), d


def ygamma(a):
    """relative luminance (linear, 0..255) back to an sRGB-looking grey for display."""
    x = a.astype(np.float32) / 255.0
    s = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.clip(s * 255, 0, 255).astype(np.uint8)


def label_for(view, theme, cue):
    if cue == 'none':
        return 'control'
    r = [x for x in met['table'] if x['view'] == view and x['theme'] == theme and x['cue'] == cue]
    if not r:
        return ''
    r = r[0]; pr = r['paired_ratio_by_band']
    return f"{DET[cue]} vs none: x{pr[2]:.2f} at 1.7, x{pr[3]:.2f} at 2.3, x{pr[0]:.2f} steady"


for view in ['desktop', 'phone']:
    blocks = []
    for theme in THEMES:
        try:
            arms = {c: load(view, theme, c) for c in CUES}
        except FileNotFoundError:
            continue
        m0, a0, _ = arms['none']
        ch, cw = a0.shape[2], a0.shape[3]
        scale = 1 if view == 'desktop' else 0.6
        cwS, chS = int(cw * scale), int(ch * scale)
        thumb_w = 300
        left = 190
        cell_h = chS + 26
        W = left + 4 * (cwS + 8) + thumb_w + 20
        H = 36 + 26 + len(CUES) * (cell_h + 8)
        img = Image.new('RGB', (W, H), (245, 245, 245))
        dr = ImageDraw.Draw(img)
        dr.text((10, 8), f'{view.upper()}  ·  {theme} theme  ·  luminance only (colour removed)  ·  full colour at right', fill=(0, 0, 0), font=FONT_B)
        for i, f in enumerate(FACT):
            dr.text((left + i * (cwS + 8) + 4, 38), f + (' (steady)' if i == 0 else ' (gusty)' if i >= 2 else ''), fill=(0, 0, 0), font=FONT)
        for r, cue in enumerate(CUES):
            m, a, d = arms[cue]
            y = 62 + r * (cell_h + 8)
            dr.text((10, y + 4), CUE_NAME[cue], fill=(0, 0, 0), font=FONT_B)
            for li, part in enumerate(label_for(view, theme, cue).split(', ')):
                dr.text((10, y + 26 + 18 * li), part, fill=(60, 60, 60), font=FONT)
            fr = a[a.shape[0] // 2]
            for b in range(4):
                tile = Image.fromarray(ygamma(fr[b]), 'L').convert('RGB')
                if scale != 1:
                    tile = tile.resize((cwS, chS), Image.NEAREST)
                img.paste(tile, (left + b * (cwS + 8), y))
            shot = Image.open(d / 'shot.png').convert('RGB')
            shot.thumbnail((thumb_w, chS))
            img.paste(shot, (left + 4 * (cwS + 8) + 10, y))
        blocks.append(img)
        # clip: 4 cues x 4 bands, luminance, every 2nd frame
        frames = []
        n = min(arms[c][1].shape[0] for c in CUES)
        gs = 0.4 if view == 'desktop' else 0.35
        tw, th = int(cw * gs), int(ch * gs)
        for k in range(0, min(n, 120), 2):
            g = Image.new('L', (110 + 4 * (tw + 4), 24 + 4 * (th + 4)), 235)
            gd = ImageDraw.Draw(g)
            for i, f in enumerate(FACT):
                gd.text((110 + i * (tw + 4), 4), f, fill=0, font=FONT)
            for r, cue in enumerate(CUES):
                gd.text((4, 24 + r * (th + 4) + 4), CUE_NAME[cue].split(' (')[0], fill=0, font=FONT)
                for b in range(4):
                    t = Image.fromarray(ygamma(arms[cue][1][k, b]), 'L').resize((tw, th), Image.BILINEAR)
                    g.paste(t, (110 + b * (tw + 4), 24 + r * (th + 4)))
            frames.append(g)
        dt = float(np.median(np.diff(m0['times']))) * 2 if len(m0['times']) > 2 else 66
        frames[0].save(OUT / f'clip-{view}-{theme}.gif', save_all=True, append_images=frames[1:], duration=int(dt), loop=0, optimize=True)
    if blocks:
        Wt = max(b.width for b in blocks); Ht = sum(b.height for b in blocks) + 10 * len(blocks)
        sheet = Image.new('RGB', (Wt, Ht), (255, 255, 255)); y = 0
        for b in blocks:
            sheet.paste(b, (0, y)); y += b.height + 10
        sheet.save(OUT / f'sheet-{view}.jpg', quality=82, optimize=True)
        print('sheet', view, sheet.size)
