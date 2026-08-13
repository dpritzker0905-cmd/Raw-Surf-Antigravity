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
# Candidates whose effect is GUARDED on an input. A row lacking that input cannot move, so
# averaging it into the verdict dilutes a real effect toward "quiet" -- the denominator
# lesson. When the dependency is only partly present the report says so AND reports the rate
# over the carrying subset, which is the number that actually answers the question.
CANDIDATE_INPUT_DEPS = {"SURF_TIDE_DEPTH": "water_level_m"}


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
    # water_level_m carried through so SURF_TIDE_DEPTH is EXERCISABLE. Absent on rows rated before
    # it was persisted -> passes None -> the tide guard stays false, exactly as production behaves.
    h, _regime = estimate_surf_at(row["latitude"], row["longitude"],
                                  inp["offshore_hs_m"], row["period_s"],
                                  inp.get("swell_from_deg"), geometry=g,
                                  water_level_m=inp.get("water_level_m"))
    return h


def candidate_can_move(candidate: Dict[str, str], cell_ref_fn=None) -> dict:
    """POSITIVE CONTROL: can this harness exercise the candidate AT ALL?

    ⛔ WHY THIS EXISTS -- I shipped a false result without it. The first real run reported
    SURF_TIDE_DEPTH=1 as "0.2% level change, median 0.0", which reads as *safe to flip*. It was
    measuring NOTHING: `surf_transform` guards the tide term with `if water_level_m and
    os.environ.get("SURF_TIDE_DEPTH")...`, and the replay never supplies `water_level_m` -- exactly
    as `surf_point` warns in prose ("NO SERVING-PATH CALLER SUPPLIES IT YET"). The flag could not
    act, so of course nothing moved. A null result from an inert lever is not evidence of a quiet
    lever; it is evidence of a blind harness.

    The control drives the SAME `_height`/`_rate` path `replay_frames` uses -- a control that took
    a shortcut the replay does not take would certify a capability the replay lacks -- across seas
    from trivial to cap-limited, because a term that only binds in the saturated regime (the tide
    cap does: measured at Pipeline, 8.99 m -> 12.92 m at +1.5 m water level, and NOTHING below
    ~12 m offshore) is invisible on ordinary rows.
    ⭐ The repo already knew this shape: "A 0% RESULT IS WORTHLESS WITHOUT A POSITIVE CONTROL."
    """
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    from services.weather_pipeline.surf_rating import compute_surf_rating
    lat, lng = 21.665, -158.051                       # Pipeline: steep, cap-limited at big swell
    g = resolve_surf_geometry(lat, lng)
    probes = []
    for off, tp in ((0.5, 14.0), (2.0, 14.0), (8.0, 14.0), (12.0, 14.0), (12.0, 20.0)):
        h, _r = estimate_surf_at(lat, lng, off, tp, 315.0, geometry=g)
        sc, _l = compute_surf_rating(h, tp, 3.0, wind_from_deg=140.0,
                                     shore_normal_deg=g.shore_normal_deg, swell_from_deg=315.0,
                                     break_depth_m=g.break_depth_m)
        probes.append({"spot_id": "ctl", "latitude": lat, "longitude": lng, "score": sc,
                       "level": _l, "surf_height_m": round(h, 3), "period_s": tp,
                       "inputs": {"offshore_hs_m": off, "swell_from_deg": 315.0, "wind_ms": 3.0,
                                  "wind_from_deg": 140.0, "water_level_m": 1.5,
                                  "shore_normal_deg": g.shore_normal_deg,
                                  "break_depth_m": g.break_depth_m}})
    rep = replay_frames([{"spots": probes}], candidate, cell_ref_fn=cell_ref_fn)
    moved = max(abs(m["delta"]) for m in (rep["biggest_upgrades"] + rep["biggest_downgrades"]))         if rep["rows_replayable"] else 0.0
    return {"can_move": moved > REPRODUCE_TOL, "max_abs_delta": moved,
            "probes": len(probes), "replayable": rep["rows_replayable"]}


def infer_dependencies(movers, tol=REPRODUCE_TOL):
    """Which input is the candidate's effect CONFINED to? Discovered from the data, not declared.

    ⛔ WHY THIS EXISTS. CANDIDATE_INPUT_DEPS is a hand-maintained registry with one entry, so a
    future flag guarded on an unlisted input gets the DILUTED headline in silence -- proven: the
    same frames report a bare "25.0% change" with no warning when the dependency is unregistered,
    and "100.0% among rows that carry it" when it is. A registry that must be remembered is a
    registry that will be forgotten; this needs nothing remembered.

    An input qualifies when EVERY row that moved carries it and at least one row lacking it did
    NOT move -- i.e. the movement is perfectly confined. Requires a row on BOTH sides, because a
    key present on every row explains nothing (it cannot discriminate), and that is exactly the
    denominator trap this whole line of work keeps hitting.
    """
    moved = [m for m in movers if abs(m["delta"]) > tol]
    if not moved:
        return []
    keys = set()
    for m in movers:
        keys.update(m.get("input_keys") or ())
    found = []
    for k in sorted(keys):
        with_k = [m for m in movers if k in (m.get("input_keys") or ())]
        without_k = [m for m in movers if k not in (m.get("input_keys") or ())]
        if not with_k or not without_k:
            continue                      # present (or absent) everywhere: explains nothing
        moved_with = [m for m in with_k if abs(m["delta"]) > tol]
        moved_without = [m for m in without_k if abs(m["delta"]) > tol]
        if moved_with and not moved_without:
            found.append({"input": k, "rows_with": len(with_k), "rows_without": len(without_k),
                          "moved_with": len(moved_with),
                          "pct_of_carrying": round(100.0 * len(moved_with) / len(with_k), 1)})
    return found


def _dep_subset(candidate, movers):
    """Level-change rate over ONLY the rows carrying the candidate's guarded input."""
    dep = next((CANDIDATE_INPUT_DEPS[k] for k in candidate if k in CANDIDATE_INPUT_DEPS), None)
    if not dep:
        return None
    rows = [m for m in movers if m.get("dep_present")]
    if not rows:
        return {"input": dep, "rows": 0, "changed": 0, "pct": None, "max_abs_delta": 0.0}
    changed = sum(1 for m in rows if m["level_now"] != m["level_cand"])
    return {"input": dep, "rows": len(rows), "changed": changed,
            "pct": round(100.0 * changed / len(rows), 1),
            "max_abs_delta": max(abs(m["delta"]) for m in rows)}


def _note(bucket, s, why, got, expected, cap=8):
    """Record WHICH row was disqualified. A count cannot be investigated -- see
    docs/research/FINDING-2026-08-12-the-disqualified-row-is-an-INTERACTION.md."""
    if len(bucket) < cap:
        d = None if got is None or expected is None else round(abs(got - expected), 3)
        bucket.append({"name": s.get("name"), "spot_id": s.get("spot_id"), "why": why,
                       "got": got, "expected": expected, "delta": d,
                       "surf_height_m": s.get("surf_height_m")})


def replay_frames(frames: List[dict], candidate: Dict[str, str], cell_ref_fn=None) -> dict:
    """Pure-ish core (touches os.environ transiently; static assets only). Returns the report.

    `cell_ref_fn` supplies the REFERENCE_LANE=cell yardstick (injected, so the core stays testable
    without the L2 blob); main() builds it via _cell_reference_fn and REFUSES if it is unavailable
    -- a missing climatology must never silently replay as "no reference", which would read as a
    band/glyph agreement that was never measured."""
    height_replay = any(k in candidate for k in HEIGHT_FLAGS)
    _dep_key = next((CANDIDATE_INPUT_DEPS[k] for k in candidate
                     if k in CANDIDATE_INPUT_DEPS), None)
    structural_ref_off = candidate.get("RATING_LOCAL_SIZE") == "0"
    structural_ref_cell = candidate.get("REFERENCE_LANE") == "cell"
    env_patch = {k: v for k, v in candidate.items()
                 if k not in ("RATING_LOCAL_SIZE", "REFERENCE_LANE")}

    # WHAT POPULATION THIS RESULT COVERS. Without it a reader sees "0.2% of rows changed" and
    # cannot tell whether that is one hour or a fortnight -- and for a candidate that only binds
    # at, say, a tidal extreme, a quiet 3-hour window is not evidence of a quiet flag. The first
    # real run (SURF_TIDE_DEPTH, 2026-08-09) spanned 3 models x 2 hour-offsets and said none of it.
    models, hour_offsets, valid_times = set(), set(), []
    served_frames = set()
    frames_seen = 0
    rows_seen = rows_replayable = disqualified = 0
    # ⭐ WHICH row, not just how many. A count told me 1 row failed and nothing else; locating it
    # cost ~14 bisection runs and produced a WRONG published conclusion on the way. Capped so a
    # systemic break cannot turn the report into a data dump.
    disq_rows = []
    up = down = same = 0
    deltas: List[float] = []
    level_flow: Dict[str, int] = {}
    movers: List[dict] = []
    inputs_present: Dict[str, int] = {}
    saved = {k: os.environ.get(k) for k in env_patch}

    for fr in frames or []:
        frames_seen += 1
        if fr.get("model"):
            models.add(str(fr["model"]))
        if fr.get("hour_offset") is not None:
            hour_offsets.add(int(fr["hour_offset"]))
        if fr.get("valid_time"):
            valid_times.append(str(fr["valid_time"]))
        # ⭐ THE FRAME A REQUEST ASKED FOR IS NOT THE FRAME IT WAS SERVED. Measured 2026-08-12:
        # twelve hourly requests to /api/weather/spot-ratings returned THREE distinct
        # served_valid_times -- 01:00Z answered eight of them. The span read "12 h" and was
        # perfectly correct; the COVERAGE was three-eighths of that. A frame with no
        # served_valid_time (source=live) is its own distinct frame, keyed by valid_time, since
        # nothing else distinguishes it.
        served_frames.add(str(fr.get("served_valid_time") or fr.get("valid_time") or frames_seen))
        for s in fr.get("spots") or []:
            rows_seen += 1
            if s.get("score") is None or not s.get("inputs") or s.get("surf_height_m") is None:
                continue
            ref = s.get("reference_size_m")

            # BASELINE self-check: same functions, same inputs, current (baseline) env.
            base_score, base_level = _rate(s["surf_height_m"], s, ref)
            if base_score is None or abs(base_score - s["score"]) > REPRODUCE_TOL:
                disqualified += 1
                _note(disq_rows, s, "baseline", base_score, s["score"])
                continue
            if height_replay:
                h_check = _height(s)
                # ⭐ RELATIVE, because the quantization envelope SCALES with height while a
                # flat bound does not. Measured 2026-08-12 over 128 served rows by perturbing
                # every persisted input by its own rounding half-quantum, PLUS the +-0.0005
                # that surf_height_m carries as a 1e-3-rounded comparison TARGET:
                #   envelope/height  p50 0.25%  p90 0.57%  max 0.84%
                # 1.0% clears the measured max with headroom; the 0.005 floor keeps small
                # waves exactly as strict as before. DERIVED from the grids, not fitted to a
                # failing row -- see docs/research/FINDING-2026-08-12-the-disqualified-row-
                # is-an-INTERACTION.md. A flat 0.005 disqualified the TALLEST sampled wave
                # (2.629 m, off by 0.3 mm) the day tail sampling first put big waves in the
                # sample -- a false-alarm rate that GROWS with coverage.
                _tol_h = max(0.005, 0.010 * abs(s["surf_height_m"]))
                if h_check is None or abs(h_check - s["surf_height_m"]) > _tol_h:
                    disqualified += 1          # geometry/assets/code moved since the frame
                    _note(disq_rows, s, "height", h_check, s["surf_height_m"])
                    continue
            rows_replayable += 1
            for _k in (s.get("inputs") or {}):
                inputs_present[_k] = inputs_present.get(_k, 0) + 1

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
                _note(disq_rows, s, "candidate", None, s["score"])
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
                           "ref_now": ref, "ref_cand": cand_ref,
                           "dep_present": bool(_dep_key and (s.get("inputs") or {}).get(_dep_key)
                                               is not None),
                           # For INFERRING the dependency from the data instead of a registry.
                           "input_keys": sorted(k for k, v in (s.get("inputs") or {}).items()
                                                if v is not None)})

    movers.sort(key=lambda m: m["delta"])
    n = len(deltas)
    ds = sorted(deltas)
    pct = lambda q: ds[min(n - 1, int(q * n))] if n else None
    span_h = (max(hour_offsets) - min(hour_offsets)) if hour_offsets else None
    return {
        "candidate": candidate,
        # Coverage travels WITH the verdict, never in a separate paragraph someone can skip.
        "coverage": {
            "frames": frames_seen,
            "distinct_served_frames": len(served_frames),
            "models": sorted(models),
            "hour_offsets": sorted(hour_offsets),
            "hour_span": span_h,
            "valid_time_min": min(valid_times) if valid_times else None,
            "valid_time_max": max(valid_times) if valid_times else None,
        },
        "rows_seen": rows_seen, "rows_replayable": rows_replayable,
        "disqualified": disqualified, "disqualified_rows": disq_rows,
        "level_unchanged": same, "level_up": up, "level_down": down,
        "level_change_pct": round(100.0 * (up + down) / n, 1) if n else None,
        "delta_p10": pct(0.10), "delta_median": pct(0.50), "delta_p90": pct(0.90),
        "delta_min": ds[0] if n else None, "delta_max": ds[-1] if n else None,
        "level_flow": dict(sorted(level_flow.items(), key=lambda kv: -kv[1])),
        # How many REPLAYABLE rows carried each input. Without this a verdict computed over
        # rows that mostly lack the candidate's guarded input reads as "quiet".
        "inputs_present": dict(sorted(inputs_present.items())),
        "dep_subset": _dep_subset(candidate, movers),
        # Registry-free: what the DATA says the effect is confined to.
        "inferred_deps": infer_dependencies(movers),
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
    # THE POSITIVE CONTROL RUNS FIRST. A null verdict is only meaningful if the harness could
    # have produced a non-null one.
    ctl = candidate_can_move(candidate, cell_ref_fn=cell_ref_fn)
    if not ctl["can_move"]:
        print("REFUSED: this harness cannot exercise %s. Across %d control seas (trivial to"
              " cap-limited) the candidate moved the score by at most %.3f points -- below the"
              " %.2f reproduce tolerance. The lever is INERT here, usually because the replay does"
              " not supply an input the flag is guarded on (SURF_TIDE_DEPTH needs water_level_m,"
              " which no serving-path caller provides). A null result from an inert lever is NOT"
              " evidence of a quiet lever."
              % (candidate, ctl["probes"], ctl["max_abs_delta"], REPRODUCE_TOL))
        return 3
    rep = replay_frames(frames, candidate, cell_ref_fn=cell_ref_fn)
    rep["control"] = ctl

    # NOT-SAMPLED vs BROKEN -- the repo's own rule is that a check which CANNOT tell them apart
    # must refuse. This one CAN: rows with no `inputs` are outside the 5% sample (absence), while a
    # disqualified row HAD inputs and failed to reproduce (breakage). Collapsing both into exit 3
    # cost two false CI alarms on 2026-08-09 for a state that resolves itself on the next
    # precompute -- and an instrument that cries wolf gets muted exactly like a guard that does.
    if rep["rows_replayable"] == 0 and rep["disqualified"] > 0:
        rep["verdict"] = "refused_baseline_broken"
        print("REFUSED: %d rows carried inputs and NONE reproduced their persisted score (seen %d)."
              " The replay is no longer the production chain -- a second forecast path, or the"
              " assets/constants moved since these frames were rated. This is blindness, not a"
              " result." % (rep["disqualified"], rep["rows_seen"]))
        return 3
    if rep["rows_replayable"] == 0:
        rep["verdict"] = "not_ready"
        print("NOT READY: 0 of %d rows carry `inputs`, and none were broken -- these frames predate"
              " the inputs persistence, or none of them fell in the sample"
              " (SPOT_RATINGS_INPUTS_SAMPLE_PCT, 5%% by default). NOTHING WAS MEASURED: this is not"
              " a result and not a failure. Re-dispatch after the next precompute cycle."
              % rep["rows_seen"])
        if args.json:
            json.dump(rep, open(args.json, "w", encoding="utf-8"), indent=1)
        return 0
    rep["verdict"] = "measured"

    print("SHADOW A/B  candidate=%s" % candidate)
    print("  rows       seen %d | replayable %d | disqualified %d"
          % (rep["rows_seen"], rep["rows_replayable"], rep["disqualified"]))
    _c = rep["coverage"]
    print("  COVERAGE   %d frames | models %s | hour offsets %s (span %s h) | %s .. %s"
          % (_c["frames"], ",".join(_c["models"]) or "?", _c["hour_offsets"] or "?",
             _c["hour_span"] if _c["hour_span"] is not None else "?",
             _c["valid_time_min"] or "?", _c["valid_time_max"] or "?"))
    # ⭐ THE UNKNOWN SPAN WARNS LOUDER THAN THE NARROW ONE, because it is strictly worse: a 3 h
    # window is at least a MEASURED 3 h, while a missing `hour_offset` means the window was never
    # established and may be a single hour. The original guard read
    # `if hour_span is not None and hour_span <= 6`, so the unknown case fell out of BOTH branches
    # and printed nothing at all -- absence encoded as success, the same shape as the `undefined =>
    # falsy => "AUTHORITATIVE NATIVE"` and `mismatches.length === 0 => pass` defects already on
    # record. It surfaced on 2026-08-12 replaying a single production frame from
    # /api/weather/spot-ratings, which carries `valid_time` but no `hour_offset`: the narrowest
    # sample this harness has ever run drew the quietest coverage line it has ever printed.
    # ⭐⭐ THIS OUTRANKS BOTH SPAN WARNINGS BELOW, so it prints first: a span is a property of what
    # was ASKED FOR, and this is a property of what came BACK. A 12 h span built from 3 distinct
    # served frames is a 3-frame sample wearing a 12-frame label, and neither span branch can see
    # it -- the span was measured correctly.
    _dsf = _c.get("distinct_served_frames")
    if _dsf is not None and _c["frames"] > 1 and _dsf < _c["frames"]:
        print("  ! REPEATED FRAMES  %d frames resolved to only %d distinct served frame(s). The"
              " upstream answered several requested hours with the SAME precompute, so this sample"
              " is narrower than its span suggests. Weight the verdict by %d, not %d."
              % (_c["frames"], _dsf, _dsf, _c["frames"]))
    if _c["hour_span"] is None:
        print("  ! SPAN UNKNOWN  no frame carried `hour_offset`, so the window this sample spans is"
              " UNMEASURED -- it may be a single hour. Treat a null verdict as UNSUPPORTED, not as"
              " 'no effect': this is strictly weaker evidence than the NARROW case below, which at"
              " least knows how wide it is.")
    elif _c["hour_span"] <= 6:
        print("  ! NARROW    this is a %s h window -- a candidate that binds only in some"
              " conditions (a tidal extreme, a big swell) can look quiet here and move plenty"
              " elsewhere. Re-run across a wider span before concluding 'no effect'."
              % _c["hour_span"])
    print("  LEVEL      unchanged %d  up %d  down %d  => %s%% change"
          % (rep["level_unchanged"], rep["level_up"], rep["level_down"], rep["level_change_pct"]))
    print("  delta      p10 %s  median %s  p90 %s  (min %s, max %s)"
          % (rep["delta_p10"], rep["delta_median"], rep["delta_p90"],
             rep["delta_min"], rep["delta_max"]))
    if candidate.get("REFERENCE_LANE") == "cell":
        print("  SCOPE      band-vs-glyph REFERENCE lane only, height held fixed. The band also"
              " samples its height at the 2-deg CELL CENTRE, so this is a LOWER BOUND on the"
              " on-screen divergence.")
    _n = rep["rows_replayable"] or 1
    _ip = rep.get("inputs_present") or {}
    print("  INPUTS     " + " | ".join("%s %d/%d" % (k, v, rep["rows_replayable"])
                                       for k, v in _ip.items()) if _ip else "  INPUTS     (none)")
    for _inf in (rep.get("inferred_deps") or []):
        print("  * INFERRED   every row that moved carries `%s` (%d/%d carrying rows moved,"
              " %.0f%%), and NONE of the %d rows without it moved. The effect is CONFINED to"
              " that input -- read the carrying-row rate, not the headline."
              % (_inf["input"], _inf["moved_with"], _inf["rows_with"], _inf["pct_of_carrying"],
                 _inf["rows_without"]))
    _ds = rep.get("dep_subset")
    if _ds:
        if _ds["rows"] == 0:
            print("  ! BLIND     this candidate is guarded on `%s` and NOT ONE replayable row"
                  " carries it. The verdict above is arithmetic over rows the flag cannot touch."
                  % _ds["input"])
        else:
            print("  DEPENDENCY  guarded on `%s`: %d/%d rows carry it (%.0f%%) -> among THOSE,"
                  " %d changed level (%.1f%%), max |delta| %.1f"
                  % (_ds["input"], _ds["rows"], rep["rows_replayable"],
                     100.0 * _ds["rows"] / _n, _ds["changed"], _ds["pct"], _ds["max_abs_delta"]))
            if _ds["rows"] < rep["rows_replayable"]:
                print("  ! DILUTED   the headline rate averages in %d rows that CANNOT move"
                      " (no `%s`) -- read the dependency line, not the headline."
                      % (rep["rows_replayable"] - _ds["rows"], _ds["input"]))
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
