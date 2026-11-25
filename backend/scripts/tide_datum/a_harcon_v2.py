"""tide-a-harcon-v2 controls (gates/tide-a-harcon-v2.md §5, §6, §11, §12): C2 as a pipeline-break detector on a 6-MINUTE
grid with FIXED a-priori bars, the planted breaks (C5 in the v2 run; four in the pre-flight), and the status rules.

PURE except where a synthesis function is passed in. The bars are THIS module's constants, copied from the gate text
(§5): no file, run or quantile can move them.
"""
import statistics as st
from datetime import datetime, timedelta, timezone

BAR_H_M, BAR_T_MIN = 0.05, 10.0           # §5: fixed a priori from the size of the breaks C2 exists to catch
GRID_MIN = 6                              # §5: the own-constants synthesis on a 6-minute grid (the arms stay hourly)
V2_START, PREFLIGHT_START, DAYS = "2027-07-15", "2027-07-01", 14     # §4, §6: half-open [start, start + 14 d)
PREFLIGHT_MIN_TESTED, PREFLIGHT_MAX_EXCEED, PLANT_MIN_FAIL = 300, 0.01, 0.95


def window(start, days=DAYS):
    """The half-open window [day0, day0 + days) as aware UTC datetimes."""
    day0 = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
    return day0, day0 + timedelta(days=days)


def hours_in(start, days=DAYS):
    """PURE: every whole hour in the half-open window (used to prove the two windows are disjoint)."""
    a, b = window(start, days)
    out, t = set(), a
    while t < b:
        out.add(t)
        t += timedelta(hours=1)
    return out


def grid(day0, stop, minutes=GRID_MIN, pad_h=6):
    """The synthesis times: every `minutes` from day0 - pad to stop + pad."""
    t, out = day0 - timedelta(hours=pad_h), []
    while t <= stop + timedelta(hours=pad_h):
        out.append(t)
        t += timedelta(minutes=minutes)
    return out


# ---- planted breaks on the constants (rows: (number, name, amplitude m, phase_GMT deg, speed deg/h)) ---------------
def amp_x100(hc):
    return [(r[0], r[1], r[2] * 100.0, r[3]) + tuple(r[4:]) for r in hc]


def phase_flip(hc):
    return [(r[0], r[1], r[2], (-r[3]) % 360.0) + tuple(r[4:]) for r in hc]


def phase_plus90(hc):
    return [(r[0], r[1], r[2], (r[3] + 90.0) % 360.0) + tuple(r[4:]) for r in hc]


def drop_m2(hc):
    return [r for r in hc if r[1] != "M2"]


# name -> (constants transform, time shift in minutes)
C5_PLANTS = {"P1_phase_plus90": (phase_plus90, 0), "P2_amp_x100": (amp_x100, 0), "P3_time_plus60": (None, 60)}
PREFLIGHT_PLANTS = {"i_amp_x100": (amp_x100, 0), "ii_phase_flip": (phase_flip, 0), "iii_time_plus60": (None, 60),
                    "iv_drop_m2": (drop_m2, 0)}


def c2_status(rows):
    """('pass' | 'mismatch' | 'untestable', detail) with the FIXED v2 bars, over match_events rows."""
    m = [r for r in rows or [] if r.get("height_err_m") is not None]
    if not m:
        return "untestable", {"matched": 0, "n": len(rows or [])}
    h = st.median(abs(r["height_err_m"]) for r in m)
    t = st.median(abs(r["time_err_min"]) for r in m)
    status = "pass" if (h <= BAR_H_M and t <= BAR_T_MIN) else "mismatch"
    return status, {"median_h_m": h, "median_t_min": t, "matched": len(m), "n": len(rows)}


def plant_fails(status):
    """§12: a planted break FAILS C2 iff C2's status is not PASS (a mismatch, or no matched events / untestable)."""
    return status != "pass"


def events_rows_fine(truth_hilo, truth_mean, times, series, day0, stop):
    """v1's events_rows (a_harcon_parity) on a sub-hourly series: the times keep their MINUTES (v1's hourly formatter
    writes HH:00). Centring is v1's: the series minus its own mean over [day0, stop); NOAA's events minus its mean."""
    import a_harcon_vendor as V
    from services.weather_pipeline import tide as T
    inside = [v for v, t in zip(series, times) if day0 <= t < stop and v is not None]
    m = st.fmean(inside) if inside else 0.0
    ours = [None if v is None else float(v) - m for v in series]
    iso = [t.strftime("%Y-%m-%dT%H:%M") for t in times]
    return V.match_events([(t, k, round(v - truth_mean, 4)) for t, k, v in truth_hilo], T.tide_extrema(iso, ours))


def c2_rows(hc, truth_hilo, truth_mean, day0, stop, synth, transform=None, shift_min=0):
    """The own-constants identity on the 6-min grid (optionally planted): match_events rows, centred as in v1.
    synth(constants, times) -> values: the candidate's own synthesis (harcon_eval), verbatim. None when it gives none."""
    consts = transform(hc) if transform else hc
    times = grid(day0, stop)
    vals = synth(consts, times) if consts else None
    if vals is None:
        return None
    times = [t + timedelta(minutes=shift_min) for t in times]
    return events_rows_fine(truth_hilo, truth_mean, times, [float(v) for v in vals], day0, stop)


def minors_diagnostic(hc, tr, day0, stop):
    """REPORTED ONLY, never deciding (§5): the own-constants C2 with pyTMD's minor-constituent inference, where the
    installed pyTMD offers it. Any failure is recorded as 'unavailable', never an error of the run."""
    try:
        import pyTMD.predict
        import timescale.time  # noqa: F401
        import timescale
        import numpy as np
        times = grid(day0, stop)
        major = minor_inferred_series(hc, times, pyTMD, timescale, np)
        rows = events_rows_fine(tr["hilo"], tr["raw_mean"], times, major, day0, stop)
        status, detail = c2_status(rows)
        return {"status": status, "detail": detail}
    except Exception as e:                                    # noqa: BLE001 - a diagnostic never fails the run
        return {"status": "unavailable", "why": f"{type(e).__name__}: {e}"[:200]}


def minor_inferred_series(hc, times, pyTMD, timescale, np):
    """The candidate's synthesis plus pyTMD.predict.infer_minor on the same major constituents (diagnostic)."""
    import arms
    base = arms.harcon_eval(hc, arms.to_np(times))
    ts = timescale.from_datetime(arms.to_np(times).astype("datetime64[ns]"))
    names = [r[1].lower() for r in hc]
    amp = np.array([r[2] for r in hc], dtype=float)
    ph = np.radians([r[3] for r in hc])
    hc_complex = (amp * np.exp(-1j * ph))[None, :]
    minor = pyTMD.predict.infer_minor(ts.tide, hc_complex, names, deltat=ts.tt_ut1, corrections="GOT")
    return [float(b) + float(m) for b, m in zip(base, np.asarray(minor).reshape(-1))]


def preflight_verdict(records):
    """PURE, §6: PASS iff >= 300 records TESTED, <= 1 % of them over the fixed bars, and EACH planted break FAILS C2
    (§12: status != pass) at >= 95 % of the tested records. records: {sid: {"c2": status, "plants": {name: status}}}."""
    tested = {s: r for s, r in records.items() if r.get("c2") in ("pass", "mismatch")}
    n = len(tested)
    over = sorted(s for s, r in tested.items() if r["c2"] == "mismatch")
    plants = {}
    for name in PREFLIGHT_PLANTS:
        fails = [s for s, r in tested.items() if plant_fails((r.get("plants") or {}).get(name, "pass"))]
        misses = sorted(set(tested) - set(fails))
        plants[name] = {"fail_frac": (len(fails) / n) if n else 0.0, "misses": misses}
    ok = (n >= PREFLIGHT_MIN_TESTED and (len(over) / n if n else 1.0) <= PREFLIGHT_MAX_EXCEED
          and all(p["fail_frac"] >= PLANT_MIN_FAIL for p in plants.values()))
    return {"status": "PASS" if ok else "STOP", "tested": n, "over_bars": over,
            "over_frac": (len(over) / n) if n else None, "plants": plants,
            "rule": "gates/tide-a-harcon-v2.md s6 + s12"}


def c5_verdict(c5_by_station):
    """PURE: C5 (VOID-only) fails iff ANY plant PASSES C2 at any scored station. c5_by_station: {sid: {name: status}}."""
    passed = sorted(f"{s}:{n}" for s, plants in c5_by_station.items() for n, stt in plants.items() if not plant_fails(stt))
    missing = sorted(s for s, plants in c5_by_station.items() if set(plants) != set(C5_PLANTS))
    return {"pass": not passed and not missing, "plant_passed_c2": passed, "missing": missing}
