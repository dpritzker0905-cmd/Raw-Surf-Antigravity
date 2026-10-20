"""ICON_PEAK_PERIOD (dark, default off): give the ICON lane (DWD GWAM) a PEAK period.

WHY (forensics 2026-10-20, ledger 1497). The surf chain (`surf_transform.estimate_surf`, `surf_rating.period_quality`)
is written for the PEAK period Tp, and GFS (PERPW) and the ECMWF wave stream (pp1d) both serve one. The ICON lane
served `tm10` (Tm-1,0, the energy period) as the total period and `mpts` / `mpww` (MEAN periods) for its two
partitions. At 6,433 world nodes where ICON and GFS heights agree within 15%, ICON/GFS period had median 0.842.
DWD's open GWAM publishes no total peak period, but it does publish the PEAK period of each partition: `ppts`
(total swell) and `ppww` (wind sea).

WHAT THE FLAG DOES (call-time read; flag off -> byte-identical):
  * swell_wave_period  <- ppts (was mpts)       wind_wave_period <- ppww (was mpww)
  * wave_period        <- a SMOOTH blend of the two partition peaks (below); tm10 stays as `wave_period_tm10`.
The partitions are what the chain should prefer (`estimate_surf_partitioned` transforms each train on its own period);
the blended total is the scalar fallback and what `period_s` / the period cue read.

THE BLEND, AND WHY IT IS NOT A HARD SWITCH. A buoy's dominant period (DPD) is the period of the HIGHEST spectral peak.
For partitions of similar shape the peak density scales like E*Tp = H^2*Tp, so the dominant one is the larger of
s_i = H_i^2 * Tp_i. Picking it outright (argmax) jumps between ~6 s and ~14 s when two partitions are near-equal, the
abrupt flip Reflection warned about (and a forecast-hour flicker on the map). Instead:
        w_i = s_i ** p / sum_j s_j ** p,      Tp = sum_i w_i * Tp_i
which is continuous in every input, equals the argmax as p -> infinity, and an energy-period-weighted mean at p = 1.
`p` is ICON_PEAK_PERIOD_SHARPNESS (default 2; validation in the PR log measures p = 1, 2, 4 and argmax against NDBC
DPD and reports the hour-to-hour jump distribution). A missing partition leaves the other one; both missing falls back
to tm10, counted, so a hole never appears where the old field had a value.

Imported BY PATH from dwd_gwam_fetcher.py (production spawns it as a script), so no package-relative imports.
"""
import os

FLAG = "ICON_PEAK_PERIOD"
SHARPNESS_ENV = "ICON_PEAK_PERIOD_SHARPNESS"
DEFAULT_SHARPNESS = 2.0
DIAGNOSTIC_OM = "wave_period_tm10"

# (gwam var, open-meteo var) rewrites under the flag; everything else in VAR_MAP is unchanged.
_REWRITE = {
    ("tm10", "wave_period"): ("tm10", DIAGNOSTIC_OM),
    ("mpts", "swell_wave_period"): ("ppts", "swell_wave_period"),
    ("mpww", "wind_wave_period"): ("ppww", "wind_wave_period"),
}


def peak_period_enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def sharpness() -> float:
    try:
        p = float(os.environ.get(SHARPNESS_ENV, DEFAULT_SHARPNESS))
    except (TypeError, ValueError):
        return DEFAULT_SHARPNESS
    return p if p > 0 else DEFAULT_SHARPNESS


def with_peak_period(var_map):
    """The variable map to fetch. Flag off -> an unchanged copy. Flag on -> partition peaks + tm10 as a diagnostic;
    order is kept (each height still precedes its direction and period)."""
    rows = list(var_map)
    if not peak_period_enabled():
        return rows
    out = []
    for var, om, unit in rows:
        nv, nom = _REWRITE.get((var, om), (var, om))
        out.append((nv, nom, unit))
    return out


def _ok(x):
    return isinstance(x, (int, float)) and x == x and x > 0


def blend_peak_period(h_sw, t_sw, h_ww, t_ww, p=DEFAULT_SHARPNESS):
    """Smooth dominant-peak period from two partitions, or None when neither is usable."""
    parts = [(h, t) for h, t in ((h_sw, t_sw), (h_ww, t_ww)) if _ok(h) and _ok(t)]
    if not parts:
        return None
    if len(parts) == 1:
        return float(parts[0][1])
    scores = [(h * h * t) for h, t in parts]
    top = max(scores)
    # normalise by the top score before the power: keeps s**p finite for any p and any units
    w = [(s / top) ** p for s in scores]
    return float(sum(wi * t for wi, (_h, t) in zip(w, parts)) / sum(w))


def derive_total_series(hourly, p=None):
    """Return (wave_period list, n_fallback_to_tm10) for one point's hourly dict (flag-on fetch)."""
    p = sharpness() if p is None else p
    hs = hourly.get("swell_wave_height") or []
    ts = hourly.get("swell_wave_period") or []
    hw = hourly.get("wind_wave_height") or []
    tw = hourly.get("wind_wave_period") or []
    tm = hourly.get(DIAGNOSTIC_OM) or []
    n = max(len(hs), len(ts), len(hw), len(tw), len(tm))

    def at(a, i):
        return a[i] if i < len(a) else None

    out, fell_back = [], 0
    for i in range(n):
        v = blend_peak_period(at(hs, i), at(ts, i), at(hw, i), at(tw, i), p)
        if v is None:
            v = at(tm, i)
            if v is not None:
                fell_back += 1
        out.append(round(v, 4) if isinstance(v, float) else v)
    return out, fell_back
