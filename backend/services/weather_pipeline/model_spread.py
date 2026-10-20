"""model_spread.py — per-node GFS/EURO/ICON disagreement on the world wave field (DATA ONLY, dark, 2026-10-19).

WHY. A 2026-10-20 outside cross-check of the served GFS-Wave world field agreed within 3% in calm swell but differed
by 29% in a Southern Ocean storm and 37% at a typhoon (where an ensemble's own confidence read 47%). So a model-spread
confidence layer matters most exactly where heights are largest. Reflection reviewed the plan and advised collecting
the spread DATA first, before any UI, so the layer's thresholds are later set from a distribution, not a guess.

WHAT. For one valid time at which GFS, EURO and ICON all have an authoritative (not estimated) `global_mid` marine
waves product, on the GFS `global_mid` lattice (the common grid: ~2 deg, the world view's field), per node:

    mean, min, max       of the three members' significant wave height (m)
    spread = max - min   (m)
    cv = std / mean      population std of the three (ddof 0); None where mean == 0

Each member's value at a node is `consensus_product.member_answer`: what that member's served /point answers at that
coordinate (the production PointSampler, memoized per product). That is the same read the CONSENSUS shadow blends,
so the spread is the disagreement BETWEEN the numbers the consensus averages. A node counts only where GFS has a
valid ocean vector and every member answers; anything else is counted, never filled.

  * Estimated products are excluded on purpose: the EURO/ICON extension tails past a model's native horizon are
    built from other models (icon_marine_extension, the EURO estimated tail), so their agreement would be manufactured.
  * The member pick per (model, valid time) is the latest run's product, the manifest's own `run_time`.

PURE: no I/O and no environment reads. Serves nothing and draws nothing; the only caller is
scripts/publish_model_spread.py, run in forecast-ingest.yml behind the repository variable MODEL_SPREAD_PUBLISH.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Dict, Iterable, List, Optional

from services.weather_pipeline.consensus_product import (
    CONSENSUS_MEMBERS, _check_lane, _check_primary, _identity, member_answer)
from services.weather_pipeline.sampler import PointSampler

SPREAD_MEMBERS = CONSENSUS_MEMBERS          # ("GFS", "EURO", "ICON"): the members the consensus averages
TIER = "global_mid"
VERSION = 1
HS_DECIMALS = 3                             # mm: the stored products carry 4, every reader of this needs far less
CV_DECIMALS = 4


def node_stats(values: List[float]) -> dict:
    """mean / min / max / spread / cv of one node's member heights. PURE.

    cv is the population coefficient of variation (std with ddof 0 over the members, divided by the mean): with
    three members ddof 1 would inflate it by sqrt(3/2) and make it disagree with `spread` about what "agree" means.
    None where the mean is 0 (calm water with every member at 0 has no relative disagreement to report)."""
    n = len(values)
    if n == 0:
        raise ValueError("model_spread: no member values")
    lo, hi = min(values), max(values)
    if hi == lo:        # members agree exactly: say so exactly (a float mean of 3 x 0.8 is 0.8000000000000002)
        return {"mean": lo, "min": lo, "max": hi, "spread": 0.0, "cv": 0.0 if lo > 0 else None}
    mean = math.fsum(values) / n
    std = math.sqrt(math.fsum((v - mean) ** 2 for v in values) / n)
    return {"mean": mean, "min": lo, "max": hi, "spread": hi - lo, "cv": (std / mean) if mean > 0 else None}


def _latest_authoritative(manifest, model: str, tier: str) -> Dict[datetime, object]:
    """{valid_time_start: the manifest item of `model`'s latest run there}, authoritative global tier items only."""
    from services.weather_pipeline.manifest_view import products_for
    out: Dict[datetime, object] = {}
    for p in products_for(manifest, model, "marine", "waves"):
        if p.region_id != tier or p.is_estimated or p.is_test_fixture or not p.filename:
            continue
        cur = out.get(p.valid_time_start)
        if cur is None or p.run_time > cur.run_time:
            out[p.valid_time_start] = p
    return out


def aligned_frames(manifest, tier: str = TIER, members=SPREAD_MEMBERS) -> Dict[datetime, Dict[str, object]]:
    """{valid_time: {model: manifest item}} for every valid time at which EVERY member has an authoritative `tier`
    product. PURE."""
    per = {m: _latest_authoritative(manifest, m, tier) for m in members}
    common = set.intersection(*(set(v) for v in per.values())) if per else set()
    return {vt: {m: per[m][vt] for m in members} for vt in sorted(common)}


def lead_hours(item) -> float:
    return (item.valid_time_start - item.run_time).total_seconds() / 3600.0


def select_frames(aligned: Dict[datetime, Dict[str, object]], step_h: int, max_frames: int) -> List[datetime]:
    """The valid times to build: GFS lead >= 0 and a whole multiple of `step_h` (lead 0, 24, 48 ... at the default),
    earliest first, at most `max_frames`. Bounded on purpose: three ~1.7 MB products per frame, and the 4-hourly
    cycle must stay seconds, not minutes. PURE."""
    if step_h <= 0 or max_frames <= 0:
        return []
    out = []
    for vt in sorted(aligned):
        lead = lead_hours(aligned[vt]["GFS"])
        if lead >= 0 and abs(lead / step_h - round(lead / step_h)) < 1e-6:
            out.append(vt)
        if len(out) >= max_frames:
            break
    return out


def _round(x: Optional[float], nd: int) -> Optional[float]:
    return None if x is None else round(x, nd)


def build_spread(gfs, members: Dict[str, object], sampler: Optional[PointSampler] = None) -> dict:
    """The spread frame for one valid time: per-node arrays over the GFS lattice (module docstring). `members` maps
    EURO and ICON to their products. Refuses (ValueError) unless all three are marine waves at the same valid time
    in the same unit, with a GFS grid (consensus_product's own checks). PURE."""
    _check_primary(gfs)
    if set(members) != set(SPREAD_MEMBERS) - {"GFS"}:
        raise ValueError(f"model_spread: EURO and ICON required, got {sorted(members)}")
    for name, p in members.items():
        _check_lane(name, p, gfs, strict_time=True)
    sampler = sampler or PointSampler(memoize=True)
    products = {"GFS": gfs, **members}
    cols = {k: [] for k in ("lat", "lng", "mean", "min", "max", "spread", "cv")}
    counts = {"lattice_nodes": len(gfs.grid.vectors), "not_ocean": 0, "member_missing": {m: 0 for m in products},
              "nodes": 0}
    worst = None
    for vec in gfs.grid.vectors:
        if not sampler._is_vector_valid(vec, gfs.domain, gfs.layer):
            counts["not_ocean"] += 1
            continue
        vals, ok = [], True
        for name in SPREAD_MEMBERS:
            a = member_answer(sampler, products[name], vec.lat, vec.lng)
            hs = None if a is None else a.get("hs")
            if hs is None or not math.isfinite(float(hs)) or float(hs) < 0:
                counts["member_missing"][name] += 1
                ok = False
                break
            vals.append(float(hs))
        if not ok:
            continue
        s = node_stats(vals)
        cols["lat"].append(round(vec.lat, 4))
        cols["lng"].append(round(vec.lng, 4))
        for k in ("mean", "min", "max", "spread"):
            cols[k].append(round(s[k], HS_DECIMALS))
        cols["cv"].append(_round(s["cv"], CV_DECIMALS))
        counts["nodes"] += 1
        if worst is None or s["spread"] > worst["spread"]:
            worst = {"lat": vec.lat, "lng": vec.lng, **{k: round(v, HS_DECIMALS) for k, v in s.items() if k != "cv"},
                     "cv": _round(s["cv"], CV_DECIMALS),
                     "members": dict(zip(SPREAD_MEMBERS, (round(v, HS_DECIMALS) for v in vals)))}
    return {
        "version": VERSION, "kind": "model_spread", "field": "marine/waves/significant_wave_height",
        "tier": gfs.region_id or TIER, "unit": gfs.value_unit, "valid_time": _iso(gfs.valid_time),
        "lead_h": round((gfs.valid_time - gfs.run_time).total_seconds() / 3600.0, 2),
        "grid": {"lattice": "GFS " + (gfs.region_id or TIER), "cols": gfs.grid.cols, "rows": gfs.grid.rows,
                 "bounds": gfs.grid.bounds.model_dump() if gfs.grid.bounds is not None else None},
        "members": {m: _identity(p) for m, p in products.items()},
        "member_read": "consensus_product.member_answer (the served /point answer at the node)",
        "cv_definition": "population std (ddof 0) of the members / their mean; null where the mean is 0",
        "counts": counts, "max_spread_node": worst, "summary": frame_summary(cols),
        "nodes": cols,
    }


def _iso(t) -> Optional[str]:
    return t.isoformat() if t is not None else None


def _q(sorted_vals: List[float], q: float) -> Optional[float]:
    """The ledger's index quantile rule (consensus_product._ratio_quantiles): sorted[int(q * n)], clamped."""
    if not sorted_vals:
        return None
    return sorted_vals[min(len(sorted_vals) - 1, int(q * len(sorted_vals)))]


def frame_summary(cols: dict) -> dict:
    """A frame's one-line digest for the index: node count, spread median / p90 / max, cv median / p90. PURE."""
    sp = sorted(cols["spread"])
    cv = sorted(c for c in cols["cv"] if c is not None)
    r = lambda x, nd=HS_DECIMALS: None if x is None else round(x, nd)  # noqa: E731
    return {"nodes": len(sp), "spread_median": r(_q(sp, 0.5)), "spread_p90": r(_q(sp, 0.9)),
            "spread_max": r(sp[-1] if sp else None), "cv_median": r(_q(cv, 0.5), CV_DECIMALS),
            "cv_p90": r(_q(cv, 0.9), CV_DECIMALS)}


def decile_report(frames: Iterable[dict]) -> List[dict]:
    """The spread distribution by MEAN-height decile, pooled over every node of `frames`: one row per decile with
    its height range, node count, spread median / p90, relative spread (spread / mean) median and cv median / p90,
    plus a "top 1%" row (the highest 1% of mean heights, which decile 10 also contains). Deciles by the same index
    rule as `frame_summary`; a decile's lower edge is inclusive. PURE."""
    rows = []
    for f in frames:
        n = f["nodes"]
        rows.extend(zip(n["mean"], n["spread"], n["cv"]))
    if not rows:
        return []
    rows.sort(key=lambda t: t[0])
    total, out = len(rows), []
    # Ten deciles, then the top 1% again on its own: storms are a few percent of the world's sea nodes, so inside
    # decile 10 they move only its p90. The tail row is where the 29-37% storm disagreement has to show.
    for d, part in [(d + 1, rows[d * total // 10:(d + 1) * total // 10]) for d in range(10)] + [
            ("top 1%", rows[min(total - 1, 99 * total // 100):])]:
        if not part:
            continue
        sp = sorted(p[1] for p in part)
        rel = sorted(p[1] / p[0] for p in part if p[0] > 0)
        cv = sorted(p[2] for p in part if p[2] is not None)
        out.append({"decile": d, "hs_lo": part[0][0], "hs_hi": part[-1][0], "n": len(part),
                    "spread_median": _q(sp, 0.5), "spread_p90": _q(sp, 0.9),
                    "rel_spread_median": None if not rel else round(_q(rel, 0.5), CV_DECIMALS),
                    "cv_median": _q(cv, 0.5), "cv_p90": _q(cv, 0.9)})
    return out


def report_markdown(rows: List[dict], title: str) -> str:
    """The decile report as a Markdown table (the Actions step summary and the PR evidence). PURE."""
    f = lambda x, nd=2: "-" if x is None else f"{x:.{nd}f}"  # noqa: E731
    lines = [f"### {title}", "",
             "| decile | mean Hs (m) | nodes | spread median (m) | spread p90 (m) | spread/mean median "
             "| cv median | cv p90 |",
             "|---:|---|---:|---:|---:|---:|---:|---:|"]
    for r in rows:
        lines.append(f"| {r['decile']} | {f(r['hs_lo'])} - {f(r['hs_hi'])} | {r['n']} | {f(r['spread_median'])} | "
                     f"{f(r['spread_p90'])} | {f(r['rel_spread_median'], 3)} | {f(r['cv_median'], 3)} | "
                     f"{f(r['cv_p90'], 3)} |")
    return "\n".join(lines) + "\n"
