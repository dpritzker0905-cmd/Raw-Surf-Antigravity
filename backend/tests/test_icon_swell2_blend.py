"""The server port of the ICON swell_2 blend equals the browser's (2026-11-13, move 3, owner decision B).

The golden file is written by the BROWSER's own code (frontend/scripts/icon-swell2/golden.mjs runs iconSwell2Blend.js unchanged),
so a change to either side that is not mirrored in the other fails here. Floats compare within 1e-9 (Python's libm and V8's may
differ in the last bit of sin/cos/atan2; measured max 5.7e-14 over 105,180 cells); availability flags and missing directions
compare exactly.
"""
import json
import math
from pathlib import Path

import pytest

from services.weather_pipeline.icon_swell2_blend import blend_vectors

GOLDEN = Path(__file__).parent / "fixtures" / "icon_swell2_blend_js_golden.json"
KEYS = ("lat", "lng", "u", "v", "speed", "height", "period", "direction", "isOcean", "is_valid")


def _dec(o):
    if isinstance(o, dict):
        if set(o) == {"__nonfinite"}:
            return float(o["__nonfinite"].replace("Infinity", "inf"))
        return {k: _dec(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_dec(x) for x in o]
    return o


CASES = _dec(json.loads(GOLDEN.read_text(encoding="utf-8")))["edge"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_port_matches_the_browser_blend(case):
    got = blend_vectors(case["g"], case["e"])
    if not case["out"]:
        assert got is None or got[0] == []
        return
    vectors, gfs_w, euro_w = got
    assert [gfs_w, euro_w] == case["weights"]
    assert len(vectors) == len(case["out"])
    for a, b in zip(vectors, case["out"]):
        for k in KEYS:
            x, y = a.get(k), b.get(k)
            if isinstance(x, bool) or isinstance(y, bool) or x is None or y is None:
                assert x == y, (case["name"], k, x, y)
            elif not (math.isnan(x) and math.isnan(y)):
                assert abs(x - y) <= 1e-9, (case["name"], k, x, y)


def test_golden_covers_the_hard_cases():
    names = {c["name"] for c in CASES}
    for must in ("cancelling directions", "exact cancel 0.6/0.4", "gfs masked", "euro land", "both calm", "gfs only", "euro only",
                 "euro fuller anchors", "half-degree key rounding", "half-up key boundary (JS rounds 20.5 up; banker rounding would not)", "negative half key", "NaN height", "null u"):
        assert must in names


def test_weights_follow_which_sources_have_cells():
    one = [{"lat": 0, "lng": 0, "speed": 1.0, "direction": 90.0, "u": -1.0, "v": 0.0, "period": 9.0, "is_valid": True}]
    assert blend_vectors(one, one)[1:] == (0.6, 0.4)
    assert blend_vectors(one, [])[1:] == (1.0, 0.0)
    assert blend_vectors([], one)[1:] == (0.0, 1.0)
    assert blend_vectors([], []) is None
