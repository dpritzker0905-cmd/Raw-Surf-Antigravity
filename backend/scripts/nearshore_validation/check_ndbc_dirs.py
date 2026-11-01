"""Direction control for NDBC 41009: the mean direction rebuilt from our moments vs NDBC's own MWD (stdmet), per block.
Run with the spectra venv after fetch_spectra.py. Prints the median |difference| for history years and realtime."""
import gzip
from datetime import datetime, timezone

import numpy as np

from config import CACHE

d = np.load(CACHE / '41009.npz')
e = np.nan_to_num(d['energy'])
a = (e * np.nan_to_num(d['a1'])).sum(1)
b = (e * np.nan_to_num(d['b1'])).sum(1)
dm = np.degrees(np.arctan2(b, a)) % 360
ip = np.argmax(e, 1)
rr = np.arange(len(ip))
dp = np.degrees(np.arctan2(d['b1'][rr, ip], d['a1'][rr, ip])) % 360


def stdmet(text):
    out = {}
    for line in text.splitlines():
        if line.startswith('#'):
            continue
        p = line.split()
        if len(p) < 12:
            continue
        try:
            t = datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]), tzinfo=timezone.utc).timestamp()
            mwd = float(p[11])
        except ValueError:
            continue
        if mwd < 361:
            out[t] = mwd
    return out


ref = stdmet(gzip.decompress((CACHE / 'h2025_41009_stdmet.txt.gz').read_bytes()).decode('ascii', 'replace'))
ref.update(stdmet((CACHE / 'rt_41009.txt').read_text(encoding='ascii', errors='replace')))
for label, lo, hi in (('2025 history', 2025, 2025), ('2026 realtime', 2026, 2026)):
    rows = []
    for i, t in enumerate(d['time']):
        y = datetime.fromtimestamp(t, timezone.utc).year
        if lo <= y <= hi and t in ref:
            rows.append((dm[i], dp[i], ref[t]))
    if not rows:
        print(label, 'no overlap')
        continue
    r = np.array(rows)
    diff_m = np.abs((r[:, 0] - r[:, 2] + 180) % 360 - 180)
    diff_p = np.abs((r[:, 1] - r[:, 2] + 180) % 360 - 180)
    signed = np.median(((r[:, 0] - r[:, 2] + 180) % 360) - 180)
    print(f'{label}: n {len(r)}  median |rebuilt mean - MWD| {np.median(diff_m):.1f} deg (signed {signed:+.1f})'
          f'  |rebuilt peak - MWD| {np.median(diff_p):.1f}  rebuilt mean p50 {np.median(r[:, 0]):.0f}  MWD p50 {np.median(r[:, 2]):.0f}')
