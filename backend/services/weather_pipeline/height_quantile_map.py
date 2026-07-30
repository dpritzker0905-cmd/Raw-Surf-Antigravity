"""Empirical quantile mapping for the offshore height input — the fitter and the applier.

THE DEFECT THIS CORRECTS (measured 2026-07-30, 1,913 residuals / 60 NDBC buoys, stratified on the
OBSERVED height): the offshore input COMPRESSES — +0.355 m at 0-0.5 m, +0.236 at 0.5-1.0,
-0.024 at 1.0-1.5, -0.175 at 1.5-2.5, -0.363 at 2.5-10 m — while the aggregate (+0.107 m) hides
all of it. A mean or delta correction cannot fix a compressed DISTRIBUTION; quantile mapping is
the published remedy (QDM reduces wave RMSE 0.6-11% in the literature).

THE ONE RULE THAT DECIDES WHETHER THIS WORKS: `n` is rows, `n_buoys` is INDEPENDENCE. A band is
fitted only when both are healthy (MIN_ROWS_TO_FIT / MIN_BUOYS_TO_FIT, shared with the archive's
own reporting); everything outside the fitted domain stays on the IDENTITY map with a continuous
blend at the edges. Fitting the 2.5-10 m band on 8 buoys would not correct big-wave behaviour, it
would invent it — the tails wait for the history archive to deepen (EGQM/Gumbel when attacked).

The blob is versioned and self-describing; `apply_height_quantile_map` is pure and cheap (bisect).
Nothing in the engine reads it yet — wiring the correction into the ONE offshore-Hs injection
point is a separate, A/B-measured change (HEIGHT_QUANTILE_MAP, default off).
"""
import bisect
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from services.weather_pipeline.buoy_calibration import (
    HEIGHT_BANDS, MIN_BUOYS_TO_FIT, MIN_ROWS_TO_FIT, stratified_height_bias,
)

logger = logging.getLogger(__name__)

QUANTILE_MAP_L2_KEY = "calibration/height_quantile_map.json"
BLEND_MARGIN_M = 0.25   # identity is reached this far outside the fitted model-value domain
_KNOT_PERCENTILES = [p / 100.0 for p in range(5, 100, 5)]  # 5%..95% step 5


def _quantile(sorted_vals: Sequence[float], q: float) -> float:
    """Linear-interpolated quantile on a pre-sorted sequence (numpy-free; CI runs without it)."""
    n = len(sorted_vals)
    if n == 1:
        return float(sorted_vals[0])
    pos = q * (n - 1)
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return float(sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac)


def fittable_bands(rows) -> List[Tuple[float, float]]:
    """The observed-height bands with BOTH enough rows and enough independent buoys."""
    out = []
    for band in stratified_height_bias(rows):
        if band["n"] >= MIN_ROWS_TO_FIT and band["n_buoys"] >= MIN_BUOYS_TO_FIT:
            out.append((band["band_lo_m"], band["band_hi_m"]))
    return out


def fit_height_quantile_map(rows, now: Optional[datetime] = None) -> Optional[Dict]:
    """Fit EQM over the rows whose OBSERVED height falls in a fittable band. Returns the versioned
    blob, or None when nothing is fittable. Pure."""
    bands = fittable_bands(rows)
    if not bands:
        return None
    pool = [
        r for r in rows
        if isinstance(r.get("buoy_wvht_m"), (int, float))
        and isinstance(r.get("model_hs_m"), (int, float))
        and r["model_hs_m"] > 0.0
        and any(lo <= r["buoy_wvht_m"] < hi for lo, hi in bands)
    ]
    if len(pool) < MIN_ROWS_TO_FIT:
        return None
    model_sorted = sorted(r["model_hs_m"] for r in pool)
    obs_sorted = sorted(r["buoy_wvht_m"] for r in pool)

    knots: List[Tuple[float, float]] = []
    for q in _KNOT_PERCENTILES:
        x = round(_quantile(model_sorted, q), 4)
        y = round(_quantile(obs_sorted, q), 4)
        if knots and x <= knots[-1][0]:
            # Duplicate/regressive x (ties in the model distribution): keep the map single-valued
            # by averaging the target — quantiles guarantee y is non-decreasing, so monotonicity
            # in y is preserved.
            px, py = knots[-1]
            knots[-1] = (px, round((py + y) / 2.0, 4))
            continue
        knots.append((x, y))
    if len(knots) < 3:
        return None

    per_buoy: Dict[str, int] = {}
    for r in pool:
        per_buoy[r.get("buoy_id")] = per_buoy.get(r.get("buoy_id"), 0) + 1
    counts = sorted(per_buoy.values())

    # Per-side blend margins, scaled to the edge correction: a fixed margin smaller than the
    # correction makes the identity blend FOLD BACK (slope 1 + corr/margin < 0 when corr < -margin)
    # — caught by the monotonicity test on the first fit. 2x the correction keeps slope ≥ 0.5.
    corr_lo = knots[0][1] - knots[0][0]
    corr_hi = knots[-1][1] - knots[-1][0]
    margin_lo = round(max(BLEND_MARGIN_M, 2.0 * abs(corr_lo)), 4)
    margin_hi = round(max(BLEND_MARGIN_M, 2.0 * abs(corr_hi)), 4)

    blob = {
        "version": 1,
        "kind": "height_eqm",
        "fitted_at": (now or datetime.now(timezone.utc)).isoformat(),
        "source": "calibration/buoy_residual_archive.json",
        "domain_m": [knots[0][0], knots[-1][0]],
        "blend_margin_lo_m": margin_lo,
        "blend_margin_hi_m": margin_hi,
        "knots": [[x, y] for x, y in knots],
        "n_rows": len(pool),
        "n_buoys": len(per_buoy),
        "rows_per_buoy": {"min": counts[0], "median": counts[len(counts) // 2], "max": counts[-1]},
        "bands_fitted": [[lo, hi] for lo, hi in bands],
    }
    blob["per_band"] = evaluate_per_band(rows, blob)
    return blob


def apply_height_quantile_map(x: float, blob: Optional[Dict]) -> float:
    """Corrected offshore height for model value x. Identity outside the fitted domain (with a
    continuous linear blend over blend_margin_m), identity on any malformed blob. Pure, monotone."""
    if not blob or not isinstance(x, (int, float)) or x <= 0.0:
        return x
    knots = blob.get("knots") or []
    if len(knots) < 2:
        return x
    margin_lo = float(blob.get("blend_margin_lo_m", blob.get("blend_margin_m", BLEND_MARGIN_M)))
    margin_hi = float(blob.get("blend_margin_hi_m", blob.get("blend_margin_m", BLEND_MARGIN_M)))
    xs = [k[0] for k in knots]
    lo, hi = xs[0], xs[-1]

    def _interp(v: float) -> float:
        i = bisect.bisect_right(xs, v)
        if i <= 0:
            return knots[0][1]
        if i >= len(xs):
            return knots[-1][1]
        x0, y0 = knots[i - 1]
        x1, y1 = knots[i]
        f = (v - x0) / (x1 - x0) if x1 > x0 else 0.0
        return y0 + f * (y1 - y0)

    if lo <= x <= hi:
        return round(_interp(v=x), 4)
    if x < lo:
        if x <= lo - margin_lo or margin_lo <= 0.0:
            return x
        w = (x - (lo - margin_lo)) / margin_lo   # 0 at the identity edge, 1 at the domain edge
        return round((1.0 - w) * x + w * (x + (knots[0][1] - lo)), 4)
    if x >= hi + margin_hi or margin_hi <= 0.0:
        return x
    w = ((hi + margin_hi) - x) / margin_hi       # 1 at the domain edge, 0 at the identity edge
    return round((1.0 - w) * x + w * (x + (knots[-1][1] - hi)), 4)


def evaluate_per_band(rows, blob) -> List[Dict]:
    """Before/after bias+MAE per OBSERVED band. ⚠️ Never judge this on the aggregate — a near-zero
    aggregate over a compressing model is the trap the stratification exists to expose."""
    out = []
    for lo, hi in HEIGHT_BANDS:
        band_rows = [
            r for r in rows or []
            if isinstance(r.get("buoy_wvht_m"), (int, float))
            and isinstance(r.get("model_hs_m"), (int, float))
            and lo <= r["buoy_wvht_m"] < hi
        ]
        entry = {"band_lo_m": lo, "band_hi_m": hi, "n": len(band_rows),
                 "n_buoys": len({r.get("buoy_id") for r in band_rows})}
        if band_rows:
            before = [r["model_hs_m"] - r["buoy_wvht_m"] for r in band_rows]
            after = [apply_height_quantile_map(r["model_hs_m"], blob) - r["buoy_wvht_m"]
                     for r in band_rows]
            entry["before"] = {"bias_m": round(sum(before) / len(before), 4),
                               "mae_m": round(sum(abs(e) for e in before) / len(before), 4)}
            entry["after"] = {"bias_m": round(sum(after) / len(after), 4),
                              "mae_m": round(sum(abs(e) for e in after) / len(after), 4)}
        out.append(entry)
    return out
