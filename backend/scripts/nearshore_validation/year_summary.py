"""Per-year sanity summary of the partitioned records (mean direction, wind-sea detection rate)."""
from datetime import datetime, timezone

import numpy as np

from config import OUT, STATIONS

for sid in STATIONS:
    p = np.load(OUT / f'{sid}_parts.npz')
    yr = np.array([datetime.fromtimestamp(t, timezone.utc).year for t in p['time']])
    cells = []
    for y in sorted(set(yr)):
        m = yr == y
        cells.append(f"{y}: dm p50 {np.nanmedian(p['dm'][m]):.0f}, Hs p50 {np.nanmedian(p['hs'][m]):.2f}, "
                     f"wind sea found {np.mean(p['h_ws'][m] > 0.05):.0%}")
    print(sid, ' | '.join(cells))
