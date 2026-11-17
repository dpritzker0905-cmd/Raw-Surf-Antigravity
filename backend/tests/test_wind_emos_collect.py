"""The EMOS matched-data collector (scripts/wind_emos_collect.py). Pre-registration:
docs/weather-program/log/2026-11-16-wind-emos-preregistration.md, amendment 2."""
import io
import os
import sys
from datetime import datetime, timezone
from unittest.mock import patch

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_emos_collect as C  # noqa: E402


def test_registered_leads_and_period():
    assert C.LEADS == (192, 210, 228, 252, 288, 324)            # two per lead bin (amendment 2)
    assert C.PERIOD[0] == datetime(2025, 6, 1, tzinfo=timezone.utc)
    runs = C.runs_between(datetime(2025, 6, 1, 12, tzinfo=timezone.utc), datetime(2025, 6, 3, tzinfo=timezone.utc))
    assert [r.hour for r in runs] == [0, 0, 0] and len(runs) == 3   # 00Z only


def test_shards_partition_the_runs():
    items = list(range(10))
    parts = [C.shard(items, f"{i}/4") for i in range(4)]
    assert sorted(x for p in parts for x in p) == items and all(parts)


def test_pack_keeps_only_station_values_per_lead():
    f = {"10u": np.ones((51, 3)), "10v": np.zeros((51, 3)), "10fg": np.full((51, 3), 7.0)}
    blob = C.pack_run({192: f, 324: f})
    with np.load(io.BytesIO(blob)) as z:
        assert sorted(z.files) == ["g_192", "g_324", "has_cf", "u_192", "u_324", "v_192", "v_324"]
        assert int(z["has_cf"]) == 1                      # amendment 5: 51 members when 1, 50 when 0
        assert z["u_192"].shape == (51, 3) and z["g_324"].dtype == np.float32


def test_a_missing_lead_drops_the_run_never_fills():
    calls = []

    def fake_fetch(session, run, step, reduce_fn, **kw):
        calls.append(step)
        if step == 288:
            raise ValueError("member fields missing")
        return {"10u": np.ones((51, 2)), "10v": np.ones((51, 2)), "10fg": np.ones((51, 2))}, {}
    with patch.object(C.ef, "fetch_step", side_effect=fake_fetch), pytest.raises(ValueError):
        C.collect_run(None, datetime(2025, 7, 1, tzinfo=timezone.utc), np.zeros(2), np.zeros(2))
    assert calls == [192, 210, 228, 252, 288]


def test_daily_target_survives_throttling_and_falls_back():
    now = datetime(2026, 11, 16, 10, 7, tzinfo=timezone.utc)
    calls = []

    def avail(session, run, last, base=None):
        calls.append((run.day, "ecmwf" if base == C.ef.ECMWF_BASE else "aws"))
        if base == C.ef.ECMWF_BASE:
            raise RuntimeError("HTTP 503")                 # throttled: the next source is tried
        return run.day == 16
    with patch.object(C.ef, "run_available", side_effect=avail):
        run, base = C.daily_target(None, now)
    assert run == datetime(2026, 11, 16, tzinfo=timezone.utc) and base == C.ef.AWS_BASE
    with patch.object(C.ef, "run_available", side_effect=RuntimeError("HTTP 503")):
        assert C.daily_target(None, now) == (None, None)   # never a crash
