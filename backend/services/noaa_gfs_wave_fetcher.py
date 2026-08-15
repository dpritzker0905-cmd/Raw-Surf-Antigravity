"""
NOAA GFS-Wave GLOBAL-COARSE marine fetcher (low-strain, byte-range GRIB2 from AWS Open Data).

WHY THIS EXISTS:
  - open-meteo's free tier daily-quota (~10k/day) is the hard wall that starves the ingestion pipeline;
    each global coarse product = 612 billed calls. Moving GFS marine onto NOAA-direct (like EURO moved
    onto Copernicus) takes GFS off open-meteo entirely, freeing the whole open-meteo budget for ICON.
  - NOAA GFS-Wave is public-domain and lives free, no-auth, on AWS Open Data S3
    (bucket: noaa-gfs-bdp-pds), running to f384 (16 days) — more than the 14-day horizon we serve.

LOW-STRAIN DESIGN (mirrors copernicus_global_fetcher.py's thin-band ethos):
  - Each forecast hour is a separate GRIB2 file (global.0p25, ~11.6 MB full). We DON'T download the whole
    file: each file ships a `.idx` sidecar listing every GRIB message's byte offset, so we fetch ONLY the
    12 wave messages we need via HTTP Range requests (~7 MB), coalesced into 3 contiguous range GETs.
  - One forecast hour decoded at a time → tiny peak memory (~tens of MB), I/O-bound, low CPU. Slow
    (~5-15 min for 14 days @ 3-hourly = 113 steps) → BACKGROUND ingestion ONLY, never a user request.
  - The swell partitions (SWELL/SWPER/SWDIR ":1/:2 in sequence") are selected by their `.idx` label and
    decoded BY CONCATENATION ORDER, sidestepping eccodes' ambiguous swell-partition key naming.

OUTPUT: Open-Meteo-shaped JSON (list of point dicts with hourly arrays, __provider:'noaa') so the existing
normalizer/ingestion consumes it UNCHANGED — same schema as the open-meteo all_marine path. All 4 layers
(waves/swell_1/swell_2/wind_waves). The caller (ingest_gfs_marine_global) keeps provider='open-meteo' so
the manifest (source_dataset='ncep_gfswave025') stays byte-identical to the open-meteo path — zero regression.

USAGE:
  - As a subprocess (production): python noaa_gfs_wave_fetcher.py '<payload-json>' → writes JSON to
    payload["output_path"]; prints a one-line SUMMARY:... to stdout.
  - Standalone verification (Render shell, no args): python backend/services/noaa_gfs_wave_fetcher.py
    → runs global / 10° / 14-day with the latest cycle, writes nothing, prints the summary.
    NOAA_FETCHER_QUICK=1 → tiny region + ~2 days for a fast (~1-2 min) smoke test.
"""
import os
import sys
import json
import time
import uuid
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta

S3_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
GRID = "global.0p25"
HTTP_TIMEOUT = 60

# (idx variable token, idx level/sequence token) -> open-meteo variable, unit
#   The 12 wave messages we extract; ordering here is also the canonical decode order.
IDX_TO_OM = [
    (("HTSGW", "surface"),        "wave_height",                    "m"),
    (("PERPW", "surface"),        "wave_period",                    "s"),
    (("DIRPW", "surface"),        "wave_direction",                 "°"),
    (("WVHGT", "surface"),        "wind_wave_height",               "m"),
    (("SWELL", "1 in sequence"),  "swell_wave_height",              "m"),
    (("SWELL", "2 in sequence"),  "secondary_swell_wave_height",    "m"),
    (("WVPER", "surface"),        "wind_wave_period",               "s"),
    (("SWPER", "1 in sequence"),  "swell_wave_period",              "s"),
    (("SWPER", "2 in sequence"),  "secondary_swell_wave_period",    "s"),
    (("WVDIR", "surface"),        "wind_wave_direction",            "°"),
    (("SWDIR", "1 in sequence"),  "swell_wave_direction",           "°"),
    (("SWDIR", "2 in sequence"),  "secondary_swell_wave_direction", "°"),
]
OM_UNITS = {om: u for _, om, u in IDX_TO_OM}
OM_ORDER = [om for _, om, _ in IDX_TO_OM]


def _vector_blockmean() -> bool:
    """Is the vectorized regrid path on? Read PER CALL, never at import — a module-level read freezes
    the environment as of process start, and this repo's recorded scar is a flag holding a different
    value in each lane.

    ✅ DEFAULT **ON** since 2026-08-07, on three layers of evidence — the third of which is the one
    that actually licenses it, because a parity proof about a FUNCTION is not a proof about the LOOP
    that calls it, and neither is a proof about REAL DATA:

      1. FUNCTIONS — `tests/test_blockmean_vectorized_parity.py`: bit-identical against the scalar
         oracle over a population that PLANTS the branches random data never reaches (clamped row
         edges, wrapping columns, all-NaN and zero-energy blocks, the total-only and conf=None
         branches measured at 0% of 3,000 random blocks).
      2. THE LOOP — `tests/test_vector_blockmean_loop_shadow.py`: the real `fetch_global_coarse`,
         run once per flag state against a stubbed decoder, byte-identical payloads; plus a coverage
         assertion that COUNTS every batch reduction, which is how `direction_block_batch` was caught
         being wired but never executed.
      3. REAL GRIB — `.github/workflows/vector-blockmean-parity.yml`, run 31133454231 on
         **python 3.12.13 / pygrib 2.1.8 / numpy 2.5.1** (production's interpreter), fetching NOAA's
         actual byte-range GRIB2 twice, once per flag state:
             SUMMARY both runs: points=15 steps_ok=17 steps_failed=0 timesteps=17
             **compared 4080 values across 15 points (0 null on both sides) -> IDENTICAL**
         Zero nulls matters: every compared value was a real number, not a payload of Nones that
         would match trivially.

    Read PER CALL, never at import — a module-level read freezes the environment as of process start,
    and this repo's recorded scar is a flag holding a different value in each lane.
    Kill: FETCH_VECTOR_BLOCKMEAN=0 restores the per-point loop, which is retained, not deleted."""
    return os.environ.get("FETCH_VECTOR_BLOCKMEAN", "1") != "0"


def _coarse_axis(lo, hi, step):
    """Axis lo..hi INCLUSIVE of both endpoints — actually matching generate_bbox_coords / the
    open-meteo generator (both `<= hi + eps`). The previous `< hi` EXCLUSIVE form under-supplied
    every NOAA-direct product by one east COLUMN and one north ROW relative to the normalizer's
    bbox-declared inclusive grid, which back-filled them as explicit is_valid=false — the
    2026-07-18 live "hard vertical line of no animations": the FL tile's -79.0 column was 21/21
    invalid (screen x=605 = the user's stripe; upstream open-meteo proven to HAVE data there).
    EXCEPTION: a full-wrap 360° longitude axis stays endpoint-exclusive (+180 duplicates -180)."""
    vals = []
    full_wrap = (hi - lo) >= 360.0 - step * 0.5
    limit = (hi - step * 0.5) if full_wrap else (hi + 1e-4)
    v = lo
    while v <= limit:
        vals.append(round(v, 4))
        v += step
    return vals


# direction variable -> the height variable that weights its energy mean (E ∝ H²)
DIR_TO_HEIGHT = {
    "wave_direction": "wave_height",
    "swell_wave_direction": "swell_wave_height",
    "secondary_swell_wave_direction": "secondary_swell_wave_height",
    "wind_wave_direction": "wind_wave_height",
}


# Energy-weighted circular-mean direction over the coarse block — the vortex-root fix (2026-07-02).
# Shared with the DWD GWAM fetcher; full rationale + tests live with the helpers.
try:
    from _fetch_common import (  # script-by-path
        energy_mean_direction_block, energy_mean_direction_block_multi_conf,
        energy_mean_direction_block_partition_conf,
        energy_mean_height_block, energy_mean_scalar_block,
        DIR_TOTAL_COHERENCE_RAMP_LO, DIR_TOTAL_COHERENCE_RAMP_HI,
    )
except ImportError:
    from services._fetch_common import (  # package
        energy_mean_direction_block, energy_mean_direction_block_multi_conf,
        energy_mean_direction_block_partition_conf,
        energy_mean_height_block, energy_mean_scalar_block,
        DIR_TOTAL_COHERENCE_RAMP_LO, DIR_TOTAL_COHERENCE_RAMP_HI,
    )

try:
    from _fetch_blockmean_vec import (                              # script-by-path
        multi_dir_conf_batch, partition_dir_conf_batch,
        direction_block_batch, height_block_batch, scalar_block_batch,
    )
except ImportError:
    from services._fetch_blockmean_vec import (                     # package
        multi_dir_conf_batch, partition_dir_conf_batch,
        direction_block_batch, height_block_batch, scalar_block_batch,
    )

# Scalar block aggregation (2026-07-04, wind_waves tri-model forensics): heights = block RMS,
# periods = H²-weighted block mean — symmetric with the direction block means. PARTITIONED WW3
# fields (WVHGT/SWELL_2) are exact-0 wherever a subcell classifies elsewhere; center-point
# sampling turned partially-windsea 10° blocks into flickering 0.0 heatmap pixels (live:
# (-60,-50) 0.0@T00 / 4.7@T12 vs reference 7.64 m). Kill switch NOAA_COARSE_SCALAR_BLOCKMEAN=0
# → legacy center-point sampling.
HEIGHT_VARS = {"wave_height", "swell_wave_height", "secondary_swell_wave_height", "wind_wave_height"}
PERIOD_TO_HEIGHT = {
    "wave_period": "wave_height",
    "wind_wave_period": "wind_wave_height",
    "swell_wave_period": "swell_wave_height",
    "secondary_swell_wave_period": "secondary_swell_wave_height",
}

# §0B-a render-confidence export (2026-07-03): the gate's own resultant length rides along as an
# extra hourly series so the frontend can FADE crest animation where the direction estimator is
# incoherent (the (20,-120)-class GFS-vs-ECMWF divergence blocks — no stable direction exists).
# Extra series, never replaces a whitelisted variable. Kill switch NOAA_COARSE_DIR_CONFIDENCE=0.
DIR_CONFIDENCE_OM = "wave_direction_confidence"

# PER-PARTITION render confidence (2026-07-31). The total sea has carried a confidence since
# §0B-a; the three PARTITIONS carried none, and they are the layers that need it most — a
# partition is exact-0 wherever WW3 assigned that subcell's energy elsewhere, so a 2° block can
# be 98 % empty of a train and still export a perfectly confident bearing for it (measured on the
# served products: s_ocean swell_2 = 1 contributing subcell of 64, s_pacific swell_2 = 4 of 64,
# n_pacific wind_waves = 1 of 64). conf = R x coverage, so it collapses to R on a full block and
# to ~0 where the layer is claiming a train it does not have. The normalizer already picks up
# "{direction_key}_confidence" GENERICALLY and the frontend already carries dir_confidence into
# the texture encoder, so this only had to be produced. Kill: NOAA_PARTITION_DIR_CONFIDENCE=0.
PARTITION_DIR_CONFIDENCE_OM = {
    "wind_wave_direction": "wind_wave_direction_confidence",
    "swell_wave_direction": "swell_wave_direction_confidence",
    "secondary_swell_wave_direction": "secondary_swell_wave_direction_confidence",
}

# The TOTAL-SEA direction (om 'wave_direction') is synthesized from the three PARTITIONS instead of
# block-averaging DIRPW: DIRPW is a PEAK direction and is BIMODAL in two-system water, so its block
# mean stays unstable (measured: only 41°→31° mean neighbor delta; N-Atlantic still 50°). Each
# partition is unimodal with its own height, so the energy blend is stable. (dir_om, height_om) pairs:
TOTAL_SEA_PARTITIONS = [
    ("wind_wave_direction", "wind_wave_height"),
    ("swell_wave_direction", "swell_wave_height"),
    ("secondary_swell_wave_direction", "secondary_swell_wave_height"),
]


def _pick_cycle(requests, now, max_f):
    """Probe AWS Open Data newest-first for a COMPLETE GFS-Wave cycle (f000 + the requested last hour
    both present). Returns (cycle_dt, file_prefix) or (None, None)."""
    # GFS runs 00/06/12/18Z; waves land ~3.5-5 h after cycle. Walk back up to ~36 h.
    floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for back in range(0, 7):
        cyc = floor6 - timedelta(hours=6 * back)
        ymd = cyc.strftime("%Y%m%d")
        hh = cyc.strftime("%H")
        prefix = f"{S3_BASE}/gfs.{ymd}/{hh}/wave/gridded/gfswave.t{hh}z.{GRID}."
        try:
            r0 = requests.head(f"{prefix}f000.grib2.idx", timeout=HTTP_TIMEOUT)
            rN = requests.head(f"{prefix}f{max_f:03d}.grib2.idx", timeout=HTTP_TIMEOUT)
            if r0.status_code == 200 and rN.status_code == 200:
                return cyc, prefix
        except Exception:
            continue
    return None, None


def _parse_idx(text):
    """Parse a GFS .idx into [(start, end_or_None, var_token, level_token)] in file order.
    end of message i = start of message i+1 (minus 1); last message → None (range to EOF)."""
    rows = []
    for line in text.strip().splitlines():
        parts = line.split(":")
        if len(parts) < 5:
            continue
        try:
            start = int(parts[1])
        except ValueError:
            continue
        rows.append([start, None, parts[3], parts[4]])
    for i in range(len(rows) - 1):
        rows[i][1] = rows[i + 1][0] - 1
    return rows


def _select_ranges(idx_rows):
    """From parsed idx rows, return (ordered list of (om_var,(start,end)), coalesced byte ranges).
    Selection order follows IDX_TO_OM so concat order == decode order."""
    by_key = {}
    for start, end, var, lvl in idx_rows:
        by_key[(var, lvl)] = (start, end)
    selected = []  # (om_var, (start,end))
    for key, om, _ in IDX_TO_OM:
        if key in by_key:
            selected.append((om, by_key[key]))
    return selected


def _fetch_message_bytes(requests, url, start, end):
    rng = f"bytes={start}-{end}" if end is not None else f"bytes={start}-"
    r = requests.get(url, headers={"Range": rng}, timeout=HTTP_TIMEOUT)
    if r.status_code not in (200, 206):
        raise RuntimeError(f"range GET {rng} -> HTTP {r.status_code}")
    # WS-CAN-0017: THE BYTES MUST BE THE BYTES WE ASKED FOR.
    # ⚠️ The dangerous case is NOT truncation — that decodes to too few GRIB messages and the
    # count check catches it. It is OVER-fetch: a server that IGNORES `Range` answers 200 with the
    # WHOLE FILE, which was accepted here. Concatenating whole files yields MORE messages than
    # expected, and every caller reads its variables POSITIONALLY (`msgs[0]` is U and `msgs[1]` is
    # V in the wind lane), so the wrong message silently becomes the wrong variable.
    # `end is None` means an open-ended `bytes=<start>-`, whose length nobody stated — validating a
    # length that was never requested would break those callers, so it is deliberately exempt.
    if end is not None:
        want = end - start + 1
        got = len(r.content)
        if got != want:
            msg = (f"range GET {rng} -> HTTP {r.status_code} returned {got} bytes, expected {want}"
                   f" (a server that ignores Range answers 200 with the whole file)")
            # ⭐ KILL SWITCH, house convention — every other risky switch in this repo has one.
            # VERIFIED against live NOAA 2026-08-14: requested bytes=0-706045, got exactly 706046,
            # Content-Range confirmed. But that was a DIRECT fetch, and production egresses through
            # Render, which cannot be tested from a dev box. If a proxy ever rewrote ranges this
            # check would stop EVERY ingest cycle and the whole forecast estate would go stale
            # behind it.
            # 2026-08-15 (Master Codex MC-05): the hatch EXTRACTS, it never accepts. The proxy
            # case it exists for is PROVABLE — a server that ignored `Range` answers 200 with the
            # WHOLE file, which CONTAINS the bytes we asked for, and every request starts on an
            # .idx message boundary so the slice must open with the GRIB magic. Prove it and
            # slice; anything unprovable still raises even with the switch thrown, because feeding
            # a wrong-length body to a POSITIONAL GRIB parser is corruption, and an escape hatch
            # that keeps ingest alive on corrupt bytes is worse than an outage.
            if os.environ.get("GRIB_RANGE_STRICT", "1") == "0":
                if (r.status_code == 200 and got > want and start + want <= got
                        and r.content[start:start + 4] == b"GRIB"):
                    sys.stderr.write(f"[range-integrity EXTRACT] {msg} -- whole-file response "
                                     f"proven (GRIB magic at byte {start}); slicing the requested "
                                     f"{want} bytes\n")
                    return r.content[start:start + want]
                sys.stderr.write(f"[range-integrity UNPROVABLE] {msg} -- switch is thrown but no "
                                 f"safe slice can be proven; refusing\n")
            raise RuntimeError(msg)
    return r.content


def fetch_global_coarse(payload):
    """Return (points_or_regions, steps_ok, steps_failed, times) for the coarse global grid via NOAA GFS-Wave.

    MULTI-BBOX (2026-07-31, single-download-pass — the same port applied to the wind lane, and the
    2026-07-13 GWAM precedent before that). NOAA's byte-range selects a GRIB *message*, not a region:
    a message is the whole global 0.25° field, so the bbox never touches the wire and a per-region
    pass re-downloads identical bytes. That redundancy is what WORLDWIDE_REGIONS_PER_CYCLE rationed
    by ROTATION, and the rotation is what left uk_ireland and east_australia on an 18.7-day-old run.
    Measured consequence at the SERVE path (2026-07-31 20:19Z, /api/weather/point GFS marine waves):
    uk_ireland fell through to gfs_marine_waves_global_mid — an 8x coarser grid under the height
    chain — and east_australia had no tile at all, answering `source: backend_direct_point` with a
    run_time stamped at request time, i.e. a LIVE per-request upstream fetch on the serve box (three
    melt incidents in its history). A missing tile does not merely coarsen; it converts a batch cost
    into per-request compute.
    A payload `bboxes: {region_id: bbox}` samples EVERY region from each decoded field in ONE pass.
    The legacy single-`bbox` path is unchanged (plain list of points).
    """
    import numpy as np
    # POOLED, not the module: same .get/.head, one handshake instead of one per call (~346 ms/call
    # measured vs NOMADS; ~157 s per 113-step run). See _fetch_common.http_session for the numbers
    # and the seam. Kill: FETCH_HTTP_SESSION=0.
    try:
        from _fetch_common import http_session           # script-by-path
    except ImportError:
        from services._fetch_common import http_session  # package context
    requests = http_session()
    import pygrib
    import gc

    multi = payload.get("bboxes") or None            # {region_id: bbox} -> multi-region mode
    regions = dict(multi) if multi else {"__single__": payload["bbox"]}
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 14))
    max_f = min(int(forecast_days) * 24, 384)

    # ── PER-REGION RESOLUTION (2026-08-02) ───────────────────────────────────────────────────────
    # A download pass is already region-independent: NOAA's byte-range selects a GRIB *message*, and
    # a message is the whole global 0.25° field, so the bbox never touches the wire (2b0e1466). But
    # the pass still forced ONE output resolution on every bbox — which is why the 2° global_mid tile
    # could not ride along with the 0.25° flagship tiles and instead re-downloaded the identical
    # f000-f336 set: ~790 MB and ~26 min, twice per pilots cycle (measured, run 30748383857).
    # `resolutions` ({region_id: degrees}) lifts that, defaulting to the scalar for any region it
    # omits — so a payload WITHOUT the key is byte-identical to before, and the single-bbox path
    # never carries one at all.
    # Kill switch NOAA_MULTI_RES=0 -> ignore the map, one resolution for every bbox, exactly as before.
    _res_map = payload.get("resolutions") or {}
    if os.environ.get("NOAA_MULTI_RES", "1") == "0":
        _res_map = {}
    res_by = {rid: float(_res_map.get(rid, resolution)) for rid in regions}

    # rid -> (lats, lons). Axis order matches the single-bbox path exactly (lat outer, lon inner).
    axes = {rid: (_coarse_axis(float(bb["south"]), float(bb["north"]), res_by[rid]),
                  _coarse_axis(float(bb["west"]), float(bb["east"]), res_by[rid]))
            for rid, bb in regions.items()}
    # Block half-width per region, against the FIXED 0.25° source grid (10° block -> half = 20).
    # Loop-invariant, so computed ONCE here instead of per forecast hour as the single `half` was.
    half_by = {rid: max(1, int(round(res_by[rid] / 0.25 / 2.0))) for rid in regions}
    f_hours = list(range(0, max_f + 1, 3))  # 3-hourly (all multiples of 3 exist 0..384)

    cycle_dt, prefix = _pick_cycle(requests, datetime.now(timezone.utc), max_f)
    if not prefix:
        sys.stderr.write("[noaa_gfs_wave_fetcher] no complete GFS-Wave cycle found on AWS Open Data\n")
        return ({} if multi else []), 0, 0, None

    tmp = Path(tempfile.gettempdir())
    # Env-constant switches, read once (also referenced by the per-step decode loop below).
    # Kill switch NOAA_COARSE_DIR_BLOCKMEAN=0 → legacy raw point-sampling of directions.
    blockmean = os.environ.get("NOAA_COARSE_DIR_BLOCKMEAN", "1") != "0"
    # Kill switch NOAA_COARSE_SCALAR_BLOCKMEAN=0 → legacy center-point sampling of heights/periods.
    scalar_blockmean = blockmean and os.environ.get("NOAA_COARSE_SCALAR_BLOCKMEAN", "1") != "0"
    # Kill switch NOAA_COARSE_DIR_TOTAL_FIELD=0 → partition-blend only (no DIRPW coherence tier).
    total_field = os.environ.get("NOAA_COARSE_DIR_TOTAL_FIELD", "1") != "0"
    export_confidence = blockmean and os.environ.get("NOAA_COARSE_DIR_CONFIDENCE", "1") != "0"
    # Per-partition confidence (R x coverage) — see PARTITION_DIR_CONFIDENCE_OM.
    export_part_conf = blockmean and os.environ.get("NOAA_PARTITION_DIR_CONFIDENCE", "1") != "0"
    # accumulator: point index -> {om_var -> [values per timestep]}; the confidence series is
    # initialized WITH the whitelisted variables so failed steps keep every series time-aligned.
    series_keys = OM_ORDER + ([DIR_CONFIDENCE_OM] if export_confidence else [])
    if export_part_conf:
        series_keys = series_keys + list(PARTITION_DIR_CONFIDENCE_OM.values())
    series_by = {rid: [{om: [] for om in series_keys} for _ in range(len(la) * len(lo))]
                 for rid, (la, lo) in axes.items()}
    idx_by = None  # rid -> [(row, col), ...] per coarse point, built from the first decoded grid
    times = []
    steps_ok = 0
    steps_failed = 0

    # ── SOFT DEADLINE (2026-08-02) ───────────────────────────────────────────────────────────────
    # This file runs as a subprocess under a HARD kill (noaa_marine_service). A hard kill is
    # ALL-OR-NOTHING, and on 2026-08-02 that cost the whole lane: the global_mid 14-day pass ran the
    # full 30-min ceiling, was killed, and every downloaded step was discarded — GFS marine
    # global_mid went stale (19.8 h and climbing) while EVERY other GFS-marine job in the same run
    # succeeded. Nothing was broken upstream or here; upstream had merely SLOWED (~8.8 s/step on
    # 08-01 -> ~14-17 s/step on 08-02) and the ceiling had no headroom left. The per-step `except`
    # below ALREADY degrades gracefully, so the only thing that made a slow run catastrophic was that
    # the deadline lived OUTSIDE the process where it could only kill, never salvage.
    # Hours are fetched ASCENDING, so a truncation drops the FAR hours and keeps the near-term surf —
    # the half users actually read. Kill switch NOAA_FETCH_BUDGET_S=0 -> legacy all-or-nothing.
    budget_s = float(os.environ.get("NOAA_FETCH_BUDGET_S", "2400"))
    t_start = time.time()
    truncated_at = None

    for f in f_hours:
        # Checked BEFORE any append, so `times` and every series stay equal-length — the same
        # alignment invariant the except-branch below maintains. Never START a step we can't finish.
        if budget_s > 0 and (time.time() - t_start) >= budget_s:
            truncated_at = f
            sys.stderr.write(
                f"[noaa_gfs_wave_fetcher] soft deadline {budget_s:.0f}s reached at f{f:03d} — "
                f"returning {steps_ok} completed steps instead of discarding them\n")
            break
        url = f"{prefix}f{f:03d}.grib2"
        out = tmp / f"gfswave_{uuid.uuid4().hex}.grib2"
        try:
            idx_txt = requests.get(url + ".idx", timeout=HTTP_TIMEOUT).text
            selected = _select_ranges(_parse_idx(idx_txt))
            if len(selected) != len(OM_ORDER):
                raise RuntimeError(f"idx missing wave messages (got {len(selected)}/{len(OM_ORDER)})")
            with open(out, "wb") as fh:
                for _om, (start, end) in selected:
                    fh.write(_fetch_message_bytes(requests, url, start, end))

            grbs = pygrib.open(str(out))
            msgs = grbs.read()  # in concatenation order == OM_ORDER
            # WS-CAN-0017: `!=`, NOT `<`. The variables below are read POSITIONALLY
            # (`msgs[mi]` per OM_ORDER), so this depends on "exactly these messages", not "at
            # least this many". A `<` accepted N+k — the signature of a Range request answered
            # with a whole file — and then silently mapped the wrong message to each variable.
            if len(msgs) != len(OM_ORDER):
                raise RuntimeError(f"decoded {len(msgs)} msgs, expected exactly {len(OM_ORDER)}")

            if idx_by is None:
                # One nearest-neighbour map per region, built ONCE off the first decoded message —
                # the global grid is identical every step, so this is pure local indexing.
                g0 = msgs[0]
                glats, glons = g0.latlons()
                lat1d = np.asarray(glats[:, 0], dtype=float)
                lon1d = np.asarray(glons[0, :], dtype=float)
                is_360 = bool(lon1d.max() > 180.0)
                idx_by = {}
                for rid, (la_axis, lo_axis) in axes.items():
                    rmap = []
                    for la in la_axis:
                        r = int(np.abs(lat1d - la).argmin())
                        for lo in lo_axis:
                            target = (lo % 360.0) if is_360 else lo
                            c = int(np.abs(lon1d - target).argmin())
                            rmap.append((r, c))
                    idx_by[rid] = rmap

            # Decode every message up-front so DIRECTION vars can pair with their HEIGHT var (energy weight).
            arrs = {}
            for mi, om in enumerate(OM_ORDER):
                vals = msgs[mi].values  # masked array (land/missing masked)
                arrs[om] = np.ma.filled(np.ma.asarray(vals, dtype=float), np.nan)
            # blockmean/total_field/export_confidence hoisted above the hour loop (env-constant).
            # total_field default ON (third pass, 2026-07-02): in tri-modal water the partition vectors
            # cancel and the blend lands on a minority system (Baja block 20,-120 read TO≈257 while DIRPW
            # says TO≈6) — the coherence-gated DIRPW tier in the _conf helper fixes exactly that.
            _partition_pairs = [(arrs[d], arrs[h]) for d, h in TOTAL_SEA_PARTITIONS]
            _total_h = arrs.get("wave_height") if total_field else None
            # The decode + the block-mean inputs above are per-STEP and region-independent; only the
            # point iteration below is per-region. That asymmetry is the whole optimisation, and it
            # is why the BLOCK WIDTH (`half`) can differ per region for free — it is read inside the
            # per-region loops, never in the shared decode.
            for om in OM_ORDER:
                arr = arrs[om]
                if blockmean and om == "wave_direction":
                    # total-sea direction: coherence-gated blend of DIRPW-block-mean and partitions
                    for rid, rmap in idx_by.items():
                        series = series_by[rid]
                        half = half_by[rid]
                        # VECTORIZED PATH (2026-08-06, MASTER-AUDIT-9.0 Phase 2). Same reduction, one
                        # strided pass instead of ~15,000 python calls: measured 16.8x on this call
                        # (97 -> 5.79 us/point), the single most expensive of the five at 31.0% of the
                        # regrid cost. Bit-identical by construction — the batch form vectorizes only
                        # the interior and DELEGATES clamped edge rows to the scalar function passed
                        # here. Guard: tests/test_blockmean_vectorized_parity.py, whose population
                        # PLANTS the total-only and conf=None branches that random data never reaches
                        # (measured 0% of 3,000 blocks). Kill: FETCH_VECTOR_BLOCKMEAN=0.
                        if _vector_blockmean() and rmap:
                            _sc = (lambda _r, _c, _h=half:
                                   energy_mean_direction_block_multi_conf(
                                       _partition_pairs, arr, _r, _c, _h, True, _total_h))
                            _rs = np.fromiter((p[0] for p in rmap), dtype=np.intp, count=len(rmap))
                            _cs = np.fromiter((p[1] for p in rmap), dtype=np.intp, count=len(rmap))
                            _bd, _bc, _bp = multi_dir_conf_batch(
                                _partition_pairs, arr, _rs, _cs, half, True, _sc,
                                total_h_arr=_total_h,
                                ramp_lo=DIR_TOTAL_COHERENCE_RAMP_LO,
                                ramp_hi=DIR_TOTAL_COHERENCE_RAMP_HI)
                            for pi in range(len(rmap)):
                                _x = float(_bd[pi])
                                series[pi][om].append(round(_x, 4) if _x == _x else None)
                                if export_confidence:
                                    series[pi][DIR_CONFIDENCE_OM].append(
                                        round(float(_bc[pi]), 4) if _bp[pi] else None
                                    )
                            continue
                        for pi, (r, c) in enumerate(rmap):
                            x, conf = energy_mean_direction_block_multi_conf(_partition_pairs, arr, r, c, half, True, _total_h)
                            series[pi][om].append(round(float(x), 4) if x == x else None)
                            if export_confidence:
                                series[pi][DIR_CONFIDENCE_OM].append(
                                    round(float(conf), 4) if conf is not None else None
                                )
                    continue
                h_arr = arrs.get(DIR_TO_HEIGHT[om]) if (blockmean and om in DIR_TO_HEIGHT) else None
                is_height = scalar_blockmean and om in HEIGHT_VARS
                p_h_arr = arrs.get(PERIOD_TO_HEIGHT[om]) if (scalar_blockmean and om in PERIOD_TO_HEIGHT) else None
                # A PARTITION direction also exports R x coverage, because energy weighting only
                # ever sees subcells where the train exists — see PARTITION_DIR_CONFIDENCE_OM.
                part_conf_key = PARTITION_DIR_CONFIDENCE_OM.get(om) if export_part_conf else None
                for rid, rmap in idx_by.items():
                    series = series_by[rid]
                    half = half_by[rid]
                    # VECTORIZED PATH — the same four reductions, one strided pass each. The branch
                    # below is decided per-VARIABLE, not per-point, so it hoists cleanly out of the
                    # point loop. Measured speedups: partition_conf 15.5x, scalar 18.3x, height
                    # 21.9x, direction 12.5x. Together with the multi_conf site above this covers
                    # 100% of the regrid cost (510.8 s -> ~29.4 s per 113-step run, 17.4x).
                    # Bit-identical by construction: each batch form vectorizes only the interior and
                    # DELEGATES clamped edge rows to the scalar function handed to it.
                    # Kill: FETCH_VECTOR_BLOCKMEAN=0.
                    if _vector_blockmean() and rmap:
                        _rs = np.fromiter((p[0] for p in rmap), dtype=np.intp, count=len(rmap))
                        _cs = np.fromiter((p[1] for p in rmap), dtype=np.intp, count=len(rmap))
                        _vals = _pconfs = None
                        if h_arr is not None and part_conf_key:
                            _vals, _pconfs = partition_dir_conf_batch(
                                arr, h_arr, _rs, _cs, half, True,
                                lambda _r, _c, _h=half: energy_mean_direction_block_partition_conf(
                                    arr, h_arr, _r, _c, _h, True))
                        elif h_arr is not None:
                            _vals = direction_block_batch(
                                arr, h_arr, _rs, _cs, half, True,
                                lambda _r, _c, _h=half: energy_mean_direction_block(
                                    arr, h_arr, _r, _c, _h, True))
                        elif is_height:
                            _vals = height_block_batch(
                                arr, _rs, _cs, half, True,
                                lambda _r, _c, _h=half: energy_mean_height_block(
                                    arr, _r, _c, _h, True))
                        elif p_h_arr is not None:
                            _vals = scalar_block_batch(
                                arr, p_h_arr, _rs, _cs, half, True,
                                lambda _r, _c, _h=half: energy_mean_scalar_block(
                                    arr, p_h_arr, _r, _c, _h, True))
                        if _vals is not None:
                            for pi in range(len(rmap)):
                                if _pconfs is not None:
                                    # ⚠️ the scalar form NEVER returns None here (its fallbacks
                                    # return 0.0), so this is an unconditional round — matching it.
                                    series[pi][part_conf_key].append(round(float(_pconfs[pi]), 4))
                                _x = float(_vals[pi])
                                series[pi][om].append(round(_x, 4) if _x == _x else None)
                            continue
                    for pi, (r, c) in enumerate(rmap):
                        if h_arr is not None and part_conf_key:
                            x, _pconf = energy_mean_direction_block_partition_conf(
                                arr, h_arr, r, c, half, True)
                            series[pi][part_conf_key].append(
                                round(float(_pconf), 4) if _pconf is not None else None)
                        elif h_arr is not None:
                            # global.0p25 grid → longitude always wraps
                            x = energy_mean_direction_block(arr, h_arr, r, c, half, True)
                        elif is_height:
                            x = energy_mean_height_block(arr, r, c, half, True)
                        elif p_h_arr is not None:
                            x = energy_mean_scalar_block(arr, p_h_arr, r, c, half, True)
                        else:
                            x = arr[r, c]
                        series[pi][om].append(round(float(x), 4) if x == x else None)  # x==x drops NaN
            grbs.close()

            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_ok += 1
        except Exception as e:
            # keep the time-axis aligned: append None for this timestep so all series stay equal
            # length — for EVERY region, or one region's arrays desync from `times` and every later
            # value is attributed to the wrong timestamp (a silent time shift).
            for series in series_by.values():
                for pt in series:
                    for om in series_keys:
                        if len(pt[om]) < steps_ok + steps_failed + 1:
                            pt[om].append(None)
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_failed += 1
            sys.stderr.write(f"[noaa_gfs_wave_fetcher] f{f:03d} failed: {type(e).__name__}: {e}\n")
        finally:
            try:
                if out.exists():
                    out.unlink()
            except Exception:
                pass
            gc.collect()

    if idx_by is None:
        return ({} if multi else []), 0, steps_failed, None

    # ── MINIMUM COVERAGE FLOOR ───────────────────────────────────────────────────────────────────
    # A truncated batch still PRUNES the previous run: prune_superseded_products is keyed on run_time
    # and GFS carries no estimated tail to shield it (copernicus_validator's "plain newest-run" rule),
    # so a stub would REPLACE a healthy 14-day product and SHRINK the served horizon — trading a
    # freshness problem for a coverage one. Below the floor, return nothing instead: the older,
    # longer product keeps serving, which beats overwriting it with a stump. Same discipline as
    # product_run_age_census's "REFUSING TO REPORT" — an instrument that cannot do its job says so.
    # Floor SCALES with what was actually asked for and caps at the absolute bar, so salvage stays
    # possible at every horizon: capping at `max_f` itself would set a 2-day request's floor to the
    # whole 2 days, refusing every partial on principle and quietly disabling this path for the
    # short passes. Half the request, or 120 h, whichever is SMALLER -> 14 d judged at 120 h (the
    # bar that matters for global_mid), a 5 d pilot pass at 60 h, a 2 d quick pass at 24 h.
    # ⛔⛔ TWO INDEPENDENT DEFECTS LIVED HERE UNTIL 2026-08-07 (MASTER-AUDIT-10.0 §1.4 / row E), and
    # fixing either one alone leaves the floor useless.
    #
    #  (1) IT WAS GATED `if truncated_at is not None`, and `truncated_at` is set ONLY by the
    #      soft-deadline break above. So the floor could fire only on the SLOW failure and never on
    #      the BROKEN one — upstream 429/503, short-range publication, malformed GRIB. Those raise
    #      per-step, are caught, and leave `truncated_at` None.
    #  (2) IT MEASURED THE WRONG QUANTITY. `covered_h = (len(times) - 1) * 3` counts `times`, and
    #      the per-step `except` branch appends to `times` too (it appends None values to keep the
    #      alignment invariant). So a run in which EVERY step failed still measured a full 336 h.
    #
    # MEASURED by driving the real loop with a stubbed wire, deadline deliberately never binding:
    #     ok_steps  failed  covered_h(old)   null_frac
    #        113       0         336            0.0%
    #         60      53         336           46.9%
    #         20      93         336           82.3%
    #          1     112         336           99.1%   <- shipped, claiming a 336 h horizon
    #   d(covered_h)/d(steps_failed) = +0.000   at every rate
    #   d(null%)    /d(steps_failed) = +0.885
    # ★★★ AN INSTRUMENT WHOSE DERIVATIVE W.R.T. ITS OWN SUBJECT IS ZERO CANNOT DETECT IT. That is
    # why (2) is not optional: with only (1) fixed the floor would compute 336 >= 120 and pass a
    # 99.1%-null product every time.
    #
    # ⚠️ WHY `steps_ok` AND NOT `len(times)`: it counts only steps that actually decoded. In the
    # pure-truncation case (steps_failed == 0) `steps_ok == len(times)`, so this is BYTE-IDENTICAL
    # to the previous behaviour on the path the soft-deadline tests already pin — the change can
    # only ever be MORE conservative, never less.
    #
    # ⚠️⚠️ THIS FLOOR EXISTS IN 1 OF 9 FETCHERS, AND THAT IS DELIBERATELY NOT BEING "FIXED" HERE.
    # Six siblings (`dwd_gwam`, `dwd_icon_wind`, `dwd_icon_pressure`, `noaa_gfs_wind`,
    # `noaa_gfs_pressure`, `ecmwf_opendata`) also track `steps_failed`, so they can also ship a
    # partially-null product. That is a claim about CODE. Whether it is an EXPOSURE needs a
    # denominator nobody has measured: each lane's observed upstream failure rate, and whether its
    # prune rule actually replaces a healthy longer product the way GFS's "plain newest-run" one
    # does (copernicus_validator.py:389). ★ The 2026-08-06 session lost five builds to exactly this
    # error, and the 08-07 audit closed a salvage propagation on it — the six unsalvaged lanes ran
    # at 3.3-36.1% of their kill. PRICE IT WITH A PAIRED MEASUREMENT BEFORE COPYING THIS.
    floor_h = min(float(os.environ.get("NOAA_FETCH_MIN_HOURS", "120")), float(max_f) * 0.5)
    covered_h = max(0, steps_ok - 1) * 3
    if covered_h < floor_h:
        sys.stderr.write(
            f"[noaa_gfs_wave_fetcher] REFUSING partial result: covered {covered_h}h < floor "
            f"{floor_h:.0f}h (steps_ok={steps_ok} steps_failed={steps_failed} "
            f"truncated_at={truncated_at}) — keeping the previous run rather than pruning it to a "
            f"stub\n")
        return ({} if multi else []), steps_ok, steps_failed, None

    by_region = {}
    for rid, (la_axis, lo_axis) in axes.items():
        series = series_by[rid]
        points = []
        pi = 0
        for la in la_axis:
            for lo in lo_axis:
                hourly = {"time": times}
                for om in series_keys:
                    hourly[om] = series[pi][om]
                units = {"time": "iso8601", **OM_UNITS}
                if export_confidence:
                    units[DIR_CONFIDENCE_OM] = "fraction"
                points.append({
                    "latitude": float(la), "longitude": float(lo),
                    "generationtime_ms": 0, "utc_offset_seconds": 0,
                    "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                    "__provider": "noaa",
                    "hourly_units": units,
                    "hourly": hourly,
                })
                pi += 1
        by_region[rid] = points

    if multi:
        return by_region, steps_ok, steps_failed, times
    return by_region["__single__"], steps_ok, steps_failed, times


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        quick = os.environ.get("NOAA_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("NOAA_FETCHER_DAYS", "2" if quick else "14"))
        bbox = ({"west": -80.0, "south": 20.0, "east": -40.0, "north": 40.0} if quick
                else {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0})
        payload = {"bbox": bbox, "resolution": 10.0, "forecast_days": days, "output_path": ""}

    t0 = time.time()
    points, ok, failed, times = fetch_global_coarse(payload)
    elapsed = time.time() - t0

    out_path = payload.get("output_path", "")
    # Multi-region mode: `points` is {region_id: [points]} -> wrap in the keyed envelope the multi
    # service fn unwraps; flatten for the summary stats. Single mode unchanged (plain list).
    is_multi = isinstance(points, dict)
    out_obj = {"__multi_region__": True, "regions": points} if is_multi else points
    flat = [p for pts in points.values() for p in pts] if is_multi else points

    if out_path and flat:
        with open(out_path, "w") as f:
            json.dump(out_obj, f)

    nz = 0
    sample_max = None
    if flat:
        wh = [v for p in flat for v in p["hourly"].get("wave_height", []) if v is not None]
        nz = sum(1 for v in wh if v and v > 0)
        sample_max = max(wh) if wh else None
    regions_note = f" regions={len(points)}" if is_multi else ""
    # A truncated run is a DEGRADED success, not a clean one. The service logs this SUMMARY line on
    # exit 0, so say it HERE — otherwise a short horizon reads as a healthy fetch and the soft
    # deadline becomes invisible exactly when someone needs to know it fired.
    want_steps = min(int(payload.get("forecast_days", 14)) * 24, 384) // 3 + 1
    truncated = "yes" if (times is not None and len(times) < want_steps) else "no"
    print(f"SUMMARY: points={len(flat)}{regions_note} steps_ok={ok} steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"truncated={truncated} "
          f"wave_height_nonzero={nz} wave_height_max={sample_max} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and flat) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
