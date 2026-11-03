"""consensus_product.py — the equal GFS/EURO/ICON mean, built as a GFS waves product (roadmap stage 5, DARK).

WHY. The offshore skill ledger (held-out week, ~2,800 pairs per lead, 2026-09-29) and the nearshore judge agree that
the equal three-model mean is the robust served input: all-sea MAE .282 / .304 / .337 m at 24 / 48 / 72 h against
the served GFS lane's .300 / .329 / .392, and on big swells (>= 3 m) .432 / .432 / .645 against GFS's
.464 / .580 / .872. Every model reads LOW on big days and ICON's high lean cancels part of it, which is why the
GFS+EURO pair (better all-sea) loses big swells at every lead and was rejected. `by_band` (#160), first published
2026-09-29 11Z: equal .501 vs best member .520 on big seas, .342 vs .375 rideable, .251 vs .253 small, and .139 vs
EURO's .136 on flat seas, where the served lane reads .245.

WHAT. build_equal_mean(gfs, euro, icon) returns a COPY of the GFS waves product. At every GFS ocean cell where EURO
and ICON both answer, the cell carries the equal-mean Hs with GFS's own period and direction: the primary's sea
scaled to the consensus height, by `equal_consensus`, the SAME function the judge's consensus arm grades (moved here
from nearshore_validation, which re-exports it). u and v are scaled by Hs_consensus / Hs_gfs, so the direction they
encode is GFS's to the last digit and |(u, v)| is the consensus height. Every other cell is GFS's, unchanged.

  * Members are read with the PRODUCTION PointSampler, the answer /api/weather/point gives at that coordinate. A
    member answered unless its interpolation_method is `unavailable` or `out_of_bounds_fallback`.
  * GFS's own Hs is |(u, v)| at the cell: at a grid node the sampler returns the node's own u and v, so this is the
    number the served /point reads there (the test pins it). Mirror it, never re-derive it.
  * The sampler is memoized per product (sampler.py, 2026-09-29): unmemoized, one sample cost 2.66 ms on a
    5,917-cell Brazil tile, ~25 s per frame for two members; memoized, the frame builds in 0.15 s.
  * `grid.diagnostics["consensus"]` carries the members, their product ids and runs, the cell counts, and the
    consensus / primary height ratio (p10 / median / p90, the ledger's `equal_over_primary` rule): calm seas move
    most (Florida east tile, 06Z 2026-09-29: x1.31 at the median cell, x3.6 at p90), so every build reports it.
  * Refuses (ValueError) unless the inputs are marine waves products from GFS, EURO and ICON at the same valid_time,
    in the same unit, with a GFS grid. The caller keeps the GFS product on a refusal.

CONSENSUS_PERIOD_MEDIAN (DARK, default "0"; 2026-11-02). On, a blended cell's total PERIOD is the MEDIAN of the three
members' periods instead of GFS's own (direction stays GFS's; Hs is still the equal mean). Offline, 74 NDBC buoys,
23,527 h (2026-09-18..11-02, best lead), MAE vs buoy DPD: median 1.481 s, equal mean 1.517 s, GFS alone 1.684 s
(median - mean +0.036 s [+0.019, +0.052], DM/HAC + block bootstrap; no DPD band worse). That median was measured with
ICON's PEAK-period blend (#412). With the ICON member served today (tm10, the energy period) the median is WORSE than
GFS alone on long swell (DPD > 12 s: -0.71 s [-1.00, -0.43]), so the median takes effect ONLY while ICON_PEAK_PERIOD
is also "1" in the building lane; otherwise the build keeps GFS's period, says why in its diagnostics and logs it once.
  * The median needs ALL THREE members' periods at the cell (finite, > 0); a cell missing one keeps GFS's period, and
    a cell the members could not all answer is not blended at all, so no two-member median ever ships as consensus.
  * A median of three IS one member's value (ties included), so no new period is invented.
  * Flag off: every vector and every diagnostics key is byte-identical to the build without the flag.

PURE apart from two call-time flag reads (`period_mode`, once per build). Changes no served number: nothing calls it
until the ingest wiring (PR B, behind CONSENSUS_INGEST) and the owner's flip; the median is a further dark flag on top.
"""
import logging
import math
import os
from typing import Callable, Dict, Optional, Tuple

from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import NormalizedProduct

logger = logging.getLogger(__name__)

CONSENSUS_MEMBERS = ("GFS", "EURO", "ICON")
_NO_ANSWER = frozenset({"unavailable", "out_of_bounds_fallback"})

PERIOD_MEDIAN_FLAG = "CONSENSUS_PERIOD_MEDIAN"
ICON_PEAK_FLAG = "ICON_PEAK_PERIOD"     # gwam_peak_period.FLAG (that module is imported by path; a test pins the name)
_PERIOD_MODES = ("primary", "median")
_SKIP_LOGGED = set()


def period_mode() -> Tuple[str, Optional[str]]:
    """(mode, skipped_reason), read at call time. ("median", None) only when CONSENSUS_PERIOD_MEDIAN and
    ICON_PEAK_PERIOD are both "1"; ("primary", reason) when the median was asked for but ICON still serves tm10;
    ("primary", None) when the flag is off (the default)."""
    if os.environ.get(PERIOD_MEDIAN_FLAG, "0") != "1":
        return "primary", None
    if os.environ.get(ICON_PEAK_FLAG, "0") != "1":
        return "primary", (f"{ICON_PEAK_FLAG} is off: the ICON member is tm10, and the tm10 median is worse than GFS "
                           "alone on DPD > 12 s; flip ICON_PEAK_PERIOD first")
    return "median", None


def _member_median_tp(members: dict) -> Optional[float]:
    """The median of the three members' periods, or None unless all three are finite and > 0. PURE."""
    tps = []
    for m in CONSENSUS_MEMBERS:
        try:
            t = float((members.get(m) or {}).get("tp"))
        except (TypeError, ValueError):
            return None
        if not math.isfinite(t) or t <= 0:
            return None
        tps.append(t)
    return sorted(tps)[1]


def equal_consensus(members: dict, required=CONSENSUS_MEMBERS, period: Optional[str] = None):
    """The equal mean of the `required` members' offshore Hs at one spot and hour, carrying the PRIMARY's (GFS, the
    served lane) period and direction: the ingest-time design, the primary's sea scaled to the consensus height.
    None unless EVERY required member answered, so an arm is always its full equal mean (the ledger's pairing rule)
    and never a smaller mean under the same name.
    `period`: "primary" (GFS's) or "median" (CONSENSUS_PERIOD_MEDIAN: the three members' median period, only for the
    full three-member set and only where all three periods are valid, else GFS's; the result then carries
    `tp_from`). None reads `period_mode()` at call time, so the judge's arm follows the same flag. PURE otherwise."""
    if period is None:
        period = period_mode()[0]
    if period not in _PERIOD_MODES:
        raise ValueError(f"consensus: period must be one of {_PERIOD_MODES}, got {period!r}")
    if not isinstance(members, dict) or "GFS" not in required:
        return None
    vals = []
    for m in required:
        a = members.get(m) or {}
        try:
            v = float(a.get("hs"))
        except (TypeError, ValueError):
            return None
        if not math.isfinite(v) or v < 0:
            return None
        vals.append(v)
    p = members["GFS"]
    if p.get("tp") is None or p.get("dir") is None:
        return None
    out = {"hs": sum(vals) / len(vals), "tp": float(p["tp"]), "dir": float(p["dir"])}
    if period == "median" and tuple(required) == CONSENSUS_MEMBERS:
        med = _member_median_tp(members)
        out["tp_from"] = "primary" if med is None else "median"
        if med is not None:
            out["tp"] = med
    return out


def member_answer(sampler: PointSampler, product: NormalizedProduct, lat: float, lng: float) -> Optional[dict]:
    """{hs, tp, dir} a member's served /point gives at (lat, lng), or None when it cannot answer there."""
    pt = sampler.sample_point(product, lat, lng).point
    if pt is None or pt.interpolation_method in _NO_ANSWER:
        return None
    return {"hs": pt.speed, "tp": pt.period, "dir": pt.direction}


def _iso(t) -> Optional[str]:
    return t.isoformat() if t is not None else None


def _identity(p: NormalizedProduct) -> dict:
    return {"product_id": p.product_id, "run_time": _iso(p.run_time), "model_run_time": _iso(p.model_run_time),
            "upstream_model": p.upstream_model}


def _check_primary(gfs: NormalizedProduct) -> None:
    if gfs is None or gfs.grid is None or not gfs.grid.vectors:
        raise ValueError("consensus: the GFS product has no grid")
    _check_lane("GFS", gfs, gfs, strict_time=True)


def _check_lane(name: str, p: NormalizedProduct, gfs: NormalizedProduct, strict_time: bool) -> None:
    if p is None:
        raise ValueError(f"consensus: {name} product missing")
    if (p.model or "").upper() != name:
        raise ValueError(f"consensus: expected a {name} product, got {p.model!r}")
    if (p.domain or "").lower() != "marine" or (p.layer or "").lower() != "waves":
        raise ValueError(f"consensus: {name} is {p.domain}/{p.layer}, not marine/waves")
    if strict_time and p.valid_time != gfs.valid_time:
        raise ValueError(f"consensus: {name} valid_time {_iso(p.valid_time)} != GFS {_iso(gfs.valid_time)}")
    if p.value_unit != gfs.value_unit:
        raise ValueError(f"consensus: {name} unit {p.value_unit!r} != GFS {gfs.value_unit!r}")


def _check(gfs: NormalizedProduct, members: Dict[str, NormalizedProduct]) -> None:
    _check_primary(gfs)
    for name, p in members.items():
        _check_lane(name, p, gfs, strict_time=True)


def _ratio_quantiles(ratios) -> Optional[dict]:
    """p10 / median / p90 by the ledger's `equal_over_primary` index rule (skill_consensus._graded_groups)."""
    if not ratios:
        return None
    r = sorted(ratios)
    return {"p10": round(r[len(r) // 10], 3), "median": round(r[len(r) // 2], 3),
            "p90": round(r[min(len(r) - 1, 9 * len(r) // 10)], 3)}


def build_equal_mean(gfs: NormalizedProduct, euro: NormalizedProduct, icon: NormalizedProduct,
                     sampler: Optional[PointSampler] = None, unblended: str = "keep") -> NormalizedProduct:
    """A copy of `gfs` carrying the equal GFS/EURO/ICON mean wherever all three answer (module docstring). PURE."""
    others = {"EURO": euro, "ICON": icon}
    _check(gfs, others)
    out = _build(gfs, {n: (lambda lat, lng, p=p: p) for n, p in others.items()}, sampler, unblended)
    out.grid.diagnostics["consensus"]["member_products"] = {
        "GFS": _identity(gfs), **{n: _identity(p) for n, p in others.items()}}
    return out


def build_equal_mean_from_choosers(gfs: NormalizedProduct, choosers: Dict[str, Callable],
                                   sampler: Optional[PointSampler] = None,
                                   unblended: str = "keep") -> NormalizedProduct:
    """The same equal mean, each member answered at each cell by the product `choosers[name](lat, lng)` returns:
    the product the point resolver itself would answer that cell from (consensus_ingest builds the choosers on
    manifest_point_selection), so the member value is what /point serves there. That pick may be a frame up to
    the resolver's MAX_TIME_DIFF_S from the GFS hour, exactly as /point would serve it; such cells are counted in
    `member_frame_offset_cells`. A chooser that returns None means the member cannot answer the cell. PURE given
    pure choosers."""
    _check_primary(gfs)
    if set(choosers) != {"EURO", "ICON"}:
        raise ValueError(f"consensus: choosers for EURO and ICON required, got {sorted(choosers)}")
    return _build(gfs, choosers, sampler, unblended)


def _build(gfs: NormalizedProduct, choosers: Dict[str, Callable], sampler: Optional[PointSampler],
           unblended: str) -> NormalizedProduct:
    """The cell loop behind both entry points. `unblended`: "keep" leaves a cell the members could not all
    answer as GFS's own; "mask" marks it invalid, so a SHADOW product (D-009) never serves a GFS-only value under
    the consensus name."""
    if unblended not in ("keep", "mask"):
        raise ValueError(f"consensus: unblended must be 'keep' or 'mask', got {unblended!r}")
    sampler = sampler or PointSampler(memoize=True)
    mode, skipped = period_mode()
    if skipped and skipped not in _SKIP_LOGGED:
        _SKIP_LOGGED.add(skipped)
        logger.warning("[Consensus] %s requested but skipped: %s", PERIOD_MEDIAN_FLAG, skipped)
    period_cells = {"median": 0, "primary_fallback": 0}
    out = gfs.model_copy(deep=True)
    cells = {"blended": 0, "kept_primary": 0, "not_ocean": 0}
    missing = {name: 0 for name in choosers}
    sources = {name: {} for name in choosers}
    offsets = {name: 0 for name in choosers}
    checked = set()
    primary_zero = masked = 0
    ratios = []
    for vec in out.grid.vectors:
        if not sampler._is_vector_valid(vec, gfs.domain, gfs.layer):
            cells["not_ocean"] += 1
            continue
        hs_primary = math.hypot(vec.u, vec.v)
        members = {"GFS": {"hs": hs_primary, "tp": vec.period, "dir": vec.direction}}
        for name, choose in choosers.items():
            product = choose(vec.lat, vec.lng)
            answer = None
            if product is not None:
                if id(product) not in checked:
                    _check_lane(name, product, gfs, strict_time=False)
                    checked.add(id(product))
                answer = member_answer(sampler, product, vec.lat, vec.lng)
            if answer is None:
                missing[name] += 1
                continue
            members[name] = answer
            pid = product.product_id or "?"
            sources[name][pid] = sources[name].get(pid, 0) + 1
            offsets[name] += product.valid_time != gfs.valid_time
        c = equal_consensus(members, period=mode)
        if c is None or not hs_primary > 0:     # a member did not answer, or GFS has no sea here to scale
            primary_zero += c is not None
            cells["kept_primary"] += 1
            if unblended == "mask":
                vec.is_valid = False
                masked += 1
            continue
        k = c["hs"] / hs_primary
        vec.u, vec.v, vec.speed = round(vec.u * k, 4), round(vec.v * k, 4), round(c["hs"], 4)
        if mode == "median":
            period_cells["median" if c["tp_from"] == "median" else "primary_fallback"] += 1
            if c["tp"] != vec.period:
                vec.period = round(c["tp"], 4)
        cells["blended"] += 1
        ratios.append(k)
    out.grid.diagnostics = {**(gfs.grid.diagnostics or {}), "consensus": {
        "method": "equal_mean", "members": list(CONSENSUS_MEMBERS), "carried_from_primary": ["period", "direction"],
        "valid_time": _iso(gfs.valid_time), "primary_product": _identity(gfs),
        "cells": cells, "member_missing": missing, "primary_zero": primary_zero,
        "unblended": unblended, "masked": masked,
        "member_sources": sources, "member_frame_offset_cells": offsets,
        "consensus_over_primary": _ratio_quantiles(ratios)}}
    if mode == "median":     # metadata changes ONLY with the flag: off, the diagnostics are byte-identical
        out.grid.diagnostics["consensus"]["carried_from_primary"] = ["direction"]
        out.grid.diagnostics["consensus"]["period"] = {
            "method": "member_median", "flag": PERIOD_MEDIAN_FLAG, "members": list(CONSENSUS_MEMBERS),
            "cells": period_cells}
    elif skipped:
        out.grid.diagnostics["consensus"]["period"] = {
            "method": "primary", "flag": PERIOD_MEDIAN_FLAG, "median_skipped": skipped}
    return out
