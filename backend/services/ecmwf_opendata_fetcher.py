"""
ECMWF OPEN DATA GLOBAL-COARSE fetcher — moves EURO wind + pressure off open-meteo.

EURO = ECMWF's IFS. ECMWF publishes a free (CC-BY-4.0) real-time subset of the operational IFS at 0.25°
in GRIB2 — including 10u/10v (10 m wind components) and msl (mean sea level pressure). Unlike the ICON
icosahedral work, this is a REGULAR lat/lon grid, so we reuse `_fetch_common.build_regular_nn`.

We use the official `ecmwf-opendata` client (lazy import): it resolves the latest available cycle and
byte-range-downloads only the requested params via each file's `.index`, then pygrib decodes them. One
fetcher serves the layers via the payload `layer` key:
  - layer="wind"     -> param 10u/10v  -> wind_speed_10m [m/s] + wind_direction_10m [° meteorological "from"]
  - layer="pressure" -> param msl      -> pressure_msl [hPa]  (msl is Pa -> ÷100)
  - layer="waves"    -> stream="wave" param swh/mwp/pp1d/mwd -> wave_height [m] + wave_period [s] +
                        wave_direction [°]. Period = pp1d (PEAK, the surf-correct choice, matches
                        GFS-Wave PERPW semantics) with mwp (mean) as the per-value fallback. The free
                        wave stream has NO swell-partition params (shww/shts) — total sea only, so
                        swell_1/swell_2/wind_waves stay on their existing sources.

Steps: 3-hourly to 144h, then 6-hourly to min(forecast_days*24, 240h). 00/12 runs reach 240h (10d);
06/18 runs only reach 144h — so we try the full step list and fall back to ≤144h on failure (a partial
cycle just means open-meteo fallback upstream, never a crash).

OUTPUT: Open-Meteo-shaped JSON (__provider:'ecmwf'). Caller keeps provider='open-meteo' so the manifest
(source_dataset='ecmwf_ifs') stays byte-identical. Masked/out-of-range -> None (np.ma.filled + sanitize).

USAGE: subprocess `python ecmwf_opendata_fetcher.py '<payload-json>'`; standalone (no args) for verify;
ECMWF_OPENDATA_FETCHER_QUICK=1 -> tiny region + ~2 days. Source override: ECMWF_OPENDATA_SOURCE (ecmwf|aws|azure).
"""
import os
import sys
import json
import time
import math
import uuid
import tempfile
from pathlib import Path

try:
    from _fetch_common import (
        coarse_axis, build_regular_nn, sanitize_speed_ms, sanitize_pressure_hpa,
        sanitize_direction_deg, sanitize_height_m, sanitize_period_s,
        meteo_wind_dir, make_point_dict, energy_mean_height_block,
    )
except ImportError:  # pragma: no cover - package-context fallback
    from services._fetch_common import (
        coarse_axis, build_regular_nn, sanitize_speed_ms, sanitize_pressure_hpa,
        sanitize_direction_deg, sanitize_height_m, sanitize_period_s,
        meteo_wind_dir, make_point_dict, energy_mean_height_block,
    )

LAYER_PARAMS = {"wind": ["10u", "10v"], "pressure": ["msl"], "waves": ["swh", "mwp", "pp1d", "mwd"]}
# Wave params live in their own stream ("wave"; the client maps 06/18 cycles to scwv itself).
LAYER_STREAM = {"wind": "oper", "pressure": "oper", "waves": "wave"}

# ── ECMWF PERIOD BANDS (M4 ingest half) ─────────────────────────────────────────────────────────
#
# Six significant heights BY PERIOD BAND, free on the stream this module already talks to:
# h1012 = "significant wave height of all waves with periods 10-12 s", up to 25-30 s. EURO is the
# one model that publishes NO spectral partitions on any path, so these bands are the only way it
# can describe its own sea — and `estimate_surf` is strongly non-linear in period (Komar's Hb goes
# as Tp^0.4), which is exactly the variable the bands are indexed by.
#
# ⛔ GATED ON A MEASUREMENT, NOT A HYPOTHESIS. Fetching six extra global fields is not free, and the
# residual wind-sea reconstruction in `period_bands` is only sound if the bands stay within the
# total. Probed against the live 20260802/00z cycle over 20,494 ocean cells
# (`.github/workflows/ecmwf-band-closure-probe.yml`):
#     sqrt(sum(band^2))/swh   p50 0.5549   p90 0.8008   p99 0.9929   max 1.0012   exceed 0.0%
# ⇒ BANDS_CLOSE. The median sitting near 0.55 is EXPECTED — the bands cover >=10 s only, so the
# remainder is wind sea, not a deficit; and the upper tail converging on exactly 1.0 is the
# signature of a real decomposition (swell-dominated cells where the bands ARE the whole sea).
#
# ⚠️ DEFAULT OFF, and the flag gates the FETCH, not just the emit — six extra global fields per
# cycle on a 1-CPU box with a documented melt history is the binding constraint, per the recorded
# `SURF_PARTITIONS costs 4x` lesson. With the flag off this module is byte-identical to before.
WAVE_PERIOD_BAND_PARAMS = ["h1012", "h1214", "h1417", "h1721", "h2125", "h2530"]


def period_bands_enabled():
    """Whether to fetch + emit the six period bands. Read PER CALL, never at import.

    A module-level read freezes whatever the environment was when the process started, and this
    repo's recorded scar is a flag holding a different value in each lane. Kill: unset or '0'."""
    return os.environ.get("ECMWF_PERIOD_BANDS", "0") == "1"


def layer_params(layer):
    """Params to request for `layer`, including the period bands when they are switched on.

    ★ `LAYER_PARAMS` itself is left UNMUTATED on purpose — `test_ecmwf_euro.py` pins its wave list
    to the base four, and that guard should keep passing. The bands are an addition at request
    time, not a redefinition of the baseline."""
    base = LAYER_PARAMS[layer]
    if layer == "waves" and period_bands_enabled():
        return list(base) + list(WAVE_PERIOD_BAND_PARAMS)
    return base


def _step_list(max_hours):
    """ECMWF oper IFS open-data steps: 3-hourly to 144, 6-hourly to 240. Capped at max_hours."""
    steps = list(range(0, 145, 3)) + list(range(150, 241, 6))
    return [s for s in steps if s <= max_hours]


# ── THE WAVE ENSEMBLE (`waef`) ──────────────────────────────────────────────────────────────────
#
# A deterministic forecast is a point; an ensemble is a DISTRIBUTION, and the spread is what turns a
# forecast into a confidence — which is what the observation gate has always actually wanted. This
# is the same stream, the same `.index` byte-range mechanism and the same pygrib decode this module
# already performs; only `type`, `stream` and `number` differ.
#
# ⭐ PRICED BEFORE WIRING (2026-08-06), from the stream's own `.index` — not estimated:
#     whole step, 13 params x 50 members ......... 501 MB   <- never fetch whole; the box OOMs at 1,579 MB
#     swh, all 50 members, range-requested ....... 40.7 MB / step
#     swh, 10 members ............................  8.1 MB / step   <- the default below
# 50 members are CONFIRMED present (numbers 1..50) and the messages are real ensemble members
# (product template 1). A spread estimate does not need all 50, and the 1-CPU box is the binding
# constraint, exactly as it was for the period bands above.
#
# ⭐ MAGNITUDES SANITY-CHECKED WITHOUT DECODING A POINT: Section 5's (R, E, D, bits) fixes the
# ENCODABLE RANGE, and it lands where physics says — swh 0.0044..16.00 m, mwp 1.32..33.32 s,
# h1417 0.0011..8.00 m, with a bitmap carrying 665,628 sea points of 1,038,240.
# ⛔ TWO DECODE TRAPS, either of which yields PLAUSIBLE-BUT-WRONG METRES (and one of which is the
# likeliest cause of the retracted v4 figures):
#   1. packing is template 5.42 (CCSDS/AEC), NOT simple packing — pygrib handles it, a hand-rolled
#      reader assuming 5.0 does not;
#   2. GRIB2 signed ints are SIGN-MAGNITUDE, not two's complement: read as two's complement the
#      binary scale E comes out -32756 instead of -12, a scale error of 2^32744.
#
# ⚠️ DEFAULT OFF, and the flag gates the REQUEST. With it off, `retrieve_spec` returns exactly the
# kwargs this module sent before it existed — pinned by test, because "byte-identical when off" is
# the only thing that makes a new lane safe to add to a working fetcher.
ENSEMBLE_STREAM = "waef"
ENSEMBLE_MEMBERS_DEFAULT = 10
ENSEMBLE_MEMBERS_MAX = 50


def wave_ensemble_enabled():
    """Whether to request the wave ENSEMBLE instead of the deterministic wave stream.

    Read PER CALL, never at import — same reason as `period_bands_enabled`: a module-level read
    freezes the environment as of process start, and this repo's recorded scar is a flag holding a
    different value in each lane. Kill: unset or '0'."""
    return os.environ.get("ECMWF_WAVE_ENSEMBLE", "0") == "1"


def wave_ensemble_members():
    """How many perturbed members to request, clamped to [2, 50].

    ⛔ THE FLOOR IS 2, NOT 1, AND IT IS NOT COSMETIC: a spread computed from one member is 0.0, and
    0.0 reads as UNANIMITY — the most confident answer the scale can express — when it actually
    means 'not sampled'. Refusing below 2 is the same rule `spread_from_members` enforces."""
    try:
        n = int(os.environ.get("ECMWF_WAVE_ENSEMBLE_MEMBERS", ENSEMBLE_MEMBERS_DEFAULT))
    except (TypeError, ValueError):
        n = ENSEMBLE_MEMBERS_DEFAULT
    return max(2, min(ENSEMBLE_MEMBERS_MAX, n))


def retrieve_spec(layer, params, steps):
    """PURE: the exact kwargs for `client.retrieve`, so the DECISION is testable without a network.

    ⛔ THIS IS ALWAYS THE DETERMINISTIC REQUEST, INCLUDING WHEN THE ENSEMBLE IS ON — and that is the
    correction this function exists in its current form to record.

    It used to OVERWRITE `type` (fc -> pf) and `stream` (wave -> waef) under the flag, so switching
    the ensemble on meant the deterministic IFS run was never fetched and the served EURO wave height
    silently became the MEAN OF THE MEMBERS. Measured before flipping (run 31138214907, +120 h,
    20,000 ocean cells, 10 members) — the global bias is +0.0009 m, which a median-only check would
    have called identical and waved through. BY HEIGHT BAND it is not identical at all:

        0-1 m  +10.5%      3-4 m   +0.4%
        1-2 m   +1.7%      4-6 m   -0.5%
        2-3 m   +0.2%      6 m+    -3.3%      max 12.15 m -> 10.12 m  (-16.6%)

    That is the textbook ensemble-mean smoothing signature — high at the small end, LOW at the tail —
    and the tail is the half of the distribution surf cares about. Flipping it would have shaved the
    biggest EURO swells while every test stayed green, because every test asserts the DECODE, not the
    VALUE.

    ⇒ THE VALUE AND THE UNCERTAINTY DO NOT HAVE TO COME FROM THE SAME FETCH. The deterministic run
    stays the served height; `ensemble_spec` below fetches the members separately, for spread ONLY.
    """
    return {"type": "fc", "stream": LAYER_STREAM[layer], "levtype": "sfc",
            "param": list(params), "step": list(steps)}


# The ensemble is fetched for ONE parameter. Spread on the HEIGHT is the whole product; every extra
# param multiplies by the member count. Measured: production `layer_params("waves")` is 4 params, so
# requesting them all at 10 members is 40 messages/step (~34 MB) against 8.58 MB for swh alone — a
# 4x cost for three fields nothing consumes.
ENSEMBLE_SPREAD_PARAMS = ("swh",)


def ensemble_spec(steps):
    """PURE: the kwargs for the SEPARATE member fetch. Differs from the deterministic request in
    exactly three fields — `type` fc->pf, `stream` wave->waef, plus `number` — and narrows `param`
    to the height, for the cost reason above."""
    return {"type": "pf", "stream": ENSEMBLE_STREAM, "levtype": "sfc",
            "param": list(ENSEMBLE_SPREAD_PARAMS), "step": list(steps),
            "number": list(range(1, wave_ensemble_members() + 1))}


def spread_from_members(values):
    """PURE: (mean, sd, n) across ensemble members at one point, or None when it cannot be answered.

    ⛔ REFUSES below 2 finite members rather than returning 0.0. A single member yields sd 0.0, which
    is indistinguishable from perfect agreement — the check would then be unable to tell 'not
    sampled' from 'unanimous', which is the house rule for any check (standing rule 27)."""
    finite = [float(v) for v in (values or [])
              if v is not None and float(v) == float(v) and abs(float(v)) != float("inf")]
    if len(finite) < 2:
        return None
    n = len(finite)
    mean = sum(finite) / n
    var = sum((v - mean) ** 2 for v in finite) / n     # population sd across the members present
    return (mean, var ** 0.5, n)


def reduce_member_values(per_member):
    """PURE: {member_number: [v0, v1, ...]} -> (means, sds, counts), one entry per POINT.

    This is the piece `3a95f9a1` deliberately left unbuilt. The decode keys `by[rid][kind][vt]`, and
    every ensemble member shares a shortName and a validDate — MEASURED, not assumed, by
    `.github/workflows/ecmwf-ensemble-key-probe.yml` (run 31134428972): across 3 members of one step,
    `shortName` and `validDate` were CONSTANT while `perturbationNumber`/`number` varied 1..3. So the
    existing assignment collapses all members into one slot and the last one wins.

    ⛔ THE MESSAGES ARRIVE OUT OF ORDER — the same probe read msg 0 -> member 2, msg 1 -> member 1,
    msg 2 -> member 3. Any decode that appended positionally, or trusted arrival order to match the
    requested `number` list, would silently mislabel members. That is why the input here is a DICT
    KEYED BY MEMBER and never a list.

    ⭐ THE MEAN AND THE SPREAD HAVE DIFFERENT REFUSAL THRESHOLDS, and conflating them would be the
    familiar error in a new place:
      * the MEAN is answerable from ONE finite member — it is still the best estimate available;
      * the SPREAD is NOT. One member yields sd 0.0, which reads as perfect agreement — the most
        confident answer the scale can express — when it actually means 'not sampled'.
    So `sds[i]` is None below two finite members while `means[i]` is still a number, and `counts[i]`
    always says how many members actually contributed. A caller that wants to gate on confidence has
    the count; a caller that wants the value has the mean.

    Points with no finite member at all yield mean NaN (the existing no-data signature), sd None,
    count 0 — never 0.0, which would claim a calm sea where there was no observation.
    """
    if not per_member:
        return [], [], []
    n_pts = max(len(v) for v in per_member.values())
    means, sds, counts = [], [], []
    for i in range(n_pts):
        vals = []
        for _member, series in sorted(per_member.items()):     # sorted => deterministic, order-proof
            if i < len(series):
                v = series[i]
                if v is not None and v == v and abs(float(v)) != float("inf"):
                    vals.append(float(v))
        counts.append(len(vals))
        if not vals:
            means.append(float("nan"))
            sds.append(None)
            continue
        means.append(sum(vals) / len(vals))
        stat = spread_from_members(vals)                       # refuses below 2 — reused, not re-derived
        sds.append(stat[1] if stat is not None else None)
    return means, sds, counts


def fetch_global_coarse(payload):
    """Return (points, steps_ok, steps_failed, times) for the coarse global EURO wind/pressure grid via ECMWF Open Data."""
    import numpy as np
    import pygrib
    from ecmwf.opendata import Client

    # MULTI-BBOX (2026-07-13, single-download-pass): ECMWF ships ONE whole-globe multi-step file —
    # a payload `bboxes: {region_id: bbox}` samples EVERY region from each streamed message, so N
    # regions cost one region's download. Returns ({region_id: [points]}, ...) in multi mode; the
    # legacy single-`bbox` path is unchanged (list of points).
    multi = payload.get("bboxes") or None
    regions = dict(multi) if multi else {"__single__": payload["bbox"]}
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 10))
    layer = payload.get("layer", "wind")
    if layer not in LAYER_PARAMS:
        sys.stderr.write(f"[ecmwf_opendata_fetcher] unknown layer '{layer}'\n")
        return ({} if multi else []), 0, 0, None
    params = layer_params(layer)
    max_hours = min(forecast_days * 24, 240)
    # WAVE HEIGHT BLOCK-MEAN (enclosed-sea dropout fix, 2026-07-22): the coarse wave height was
    # POINT-SAMPLED at the cell centre (arr[r,c]); a 10° cell whose centre lands on a masked native cell
    # (coastline / delta / enclosed-sea edge) sampled NaN and dropped the whole cell — so the Gulf of
    # Mexico / Mediterranean / Gulf of California / Black Sea / … went BLANK for EURO worldwide (GFS was
    # fine — it already block-means heights). RMS over the block's finite (ocean) subcells survives such
    # cells; an all-NaN (true land) block still drops → nothing paints on land. Native ECMWF wave grid is
    # global 0.25° (longitude wraps). Kill: ECMWF_WAVE_SCALAR_BLOCKMEAN=0 -> legacy centre-point sampling.
    scalar_blockmean = os.environ.get("ECMWF_WAVE_SCALAR_BLOCKMEAN", "1") != "0"
    _half = max(1, int(round(resolution / 0.25 / 2.0)))

    axes = {}    # rid -> (lats, lons)
    for rid, bb in regions.items():
        axes[rid] = (coarse_axis(float(bb["south"]), float(bb["north"]), resolution),
                     coarse_axis(float(bb["west"]), float(bb["east"]), resolution))

    tmp = Path(tempfile.gettempdir())
    target = tmp / f"ecmwf_{layer}_{uuid.uuid4().hex}.grib2"
    client = Client(source=os.environ.get("ECMWF_OPENDATA_SOURCE", "ecmwf"))

    def _retrieve(steps):
        # date/time omitted -> client resolves the latest available cycle automatically.
        # The request is built by `retrieve_spec` so the DECISION (deterministic vs ensemble) is a
        # pure function a test can pin, rather than something only readable in source. With
        # ECMWF_WAVE_ENSEMBLE off this is byte-identical to the previous inline call.
        return client.retrieve(target=str(target), **retrieve_spec(layer, params, steps))

    steps_full = _step_list(max_hours)
    result = None
    try:
        result = _retrieve(steps_full)
    except Exception as e:
        # latest cycle may be 06/18 (only to 144h) or high steps not yet published — retry ≤144h.
        sys.stderr.write(f"[ecmwf_opendata_fetcher] full retrieve failed ({type(e).__name__}: {e}); retry ≤144h\n")
        try:
            result = _retrieve([s for s in steps_full if s <= 144])
        except Exception as e2:
            sys.stderr.write(f"[ecmwf_opendata_fetcher] retrieve failed: {type(e2).__name__}: {e2}\n")
            return [], 0, 0, None

    if not target.exists():
        sys.stderr.write("[ecmwf_opendata_fetcher] retrieve produced no file\n")
        return ({} if multi else []), 0, 0, None

    # MEMORY: ECMWF returns ONE multi-step file (~130 full global 0.25° fields for 10d wind). Holding
    # them all decoded at once is ~1GB -> OOM on the 2GB box. Stream message-by-message: sample the
    # ~n_pts NN points PER REGION immediately and DISCARD each full field, so peak RAM stays ~one
    # field (~8MB) + the tiny sampled lists. Sampled lists are in idx-map order = points order (pi).
    want_u = ("10u", "u10"); want_v = ("10v", "v10"); want_p = ("msl", "prmsl", "mslp")
    want_h = ("swh",); want_pk = ("pp1d",); want_mp = ("mwp",); want_d = ("mwd",)
    # Period bands are their own kinds, keyed by the ECMWF param name VERBATIM ('h1012'...). That
    # naming is deliberate: `period_bands.bands_to_partitions` keys on exactly these strings, so
    # producer and consumer share one vocabulary and there is no translation layer to drift.
    want_bands = tuple(WAVE_PERIOD_BAND_PARAMS) if period_bands_enabled() else ()
    want_wave = want_h + want_pk + want_mp + want_d + want_bands
    # per-region, per-kind {vt: vals}
    by = {rid: {k: {} for k in ("u", "v", "p", "h", "pk", "mp", "d") + want_bands}
          for rid in regions}
    # Per-member accumulator, used ONLY when the ensemble is on: rid -> kind -> vt -> {member: vals}.
    # Kept separate from `by` so the deterministic path and `_assemble` below are byte-for-byte
    # untouched when the flag is off.
    ens = {}
    spread = {}    # rid -> kind -> vt -> (sds, counts); populated only in ensemble mode
    ensemble_on = (layer == "waves") and wave_ensemble_enabled()
    idx_by = None    # rid -> [(r, c), ...]
    try:
        grbs = pygrib.open(str(target))
        for m in grbs:
            sn = (m.shortName or "").lower()
            if layer == "wind" and sn not in (want_u + want_v):
                continue
            if layer == "pressure" and sn not in want_p:
                continue
            if layer == "waves" and sn not in want_wave:
                continue
            if idx_by is None:
                glats, glons = m.latlons()
                lat1d = np.asarray(glats[:, 0], dtype=float)
                lon1d = np.asarray(glons[0, :], dtype=float)
                idx_by = {rid: build_regular_nn(lats, lons, lat1d, lon1d)  # auto 0-360 detect
                          for rid, (lats, lons) in axes.items()}
            arr = np.ma.filled(np.ma.asarray(m.values, dtype=float), np.nan)
            vt = m.validDate
            kind = (sn if sn in want_bands else
                    "u" if sn in want_u else "v" if sn in want_v else "p" if sn in want_p else
                    "h" if sn in want_h else "pk" if sn in want_pk else "mp" if sn in want_mp else "d")
            # ── WHICH MEMBER IS THIS? ──────────────────────────────────────────────────────────────
            # Only meaningful with the ensemble on. `perturbationNumber` is the GRIB2 standard key
            # and `number` is pygrib's alias for it; BOTH were measured varying 1..3 across members
            # while shortName and validDate stayed constant (key probe, run 31134428972). Note
            for rid, im in idx_by.items():
                if kind == "h" and scalar_blockmean:
                    # block-mean the wave height so enclosed-sea cells whose centre lands on masked land
                    # survive (see the ECMWF_WAVE_SCALAR_BLOCKMEAN note); everything else point-samples.
                    vals = [energy_mean_height_block(arr, r, c, _half, True) for (r, c) in im]
                else:
                    vals = [arr[r, c] for (r, c) in im]  # ~n_pts sampled values (tiny)
                # A plain assignment is CORRECT here: this is the deterministic stream, one message
                # per (kind, valid_time). The members are fetched separately below and accumulate
                # into `ens` keyed by perturbationNumber — which is what stops them overwriting each
                # other, and is why no member branch belongs in this loop.
                by[rid][kind][vt] = vals
            del arr
        grbs.close()

        # ── SECOND FETCH: the members, for SPREAD ONLY ────────────────────────────────────────────
        # A separate request into a separate file, `swh` alone. The deterministic decode above is
        # already complete and untouched here, so a failure costs the confidence signal and NOTHING
        # else — the forecast still ships. That asymmetry is deliberate: an uncertainty estimate must
        # never be able to take down the value it qualifies.
        if ensemble_on:
            ens_target = tmp / f"ecmwf_waef_{uuid.uuid4().hex}.grib2"
            try:
                client.retrieve(target=str(ens_target), **ensemble_spec(steps_full))
                egrbs = pygrib.open(str(ens_target))
                for em in egrbs:
                    if (em.shortName or "").lower() not in want_h:
                        continue
                    try:
                        emember = int(getattr(em, "perturbationNumber"))
                    except Exception:
                        continue          # no member id -> skip, never overwrite another member
                    earr = np.ma.filled(np.ma.asarray(em.values, dtype=float), np.nan)
                    evt = em.validDate
                    for rid, im in idx_by.items():
                        if scalar_blockmean:
                            evals = [energy_mean_height_block(earr, r, c, _half, True) for (r, c) in im]
                        else:
                            evals = [earr[r, c] for (r, c) in im]
                        ens.setdefault(rid, {}).setdefault("h", {}).setdefault(evt, {})[emember] = evals
                    del earr
                egrbs.close()
            except Exception as _ee:
                sys.stderr.write("[ecmwf_opendata_fetcher] ensemble fetch skipped "
                                 f"({type(_ee).__name__}: {_ee}); serving without spread\n")
            finally:
                try:
                    if ens_target.exists():
                        ens_target.unlink()
                except Exception:
                    pass

        # ── REDUCE THE MEMBERS ────────────────────────────────────────────────────────────────────
        # Collapse {member: vals} to a per-point mean, and keep the spread alongside. `by` therefore
        # carries the same SHAPE it always did (a list of point values per vt), so `_assemble` and
        # every consumer downstream are unchanged — the ensemble changes what the number IS, not
        # what the payload looks like.
        for rid, kinds in ens.items():
            for kind, vts in kinds.items():
                for vt, per_member in vts.items():
                    _means, sds, counts = reduce_member_values(per_member)
                    # ⛔ THE MEAN IS DELIBERATELY DISCARDED. It used to overwrite by[rid][kind][vt],
                    # i.e. the served height became the ensemble mean. Measured before that ever
                    # shipped (run 31138214907, +120 h, 20,000 cells, 10 members): global bias
                    # +0.0009 m — which reads as "identical" — but BY HEIGHT BAND the mean runs
                    # +10.5% at 0-1 m and -3.3% at 6 m+, with the sample max falling 12.15 -> 10.12 m
                    # (-16.6%). Ensemble-mean smoothing, biting hardest on exactly the big days this
                    # app exists to forecast. The deterministic run stays the VALUE; the members
                    # contribute UNCERTAINTY only.
                    spread.setdefault(rid, {}).setdefault(kind, {})[vt] = (sds, counts)
        if ens:
            _n_members = max((len(pm) for ks in ens.values() for vs in ks.values()
                              for pm in vs.values()), default=0)
            sys.stderr.write(f"[ecmwf_opendata_fetcher] ensemble reduced: {_n_members} members "
                             f"per (kind, valid_time)\n")
    finally:
        try:
            if target.exists():
                target.unlink()
        except Exception:
            pass

    rid0 = next(iter(regions))
    if layer == "wind":
        times_dt = sorted(set(by[rid0]["u"]) & set(by[rid0]["v"]))
    elif layer == "waves":
        # height + direction are required; period falls back per-value (pp1d peak -> mwp mean -> None).
        times_dt = sorted(set(by[rid0]["h"]) & set(by[rid0]["d"]))
    else:
        times_dt = sorted(by[rid0]["p"])
    if not times_dt or idx_by is None:
        sys.stderr.write(f"[ecmwf_opendata_fetcher] no usable {layer} messages decoded\n")
        return ({} if multi else []), 0, 0, None

    times = [vt.strftime("%Y-%m-%dT%H:%M:%SZ") for vt in times_dt]

    def _assemble(rid):
        lats, lons = axes[rid]
        n_pts = len(lats) * len(lons)
        b = by[rid]
        if layer == "wind":
            spd = [[] for _ in range(n_pts)]
            drc = [[] for _ in range(n_pts)]
            for vt in times_dt:
                u_vals = b["u"][vt]; v_vals = b["v"][vt]
                for pi in range(n_pts):
                    uu = u_vals[pi]; vv = v_vals[pi]
                    if uu == uu and vv == vv:  # not NaN
                        spd[pi].append(sanitize_speed_ms(math.sqrt(uu * uu + vv * vv)))
                        drc[pi].append(sanitize_direction_deg(meteo_wind_dir(uu, vv)))
                    else:
                        spd[pi].append(None); drc[pi].append(None)
            units = {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"}
            hourly_of = lambda pi: {"time": times, "wind_speed_10m": spd[pi], "wind_direction_10m": drc[pi]}
        elif layer == "waves":
            hgt = [[] for _ in range(n_pts)]
            per = [[] for _ in range(n_pts)]
            drc = [[] for _ in range(n_pts)]
            # ENSEMBLE SPREAD, emitted only when the ensemble actually produced one. `spread` is
            # populated by the member reduction above and is empty otherwise, so with the flag off
            # this list stays empty and the payload is byte-identical to the deterministic one.
            spd_h = [[] for _ in range(n_pts)] if spread.get(rid, {}).get("h") else None
            for vt in times_dt:
                h_vals = b["h"][vt]; d_vals = b["d"][vt]
                sd_vals = (spread.get(rid, {}).get("h", {}).get(vt) or (None, None))[0]
                pk_vals = b["pk"].get(vt); mp_vals = b["mp"].get(vt)
                for pi in range(n_pts):
                    hgt[pi].append(sanitize_height_m(h_vals[pi]))   # NaN (land mask) -> None inside
                    if spd_h is not None:
                        # ⚠️ NOT sanitize_height_m: a spread is a DISPERSION, not a height, and its
                        # valid range is different (0 is legitimate; the height sanitiser's floor
                        # would be wrong here). None passes straight through — it already means
                        # "fewer than two members had a value", which must not become 0.0.
                        _sd = sd_vals[pi] if sd_vals is not None and pi < len(sd_vals) else None
                        spd_h[pi].append(round(float(_sd), 4)
                                         if _sd is not None and _sd == _sd else None)
                    drc[pi].append(sanitize_direction_deg(d_vals[pi]))
                    pv = pk_vals[pi] if pk_vals is not None else float("nan")
                    if pv != pv and mp_vals is not None:  # peak missing -> mean
                        pv = mp_vals[pi]
                    per[pi].append(sanitize_period_s(pv))
            # PERIOD BANDS: one series per band, named with the ECMWF param verbatim so the
            # consumer's dict is a direct build. Absent when the flag is off -> the emitted payload
            # is byte-identical to before, which is what makes this shippable inert.
            bands = {}
            for bp in want_bands:
                vals = [[] for _ in range(n_pts)]
                for vt in times_dt:
                    b_vals = b[bp].get(vt)
                    for pi in range(n_pts):
                        # sanitize_height_m turns the land mask's NaN into None, same as `swh`.
                        vals[pi].append(sanitize_height_m(b_vals[pi]) if b_vals is not None else None)
                bands[bp] = vals
            units = {"time": "iso8601", "wave_height": "m", "wave_period": "s", "wave_direction": "°"}
            units.update({f"wave_band_{bp}": "m" for bp in want_bands})

            def hourly_of(pi, _bands=bands, _spd=spd_h):
                out = {"time": times, "wave_height": hgt[pi], "wave_period": per[pi],
                       "wave_direction": drc[pi]}
                for bp, series in _bands.items():
                    out[f"wave_band_{bp}"] = series[pi]
                # ⭐ THE SPREAD REACHES THE PAYLOAD. Computing it and keeping it in a local was the
                # "true but reaches nobody" shape — the whole reason the literature says to run an
                # ensemble is the distribution, and a distribution nobody is served is a point
                # forecast with extra steps. Absent entirely (not null) when the ensemble is off, so
                # the deterministic payload is byte-identical.
                if _spd is not None:
                    out["wave_height_spread"] = _spd[pi]
                return out
        else:
            ser = [[] for _ in range(n_pts)]
            for vt in times_dt:
                p_vals = b["p"][vt]
                for pi in range(n_pts):
                    ser[pi].append(sanitize_pressure_hpa(p_vals[pi]))
            units = {"time": "iso8601", "pressure_msl": "hPa"}
            hourly_of = lambda pi: {"time": times, "pressure_msl": ser[pi]}
        points = []
        pi = 0
        for la in lats:
            for lo in lons:
                points.append(make_point_dict(la, lo, "ecmwf", units, hourly_of(pi)))
                pi += 1
        return points

    if multi:
        return {rid: _assemble(rid) for rid in regions}, len(times_dt), 0, times
    return _assemble("__single__"), len(times_dt), 0, times


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        quick = os.environ.get("ECMWF_OPENDATA_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("ECMWF_OPENDATA_FETCHER_DAYS", "2" if quick else "10"))
        layer = os.environ.get("ECMWF_OPENDATA_FETCHER_LAYER", "wind")
        bbox = ({"west": -80.0, "south": 20.0, "east": -40.0, "north": 40.0} if quick
                else {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0})
        payload = {"bbox": bbox, "resolution": 10.0, "forecast_days": days, "layer": layer, "output_path": ""}

    t0 = time.time()
    points, ok, failed, times = fetch_global_coarse(payload)
    elapsed = time.time() - t0

    # Multi-region mode: `points` is {region_id: [points]} -> keyed envelope; flatten for stats.
    is_multi = isinstance(points, dict)
    out_obj = {"__multi_region__": True, "regions": points} if is_multi else points
    flat = [p for pts in points.values() for p in pts] if is_multi else points

    out_path = payload.get("output_path", "")
    if out_path and flat:
        with open(out_path, "w") as f:
            json.dump(out_obj, f)

    layer = payload.get("layer", "wind")
    key = {"wind": "wind_speed_10m", "pressure": "pressure_msl", "waves": "wave_height"}.get(layer, "wind_speed_10m")
    vals = [v for p in flat for v in p["hourly"].get(key, []) if v is not None]
    print(f"SUMMARY: layer={layer} regions={len(points) if is_multi else 1} points={len(flat)} "
          f"steps_ok={ok} steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"{key}_nonnull={len(vals)} {key}_min={min(vals) if vals else None} "
          f"{key}_max={max(vals) if vals else None} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and flat) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
