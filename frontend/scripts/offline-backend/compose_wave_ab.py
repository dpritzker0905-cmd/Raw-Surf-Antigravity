"""Compose the wave palette A/B (scn_wave_palette_ab.js output) into side-by-side sheets and a side-by-side moving clip.

Usage:  python compose_wave_ab.py <scn output dir>      (needs Pillow; the backend venv has it)
Writes, into the same dir:
  sheet-<theme>.jpg    rows = world / regional / coastal, columns = each variant run (v1 | v2), each with its legend crop beneath
  clip-<theme>.webp    the moving clip, the variants side by side, frame for frame (the same forecast hours in each pane)
"""
import glob
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

NAMES = {"v1": "v1 (the V2 kill)", "v2": "v2 (default)", "A": "A", "B": "B"}


def font(size):
    for f in ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def label(img, text, size=22):
    d = ImageDraw.Draw(img)
    f = font(size)
    w = d.textlength(text, font=f)
    d.rectangle([0, 0, w + 16, size + 12], fill=(0, 0, 0))
    d.text((8, 4), text, fill=(255, 255, 255), font=f)
    return img


def main(out):
    rec = json.load(open(os.path.join(out, "record.json"), encoding="utf-8"))
    variants = [v for v in ("v1", "v2", "A", "B") if any(s["variant"] == v for s in rec["shots"])]
    for theme in ("light", "beach"):
        shots = [s for s in rec["shots"] if s["theme"] == theme]
        if not shots:
            continue
        views = [v for v in ("world", "regional", "coastal") if any(s["view"] == v for s in shots)]
        scale = 0.5
        cell_w, cell_h, leg_h = int(1280 * scale), int(800 * scale), 70
        sheet = Image.new("RGB", (cell_w * len(variants), (cell_h + leg_h) * len(views) + 40), (30, 30, 30))
        ImageDraw.Draw(sheet).text((10, 8), f"{theme.upper()}  wave-height wash, offline synthetic store (storm eye > 10 m)  columns: " + "  |  ".join(NAMES[v] for v in variants), fill=(255, 255, 255), font=font(20))
        for r, view in enumerate(views):
            for c, v in enumerate(variants):
                s = next((x for x in shots if x["view"] == view and x["variant"] == v), None)
                if not s:
                    continue
                im = Image.open(os.path.join(out, s["file"])).convert("RGB").resize((cell_w, cell_h), Image.LANCZOS)
                label(im, f"{NAMES[v]}  |  {view}")
                y = 40 + r * (cell_h + leg_h)
                sheet.paste(im, (c * cell_w, y))
                if s.get("legend"):
                    lg = Image.open(os.path.join(out, s["legend"])).convert("RGB")
                    k = min((cell_w - 20) / lg.width, (leg_h - 6) / lg.height)
                    lg = lg.resize((max(1, int(lg.width * k)), max(1, int(lg.height * k))), Image.LANCZOS)
                    sheet.paste(lg, (c * cell_w + 10, y + cell_h + 3))
        sheet.save(os.path.join(out, f"sheet-{theme}.jpg"), quality=88)
        # The clip: frame k of each variant side by side.
        per = {v: sorted(glob.glob(os.path.join(out, f"clip-{theme}-{v}-*.png"))) for v in variants}
        n = min((len(f) for f in per.values()), default=0)
        if n:
            frames = []
            for k in range(n):
                ims = [label(Image.open(per[v][k]).convert("RGB"), NAMES[v], 18) for v in variants]
                w, h = ims[0].size
                f = Image.new("RGB", (w * len(ims), h))
                for i, im in enumerate(ims):
                    f.paste(im, (i * w, 0))
                frames.append(f.resize((int(f.width * 0.75), int(f.height * 0.75)), Image.LANCZOS))
            frames[0].save(os.path.join(out, f"clip-{theme}.webp"), save_all=True, append_images=frames[1:], duration=160, loop=0, quality=80)
        print(theme, "sheet + clip frames:", n)


if __name__ == "__main__":
    main(sys.argv[1])
