"""APCA contrast of drawn lines against what is under them (2026-10-24, isobar legibility per theme).

    python apca_lines.py WITH.png WITHOUT.png [--box x0,y0,x1,y1] [--min-diff 40]

WITH and WITHOUT are screenshots of the same instant with and without the lines (e.g. ISO_OFF=1). A pixel is a LINE pixel where
the two differ by more than --min-diff (sum of |dR|+|dG|+|dB|, keeping the anti-aliased fringe out); for each, APCA Lc of the
drawn colour (WITH) against the field under it (WITHOUT). Reports |Lc| percentiles over line pixels. APCA 0.0.98G-4g constants.
numpy + Pillow (the backend venv).
"""
import sys

import numpy as np
from PIL import Image


def _y(rgb):
    c = (rgb / 255.0) ** 2.4
    y = 0.2126729 * c[..., 0] + 0.7151522 * c[..., 1] + 0.0721750 * c[..., 2]
    return np.where(y < 0.022, y + np.clip(0.022 - y, 0, None) ** 1.414, y)


def apca(txt, bg):
    yt, yb = _y(txt), _y(bg)
    normal = yb > yt
    s = np.where(normal, (yb ** 0.56 - yt ** 0.57) * 1.14, (yb ** 0.65 - yt ** 0.62) * 1.14)
    s = np.where(np.abs(s) < 0.1, 0.0, np.where(normal, s - 0.027, s + 0.027))
    return s * 100.0


def main():
    args = sys.argv[1:]
    opt = lambda k, d: args[args.index(k) + 1] if k in args else d
    box = tuple(int(v) for v in opt('--box', '200,180,1030,800').split(','))
    min_diff = int(opt('--min-diff', '40'))
    x0, y0, x1, y1 = box
    a = np.asarray(Image.open(args[0]).convert('RGB'), dtype=np.float64)[y0:y1, x0:x1]
    b = np.asarray(Image.open(args[1]).convert('RGB'), dtype=np.float64)[y0:y1, x0:x1]
    line = np.abs(a - b).sum(-1) > min_diff
    if not line.any():
        print({'line_pixels': 0}); return
    lc = np.abs(apca(a[line], b[line]))
    q = np.percentile(lc, [10, 25, 50, 75, 90])
    print({'line_pixels': int(line.sum()), 'absLc_p10': round(q[0], 1), 'p25': round(q[1], 1), 'median': round(q[2], 1),
           'p75': round(q[3], 1), 'p90': round(q[4], 1)})


if __name__ == '__main__':
    main()
