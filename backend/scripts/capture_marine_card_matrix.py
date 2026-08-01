"""Regenerate the marine card-matrix fixture from LIVE production.

    python backend/scripts/capture_marine_card_matrix.py

Writes `frontend/src/tests/fixtures/marine-card-matrix.fixture.json`, which
`frontend/src/tests/marine-card-matrix-closure.test.js` (the 1a-0 guard) reads.

WHY A CAPTURED FIXTURE AND NOT A LIVE CALL
------------------------------------------
A guard that hits production is a guard that goes red when Render is cold, and it tests the SYSTEM
when what a CI guard must test is the CODE. So the composition invariants run offline against a
recorded sea, deterministically. The live half is a separate concern (the Calibration Census owns
the "is production still behaving" question).

⚠️ RE-CAPTURING CHANGES WHAT THE GUARD IS GRADING. The fixture is a real ocean state, and the
closure invariant is conditional on the tier mix inside it. If a re-capture lands during a calm or
a storm, the same-tier count moves and `SAME_TIER_FLOOR` in the test may need re-measuring — read
the printed census and the floor together, do not regenerate blind.

THE SITES ARE NAMED EXEMPLARS, NOT A RANDOM SAMPLE. Each covers a regime the composition must
survive: shoaling (Cocoa, Jeffreys Bay), shelf (Pipeline, Mavericks), long-period groundswell
(Trestles), EURO's home region (Hossegor), and a mid-continental LAND CONTROL (Kansas) whose only
job is to fail — a matrix with no negative control cannot tell "served" from "defaulted".
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("RAW_SURF_BASE", "https://raw-surf-antigravity.onrender.com")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "tests",
                   "fixtures", "marine-card-matrix.fixture.json")
TIMEOUT = 90

SITES = [
    ("Cocoa Beach",   28.36,   -80.60),
    ("Trestles",      33.383, -117.593),
    ("Pipeline",      21.665, -158.053),
    ("Mavericks",     37.4956, -122.5017),
    ("Jeffreys Bay", -34.049,   24.928),
    ("Hossegor",      43.664,   -1.443),
    ("KANSAS-LAND",   38.5,    -98.0),        # negative control — must NOT read as ocean on GFS
]
MODELS = ["GFS", "ICON", "EURO"]
LAYERS = ["waves", "swell_1", "swell_2", "wind_waves"]

# Only the fields the guard reads. Keeping the fixture minimal makes it reviewable in a diff —
# a 200 KB blob of every field is a fixture nobody re-reads when it changes.
KEEP_TOP = ["coverage_status", "upstream_provider", "source_dataset", "surf_height_m",
            "surf_regime", "surf_nearshore", "shore_normal_deg", "reference_size_m",
            "partitions", "is_estimated", "estimate_basis", "status"]
KEEP_PT = ["speed", "direction", "period", "interpolation_method"]


def valid_time() -> str:
    return datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00:00Z")


def fetch(model: str, layer: str, lat: float, lng: float, vt: str):
    qs = urllib.parse.urlencode({"model": model, "domain": "marine", "layer": layer,
                                 "lat": lat, "lng": lng, "valid_time": vt})
    try:
        with urllib.request.urlopen(f"{BASE}/api/weather/point?{qs}", timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code}
    except Exception as e:  # noqa: BLE001
        return {"_error": repr(e)[:160]}


def main() -> int:
    vt = valid_time()
    out = {
        "_README": (
            f"LIVE CAPTURE from {BASE}/api/weather/point, "
            f"{len(MODELS)} models x {len(LAYERS)} layers x {len(SITES)} sites. NOT synthetic. "
            "Regenerate with backend/scripts/capture_marine_card_matrix.py."
        ),
        "valid_time": vt,
        "captured_utc": datetime.now(timezone.utc).isoformat(),
        "source": BASE,
        "census": {},
        "cells": {},
    }

    requested = returned = 0
    for site, lat, lng in SITES:
        for model in MODELS:
            for layer in LAYERS:
                requested += 1
                d = fetch(model, layer, lat, lng, vt)
                if "_http_error" in d or "_error" in d:
                    print(f"  MISS {site}|{model}|{layer}: {d}", file=sys.stderr)
                    continue
                returned += 1
                pt = d.get("point") or {}
                out["cells"][f"{site}|{model}|{layer}"] = {
                    "site": site, "lat": lat, "lng": lng, "model": model, "layer": layer,
                    "payload": {**{k: d.get(k) for k in KEEP_TOP},
                                "point": {k: pt.get(k) for k in KEEP_PT}},
                }
        print(f"  captured {site}", file=sys.stderr)

    out["census"] = {"cells_requested": requested, "cells_returned": returned}

    # ASSERT WHAT RAN. The guard's first test re-checks this, but writing a partial fixture at all
    # is how a "complete" matrix quietly becomes a subset — fail here rather than ship one.
    if returned != requested:
        print(f"\n!! INCOMPLETE: {returned}/{requested} cells returned. Fixture NOT written.",
              file=sys.stderr)
        return 1

    path = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)

    # Print the tier census so SAME_TIER_FLOOR can be re-measured rather than assumed.
    parts = {"GFS": ["swell_1", "swell_2", "wind_waves"],
             "ICON": ["swell_1", "wind_waves"],
             "EURO": ["swell_1", "swell_2", "wind_waves"]}
    same = 0
    for site, _la, _ln in SITES:
        for model in MODELS:
            tiers = []
            for layer in ["waves"] + parts[model]:
                c = out["cells"].get(f"{site}|{model}|{layer}")
                pt = (c or {}).get("payload", {}).get("point", {})
                if pt.get("interpolation_method") in (None, "unavailable", "unsupported"):
                    tiers = []
                    break
                tiers.append(c["payload"]["coverage_status"])
            if tiers and len(set(tiers)) == 1:
                same += 1

    print(f"\nwrote {path}  ({os.path.getsize(path)} bytes, {returned}/{requested} cells)")
    print(f"valid_time {vt}")
    print(f"SAME-TIER (site,model) pairs in this capture: {same}")
    print("  -> compare against SAME_TIER_FLOOR in marine-card-matrix-closure.test.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
