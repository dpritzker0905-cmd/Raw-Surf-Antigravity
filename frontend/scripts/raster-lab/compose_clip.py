"""Side-by-side moving clip from clip_own_vs_om.js captures (2026-10-23, the owner's A/B of the pressure layer).

    python compose_clip.py <capture dir> --theme dark [--fps 10] [--scale 0.5] [--out clip-dark.webp]

Both arms on ONE clock: t = 0 is each arm's first key press (the scripted scrub is the same in both), and each output frame
shows the newest screencast frame of each arm at that instant, so a slow arm visibly lags. A header names the arm and shows
the elapsed time and how many keys have been pressed. Pillow (the backend venv): an animated WebP and a still of the last frame.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

LABELS = {'om': 'Today: Open-Meteo .om files', 'own': 'New: our own frames (free NOAA GFS)'}
SOURCE = {'GFS': 'NOAA GFS', 'EURO': 'ECMWF', 'ICON': 'DWD ICON'}


def label(meta):
    m = meta.get('model')
    if not m:
        return LABELS[meta['arm']]
    return f"{m} via Open-Meteo (today)" if meta['arm'] == 'om' else f"{m}: our frames ({SOURCE.get(m, m)}), isobars on"


def font(size):
    for f in ('arial.ttf', 'segoeui.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def load(cap, arm, theme):
    d = os.path.join(cap, f'{arm}-{theme}')    # arm = 'om', 'own', or 'own-EURO' style (arm-model)
    meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf8'))
    return d, meta


def frame_at(d, meta, t_ms):
    t_abs = meta['keys'][0] + t_ms
    best = meta['frames'][0]
    for f in meta['frames']:
        if f['t'] <= t_abs:
            best = f
        else:
            break
    return Image.open(os.path.join(d, 'frames', best['file'])).convert('RGB')


def main():
    args = sys.argv[1:]
    cap = args[0]
    opt = lambda k, d: args[args.index(k) + 1] if k in args else d
    theme = opt('--theme', 'dark'); fps = float(opt('--fps', '10'))
    names = opt('--arms', 'om,own').split(',')
    scale = float(opt('--scale', '0.5' if len(names) <= 2 else '0.42'))
    out = opt('--out', os.path.join(cap, f'clip-{"-".join(names)}-{theme}.webp' if names != ['om', 'own'] else f'clip-{theme}.webp'))
    arms = [load(cap, a, theme) for a in names]
    span = max(m['keys'][-1] - m['keys'][0] for _, m in arms) + max(m['frames'][-1]['t'] - m['keys'][-1] for _, m in arms)
    span = min(span, (arms[0][1]['keys'][-1] - arms[0][1]['keys'][0]) + 4000)
    w0, h0 = frame_at(*arms[0], 0).size
    w, h = int(w0 * scale), int(h0 * scale)
    head = 54
    f_big, f_small = font(20), font(16)
    dark = theme != 'light'
    bg, fg = ((17, 24, 39), (241, 245, 249)) if dark else ((248, 250, 252), (15, 23, 42))
    frames = []
    t = -500.0
    while t <= span:
        canvas = Image.new('RGB', (len(arms) * w + 12 * (len(arms) - 1), h + head), bg)
        dr = ImageDraw.Draw(canvas)
        for i, (d, meta) in enumerate(arms):
            x = i * (w + 12)
            canvas.paste(frame_at(d, meta, t).resize((w, h), Image.LANCZOS), (x, head))
            pressed = sum(1 for k in meta['keys'] if k - meta['keys'][0] <= t)
            dr.text((x + 8, 6), label(meta), fill=fg, font=f_big)
            dr.text((x + 8, 30), f't = {max(t, 0) / 1000:4.1f} s   keys pressed {pressed}/{len(meta["keys"])} (+1 h each)   {theme}', fill=fg, font=f_small)
        frames.append(canvas)
        t += 1000.0 / fps
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0, quality=80, method=4)
    frames[-1].save(out.replace('.webp', '-last.png'))
    print(f'{out}: {len(frames)} frames, {frames[0].size[0]} x {frames[0].size[1]}, {os.path.getsize(out) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
