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

DARK. `default_on` False; repo variable FRAME_RASTER_GUST_RISK=1 is the only switch. No workflow sets it. It may be switched on
only after the gate's scored result passes and the director says ON or dark under D-065.
"""
from __future__ import annotations

from datetime import timedelta, timezone

try:
    from services.weather_pipeline import ens_gust_risk_core as gr
except ImportError:  # pragma: no cover - run by path, where `services` is not importable
    from weather_pipeline import ens_gust_risk_core as gr

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
    "hours": tuple(gr.native_steps(360)), "source": "ens_gust_risk", "upstream_provider": "ecmwf",
    "credit": CREDIT, "license": LICENSE, "source_url": "https://www.ecmwf.int/en/forecasts/datasets/open-data",
    "thresholds_kn": gr.THRESHOLDS_KN,
}


def register(specs, grids, sources):
    """Add the set and its source kind to frame_set_raster's tables (that module is at its line limit)."""
    try:
        import frame_binary as fb
    except ImportError:
        from services import frame_binary as fb
    specs.setdefault(SET, dict(SPEC, field=fb.GUST_P25_PCT, fields=fb.GUST_RISK_FIELDS))
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


def risk_planes(counts, n_members=gr.MEMBERS):
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


class EnsGustRiskSource:
    """One ENS step per frame: every member's gust, reduced at once to three exceedance counts (memory holds counts, never
    50 float fields)."""

    def __init__(self, spec, session=None):
        self.spec = spec
        if session is None:
            import requests
            session = requests.Session()
        self.http = session
        try:
            from services.weather_pipeline import ens_wind_fetch as ef
        except ImportError:  # pragma: no cover
            from weather_pipeline import ens_wind_fetch as ef
        self.ef = ef
        self.base = ef.AWS_BASE

    def complete_cycle(self, now):
        """The newest 00Z run whose last step's member index is published, or None (one run a day, as the ocean sets)."""
        day = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        for back in range(3):
            cyc = day - timedelta(days=back)
            try:
                if self.ef.run_available(self.http, cyc, self.spec["hours"][-1], base=self.base):
                    return cyc
            except Exception:  # noqa: BLE001 - unreachable -> try the day before; None ends the publish quietly
                continue
        return None

    def url(self, cycle, f):
        return self.ef.ef_url(self.base, cycle, f)

    def fetch(self, cycle, f):
        import numpy as np
        want = f"{f - gr.gust_window_h(f)}-{f}"

        def reduce(arr, meta):
            if meta.get("step_range") not in (None, want):      # None: a decoder without the key (pygrib); eccodes checks
                raise ValueError(f"gust window {meta.get('step_range')} != {want} at step {f}")
            return gr.exceed_counts(to_lattice(arr, meta)[None].astype(np.float32))   # [3, 721, 1440] uint8 0/1
        p = gr.gust_param(f)
        try:
            from services.frame_set_raster import DECODE_LOCK      # ecCodes is not thread-safe: build_set runs 6 steps at once
        except ImportError:  # pragma: no cover
            from frame_set_raster import DECODE_LOCK
        got, meta = self.ef.fetch_step(self.http, cycle, f, reduce, params=(p,), base=self.base, decode_lock=DECODE_LOCK)
        stack = got[p]                                              # [members, 3, 721, 1440] uint8
        members = stack[1:] if meta.get("has_cf") else stack
        if members.shape[0] != gr.MEMBERS:
            raise ValueError(f"{members.shape[0]} perturbed members")
        acc = members.sum(axis=0, dtype=np.uint16)
        return risk_planes(acc)
