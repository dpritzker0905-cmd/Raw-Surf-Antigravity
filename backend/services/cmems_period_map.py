"""COPERNICUS_PEAK_PERIOD (dark, default off): give the Copernicus (CMEMS MFWAM) lane a PEAK period.

WHY (forensics 2026-10-20, ledger 1497; log docs/weather-program/log/2026-10-20-claude-peak-period-flags.md).
`surf_transform.estimate_surf` and `surf_rating.period_quality` are written for the PEAK period Tp. GFS-Wave
serves PERPW and the ECMWF wave stream pp1d (both peak), but every CMEMS path mapped the total `wave_period` from
VTM10, the spectral-moment period Tm-1,0 ("energy period"), which reads shorter than Tp: 0.86-0.93 x Tp for a single
JONSWAP sea and as low as ~0.53 in a mixed swell + wind sea (JONSWAP moments, 2026-10-20 03:40Z). No constant
converts one to the other, so the fix is to fetch the variable the chain was written for: CMEMS publishes VTPK,
"wave period at the spectral peak", in the same dataset.

WHAT THE FLAG DOES. With COPERNICUS_PEAK_PERIOD=1, every CMEMS variable map is rewritten at CALL time:
    ("VTM10", "wave_period")  ->  ("VTPK", "wave_period") + ("VTM10", "wave_period_tm10")
so the served total period becomes VTPK and VTM10 stays available beside it as a diagnostic. Partitions are NOT
touched: CMEMS publishes only VTM01_SW1 / VTM01_SW2 / VTM01_WW (mean periods) for them, with no partition peak period,
so those keep their meaning and the gap is reported, not hidden. Flag off: the map is returned unchanged (same tuples,
same order), so the request and every byte downstream are identical to today.

Imported BY PATH from the CMEMS fetcher subprocesses, so it has no package-relative imports (see
tests/test_fetcher_script_imports.py).
"""
import os

FLAG = "COPERNICUS_PEAK_PERIOD"
TOTAL_ENERGY_PERIOD = ("VTM10", "wave_period")
PEAK_VAR = "VTPK"
DIAGNOSTIC_OM = "wave_period_tm10"


def peak_period_enabled() -> bool:
    """Read at call time (served-number flags are os.environ reads at the point of use)."""
    return os.environ.get(FLAG, "0") == "1"


def with_peak_period(var_map):
    """Return the variable map the CMEMS fetchers should request.

    `var_map` is a list of (copernicus_var, open_meteo_var, unit). Flag off -> a copy, unchanged. Flag on -> the total
    period comes from VTPK and VTM10 is kept as `wave_period_tm10`, right after it, so the height-before-period order
    the block-mean code relies on is preserved."""
    rows = list(var_map)
    if not peak_period_enabled():
        return rows
    out = []
    for cop, om, unit in rows:
        if (cop, om) == TOTAL_ENERGY_PERIOD:
            out.append((PEAK_VAR, om, unit))
            out.append((cop, DIAGNOSTIC_OM, unit))
        else:
            out.append((cop, om, unit))
    return out


def requested_vars(var_map, om_vars):
    """CMEMS variables for a request naming Open-Meteo variables (the /point path asks per layer).

    Uses the flag-aware map, and when the total period is requested under the flag also requests its VTM10
    diagnostic, so a point carries both. Unknown names are skipped; an empty selection returns None (the caller then
    fetches everything, as before)."""
    vmap = with_peak_period(var_map)
    om_to_cop = {om: cop for cop, om, _u in vmap}
    out = []
    for om in om_vars or []:
        cop = om_to_cop.get(om)
        if cop and cop not in out:
            out.append(cop)
        if om == "wave_period" and peak_period_enabled():
            diag = om_to_cop.get(DIAGNOSTIC_OM)
            if diag and diag not in out:
                out.append(diag)
    return out or None
