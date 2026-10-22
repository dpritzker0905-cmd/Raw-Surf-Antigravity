"""Compose the wave palette A/B (scn_wave_palette_ab.js output) into side-by-side sheets and a side-by-side moving clip.

Usage:  python compose_wave_ab.py <scn output dir> [--variants l1,v2,lk] [--tag crest-<view>] [--clip-view coastal] [--title text]
        (needs Pillow; the backend venv has it)
Writes, into the same dir:
  sheet-<theme>[-tag].jpg    rows = world / regional / coastal, columns = the variants (default v1 | v2), each with its legend crop
  clip-<theme>[-tag].webp    the moving clip, the variants side by side, frame for frame (the same forecast hours in each pane);
                             --clip-view picks a non-regional clip (frames clip-<theme>-<variant>@<view>-NNN)
"""
import glob
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

NAMES = {"v1": "v1 (the V2 kill)", "v2": "v2 (default)", "A": "A", "B": "B",
         "v2@10": "v2 at 10 m (the 16 m kill = #411)", "v2@10b": "v2 at 10 m again (null control)", "v2b": "v2 at 16 m again (null control)"}
ORDER = ("v1", "v2@10", "v2", "v2@10b", "v2b", "A", "B")
CREST_NAMES = {"v2": "V2 polarity (default)", "l1": "TODAY's crests", "lk": "V2 + self-contrast everywhere (cased probe)",
               "l1k": "TODAY + self-contrast everywhere"}
DENSITY_NAMES = {"dk": "TODAY's crest density", "v2": "big-surf cut, as the eye sees it (default)"}   # --tag density-...


def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def font(size):
    for f in ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


# The dark storm crest A/B (--tag dark-<view>, --variants d1,v2, --clip-view regional|eye|coastal).
DARK_NAMES = {"d1": "TODAY (fiery orange)", "v2": "cased orange from 8 m (D-039)"}


def label(img, text, size=22):
    d = ImageDraw.Draw(img)
    f = font(size)
    w = d.textlength(text, font=f)
    d.rectangle([0, 0, w + 16, size + 12], fill=(0, 0, 0))
    d.text((8, 4), text, fill=(255, 255, 255), font=f)
    return img


def main(out):
    rec = json.load(open(os.path.join(out, "record.json"), encoding="utf-8"))
    order = opt("--variants").split(",") if opt("--variants") else ORDER
    variants = [v for v in order if any(s["variant"] == v for s in rec["shots"])]
    tag = ("-" + opt("--tag")) if opt("--tag") else ""
    names = CREST_NAMES if opt("--tag", "").startswith("crest") else DENSITY_NAMES if opt("--tag", "").startswith("density") else NAMES
    clip_view = opt("--clip-view", "regional")
    title = opt("--title", "wave-height wash, offline synthetic store (storm eye > 10 m)")
    for theme in ("light", "beach", "dark"):
        shots = [s for s in rec["shots"] if s["theme"] == theme and s.get("file")]
        if not shots:
            continue
        views = [v for v in ("world", "regional", "eye", "mid", "coastal", "close", "closer") if any(s["view"] == v for s in shots)]
        names = DARK_NAMES if theme == "dark" and opt("--tag", "").startswith("dark") else names
        scale = 0.5
        cell_w, cell_h, leg_h = int(1280 * scale), int(800 * scale), 70
        sheet = Image.new("RGB", (cell_w * len(variants), (cell_h + leg_h) * len(views) + 40), (30, 30, 30))
        ImageDraw.Draw(sheet).text((10, 8), f"{theme.upper()}  {title}  columns: " + "  |  ".join(names[v] for v in variants if any(s["variant"] == v for s in shots)), fill=(255, 255, 255), font=font(20))
        for r, view in enumerate(views):
            for c, v in enumerate(variants):
                s = next((x for x in shots if x["view"] == view and x["variant"] == v), None)
                if not s:
                    continue
                im = Image.open(os.path.join(out, s["file"])).convert("RGB").resize((cell_w, cell_h), Image.LANCZOS)
                label(im, f"{names[v]}  |  {view}")
                y = 40 + r * (cell_h + leg_h)
                sheet.paste(im, (c * cell_w, y))
                if s.get("legend"):
                    lg = Image.open(os.path.join(out, s["legend"])).convert("RGB")
                    k = min((cell_w - 20) / lg.width, (leg_h - 6) / lg.height)
                    lg = lg.resize((max(1, int(lg.width * k)), max(1, int(lg.height * k))), Image.LANCZOS)
                    sheet.paste(lg, (c * cell_w + 10, y + cell_h + 3))
        sheet.save(os.path.join(out, f"sheet-{theme}{tag}.jpg"), quality=88)
        # The clip: frame k of each variant side by side.
        at = "" if clip_view == "regional" else "@" + clip_view
        per = {v: sorted(glob.glob(os.path.join(out, f"clip-{theme}-{v}{at}-*.png"))) for v in variants}
        n = min((len(f) for f in per.values()), default=0)
        if n:
            frames = []
            for k in range(n):
                ims = [label(Image.open(per[v][k]).convert("RGB"), names[v], 18) for v in variants]
                w, h = ims[0].size
                f = Image.new("RGB", (w * len(ims), h))
                for i, im in enumerate(ims):
                    f.paste(im, (i * w, 0))
                frames.append(f.resize((int(f.width * 0.75), int(f.height * 0.75)), Image.LANCZOS))
            frames[0].save(os.path.join(out, f"clip-{theme}{tag}{at}.webp"), save_all=True, append_images=frames[1:], duration=160, loop=0, quality=80)
        print(theme, "sheet + clip frames:", n)


if __name__ == "__main__":
    main(sys.argv[1])
