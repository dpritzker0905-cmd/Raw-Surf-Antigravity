"""Smoke test of the G3 gate's Copernicus Marine readers (S1 preflight, S1 climatology, N1 analysis) on ONE gauge and
dates OUTSIDE the G3 window. No truth is fetched; nothing is scored. Prints counts and sample values only."""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tide_g3"))
import g3_sources as GS                                         # noqa: E402

out = {}
ok, why = GS.s1_preflight(Path("cm_smoke"))
out["s1_preflight"] = {"ok": ok, "why": why}
if ok:
    clim, info = GS.s1_climatology(21.303333, -157.86453, Path("cm_smoke"))
    out["s1_honolulu"] = {"cell": info, "n_doy": len(clim) if clim else 0,
                          "sample_m": [round(clim[d], 3) for d in (1, 91, 182, 274)] if clim else None}
try:
    ser = GS.n1_series(21.303333, -157.86453, datetime(2026, 10, 1), datetime(2026, 10, 2, 23), Path("cm_smoke"))
    out["n1_honolulu"] = {"hours": len(ser or {}), "sample_m": [round(v, 3) for v in list((ser or {}).values())[:3]]}
except Exception as e:                                           # noqa: BLE001
    out["n1_honolulu"] = {"error": str(e)[:300]}
print(json.dumps(out, indent=1, default=str))
