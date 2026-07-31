"""Regenerate the JS/Python rating parity goldens.

`frontend/src/components/map/surfRating.js` is a hand-maintained mirror of
`backend/services/weather_pipeline/surf_rating.py`. The map glyphs and spot list are scored by the
BACKEND; the infobox is scored by the JS. When the two drift, one spot shows two different ratings
on one screen — which is exactly what happened when the point mappers dropped `shore_normal_deg`
(12b0e1ec) and would have happened again when the blown-out wind veto landed backend-only (817379da).

`frontend/src/__tests__/ratingParity.test.js` guards that with 4,320 goldens generated here.

WHY THIS SCRIPT EXISTS: the test's docstring used to say "see the generator in the 2026-07-26 audit
notes". A regeneration procedure that lives in a chat log is not a procedure — the goldens went stale
the moment the engine changed and the only way to refresh them was to reconstruct the grid by
inspecting the JSON. Now it is one command.

    python backend/scripts/gen_rating_parity_goldens.py

Run it after ANY intentional change to either engine, then re-run the frontend suite. The parity
contract itself is unchanged: LEVELS must match exactly, scores within one rounding unit (Python's
round() is banker's rounding, JS Math.round is half-away-from-zero).

⚠️ The goldens call `rating_score` with SIX positional arguments and no keywords, so they exercise
the default paths for reference_size_m / partitions / break_depth_m. That is deliberate — it is the
shape the JS mirror is called with — but it means a change gated behind one of those inputs will not
show up here. Cover those with targeted tests instead.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Generate against DEFAULT flag state — the goldens must describe what ships, so an env var left
# over in the generating shell must not leak into them.
for _flag in ("RATING_WIND_GATE", "RATING_OVERSIZE", "RATING_PERIOD_GATE", "RATING_LOCAL_SIZE",
              "RATING_TIDE", "RATING_BREAKER_TYPE", "RATING_OBS_GATE"):
    os.environ.pop(_flag, None)

from services.weather_pipeline import surf_rating as SR  # noqa: E402
from services.weather_pipeline.surf_rating import rating_score, score_to_level  # noqa: E402

# ⚠️ This is MS_TO_KT, not KT_TO_MS — the name was backwards while the arithmetic below
# (`kt / MS_TO_KT`) was right, which is how a duplicated unit constant hides. Read the
# engine's own so the goldens cannot drift from it.
MS_TO_KT = SR.MS_TO_KT
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                   "frontend", "src", "__tests__", "__parity_goldens.json")

# The grid: height x period x wind speed x wind direction x shore-normal-known? x swell direction.
HEIGHTS = [0.0, 0.25, 0.6, 1.2, 2.0, 3.5]
PERIODS = [5.0, 9.0, 13.0, 17.0]
KNOTS = [1.0, 8.0, 16.0, 30.0, 60.0]
WIND_DIRS = [0.0, 60.0, 120.0, 180.0, 240.0, 300.0]
SHORE_NORMALS = [270.0, None]
SWELL_DIRS = [240.0, 270.0, 300.0]


def build():
    rows = []
    for h in HEIGHTS:
        for tp in PERIODS:
            for kt in KNOTS:
                for wd in WIND_DIRS:
                    for sn in SHORE_NORMALS:
                        for sd in SWELL_DIRS:
                            s = rating_score(h, tp, kt / MS_TO_KT, wd, sn, sd)
                            rows.append({"h": h, "tp": tp, "kt": kt, "wd": wd, "sd": sd,
                                         "sn": sn, "s": s, "l": score_to_level(s)})
    return rows


def main():
    rows = build()
    expected = (len(HEIGHTS) * len(PERIODS) * len(KNOTS) * len(WIND_DIRS)
                * len(SHORE_NORMALS) * len(SWELL_DIRS))
    assert len(rows) == expected, f"grid produced {len(rows)}, expected {expected}"
    # The parity test asserts the golden set covers the interesting space — check it HERE too, so a
    # degenerate regeneration fails loudly at the source instead of quietly weakening the gate.
    levels = {r["l"] for r in rows}
    assert len(levels) >= 5, f"golden set collapsed to {sorted(levels)}"
    assert any(r["s"] == 0 for r in rows), "no flat case"
    assert any(r["s"] > 70 for r in rows), "no high-scoring case"
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, separators=(",", ":"))
    print(f"wrote {len(rows)} goldens -> {OUT}")
    print(f"  levels covered: {len(levels)} {sorted(levels)}")
    print(f"  score range: {min(r['s'] for r in rows)} .. {max(r['s'] for r in rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
