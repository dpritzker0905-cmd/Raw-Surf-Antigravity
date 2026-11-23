"""Ensemble gust risk raster frames (2026-11-23, gate gust-ens-risk-v1): P(gust >= 25 / 34 / 48 kn) from the ECMWF ENS. DARK.

WHY. The gust SOTA review (2026-11-22, rank 3) and D-075: a gust forecast without its uncertainty is not state of the art. ECMWF's
own EFI/SOT products show the chance of exceeding a threshold. This set publishes the member fraction per cell and step, beside the
per-model gust sets (frame_set_raster SPECS `gust`, `gust_euro`, `gust_icon`), for a probability view under Gusts.

SOURCE. ECMWF open-data IFS ENS member files (`enfo`, `ef`), the 50 perturbed members (the control left the open-data ef files on
2026-05-13), read by #946's fetcher (ens_wind_fetch.fetch_step: byte ranges of only the gust messages, a partial ensemble
refused). The gust parameter and window follow the step (ens_gust_risk_core): `10fg` max over the last 1 h at 3-90 h, `10fg3` over
the last 3 h at 93-144 h, `10fg` over the last 6 h at 150-360 h; every message's window is checked against that table. One model,
its own native 0-360 h range: no seam with another model, no stand-in, no cross-model blend (D-075, D-076).

FRAME. Three one-byte fields (frame_binary GUST_P25_PCT / P34 / P48): the percent of members at or above 25, 34, 48 kn
(12.861 / 17.491 / 24.693 m/s), on the 0.25-degree lattice (row 0 = 90S, column 0 = 180W), exact (50 members -> even percents).
The member values are ECMWF's own grid points: the 0.25-degree ENS grid IS the lattice (a roll to 180W, no interpolation).

COST (measured in the publisher PR's log). One step = 50 messages x ~1.4 MB; 84 steps (3-144 h by 3, 150-360 h by 6) ~ 6 GB of
public byte-range reads per run, decoded in the job; nothing touches Render. Frames: see the log's size table.

SWITCHES. `default_on` False; repo variable FRAME_RASTER_GUST_RISK=1 publishes the frames. Publishing is HIDDEN: no client
reads this set, and every index carries `display` false unless GUST_RISK_DISPLAY=1 AND the gate's result records PASS (the
guardrails below, the director 2026-11-23). A recorded FAIL or VOID turns the publisher off by itself.
"""
from __future__ import annotations

import os
import threading
from datetime import timedelta, timezone

# NO numpy (or numpy-importing module) at load time (2026-11-23, regression fix): frame_set_raster_plugins imports this module,
# and raster_set_freshness.py (data-health-monitor) imports the raster sets with a system python3 that has no numpy. The
# numeric core is imported lazily (_gr) inside the functions that compute; these load-time constants equal the core's
# (tests/test_frame_set_raster_gust_risk.py pins the parity).
HOURS = tuple(range(3, 145, 3)) + tuple(range(150, 361, 6))     # = ens_gust_risk_core.native_steps(360)
THRESHOLDS_KN = (25, 34, 48)                                     # = ens_gust_risk_core.THRESHOLDS_KN
MEMBERS = 50                                                     # = ens_gust_risk_core.MEMBERS


def _gr():
    try:
        from services.weather_pipeline import ens_gust_risk_core as gr
    except ImportError:  # pragma: no cover - run by path, where `services` is not importable
        from weather_pipeline import ens_gust_risk_core as gr
    return gr


SET = "gust_risk_ens"
CREDIT = ("Copyright ECMWF; ECMWF open data (IFS ENS, 50 members), CC BY 4.0; modified (share of members whose 10 m gust reaches "
          "25 / 34 / 48 kn)")
LICENSE = "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); attribution to ECMWF required"
SPEC = {
    "target": {"model": "ECMWF_ENS", "domain": "weather", "layer": "gust_risk", "region_id": "global_0p25"},
    "field": None, "fields": None,                 # filled from frame_binary in register()
    "idx": ("10fg", "10fg3"), "grid": "0p25", "frame_plane": True, "convert": lambda a: a,
    "valid": (0.0, 100.0), "clip": None, "env": "FRAME_RASTER_GUST_RISK", "default_on": False, "strict": True,
    "value_kind": "ensemble_gust_exceedance_pct", "value_unit": "%",
    "source_dataset": "ECMWF IFS ENS open data enfo ef 0p25, 50 pf members, 10fg (1 h max to 90 h, 6 h max from 150 h) / 10fg3 "
                      "(3 h max, 93-144 h); percent of members >= 25, 34, 48 kn",
    "hours": HOURS, "source": "ens_gust_risk", "upstream_provider": "ecmwf",
    "credit": CREDIT, "license": LICENSE, "source_url": "https://www.ecmwf.int/en/forecasts/datasets/open-data",
    "thresholds_kn": THRESHOLDS_KN,
}


def register(specs, grids, sources):
    """Add the set and its source kind to frame_set_raster's tables (that module is at its line limit)."""
    try:
        import frame_binary as fb
    except ImportError:
        from services import frame_binary as fb
    specs.setdefault(SET, dict(SPEC, field=fb.GUST_P25_PCT, fields=fb.GUST_RISK_FIELDS, guard=guarded_publish))
    sources.setdefault(SPEC["source"], EnsGustRiskSource)


def to_lattice(arr, meta):
    """The ENS 0.25-degree field (rows south to north, eval_grib2's convention) as the frame lattice: 721 x 1440, row 0 = 90S,
    column 0 = 180W. The grid is the same points; only the longitude origin moves. Anything else raises."""
    import numpy as np
    a = np.asarray(arr)
    if a.shape != (721, 1440) or abs(meta["dlat"] - 0.25) > 1e-6 or abs(meta["dlon"] - 0.25) > 1e-6 \
            or abs(meta["lat_south"] + 90.0) > 1e-6:
        raise ValueError(f"not the 0.25-degree world grid: {a.shape} {meta}")
    shift = int(round(((meta["lon_west"] - 180.0) % 360.0) / 0.25)) % 1440   # columns from 180W to the first column
    return np.roll(a, shift, axis=1) if shift else a


def risk_planes(counts, n_members=MEMBERS):
    """{field id: percent plane} from exceed_counts' uint8 [3, rows, cols]."""
    try:
        import frame_binary as fb
    except ImportError:
        from services import frame_binary as fb
    import numpy as np
    c = np.asarray(counts, dtype=np.float64)
    if c.shape[0] != len(fb.GUST_RISK_FIELDS):
        raise ValueError(f"counts for {c.shape[0]} thresholds")
    return {fid: 100.0 * c[i] / float(n_members) for i, fid in enumerate(fb.GUST_RISK_FIELDS)}


# ---------------------------------------------------------------------------------------------------- guardrails
# The director's conditions for publishing HIDDEN before gate gust-ens-risk-v1 has scored (2026-11-23; David: "maybe switch on
# to start, but run a test"; SubQ, Reflection and LongCat chose: publish now, keep it hidden until the test passes).
# (1) Hidden, failing closed: every index says `display` false unless GUST_RISK_DISPLAY = '1' AND the gate's result file
#     records PASS; nothing in the client reads this set (tests/test_frame_set_raster_gust_risk.py scans frontend/src).
# (2) Budget: per run and per UTC day, bytes READ (counted on the wire) and bytes STORED (the gzip frames) have hard caps; a
#     cap reached refuses every remaining step, nothing is uploaded (coverage refusal) and the step exits 1. No wall-clock
#     slot: every pilots run may try; a cycle already published costs a few ~2 MB index reads (publish_blocked).
# (3) Retention: the publisher keeps the current and previous run (frame_set retention); on top, anything of this set older
#     than MAX_AGE_DAYS is deleted on every run, and the daily budget records after 30 days.
# (4) Provenance: every member message must carry the PINNED GRIB identity (centre, generating process, template); the
#     identity seen, the decoder and its version ride in each run's index (`provenance`).
# (5) Auto-disable: a recorded gate FAIL or VOID stops the publisher (no read, no write).

RESULT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                           "docs", "weather-program", "results", "gust-ens-risk-v1.md")
READ_CAP_RUN = 6.5e9                 # bytes; measured need ~6.05 GB (84 steps x 50 x ~1.4 MB + 84 indices x ~2 MB)
READ_CAP_DAY = 6.5e9                 # bytes per UTC day across runs (bucket record budget/gust_risk_ens/<YYYYMMDD>.json)
STORE_CAP_RUN = 45e6                 # bytes of gzip frames per run; measured 282-516 kB a frame (~36 MB a run)
MAX_AGE_DAYS = 14
PIN = {"centre": "ecmf", "generatingProcessIdentifier": 161, "productDefinitionTemplateNumber": 11}   # read 2026-11-23
BUDGET_PREFIX = "budget/gust_risk_ens"


class BudgetExceeded(RuntimeError):
    pass


def _env_float(name, default):
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return float(default)


def gate_state(path=None):
    """'PASS' / 'FAIL' / 'VOID' from the result file's `Gate verdict:` line; 'PENDING' when there is no result (or no line)."""
    path = path or os.environ.get("GUST_RISK_RESULT_FILE") or RESULT_FILE
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return "PENDING"
    for line in text.splitlines():
        if line.strip().lower().startswith("gate verdict:"):
            word = line.split(":", 1)[1].strip().split()[0].upper().strip("*`.") if line.split(":", 1)[1].strip() else ""
            return word if word in ("PASS", "FAIL", "VOID") else "PENDING"
    return "PENDING"


def display_allowed(path=None):
    """(1) Shown to users only when GUST_RISK_DISPLAY = '1' AND the gate recorded PASS. Any error -> hidden."""
    try:
        return os.environ.get("GUST_RISK_DISPLAY", "0") == "1" and gate_state(path) == "PASS"
    except Exception:  # noqa: BLE001 - fail closed
        return False


def publish_blocked(now, path=None):
    """The reason this run must not read or write, or None: (5) a recorded FAIL / VOID.

    There is NO wall-clock slot (removed 2026-11-23): GitHub started the 11:45 cron at 13:41Z, so a slot of UTC 11-15 would
    quietly skip the publish on late days. The day is bounded by the guards that do not depend on the clock: the per-UTC-day
    read cap (6.5 GB, recorded in the bucket), the per-run caps, and frame_set_raster.publish's "cycle already published"
    check, after which a later run reads only the run-availability index (~2 MB) and stops."""
    state = gate_state(path)
    if state in ("FAIL", "VOID"):
        return f"auto-disabled: gate gust-ens-risk-v1 recorded {state}"
    return None


def _budget_path(day):
    return f"{BUDGET_PREFIX}/{day:%Y%m%d}.json"


def day_used(sink, day):
    import json
    raw = sink.read(_budget_path(day))
    try:
        return float(json.loads(raw)["read_bytes"]) if raw else 0.0
    except (ValueError, KeyError, TypeError):
        return READ_CAP_DAY                       # an unreadable record counts as spent (fail closed)


def add_day_used(sink, day, read_bytes, writer="local"):
    import json
    total = day_used(sink, day) + float(read_bytes)
    sink.write(_budget_path(day), json.dumps({"read_bytes": total, "writer": writer}).encode("utf-8"),
               "application/json", "no-cache")
    return total


def prune_old(sink, now, max_age_days=MAX_AGE_DAYS):
    """(3) Delete this set's runs and indices older than `max_age_days`, and budget records older than 30 days."""
    try:
        from services import frame_set as fs
    except ImportError:  # pragma: no cover
        import frame_set as fs
    import re
    from datetime import datetime
    cut = now.astimezone(timezone.utc) - timedelta(days=max_age_days)
    cut_budget = now.astimezone(timezone.utc) - timedelta(days=30)
    prefix = fs.set_prefix(SPEC["target"]) + "/"
    gone = []
    for p in sink.list(prefix):
        m = re.search(r"/(\d{8}T\d{6}Z)[/-]", p[len(prefix) - 1:])
        if m and datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc) < cut:
            gone.append(p)
    for p in sink.list(BUDGET_PREFIX + "/"):
        m = re.search(r"/(\d{8})\.json$", p)
        if m and datetime.strptime(m.group(1), "%Y%m%d").replace(tzinfo=timezone.utc) < cut_budget:
            gone.append(p)
    if gone:
        sink.delete(sorted(gone))
    return gone


class _CountingSession:
    """A requests-like session that counts every response body's bytes and refuses once the read cap is reached (2)."""

    def __init__(self, inner, owner):
        self.inner, self.owner = inner, owner

    def get(self, url, **kw):
        self.owner._check_budget()
        r = self.inner.get(url, **kw)
        self.owner._add_read(len(r.content or b""))
        return r

    def head(self, url, **kw):
        return self.inner.head(url, **kw)


class EnsGustRiskSource:
    """One ENS step per frame: every member's gust, reduced at once to three exceedance counts (memory holds counts, never
    50 float fields). Guardrails (2) and (4) live here."""

    def __init__(self, spec, session=None):
        self.spec = spec
        if session is None:
            import requests
            session = requests.Session()
        self._lock = threading.Lock()
        self.bytes_pulled = 0
        self.bytes_stored = 0
        self.read_cap = _env_float("GUST_RISK_MAX_READ_BYTES", READ_CAP_RUN)
        self.store_cap = _env_float("GUST_RISK_MAX_STORE_BYTES", STORE_CAP_RUN)
        self.exceeded = None
        self.provenance = {}
        self.http = _CountingSession(session, self)
        try:
            from services.weather_pipeline import ens_wind_fetch as ef
        except ImportError:  # pragma: no cover
            from weather_pipeline import ens_wind_fetch as ef
        self.ef = ef
        self.base = ef.AWS_BASE

    def _check_budget(self):
        if self.exceeded:
            raise BudgetExceeded(self.exceeded)

    def _add_read(self, n):
        with self._lock:
            self.bytes_pulled += n
            if self.bytes_pulled > self.read_cap and not self.exceeded:
                self.exceeded = f"read cap: {self.bytes_pulled} B > {self.read_cap:.0f} B"

    def _add_stored(self, n):
        with self._lock:
            self.bytes_stored += n
            if self.bytes_stored > self.store_cap and not self.exceeded:
                self.exceeded = f"store cap: {self.bytes_stored} B > {self.store_cap:.0f} B"

    def complete_cycle(self, now):
        """The newest 00Z run whose last step's member index is published, or None (one run a day, as the ocean sets)."""
        day = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        for back in range(3):
            cyc = day - timedelta(days=back)
            try:
                if self.ef.run_available(self.http, cyc, self.spec["hours"][-1], base=self.base):
                    return cyc
            except BudgetExceeded:
                raise
            except Exception:  # noqa: BLE001 - unreachable -> try the day before; None ends the publish quietly
                continue
        return None

    def url(self, cycle, f):
        return self.ef.ef_url(self.base, cycle, f)

    def _check_identity(self, meta):
        """(4) every member message carries the pinned GRIB identity; the first one seen is logged in the index."""
        gid = meta.get("grib_id")
        if not gid:
            raise ValueError("no GRIB identity in the decode (the eccodes decoder is required)")
        for k, v in PIN.items():
            if gid.get(k) != v:
                raise ValueError(f"GRIB {k} = {gid.get(k)!r}, pinned {v!r}: the upstream changed; refused")
        with self._lock:
            if not self.provenance:
                self.provenance = dict(gid, decoder=meta.get("decoder"), pinned=sorted(PIN))
                self.spec["target"]["provenance"] = self.provenance

    def fetch(self, cycle, f):
        import numpy as np
        self._check_budget()
        gr = _gr()
        want = f"{f - gr.gust_window_h(f)}-{f}"

        def reduce(arr, meta):
            if meta.get("step_range") != want:                  # eccodes is required: a missing window refuses the step
                raise ValueError(f"gust window {meta.get('step_range')} != {want} at step {f}")
            self._check_identity(meta)
            return gr.exceed_counts(to_lattice(arr, meta)[None].astype(np.float32))   # [3, 721, 1440] uint8 0/1
        p = gr.gust_param(f)
        try:
            from services.frame_set_raster import DECODE_LOCK      # ecCodes is not thread-safe: build_set runs 6 steps at once
            from services import frame_binary as fb
        except ImportError:  # pragma: no cover
            from frame_set_raster import DECODE_LOCK
            import frame_binary as fb
        got, meta = self.ef.fetch_step(self.http, cycle, f, reduce, params=(p,), base=self.base, prefer="eccodes",
                                       decode_lock=DECODE_LOCK)
        stack = got[p]                                              # [members, 3, 721, 1440] uint8
        members = stack[1:] if meta.get("has_cf") else stack
        if members.shape[0] != gr.MEMBERS:
            raise ValueError(f"{members.shape[0]} perturbed members")
        planes = risk_planes(members.sum(axis=0, dtype=np.uint16))
        raw = fb.encode_planes(planes, (-180.0, -90.0, 179.75, 90.0), "1970-01-01T00:00:00Z", "1970-01-01T00:00:00Z")
        self._add_stored(len(fb.gzip_frame(raw)))                    # the frame's stored size (the header times do not move it)
        self._check_budget()
        return planes


def guarded_publish(args, spec, make_sink, pub, fsr, status_fn, now=None):
    """The set's whole publish, with the guardrails above; publish_raster_frames.py hands over to it."""
    from datetime import datetime
    now = now or datetime.now(timezone.utc)
    name = SET
    why = publish_blocked(now)
    if why:
        print(f"::notice title=Raster set {name} skipped::{why}")
        if why.startswith("auto-disabled"):
            gone = prune_old(make_sink(args), now, max_age_days=0)      # a recorded FAIL / VOID also clears the set
            print(f"[raster] {name}: removed {len(gone)} object(s)")
        return 0
    sink = make_sink(args)
    gone = prune_old(sink, now)
    used = day_used(sink, now.astimezone(timezone.utc))
    remaining = _env_float("GUST_RISK_MAX_READ_BYTES_DAY", READ_CAP_DAY) - used
    if remaining <= 0:
        print(f"::error title=Raster set {name} daily read budget spent::{used:.0f} B read today; nothing read")
        return 1
    sp = dict(spec, target=dict(spec["target"], display=display_allowed(), gate=gate_state()))
    source = fsr.make_source(sp)
    source.read_cap = min(source.read_cap, remaining)
    try:
        upload = pub._uploader(sink)

        def guarded_upload(jobs):                    # a cap reached anywhere in the run uploads nothing
            if source.exceeded:
                raise BudgetExceeded(source.exceeded)
            return upload(jobs)
        report = fsr.publish(source, sink, guarded_upload, log=print, spec=sp)
    except BudgetExceeded as e:                      # raised outside the per-step guard (the cycle check)
        report = {"status": "budget_refused", "reason": str(e)}
    writer = f"gh-run-{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID") else "local"
    total = add_day_used(sink, now.astimezone(timezone.utc), source.bytes_pulled, writer)
    report.update(bytes_pulled=source.bytes_pulled, bytes_stored_estimate=source.bytes_stored, read_today=total,
                  pruned=len(gone), display=sp["target"]["display"], gate=sp["target"]["gate"])
    print(f"::notice title=Raster set {name} size::pulled {source.bytes_pulled / 1e6:.1f} MB (today {total / 1e6:.1f} MB), "
          f"kept {report.get('bytes', 0) / 1e6:.1f} MB, display {sp['target']['display']} ({report.get('status')})")
    import json
    print(json.dumps(report, indent=1, sort_keys=True, default=str))
    if source.exceeded or report.get("status") == "budget_refused":
        print(f"::error title=Raster set {name} budget cap::{source.exceeded or report.get('reason')}; nothing uploaded")
        return 1
    return status_fn(name, report, strict=spec.get("strict", False))
