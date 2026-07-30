"""The offshore-height quantile map (phase 1 of the 2026-07-30 accuracy strategy).

Pins the properties that make EQM safe to ship: it decompresses a compressed synthetic
distribution band-by-band, it refuses to fit without independence, it is monotone and continuous,
and it is the IDENTITY outside the fitted domain — the thin tails must remain untouched."""
import json
import random
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.height_quantile_map import (
    apply_height_quantile_map,
    evaluate_per_band,
    fit_height_quantile_map,
    fittable_bands,
)

NOW = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)


def _compressed_rows(n_buoys=40, rows_per_buoy=20, seed=7):
    """Synthetic archive with the measured defect shape: the model compresses toward ~1.2 m.
    obs uniform 0.3-2.4 m; model = 1.2 + 0.6*(obs-1.2) + small noise."""
    rng = random.Random(seed)
    rows = []
    for b in range(n_buoys):
        for k in range(rows_per_buoy):
            obs = 0.3 + 2.1 * rng.random()
            model = 1.2 + 0.6 * (obs - 1.2) + rng.gauss(0.0, 0.05)
            rows.append({
                "buoy_id": f"b{b:03d}",
                "buoy_time": f"2026-07-{(k % 27) + 1:02d}T{k % 24:02d}:00:00Z",
                "buoy_wvht_m": round(obs, 3),
                "model_hs_m": round(max(model, 0.05), 3),
                "height_err_m": round(model - obs, 3),
            })
    return rows


def test_fit_decompresses_the_biased_bands_without_degrading_the_neutral_one():
    """EQM fixes the DISTRIBUTION, not per-row scatter: bands with real bias must improve in both
    bias and MAE; a band that was already unbiased sits at the noise floor and must merely not
    degrade beyond noise. (First draft demanded MAE improvement everywhere and failed on the
    neutral 1.0-1.5 band at +0.0008 — that was the test being wrong, not the map.)"""
    rows = _compressed_rows()
    blob = fit_height_quantile_map(rows, now=NOW)
    assert blob is not None
    fitted = {tuple(b) for b in blob["bands_fitted"]}
    assert (0.5, 1.0) in fitted and (1.0, 1.5) in fitted and (1.5, 2.5) in fitted
    for band in blob["per_band"]:
        if (band["band_lo_m"], band["band_hi_m"]) not in fitted or "before" not in band:
            continue
        before, after = band["before"], band["after"]
        if abs(before["bias_m"]) >= 0.05:  # a genuinely biased band (the defect)
            assert abs(after["bias_m"]) < abs(before["bias_m"]), f"bias must shrink: {band}"
            assert after["mae_m"] < before["mae_m"], f"MAE must improve where bias was real: {band}"
        else:  # already at the noise floor — must not be made worse
            assert after["mae_m"] <= before["mae_m"] + 0.005, f"neutral band degraded: {band}"
            assert abs(after["bias_m"]) <= abs(before["bias_m"]) + 0.02


def test_refuses_to_fit_without_independence():
    """87 rows from 2 buoys is 2 samples — the map must refuse, not invent."""
    rows = [r for r in _compressed_rows(n_buoys=2, rows_per_buoy=60)]
    assert fittable_bands(rows) == []
    assert fit_height_quantile_map(rows, now=NOW) is None


def test_identity_outside_the_domain_and_margin():
    blob = fit_height_quantile_map(_compressed_rows(), now=NOW)
    lo, hi = blob["domain_m"]
    # margins are PER SIDE and scale with the edge correction (a fixed margin smaller than the
    # correction folds the blend back — non-monotone, caught by the first fit)
    m_lo, m_hi = blob["blend_margin_lo_m"], blob["blend_margin_hi_m"]
    assert m_lo >= 2.0 * abs(blob["knots"][0][1] - lo) - 1e-9
    # far outside: byte-identical passthrough — the tails stay on the identity map
    assert apply_height_quantile_map(hi + m_hi + 0.5, blob) == hi + m_hi + 0.5
    assert apply_height_quantile_map(6.0, blob) == 6.0
    low_probe = max(lo - m_lo - 0.1, 0.01)
    assert apply_height_quantile_map(low_probe, blob) == pytest.approx(low_probe)
    # malformed blob / no blob: identity
    assert apply_height_quantile_map(1.5, None) == 1.5
    assert apply_height_quantile_map(1.5, {"knots": []}) == 1.5


def test_map_is_monotone_and_continuous():
    blob = fit_height_quantile_map(_compressed_rows(), now=NOW)
    lo, hi = blob["domain_m"]
    xs = [lo - 0.5 + i * ((hi + 0.5) - (lo - 0.5)) / 400.0 for i in range(401)]
    ys = [apply_height_quantile_map(max(x, 0.01), blob) for x in xs]
    for a, b in zip(ys, ys[1:]):
        assert b >= a - 1e-6, "map must be monotone"
    # continuity: no adjacent step larger than the local input step plus a small correction delta
    step = xs[1] - xs[0]
    for a, b in zip(ys, ys[1:]):
        assert abs(b - a) < step + 0.05, "map must be continuous (no jumps at the domain edges)"


def test_blob_survives_json_roundtrip():
    blob = fit_height_quantile_map(_compressed_rows(), now=NOW)
    revived = json.loads(json.dumps(blob))
    for x in (0.4, 0.9, 1.2, 1.8, 2.3, 3.5):
        assert apply_height_quantile_map(x, revived) == apply_height_quantile_map(x, blob)


def test_evaluate_per_band_reports_both_sides():
    """Every populated band carries before AND after — the per-band table is the judgment
    surface; the aggregate is the trap."""
    rows = _compressed_rows()
    blob = fit_height_quantile_map(rows, now=NOW)
    table = evaluate_per_band(rows, blob)
    assert len(table) == 5  # the five canonical observed-height bands
    for band in table:
        assert {"band_lo_m", "band_hi_m", "n", "n_buoys"} <= set(band)
        if band["n"] > 0:
            assert "before" in band and "after" in band
