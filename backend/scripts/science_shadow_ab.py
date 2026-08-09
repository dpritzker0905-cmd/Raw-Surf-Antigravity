"""Science shadow A/B -- replay served spot-hours under a CANDIDATE flag set, against themselves.

WHY (MASTER-AUDIT-11.0's last structural gap; HANDOFF 08-09 item 5): every calibration decision
this platform faces -- SURF_TIDE_DEPTH, SURF_REFRACTION_KR, the cap seam, census bound
re-derivation -- was a flag-flip gamble because nothing could answer "what would the SERVED
ratings have been under the candidate config?". The precompute now records each spot-hour's
INPUTS at use time (spot_ratings 'inputs': offshore_hs_m, swell_from_deg, wind_ms, wind_from_deg,
shore_normal_deg, break_depth_m -- the R11-04-sibling provenance rule), which makes every frame
replayable offline with SHARED inputs: no re-resolve, no generation skew, the flag delta is the
ONLY difference between arms.

THE SELF-CHECK IS THE INSTRUMENT'S SPINE. For every row, the BASELINE arm recomputes the rating
from the persisted inputs through the SAME production functions (compute_surf_rating; and
estimate_surf_at when the candidate touches the height chain) and must reproduce the persisted
score within REPRODUCE_TOL. A row that does not reproduce is DISQUALIFIED and counted -- never
silently included -- because a non-reproducing baseline means the replay is a second forecast
path (the repo's #1 recurring defect) or the assets/code moved since the frame was rated. The
candidate arm is only ever compared against a verified baseline.

FLAG SEMANTICS. Most science flags are read at call time from os.environ and are applied by
patching the environment for the candidate arm. Two act at composition seams and are handled
structurally: RATING_LOCAL_SIZE=0 replays with reference_size_m=None (the flag gates whether the
caller passes the reference), and HEIGHT_FLAGS below re-run the height half from the offshore
inputs + static geometry before rating.

Usage:
  python scripts/science_shadow_ab.py --candidate SURF_REFRACTION_KR=1.0
  python scripts/science_shadow_ab.py --candidate RATING_LOCAL_SIZE=0 --frames-file frames.json
  python scripts/science_shadow_ab.py --candidate SURF_TIDE_DEPTH=1 --json out.json
Frames come from --frames-file, else the spot-ratings L2 blob (SUPABASE_* env, CI secrets).
Exit 0 = report produced; exit 3 = REFUSED (no replayable rows -- blind is never a result).
ASCII output only.
"""
import argparse
import json
import os
import sys
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Score points. NOT zero because BOTH arms are quantized: compute_surf_rating rounds to 0.1, and
# the persisted inputs are rounded on write (height 1e-3 m, wind 1e-3 ms, directions 0.1 deg) --
# worst honest divergence is ~0.09 true (steepest measured limb ~74 pts/m x 5e-4 m, aim terms
# ~1 pt/deg x 0.05 deg) which can straddle ONE 0.1 rounding boundary => honest |d| <= 0.2.
# Real drift (a changed constant/asset) moves points, not tenths: 0.25 stays 4x below the
# smallest change anyone would ship. Tightening this below the rounding grid disqualifies
# honestly-reproducing rows as "broken" -- the not-sampled-vs-broken conflation, inverted.
REPRODUCE_TOL = 0.25
# Flags whose delta changes the BREAKING HEIGHT -- the replay must re-run estimate_surf_at from
# the offshore inputs (+ static geometry) rather than reuse the persisted surf_height_m.
HEIGHT_FLAGS = ("SURF_REFRACTION_KR", "SURF_HEIGHT_H110", "SURF_TIDE_DEPTH",
                "SURF_COASTAL_FROM_SHORE_NORMAL", "SURF_COASTAL_FROM_LAND_BIT")


def _cell_reference_fn():
    """REFERENCE_LANE=cell -- the BAND's yardstick, for the owner's band-vs-glyph question (queue
    E#1, observed 2026-08-09: band and glyphs disagree on colour at close zoom).

    Both lanes run the SAME statistic (reference_from_hist, p50, min 12 samples, clamp 0.4-4.0 --
    grid_size_climatology imports the helper from spot_size_climatology) over the SAME quantity
    (breaking heights, same estimate_surf physics). They differ ONLY in POPULATION: the glyph reads
    the spot's own histogram; the band reads a FIXED 2.0-degree lattice cell (LATTICE_DEG, sized to
    the global_mid product), so at Pipeline the yardsticks measured 1.484 m vs 2.164 m -- 46% apart.
    ⇒ That gap is ZOOM-INVARIANT: only the RENDER cells shrink as you zoom in, never the reference
    lattice.

    ⛔ THIS IS A COUNTERACTING TERM, NOT THE E#1 CAUSE (corrected 2026-08-09 by live measurement,
    `112d2c34`). The close-zoom band reads 2.3-2.7x ABOVE the glyph, while a LARGER reference scores
    LOWER (1.0 m/12 s: 33.5 at ref 1.481 vs 21.9 at ref 2.164). The reference gap therefore predicts
    the band reading LOW -- the OPPOSITE sign -- so E#1's real mechanism lives in the per-cell
    composition (cell bathymetry geometry + wind co-sampled at the CELL, vs the SPOT's geometry) and
    is strong enough to overcome this. What this candidate is genuinely for: sizing how much of the
    on-screen gap the reference lane CANCELS, so a per-cell fix is not credited with its effect.

    WHAT THIS MEASURES, EXACTLY: the reference lane's contribution, holding the height fixed. The
    real band also samples its height at the 2-degree CELL CENTRE rather than the spot, so this is
    a LOWER BOUND on the on-screen divergence, not the whole of it. Reported as such -- an
    instrument that overstates its own scope is how a 0% result gets trusted."""
    from services.weather_pipeline.grid_size_climatology import (
        load_grid_size_climatology_l2_cached, reference_for)
    clim = load_grid_size_climatology_l2_cached()
    if not clim or not isinstance(clim.get("cells"), dict) or not clim["cells"]:
        return None
    return lambda lat, lng: reference_for(clim, lat, lng)


def _rate(surf_h, row, reference_size_m):
    """The rating half, mirrored KEYWORD-FOR-KEYWORD from rate_one_spot (the reference
    implementation). Tide/breaker/partitions replay as ABSENT -- they are flag-off in every
    persisted frame today; when those flags ship, their inputs must be persisted first."""
    from services.weather_pipeline.surf_rating import compute_surf_rating
    inp = row.get("inputs") or {}
    return compute_surf_rating(
        surf_h, row.get("period_s"), inp.get("wind_ms"),
        wind_from_deg=inp.get("wind_from_deg"),
        shore_normal_deg=inp.get("shore_normal_deg"),
        swell_from_deg=inp.get("swell_from_deg"),
        tide_norm=None, best_tide=None, breaker_xi=None,
        reference_size_m=reference_size_m,
        partitions=None,
        break_depth_m=inp.get("break_depth_m"))


def _height(row):
    """The height half from offshore inputs + static geometry (only when a HEIGHT_FLAG differs)."""
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    inp = row.get("inputs") or {}
    if inp.get("offshore_hs_m") is None or row.get("period_s") is None:
        return None
    g = resolve_surf_geometry(row["latitude"], row["longitude"])
    h, _regime = estimate_surf_at(row["latitude"], row["longitude"],
                                  inp["offshore_hs_m"], row["period_s"],
                                  inp.get("swell_from_deg"), geometry=g)
    return h


def replay_frames(frames: List[dict], candidate: Dict[str, str], cell_ref_fn=None) -> dict:
    """Pure-ish core (touches os.environ transiently; static assets only). Returns the report.

    `cell_ref_fn` supplies the REFERENCE_LANE=cell yardstick (injected, so the core stays testable
    without the L2 blob); main() builds it via _cell_reference_fn and REFUSES if it is unavailable
    -- a missing climatology must never silently replay as "no reference", which would read as a
    band/glyph agreement that was never measured."""
    height_replay = any(k in candidate for k in HEIGHT_FLAGS)
    structural_ref_off = candidate.get("RATING_LOCAL_SIZE") == "0"
    structural_ref_cell = candidate.get("REFERENCE_LANE") == "cell"
    env_patch = {k: v for k, v in candidate.items()
                 if k not in ("RATING_LOCAL_SIZE", "REFERENCE_LANE")}

    rows_seen = rows_replayable = disqualified = 0
    up = down = same = 0
    deltas: List[float] = []
    level_flow: Dict[str, int] = {}
    movers: List[dict] = []
    saved = {k: os.environ.get(k) for k in env_patch}

    for fr in frames or []:
        for s in fr.get("spots") or []:
            rows_seen += 1
            if s.get("score") is None or not s.get("inputs") or s.get("surf_height_m") is None:
                continue
            ref = s.get("reference_size_m")

            # BASELINE self-check: same functions, same inputs, current (baseline) env.
            base_score, base_level = _rate(s["surf_height_m"], s, ref)
            if base_score is None or abs(base_score - s["score"]) > REPRODUCE_TOL:
                disqualified += 1
                continue
            if height_replay:
                h_check = _height(s)
                if h_check is None or abs(h_check - s["surf_height_m"]) > 0.005:
                    disqualified += 1          # geometry/assets/code moved since the frame
                    continue
            rows_replayable += 1

            # CANDIDATE arm under the patched environment.
            try:
                for k, v in env_patch.items():
                    os.environ[k] = v
                if structural_ref_off:
                    cand_ref = None
                elif structural_ref_cell:
                    cand_ref = cell_ref_fn(s["latitude"], s["longitude"]) if cell_ref_fn else None
                else:
                    cand_ref = ref
                cand_h = _height(s) if height_replay else s["surf_height_m"]
                cand_score, cand_level = _rate(cand_h, s, cand_ref)
            finally:
                for k, v in saved.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
            if cand_score is None:
                disqualified += 1
                continue

            d = round(cand_score - s["score"], 1)
            deltas.append(d)
            if cand_level != s.get("level"):
                key = "%s -> %s" % (s.get("level"), cand_level)
                level_flow[key] = level_flow.get(key, 0) + 1
                if d > 0:
                    up += 1
                else:
                    down += 1
            else:
                same += 1
            movers.append({"spot_id": s.get("spot_id"), "name": s.get("name"),
                           "score_now": s["score"], "score_cand": round(cand_score, 1),
                           "delta": d, "level_now": s.get("level"), "level_cand": cand_level,
                           "surf_height_m": s.get("surf_height_m"),
                           "cand_height_m": round(cand_h, 3) if cand_h is not None else None,
                           # Both yardsticks, so a mover row can be read without re-deriving them
                           # (the E#1 question is exactly "which reference, and how far apart").
                           "ref_now": ref, "ref_cand": cand_ref})

    movers.sort(key=lambda m: m["delta"])
    n = len(deltas)
    ds = sorted(deltas)
    pct = lambda q: ds[min(n - 1, int(q * n))] if n else None
    return {
        "candidate": candidate,
        "rows_seen": rows_seen, "rows_replayable": rows_replayable,
        "disqualified": disqualified,
        "level_unchanged": same, "level_up": up, "level_down": down,
        "level_change_pct": round(100.0 * (up + down) / n, 1) if n else None,
        "delta_p10": pct(0.10), "delta_median": pct(0.50), "delta_p90": pct(0.90),
        "delta_min": ds[0] if n else None, "delta_max": ds[-1] if n else None,
        "level_flow": dict(sorted(level_flow.items(), key=lambda kv: -kv[1])),
        "biggest_downgrades": movers[:6], "biggest_upgrades": movers[-6:][::-1],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", required=True,
                    help="comma-separated FLAG=value pairs, e.g. SURF_REFRACTION_KR=1.0")
    ap.add_argument("--frames-file", default=None)
    ap.add_argument("--json", default=None, help="write the full report here (the artifact)")
    args = ap.parse_args()
    candidate = dict(p.split("=", 1) for p in args.candidate.split(",") if "=" in p)
    if not candidate:
        print("REFUSED: no parseable FLAG=value pairs in --candidate")
        return 3

    if args.frames_file:
        doc = json.load(open(args.frames_file, encoding="utf-8"))
    else:
        from services.weather_pipeline.spot_ratings import load_spot_ratings_l2_cached
        doc = load_spot_ratings_l2_cached()
    frames = (doc or {}).get("frames") or []
    cell_ref_fn = None
    if candidate.get("REFERENCE_LANE") == "cell":
        cell_ref_fn = _cell_reference_fn()
        if cell_ref_fn is None:
            print("REFUSED: REFERENCE_LANE=cell needs the grid size climatology and it is empty or"
                  " unreachable. Replaying without it would silently substitute 'no reference',"
                  " which reads as band/glyph AGREEMENT that was never measured.")
            return 3
    rep = replay_frames(frames, candidate, cell_ref_fn=cell_ref_fn)

    if rep["rows_replayable"] == 0:
        print("REFUSED: 0 replayable rows (seen %d, disqualified %d) -- frames predate the inputs"
              " persistence, or the baseline no longer reproduces (assets/code moved). This is"
              " blindness, not a result." % (rep["rows_seen"], rep["disqualified"]))
        return 3

    print("SHADOW A/B  candidate=%s" % candidate)
    print("  rows       seen %d | replayable %d | disqualified %d"
          % (rep["rows_seen"], rep["rows_replayable"], rep["disqualified"]))
    print("  LEVEL      unchanged %d  up %d  down %d  => %s%% change"
          % (rep["level_unchanged"], rep["level_up"], rep["level_down"], rep["level_change_pct"]))
    print("  delta      p10 %s  median %s  p90 %s  (min %s, max %s)"
          % (rep["delta_p10"], rep["delta_median"], rep["delta_p90"],
             rep["delta_min"], rep["delta_max"]))
    if candidate.get("REFERENCE_LANE") == "cell":
        print("  SCOPE      band-vs-glyph REFERENCE lane only, height held fixed. The band also"
              " samples its height at the 2-deg CELL CENTRE, so this is a LOWER BOUND on the"
              " on-screen divergence.")
    for k, v in list(rep["level_flow"].items())[:8]:
        print("  flow       %s x%d" % (k, v))
    for r in [m for m in rep["biggest_downgrades"] if m["delta"] < 0][:4]:
        print("    v %s: %s -> %s (%s -> %s)" % (r.get("name"), r["level_now"], r["level_cand"],
                                                 r["score_now"], r["score_cand"]))
    for r in [m for m in rep["biggest_upgrades"] if m["delta"] > 0][:4]:
        print("    ^ %s: %s -> %s (%s -> %s)" % (r.get("name"), r["level_now"], r["level_cand"],
                                                 r["score_now"], r["score_cand"]))
    if args.json:
        json.dump(rep, open(args.json, "w", encoding="utf-8"), indent=1)
        print("  artifact   %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
