"""MOP-lite PartitionSource (served partitions, stored products only) and the one-accessor pin for the CHAIN and LITE arms."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import numpy as np
import pytest

from scripts import nearshore_lite_archive as job
from services.weather_pipeline.nearshore_lite import archive, arms
from services.weather_pipeline.nearshore_lite import coefficients as coef
from services.weather_pipeline.nearshore_lite import partition_source as ps
from services.weather_pipeline.nearshore_lite.ray_trace import DepthGrid, trace_target

INIT = datetime(2027, 1, 15, 0, 0, tzinfo=timezone.utc)
TARGETS = [{"id": "T1", "lat": 33.0, "lon": -118.0, "region": "California"},
           {"id": "T2", "lat": 21.6, "lon": -158.1, "region": "Hawaii"}]
TRAINS = [{"h": 1.0, "tp": 13.0, "dir": 280.0, "kind": "swell"}, {"h": 0.5, "tp": 7.0, "dir": 250.0, "kind": "windsea"}]


def _point(h=1.2, tp=11.0, d=275.0, **src):
    s = {"provider": "copernicus", "model": "EURO", "source_dataset": "cmems_mfwam", "upstream_provider": None, "upstream_model": "MFWAM"}
    s.update(src)
    return SimpleNamespace(point=SimpleNamespace(speed=h, period=tp, direction=d), **s)


class FakeService:
    def __init__(self, parts_for=None, points=None, fail=()):
        self.parts_for, self.points, self.fail = parts_for or {}, points or {}, set(fail)
        self.flag_seen, self.calls = [], []

    async def _resolve_point_internal(self, **kw):
        self.calls.append(("point", kw["layer"], kw["model"]))
        if kw["lat"] in self.fail:
            raise ps.StoredOnlyError("stored products only: refused")
        return self.points.get(kw["lat"], _point())

    async def _resolve_partitions(self, model, layer, lat, lng, vt, total_h, total_tp=None):
        self.flag_seen.append(os.environ.get("SURF_PARTITIONS"))
        self.calls.append(("parts", layer, model))
        return self.parts_for.get(lat)


def run(coro):
    return asyncio.run(coro)


def test_the_stored_only_provider_refuses_every_call():
    with pytest.raises(ps.StoredOnlyError):
        run(ps.StoredOnlyProvider().fetch_point(model="EURO", domain="marine", layer="waves", lat=0, lng=0, forecast_days=1))
    with pytest.raises(ps.StoredOnlyError):
        run(ps.StoredOnlyProvider().anything_else())


def test_rows_use_the_served_partitions_and_the_chains_total_train_otherwise():
    svc = FakeService(parts_for={33.0: TRAINS})                          # Hawaii (21.6) resolves no partitions
    src = ps.ServedPartitionSource(svc, leads_h=range(0, 3))
    rows = src.rows(INIT, TARGETS)
    assert len(rows) == 6 and {r["basis"] for r in rows if r["target"] == "T1"} == {"partitions"}
    assert [r["partitions"] for r in rows if r["target"] == "T1"][0] == TRAINS
    h = [r for r in rows if r["target"] == "T2"]
    assert {r["basis"] for r in h} == {"total"} and h[0]["partitions"] == [{"h": 1.2, "tp": 11.0, "dir": 275.0, "kind": "swell"}]
    assert src.meta()["partition_basis_counts"] == {"partitions": 3, "total": 3, "unavailable": 0}


def test_the_partitions_flag_is_forced_on_only_for_the_call_and_restored(monkeypatch):
    monkeypatch.delenv("SURF_PARTITIONS", raising=False)
    svc = FakeService(parts_for={33.0: TRAINS})
    ps.ServedPartitionSource(svc, leads_h=[0]).rows(INIT, TARGETS[:1])
    assert svc.flag_seen == ["1"] and "SURF_PARTITIONS" not in os.environ
    monkeypatch.setenv("SURF_PARTITIONS", "0")
    ps.ServedPartitionSource(svc, leads_h=[0]).rows(INIT, TARGETS[:1])
    assert os.environ["SURF_PARTITIONS"] == "0"


def test_a_stored_grid_miss_is_unavailable_never_a_live_fetch():
    svc = FakeService(fail={33.0})
    rows = ps.ServedPartitionSource(svc, leads_h=[0, 1]).rows(INIT, TARGETS[:1])
    assert [r["basis"] for r in rows] == ["unavailable"] * 2 and rows[0]["partitions"] is None
    assert not any(c[0] == "parts" for c in svc.calls)                    # no partitions asked for an unanswerable point


def test_the_model_member_is_the_one_the_chain_uses_per_target():
    svc = FakeService()
    ps.ServedPartitionSource(svc, default_model="EURO", leads_h=[0]).rows(INIT, [dict(TARGETS[0], model="GFS"), TARGETS[1]])
    assert [c[2] for c in svc.calls if c[0] == "point"] == ["GFS", "EURO"]


def test_the_source_is_recorded_per_region_and_a_non_mfwam_region_shows_up():
    svc = FakeService(points={21.6: _point(provider="gfs-wave", source_dataset="gfswave", upstream_model="GFS-Wave")})
    src = ps.ServedPartitionSource(svc, leads_h=[0, 1])
    src.rows(INIT, TARGETS)
    m = src.meta()
    assert m["partition_sources_by_region"]["California"][0]["upstream_model"] == "MFWAM"
    assert m["partition_sources_by_region"]["Hawaii"][0]["source_dataset"] == "gfswave"
    assert m["stored_products_only"] is True and m["partitions_flag_forced_on"] is True
    assert m["partition_model_by_target"] == {"T1": "EURO", "T2": "EURO"}


# ---- the CHAIN and LITE arms get byte-identical partition inputs ------------------------------------------------------
def _table():
    x = np.arange(320) * 25.0
    x0 = 314 * 25.0
    h = np.tile((0.02 * (x0 - x))[None, :], (440, 1))
    h[h < 0.5] = np.nan
    return coef.Table(coef.build_payload("plane", trace_target(DepthGrid(h, 25.0), x0 - 8.0 / 0.02, 5500.0,
                                                                 freqs=np.array([0.08, 0.1, 0.12, 0.14, 0.16, 0.2])), {}))


TOTAL = {"h": 1.2, "tp": 11.0, "dir": 275.0}


def test_lite_and_chain_part_read_the_same_partition_object_and_chain_served_reads_the_total(monkeypatch):
    row = {"target": "T1", "lead_h": 3, "partitions": TRAINS, "basis": "partitions", "total": TOTAL}
    calls = []
    real_chain, real_lite = arms.chain_buoy_hs, arms.lite_buoy_hs
    monkeypatch.setattr(arms, "chain_buoy_hs", lambda parts, *a, **k: calls.append(("chain", parts)) or real_chain(parts, *a, **k))
    monkeypatch.setattr(arms, "lite_buoy_hs", lambda t, parts, *a, **k: calls.append(("lite", parts)) or real_lite(t, parts, *a, **k))
    out = arms.arms_at_buoy(row, _table(), 20.0, shore_normal_deg=270.0)
    (_, served), (_, part), (_, lite) = calls                              # CHAIN_SERVED, CHAIN_PART, LITE, in that order
    assert part is lite                                                    # the SAME object: byte-identical partition inputs
    assert json.dumps(part, sort_keys=True) == json.dumps(lite, sort_keys=True) == json.dumps(arms.partition_inputs(row), sort_keys=True)
    assert served == [dict(TOTAL, kind="swell")] and served != part        # CHAIN_SERVED is the TOTAL field, not the partitions
    assert out["input_hash"] == arms.input_hash(arms.partition_inputs(row)) and out["total_hash"] == arms.input_hash(served)
    assert out["CHAIN_SERVED"] > 0 and out["CHAIN_PART"] > 0 and out["LITE"] > 0
    assert out["OFFSHORE"] == pytest.approx((1.0 ** 2 + 0.5 ** 2) ** 0.5)


def test_with_total_basis_rows_chain_served_and_chain_part_coincide():
    """No partitions resolved: the served chain and the partitioned chain are the same total train, so any gap is not a partition effect."""
    row = {"target": "T1", "lead_h": 0, "basis": "total", "total": TOTAL, "partitions": [dict(TOTAL, kind="swell")]}
    out = arms.arms_at_buoy(row, _table(), 20.0, shore_normal_deg=270.0)
    assert out["CHAIN_SERVED"] == pytest.approx(out["CHAIN_PART"]) and out["input_hash"] == out["total_hash"]


def test_the_gated_comparator_is_chain_served_and_chain_part_is_report_only():
    from services.weather_pipeline.nearshore_lite import scorer
    assert scorer.COMPARATOR == "CHAIN_SERVED" and scorer.REPORTED_CHAIN == "CHAIN_PART"
    import random
    rng = random.Random(3)
    rows = []
    for i in range(40):
        t = 1.0 + rng.random()
        rows.append({"date": f"2027-02-{(i % 28) + 1:02d}", "buoy": f"b{i % 5}", "region": "US West", "obs_hs": t,
                     "arms": {"CHAIN_SERVED": t + 0.4, "CHAIN_PART": t + 0.25, "LITE": t + 0.1}})
    d = scorer.decompose(rows, B=200)
    assert d["total_effect"]["delta"] < 0 and d["partition_effect"]["delta"] < 0 and d["refraction_effect"]["delta"] < 0
    # the effects add: total = partition + refraction (RMSE of constant offsets)
    assert d["total_effect"]["delta"] == pytest.approx(d["partition_effect"]["delta"] + d["refraction_effect"]["delta"], abs=1e-9)


def test_stored_only_guard_blocks_the_live_copernicus_fetch_and_restores_it():
    cms = pytest.importorskip("services.copernicus_marine_service")
    real = cms.fetch_euro_marine
    with ps.stored_only_guard():
        with pytest.raises(ps.StoredOnlyError, match="fetch_euro_marine"):
            run(cms.fetch_euro_marine(latitudes=[0.0], longitudes=[0.0], forecast_days=1, variables=["wave_height"], valid_time="x"))
    assert cms.fetch_euro_marine is real


def test_build_service_routes_every_read_through_the_stored_only_provider(monkeypatch, tmp_path):
    """The service build_service returns holds a StoredOnlyProvider as its ONLY provider, and resolving a point the empty store
    cannot answer (a) reaches the provider, which refuses, (b) never reaches the lazily imported live CMEMS fetch, (c) makes no
    network attempt (name resolution and connection creation are blocked and counted)."""
    import socket
    from services.weather_pipeline import dynamic_index as di
    from services.weather_pipeline import store as st
    attempts = []

    def blocked(*a, **k):
        attempts.append(a)
        raise AssertionError("network attempt")
    monkeypatch.setattr(socket, "getaddrinfo", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(st.ProductStore, "restore_from_supabase", lambda self, *a, **k: (0, []))
    orig_init = di.DynamicProductIndex.__init__
    monkeypatch.setattr(di.DynamicProductIndex, "__init__", lambda self, cache_dir=None: orig_init(self, tmp_path))
    svc = ps.build_service()
    assert isinstance(svc.provider, ps.StoredOnlyProvider)
    cms = pytest.importorskip("services.copernicus_marine_service")
    live = []

    async def spy_live(*a, **k):
        live.append(1)
        raise AssertionError("live fetch reached")
    seen_provider = []
    real_getattr = ps.StoredOnlyProvider.__getattr__

    def tracing(self, name):
        seen_provider.append(name)
        return real_getattr(self, name)
    monkeypatch.setattr(ps.StoredOnlyProvider, "__getattr__", tracing)
    monkeypatch.setattr(cms, "fetch_euro_marine", spy_live)                     # what the guard must replace, not reach
    src = ps.ServedPartitionSource(svc, leads_h=[0])
    rows = src.rows(INIT, [{"id": "T1", "lat": 33.0, "lon": -118.0, "region": "California"}])
    assert rows[0]["basis"] == "unavailable" and rows[0]["partitions"] is None and rows[0]["total"] is None
    assert live == [] and attempts == []                                         # no live CMEMS call, no network
    assert "fetch_point" in seen_provider                                        # the miss went THROUGH the provider


def test_tripwire_the_live_fetch_names_in_the_served_resolution_files_are_the_known_ones():
    """Narrows what the first dry run must show: a NEW live-fetch name in the resolution path makes this fail until it is reviewed."""
    import re
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "services", "weather_pipeline")
    known = {"point_resolution.py": {"fetch_euro_marine", "self.provider.fetch_point"}}
    pat = re.compile(r"fetch_euro_marine|self\.provider\.\w+|\brequests\.(?:get|post)|\bhttpx\.|urllib\.request|aiohttp|\.subprocess")
    text = open(os.path.join(root, "point_resolution.py"), encoding="utf-8").read()
    found = set()
    for m in pat.finditer(text):
        s = m.group(0)
        found.add("self.provider.fetch_point" if s.startswith("self.provider.") else s)
    assert found <= known["point_resolution.py"] | {"self.provider.fetch_point"}, sorted(found - known["point_resolution.py"])


def test_chain_arm_is_todays_constants_without_the_cap():
    from services.weather_pipeline import surf_transform as st
    parts = [{"h": 2.0, "tp": 12.0, "dir": 275.0, "kind": "swell"}]
    want = 2.0 * st.shoaling_coefficient(12.0, 20.0) * st._height_exposure_factor(275.0, 270.0) * st.REFRACTION_KR
    assert arms.chain_buoy_hs(parts, 20.0, 270.0) == pytest.approx(want)
    assert arms.chain_buoy_hs([{"h": 50.0, "tp": 14.0, "dir": 270.0, "kind": "swell"}], 3.0, 270.0) > 3.0 * 0.81       # no depth cap


def test_arms_do_not_invent_inputs_for_a_row_without_partitions():
    row = {"target": "T1", "lead_h": 0, "partitions": None, "basis": "unavailable"}
    out = arms.arms_at_buoy(row, _table(), 20.0)
    assert out["CHAIN_SERVED"] is None and out["CHAIN_PART"] is None and out["LITE"] is None and out["OFFSHORE"] is None


# ---- the job writes the source's provenance into the archive meta ----------------------------------------------------
def test_the_archive_meta_carries_the_partition_provenance(tmp_path):
    from tests.test_nearshore_lite_archive_job import SAMPLE, WORD, table
    one = TARGETS[:1]                                                      # the synthetic tide table holds one key
    src = ps.ServedPartitionSource(FakeService(parts_for={33.0: TRAINS}), leads_h=range(0, 73))
    code, s = job.run(INIT, one, ["46086"], str(tmp_path / "o"), WORD, table(), lambda u: SAMPLE, partition_source=src, dry_run=False)
    assert code == 0 and s["status"] == "ARCHIVED"
    d = str(tmp_path / "o" / "archive")
    assert archive.verify_archive(d) == [] and archive.missing_run(d, ["T1"]) == []
    name = next(n for n in os.listdir(d) if n.endswith(".json"))
    doc = json.loads(open(os.path.join(d, name), encoding="utf-8").read())
    assert doc["meta"]["partition_sources_by_region"]["California"][0]["upstream_model"] == "MFWAM"
    assert doc["meta"]["stored_products_only"] is True and doc["meta"]["partition_basis_counts"]["partitions"] == 73
    assert doc["rows"][0]["basis"] == "partitions" and doc["rows"][0]["eta_m"] is not None


def test_the_cli_builds_the_served_source_only_when_asked(monkeypatch):
    built = []
    monkeypatch.setattr(ps, "build_service", lambda: built.append(1) or FakeService())
    assert job._partition_source(SimpleNamespace(partition_source="none", model="EURO")) is None and built == []
    src = job._partition_source(SimpleNamespace(partition_source="served", model="GFS"))
    assert isinstance(src, ps.ServedPartitionSource) and src.default_model == "GFS" and built == [1]


def test_the_workflow_runs_from_the_repo_root_and_defaults_the_source_to_none():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    text = open(os.path.join(root, ".github", "workflows", "nearshore-lite-archive.yml"), encoding="utf-8").read()
    assert "python backend/scripts/nearshore_lite_archive.py" in text and "cd backend" not in text
    block = text.split("partition_source:", 2)[1]
    assert "default: 'none'" in block.split("model:", 1)[0] and "--partition-source" in text
