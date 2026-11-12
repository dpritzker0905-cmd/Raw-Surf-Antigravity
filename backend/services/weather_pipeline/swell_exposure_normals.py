"""swell_exposure_normals.py - MOP-calibrated swell-EXPOSURE normals for California spots (SHORE_NORMAL_MOP_CALIBRATED).

WHY (2026-11-11, follow-up to JAC-1 #779). The height's swell-angle factor (`surf_transform._height_exposure_factor`) asks
"how head-on is this swell?" against the spot's shore normal. That normal is a coastline fit (ETOPO, ~1.7-5 km windows) or the
0.25 deg grid's. CDIP MOP v1.1 (a physical refraction/diffraction model) shows the bearing a California spot actually RESPONDS
to is often far from either: island shadowing (the Channel Islands), headlands and bay mouths decide it, not the local coast.
Measured at 19 study spots, 2022-01..2025-03 (MOP alongshore hindcast vs the offshore CDIP buoys that drive it):
  * chain normal vs MOP's own transect normal: |diff| p50 9 deg, p90 32 deg over 77 CA spots; but MOP's transect normal is
    NOT a better input (held-out MSE 0.0254 vs the chain's 0.0289): it is the 10 m contour's orientation, not the response;
  * an EFFECTIVE normal fitted per spot to MOP's response (train 2022-2023) cut the HELD-OUT (2024-2025) MSE between the
    chain's own factor and MOP's attenuation from 0.0289 to 0.0050, better at 17 of 19 spots, pooled improvement 0.0239
    [0.0108, 0.0390] (spot bootstrap).
The fit is in the chain's own frame (the OFFSHORE swell direction against the factor), which is exactly how the chain uses it.

SCOPE: the HEIGHT's exposure factor only. The coastline normal (`SurfGeometry.shore_normal_deg`) is unchanged and still decides
the wind's offshore/onshore test and everything else: an exposure bearing shaped by an island is not the direction of the coast.
The rating's own swell alignment keeps the coastline normal for now (named follow-up).

DATA: `data/swell_exposure_normals.json`, built by `scripts/build_swell_exposure_normals.py` from the fit (one entry per catalogue
spot whose fit beat its chain normal out of sample, with the fit's evidence). Lookup is nearest within MATCH_KM of the spot.
Outside California, and at any spot not in the table, nothing changes (no MOP to calibrate against).

FLAG: SHORE_NORMAL_MOP_CALIBRATED (GUARDED, D-065), HELD OFF. The default-ON filter's nearshore arm (#773: hb_proxy at 8 CDIP
anchors, 2026-10-20..29) reads it WORSE, +0.0385 m MAE [0.0234, 0.0589], while MOP reads it far better. The two instruments
disagree (the proxy's truth applies no exposure loss, and the chain already reads below it), so it stays off until that
conflict is resolved. Off, or a miss: None, and the height uses the shore normal as before.
"""
import json
import math
import os
import threading
from typing import Optional, Tuple

FLAG = "SHORE_NORMAL_MOP_CALIBRATED"
MATCH_KM = 1.0
_ASSET = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "swell_exposure_normals.json")
_lock = threading.Lock()
_entries = None


def enabled() -> bool:
    try:
        from services import runtime_flags as _rf
        return _rf.flag(FLAG) == "1"
    except Exception:
        return False


def _load():
    global _entries
    if _entries is not None:
        return _entries
    with _lock:
        if _entries is None:
            try:
                with open(_ASSET, encoding="utf-8") as fh:
                    doc = json.load(fh)
                _entries = [(float(e["lat"]), float(e["lng"]), float(e["normal"]), str(e.get("name") or ""))
                            for e in doc.get("entries", [])]
            except Exception:
                _entries = []
    return _entries


def _km(lat1, lng1, lat2, lng2):
    return 111.2 * math.hypot(lat1 - lat2, (lng1 - lng2) * math.cos(math.radians((lat1 + lat2) / 2.0)))


def exposure_normal_at(lat: float, lng: float) -> Tuple[Optional[float], Optional[str]]:
    """(effective swell-exposure normal, spot name) for the nearest calibrated spot within MATCH_KM, else (None, None).
    Never raises; (None, None) with the flag off."""
    if not enabled():
        return None, None
    try:
        best = None
        for la, ln, normal, name in _load():
            if abs(la - lat) > 0.02:
                continue
            d = _km(lat, lng, la, ln)
            if d <= MATCH_KM and (best is None or d < best[0]):
                best = (d, normal, name)
        return (best[1], best[2]) if best else (None, None)
    except Exception:
        return None, None


def _reset_for_test():
    global _entries
    _entries = None
