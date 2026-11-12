"""Side-by-side moving clips from scn_crest_clips.js runs (2026-11-12, one-way crests).

For each <theme>-<view> with two arm directories under <out>, crop the same centred window from every frame of each arm,
resample both to FPS on one clock, label the panes, and write <out>/clips/<theme>-<view>.webp (animated, looping).
It measures nothing: the clips are for the owner's eye (the motion numbers are in marineMotionDirection.test.js).

Usage: python crest_clips.py <out dir> [--left sway --right oneway] [--fps 20] [--crop 560x380] [--scale 1.0]
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def load(run_dir):
    meta = json.loads((run_dir / "frames.json").read_text())
    frames = sorted(meta.get("frames") or [], key=lambda f: f["ts"])
    return meta, frames


def pick(frames, t):
    """The last frame at or before clock t (the compositor only emits a frame when something changed)."""
    best = frames[0]
    for f in frames:
        if f["ts"] <= t:
            best = f
        else:
            break
    return best


def crop_centre(im, cw, ch, dy=0.0):
    w, h = im.size
    cw, ch = min(cw, w), min(ch, h)
    left = (w - cw) // 2
    top = max(0, min(h - ch, int((h - ch) / 2 + dy * h)))
    return im.crop((left, top, left + cw, top + ch))


def main():
    root = Path(sys.argv[1])
    left, right = arg("--left", "sway"), arg("--right", "oneway")
    fps = int(arg("--fps", "20"))
    cw, ch = (int(x) for x in arg("--crop", "560x380").split("x"))
    out = root / "clips"
    out.mkdir(exist_ok=True)
    labels = {left: arg("--left-label", "BEFORE: orbital sway (kill switch)"), right: arg("--right-label", "AFTER: one-way crests (default)")}
    for ldir in sorted(root.glob(left + "-*")):
        key = ldir.name[len(left) + 1:]
        rdir = root / (right + "-" + key)
        if not rdir.exists():
            continue
        (lm, lf), (rm, rf) = load(ldir), load(rdir)
        if not lf or not rf:
            print(key, "no frames", lm.get("error"), rm.get("error"))
            continue
        dur = min(lf[-1]["ts"] - lf[0]["ts"], rf[-1]["ts"] - rf[0]["ts"])
        n = max(1, int(dur / 1000 * fps))
        # the phone view's sheet covers the lower half: crop a little above centre there
        dy = -0.12 if key.endswith("phone") else 0.0
        frames = []
        for i in range(n):
            t = i * 1000 / fps
            panes = []
            for d, fr, name in ((ldir, lf, left), (rdir, rf, right)):
                im = Image.open(d / pick(fr, fr[0]["ts"] + t)["file"]).convert("RGB")
                pane = crop_centre(im, cw, ch, dy)
                draw = ImageDraw.Draw(pane)
                draw.rectangle((0, 0, pane.size[0], 18), fill=(0, 0, 0))
                draw.text((6, 4), labels[name], fill=(255, 255, 255))
                panes.append(pane)
            w = sum(p.size[0] for p in panes) + 4
            h = max(p.size[1] for p in panes)
            canvas = Image.new("RGB", (w, h), (255, 255, 255))
            x = 0
            for p in panes:
                canvas.paste(p, (x, 0))
                x += p.size[0] + 4
            frames.append(canvas)
        dest = out / (key + ".webp")
        frames[0].save(dest, save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0, quality=80, method=4)
        print(key, "frames", n, "left", len(lf), "right", len(rf), "anim", lm.get("anim"), rm.get("anim"), "->", dest.name,
              round(dest.stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
