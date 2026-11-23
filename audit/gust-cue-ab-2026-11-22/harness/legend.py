"""Crop the Gusts legend (with the cue key) from each desktop arm's UI screenshot into one strip."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
AB, OUT = Path(sys.argv[1]), Path(sys.argv[2])
F = ImageFont.truetype('arial.ttf', 14)
cells = []
for theme in ['dark', 'light', 'beach']:
    for cue in ['flicker', 'width', 'hatch', 'none']:
        im = Image.open(AB / f'desktop-{theme}-{cue}' / 'ui.png').convert('RGB').crop((1225, 450, 1432, 535)).resize((414, 170), Image.LANCZOS)
        c = Image.new('RGB', (414, 192), (255, 255, 255)); c.paste(im, (0, 22)); ImageDraw.Draw(c).text((4, 3), f'{theme} / {cue}', fill=0, font=F)
        cells.append(c)
W, H = 4 * 418, 3 * 196
sheet = Image.new('RGB', (W, H), (255, 255, 255))
for i, c in enumerate(cells):
    sheet.paste(c, ((i % 4) * 418, (i // 4) * 196))
sheet.save(OUT / 'legend-keys-desktop.jpg', quality=88)
print(sheet.size)
