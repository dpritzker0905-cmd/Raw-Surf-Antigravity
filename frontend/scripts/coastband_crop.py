"""Magnified coastline crops from the coastband ladder frames.

The band question is ultimately optical: does the marine field stop short of the shoreline, and by
how much. The numbers come from coastband-analyze.js; this makes the same pixels reviewable by eye
at a magnification where a 2 px band is unmissable.

Crop centres are NOT hand-placed. Each is the measured land->water transition (coastIdx from the
analysis) projected with an independent Web Mercator implementation — so if the crop lands on the
shoreline, the harness's projection and this one agree, and if it does not, that disagreement is
itself a finding rather than a bad screenshot.

  python3 coastband_crop.py <outdir> <label>
"""
import sys, os, json, math
from PIL import Image, ImageDraw

outdir = sys.argv[1]
label = sys.argv[2] if len(sys.argv) > 2 else 'stock'
W, H, DPR = 1280, 800, 2
SCALE, HALF_W, HALF_H = 5, 40, 26          # crop half-size in DEVICE px before magnification
DIFF_T = 16

an = json.load(open(os.path.join(outdir, 'coastband-analysis.json')))
raw = json.load(open(os.path.join(outdir, 'coastband-raw.json')))
center = raw['center']
tmeta = {t['id']: t for t in raw['transects']}


def merc(lng, lat, z):
    world = 512 * (2 ** z)
    x = (lng + 180.0) / 360.0 * world
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * world
    return x, y


def to_device(lng, lat, z):
    x, y = merc(lng, lat, z)
    cx, cy = merc(center[0], center[1], z)
    return ((x - cx) + W / 2.0) * DPR, ((y - cy) + H / 2.0) * DPR


def on_frame(stop):
    p = os.path.join(outdir, f'ON_{stop}.png')
    return p if os.path.exists(p) else None


made, skipped = [], []
for r in an['rows']:
    if 'coastIdx' not in r or r.get('verdict') != 'OK':
        continue
    fon = on_frame(r['stop'])
    foff = os.path.join(outdir, f"OFF_z{r['targetZ']:.2f}.png")
    if not fon or not os.path.exists(foff):
        skipped.append((r['stop'], r['transect'], 'missing frame'))
        continue
    m = tmeta[r['transect']]
    f = r['coastIdx'] / float(r['nSamples'] - 1)
    lng = m['from'][0] + (m['to'][0] - m['from'][0]) * f
    lat = m['from'][1] + (m['to'][1] - m['from'][1]) * f
    cx, cy = to_device(lng, lat, r['z'])
    box = (int(cx) - HALF_W, int(cy) - HALF_H, int(cx) + HALF_W, int(cy) + HALF_H)
    img_on, img_off = Image.open(fon).convert('RGB'), Image.open(foff).convert('RGB')
    if box[0] < 0 or box[1] < 0 or box[2] > img_on.width or box[3] > img_on.height:
        skipped.append((r['stop'], r['transect'], f'coast off-frame at {box}'))
        continue
    a = img_on.crop(box).resize((HALF_W * 2 * SCALE, HALF_H * 2 * SCALE), Image.NEAREST)
    b = img_off.crop(box).resize((HALF_W * 2 * SCALE, HALF_H * 2 * SCALE), Image.NEAREST)
    w, h = a.size
    d = Image.new('RGB', (w, h))
    pa, pb, pd = a.load(), b.load(), d.load()
    for y in range(h):
        for x in range(w):
            r1, g1, b1 = pa[x, y]
            r2, g2, b2 = pb[x, y]
            pd[x, y] = (0, 230, 90) if max(abs(r1 - r2), abs(g1 - g2), abs(b1 - b2)) > DIFF_T else (0, 0, 0)
    sheet = Image.new('RGB', (w, h * 3 + 76), (18, 18, 22))
    sheet.paste(a, (0, 22)); sheet.paste(b, (0, h + 44)); sheet.paste(d, (0, h * 2 + 66))
    dr = ImageDraw.Draw(sheet)
    dr.text((6, 5), f"{label} | {r['stop']} {r['transect']} ({r['coast']}) z={r['z']} "
                    f"band={r['bands']['T16']['band_px']}px={r['bands']['T16']['band_km']}km  "
                    f"[{r['kmPerDevPx']:.3f} km/px]", fill=(240, 240, 245))
    dr.text((6, h + 28), 'Waves OFF (basemap reference)', fill=(190, 190, 200))
    dr.text((6, h * 2 + 50), 'green = marine field painted here', fill=(190, 190, 200))
    # a vertical rule at the crop centre = the measured shoreline
    dr.line([(w // 2, 22), (w // 2, h * 3 + 66)], fill=(255, 80, 80), width=1)
    out = os.path.join(outdir, f"CROP_{label}_{r['transect']}_{r['stop']}.png")
    sheet.save(out)
    made.append(out)

for s in skipped:
    print('skip', s)
print(f'{len(made)} crops written to {outdir}')
