"""period_bands.py — ECMWF period-band wave heights -> the `{h, tp, dir, kind}` partition shape.

WHY THIS EXISTS
---------------
EURO is the one model that cannot decompose its own sea. `ecmwf_wam025` publishes no spectral
partitions on ANY path — verified on both the free ECMWF Open-Data stream and Open-Meteo's
`ecmwf_wam025`, where swell/windsea come back null — so EURO's swell layers are served from a
DIFFERENT model (Copernicus CMEMS), and the two are not internally coherent.

But ECMWF publishes something else that nobody here fetches. Live index probe of
`data.ecmwf.int/forecasts/.../ifs/0p25/wave` and `.../aifs-single/0p25/wave` (2026-08-01):

    swh mwd mwp pp1d mp2 cdww wmb  +  h1012 h1214 h1417 h1721 h2125 h2530

`h1012` is "significant wave height of all waves with periods 10 to 12 s", and so on to 25-30 s.
**Six period-resolved heights, free, on the endpoint `ecmwf_opendata_fetcher` already talks to.**

★★ WHY BANDS BEAT PARTITIONS FOR *THIS* CHAIN. `estimate_surf` is strongly NON-LINEAR in period —
Komar's Hb goes as Tp^0.4 and the depth-limited cap as breaker_index(Tp) — which is the entire
reason `estimate_surf_partitioned` exists. Period bands are indexed BY the variable the transform is
non-linear in, and there are six of them rather than three trains. Measured on recorded live seas,
decomposing a chop-dominated sea moved the rating 2-3 LEVELS (Mavericks 81.3 good -> 55.3 fair).

⛔⛔ THE LIMITS, STATED UP FRONT — this is not a spectrum, and pretending otherwise is the failure
mode this file is built to avoid:
  * BANDS CARRY NO DIRECTION. Only `mwd` (one mean direction for the whole sea) exists. Every band
    therefore inherits the same bearing, so the per-train shore-normal exposure that makes
    `estimate_surf_partitioned` valuable is DEGENERATE here — it reduces to one exposure factor.
    That is still strictly better than one blended PERIOD, but it is half the win, and a caller must
    not read a band list as a directional decomposition.
  * BANDS COVER >= 10 s ONLY. Wind sea below 10 s is not resolved; it is the RESIDUAL of the total.
    We reconstruct it in quadrature and label it `windsea`, at the sea's own mean period — an
    assumption, and it is stamped as one (`estimated_residual`).
  * The residual is the band set's own error term. If the bands over-report, the residual clamps at
    zero rather than going imaginary, and the caller sees `residual_clamped`.

⇒ Everything here is a SHAPE. The total `swh` remains the SCALE — the same split of responsibility
`reconcile_partitions` already enforces for the CMEMS trains. Nothing in this module rescales the
sea; callers pass the output through `reconcile_partitions(bands, swh)` exactly as they do today.

Pure `math`. No I/O, no numpy, no environment reads — so it is testable without the GRIB stack,
which matters because ECMWF packs these fields with CCSDS/AEC (template 5.42) and decoding them
needs ecCodes built with libaec.
"""
import math

# (param, low_s, high_s). The centre period is the geometric-mean-free arithmetic midpoint: these
# are narrow bands, and the transform's sensitivity to Tp inside a 2-4 s window is far smaller than
# the difference BETWEEN bands, which is the effect being recovered.
ECMWF_PERIOD_BANDS = (
    ("h1012", 10.0, 12.0),
    ("h1214", 12.0, 14.0),
    ("h1417", 14.0, 17.0),
    ("h1721", 17.0, 21.0),
    ("h2125", 21.0, 25.0),
    ("h2530", 25.0, 30.0),
)

# Below this a band carries no useful energy and becomes numerical noise in quadrature. Matches the
# low-energy gate the served swell_1 / wind_waves layers already apply (0.05 m).
BAND_MIN_H_M = 0.05

# A residual smaller than this is indistinguishable from the bands' own rounding, so it is dropped
# rather than shipped as a phantom wind sea.
RESIDUAL_MIN_H_M = 0.05


def band_centre_period(low_s, high_s):
    """The period a band's energy is transformed at."""
    return (float(low_s) + float(high_s)) / 2.0


def bands_to_partitions(band_heights, total_h_m=None, mean_dir_deg=None, mean_period_s=None):
    """ECMWF band heights -> the partition list `estimate_surf_partitioned` consumes.

    `band_heights` maps the ECMWF param name ('h1012'...) to a significant height in metres; missing
    or None entries are skipped, so a partial fetch degrades instead of failing.

    Returns ``(partitions, diagnostics)``:
      partitions   list of {h, tp, dir, kind, band} — `band` names the source so a consumer can tell
                   a measured band from the reconstructed residual.
      diagnostics  what the caller needs to decide whether to TRUST this decomposition:
                   band_quad, residual_h, residual_clamped, bands_used, covers_windsea.

    ⚠️ FAILS OPEN to an empty list. A caller that gets `[]` must fall through to the total field,
    exactly as it does today when partitions are absent — this must never be able to make a sea
    state worse than not decomposing it at all.
    """
    parts = []
    quad_sq = 0.0
    if isinstance(band_heights, dict):
        for name, lo, hi in ECMWF_PERIOD_BANDS:
            h = band_heights.get(name)
            try:
                h = float(h) if h is not None else None
            except (TypeError, ValueError):
                h = None
            # NaN defeats `not h` and `h <= 0` alike — self-inequality is the only cheap catch, and
            # a NaN reaching the engine renders as the TOP rating.
            if h is None or h != h or h < BAND_MIN_H_M:
                continue
            quad_sq += h * h
            parts.append({"h": h, "tp": band_centre_period(lo, hi), "dir": mean_dir_deg,
                          "kind": "swell", "band": name})

    diag = {"band_quad": round(math.sqrt(quad_sq), 4) if quad_sq > 0 else 0.0,
            "bands_used": len(parts), "residual_h": None, "residual_clamped": False,
            "covers_windsea": False}

    # ── THE RESIDUAL: everything below 10 s, which the bands do not resolve ──────────────────────
    try:
        total = float(total_h_m) if total_h_m is not None else None
    except (TypeError, ValueError):
        total = None
    if total is not None and total == total and total > 0:
        resid_sq = total * total - quad_sq
        if resid_sq < 0:
            # The bands claim more energy than the total. That is the band set's own inconsistency,
            # not a negative sea — clamp and SAY SO rather than producing an imaginary height.
            diag["residual_clamped"] = True
            resid_sq = 0.0
        resid = math.sqrt(resid_sq)
        diag["residual_h"] = round(resid, 4)
        if resid >= RESIDUAL_MIN_H_M:
            # No period is published for the sub-10 s part. The sea's mean period is the least-bad
            # stand-in and it is STAMPED, so a consumer can discount it. Capped below 10 s because
            # by construction this is the band set's complement.
            tp = None
            if mean_period_s is not None:
                try:
                    mp = float(mean_period_s)
                    if mp == mp and mp > 0:
                        tp = min(mp, ECMWF_PERIOD_BANDS[0][1] - 0.1)
                except (TypeError, ValueError):
                    tp = None
            parts.append({"h": round(resid, 4), "tp": tp, "dir": mean_dir_deg,
                          "kind": "windsea", "band": "estimated_residual"})
            diag["covers_windsea"] = True
    return parts, diag


def bands_represent(band_heights, total_h_m, min_frac=0.0, max_frac=1.10):
    """Sanity gate on a band set BEFORE it is trusted as a decomposition.

    Unlike `partitions_represent` (which requires the trains to carry at least half the total),
    period bands legitimately carry only the >= 10 s part of the sea — on a wind-swell day that can
    be a small fraction of the total, and that is CORRECT, not degenerate. So there is no lower
    bound by default. What must never happen is the reverse: bands summing to MORE than the total,
    which means the fields disagree and the residual would be fabricated.

    Returns True when the band quadrature is within `max_frac` of the total. Fails CLOSED on
    unusable input — an unreadable total cannot license a decomposition.
    """
    try:
        total = float(total_h_m)
    except (TypeError, ValueError):
        return False
    if total != total or total <= 0:
        return False
    _parts, diag = bands_to_partitions(band_heights, total_h_m=None)
    quad = diag["band_quad"]
    if quad != quad:
        return False
    if quad <= 0:
        return False                      # no bands is not a decomposition
    frac = quad / total
    return min_frac <= frac <= max_frac
