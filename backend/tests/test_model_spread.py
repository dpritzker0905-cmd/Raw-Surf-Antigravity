"""Model spread of the world wave field (model_spread.py + scripts/publish_model_spread.py, DATA ONLY, dark).

Pins the arithmetic with controls before any real reading is trusted: the NULL control (three identical models ->
spread 0 and cv 0 at every node), the POSITIVE controls (a known offset -> exactly that spread; a known +-20% scale ->
exactly that cv; a member on a different lattice still reads the offset), what counts as a node (GFS ocean + every
member answers), which products pair (authoritative, latest run, all three), the bounded frame pick, the
write-once / retention cycle of the collector, and that the workflow runs it only behind MODEL_SPREAD_PUBLISH.
Offline only: a fake store and a local sink, no network.
"""
import gzip
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from services.weather_pipeline import model_spread as ms
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct, PipelineManifest)

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_model_spread as pub  # noqa: E402

RUN = datetime(2026, 10, 19, 6, tzinfo=timezone.utc)
VT = RUN + timedelta(hours=24)
BOX = (-20.0, -10.0, 20.0, 10.0)
_ROOT = Path(__file__).resolve().parents[2]


def _vec(lat, lng, hs, valid=True, d=270.0, tp=12.0):
    rad = math.radians(d)
    return GridVector(lat=round(lat, 4), lng=round(lng, 4), speed=round(hs, 4), direction=d,
                      u=round(-hs * math.sin(rad), 4), v=round(-hs * math.cos(rad), 4), period=tp, is_valid=valid)


def _field(lat, lng):
    """A varying sea (0.6 to ~5.6 m) so a control cannot pass by every node reading the same number."""
    return 0.6 + 0.12 * (lat + 10) + 0.05 * (lng + 20)


def _product(model, hs=_field, res=2.0, box=BOX, valid_time=VT, run_time=RUN, land=lambda lat, lng: False,
             layer="waves"):
    w, s, e, n = box
    cols, rows = int(round((e - w) / res)) + 1, int(round((n - s) / res)) + 1
    vs = [_vec(s + j * res, w + i * res, hs(s + j * res, w + i * res), valid=not land(s + j * res, w + i * res))
          for j in range(rows) for i in range(cols)]
    b = CoverageBounds(west=w, south=s, east=e, north=n)
    return NormalizedProduct(model=model, provider="test", domain="marine", layer=layer, run_time=run_time,
                             valid_time=valid_time, is_forecast_authoritative=True, is_estimated=False, coverage=b,
                             grid=NormalizedGrid(bounds=b, cols=cols, rows=rows, vectors=vs), value_kind="height",
                             value_unit="m", display_unit_hint="ft", source_variables=["hs"], freshness_sec=0,
                             region_id="global_mid", coverage_mode="global_tile", product_id=f"{model}-p")


def _spread(gfs, euro, icon):
    return ms.build_spread(gfs, {"EURO": euro, "ICON": icon})


# ── the arithmetic ────────────────────────────────────────────────────────────────────────────────────────────


def test_node_stats_by_hand():
    s = ms.node_stats([1.0, 2.0, 3.0])
    assert (s["mean"], s["min"], s["max"], s["spread"]) == (2.0, 1.0, 3.0, 2.0)
    assert s["cv"] == pytest.approx(math.sqrt(2 / 3) / 2)          # population std / mean
    assert ms.node_stats([0.0, 0.0, 0.0])["cv"] is None             # no relative disagreement in a flat calm
    assert ms.node_stats([0.8, 0.8, 0.8]) == {"mean": 0.8, "min": 0.8, "max": 0.8, "spread": 0.0, "cv": 0.0}


def test_null_control_three_identical_models_have_zero_spread_everywhere():
    f = _spread(_product("GFS"), _product("EURO"), _product("ICON"))
    n = f["nodes"]
    assert f["counts"]["nodes"] == f["counts"]["lattice_nodes"] == 21 * 11
    assert set(n["spread"]) == {0.0} and set(n["cv"]) == {0.0}
    assert n["mean"] == n["min"] == n["max"]
    assert max(n["mean"]) - min(n["mean"]) > 3                      # the field really varies
    assert f["summary"]["spread_max"] == 0.0


def test_positive_control_a_known_offset_reads_as_exactly_that_spread():
    f = _spread(_product("GFS"), _product("EURO", hs=lambda la, lo: _field(la, lo) + 0.5),
                _product("ICON", hs=lambda la, lo: _field(la, lo) - 0.5))
    n = f["nodes"]
    assert all(s == pytest.approx(1.0, abs=2e-3) for s in n["spread"])
    assert all(m == pytest.approx(_field(la, lo), abs=2e-3) for m, la, lo in zip(n["mean"], n["lat"], n["lng"]))
    assert all(lo_ == pytest.approx(m - 0.5, abs=2e-3) for lo_, m in zip(n["min"], n["mean"]))


def test_positive_control_a_known_scale_reads_as_exactly_that_cv():
    f = _spread(_product("GFS"), _product("EURO", hs=lambda la, lo: 1.2 * _field(la, lo)),
                _product("ICON", hs=lambda la, lo: 0.8 * _field(la, lo)))
    want = math.sqrt((0.2 ** 2 + 0.2 ** 2) / 3)                     # +-20% around the mean: cv 0.1633 everywhere
    assert all(c == pytest.approx(want, abs=1e-3) for c in f["nodes"]["cv"])
    big, small = max(f["nodes"]["spread"]), min(f["nodes"]["spread"])
    assert big > 4 * small                                          # same cv, spread grows with height


def test_members_on_another_lattice_are_read_at_the_gfs_nodes():
    """The common grid is GFS's lattice; a member on a finer, offset lattice is sampled there by /point's own read."""
    flat = lambda la, lo: 2.0  # noqa: E731
    f = _spread(_product("GFS", hs=flat), _product("EURO", hs=lambda la, lo: 2.3, res=0.5, box=(-21, -11, 21, 11)),
                _product("ICON", hs=flat, res=1.0, box=(-21.5, -10.5, 20.5, 11.5)))
    assert f["counts"]["nodes"] == 21 * 11
    assert all(s == pytest.approx(0.3, abs=2e-3) for s in f["nodes"]["spread"])
    assert (f["grid"]["cols"], f["grid"]["rows"]) == (21, 11)


def test_a_node_counts_only_where_gfs_is_ocean_and_every_member_answers():
    land = lambda la, lo: lo <= -16  # noqa: E731                  3 GFS columns are land
    icon = _product("ICON", box=(-20.0, -10.0, 10.0, 10.0))        # ICON stops at 10 E: 5 columns unanswered
    f = _spread(_product("GFS", land=land), _product("EURO"), icon)
    c = f["counts"]
    assert c["not_ocean"] == 3 * 11
    assert c["member_missing"]["ICON"] > 0 and c["member_missing"]["EURO"] == 0
    assert c["nodes"] == c["lattice_nodes"] - c["not_ocean"] - sum(c["member_missing"].values())
    assert all(-16 < lo <= 10 for lo in f["nodes"]["lng"])


def test_refuses_mismatched_inputs():
    with pytest.raises(ValueError):
        _spread(_product("GFS"), _product("EURO", valid_time=VT + timedelta(hours=3)), _product("ICON"))
    with pytest.raises(ValueError):
        _spread(_product("GFS"), _product("EURO", layer="wind_waves"), _product("ICON"))
    with pytest.raises(ValueError):
        ms.build_spread(_product("GFS"), {"EURO": _product("EURO")})


def test_decile_report_null_and_positive():
    null = _spread(_product("GFS"), _product("EURO"), _product("ICON"))
    rows = ms.decile_report([null])
    assert [r["decile"] for r in rows] == list(range(1, 11)) + ["top 1%"]
    assert sum(r["n"] for r in rows[:10]) == null["counts"]["nodes"]
    assert rows[-1]["hs_lo"] >= rows[9]["hs_lo"] and rows[-1]["hs_hi"] == rows[9]["hs_hi"]
    assert all(r["spread_median"] == 0.0 and r["cv_median"] == 0.0 for r in rows)
    scaled = _spread(_product("GFS"), _product("EURO", hs=lambda la, lo: 1.2 * _field(la, lo)),
                     _product("ICON", hs=lambda la, lo: 0.8 * _field(la, lo)))
    rows = ms.decile_report([scaled])
    meds = [r["spread_median"] for r in rows[:10]]
    assert meds == sorted(meds) and meds[-1] > 3 * meds[0]          # spread rises with height, cv does not
    assert all(r["rel_spread_median"] == pytest.approx(0.4, abs=2e-3) for r in rows)
    assert "| 10 |" in ms.report_markdown(rows, "t")


# ── which products pair, and which frames are built ──────────────────────────────────────────────────────────


def _item(model, vt, run=RUN, region="global_mid", est=False, fn=None):
    return ManifestProduct(product_id=fn or f"{model}-{region}-{vt:%d%H}-{run:%d%H}", model=model, provider="t",
                           domain="marine", layer="waves", run_time=run, valid_time_start=vt, valid_time_end=vt,
                           resolution=2.0, freshness_sec=0, is_forecast_authoritative=True,
                           coverage=CoverageBounds(west=-180, south=-80, east=180, north=80),
                           filename=fn or f"{model}-{region}-{vt:%d%H}-{run:%d%H}.json", is_estimated=est,
                           region_id=region)


def _manifest(items):
    return PipelineManifest(last_manifest_update=RUN, products=items)


def test_aligned_frames_pair_authoritative_latest_runs_at_shared_valid_times():
    t1, t2, t3 = VT, VT + timedelta(hours=24), VT + timedelta(hours=48)
    old = RUN - timedelta(hours=6)
    m = _manifest([
        _item("GFS", t1), _item("GFS", t1, run=old), _item("GFS", t2), _item("GFS", t3),
        _item("EURO", t1), _item("EURO", t2, est=True), _item("EURO", t3),
        _item("ICON", t1), _item("ICON", t2), _item("ICON", t3, region="global_coarse"),
    ])
    a = ms.aligned_frames(m)
    assert list(a) == [t1]                     # t2: EURO only estimated; t3: ICON only on the coarse tier
    assert a[t1]["GFS"].run_time == RUN        # the latest GFS run, not the older one at the same hour


def test_select_frames_keeps_whole_lead_steps_and_is_bounded():
    vts = [RUN + timedelta(hours=h) for h in range(-3, 200, 3)]
    a = {vt: {"GFS": _item("GFS", vt)} for vt in vts}
    got = ms.select_frames(a, 24, 8)
    assert [ms.lead_hours(a[v]["GFS"]) for v in got] == [0, 24, 48, 72, 96, 120, 144, 168]
    assert len(ms.select_frames(a, 24, 3)) == 3
    assert ms.select_frames(a, 0, 8) == [] and ms.select_frames(a, 24, 0) == []


# ── the collector: write once, retain, never touch the pipeline ───────────────────────────────────────────────


class FakeSource:
    def __init__(self, scene):
        self.files, items = {}, []
        for model, prod in scene:
            it = _item(model, prod.valid_time, run=prod.run_time)
            self.files[it.filename] = prod
            items.append(it)
        self.manifest = _manifest(items)
        self.loads = []

    def get_manifest(self):
        return self.manifest

    def load_product(self, filename, stride=None):
        self.loads.append(filename)
        p = self.files.get(filename)
        return p.model_copy(deep=True) if p is not None else None


def _scene(vts, euro_offset=0.4):
    out = []
    for vt in vts:
        out += [("GFS", _product("GFS", valid_time=vt)),
                ("EURO", _product("EURO", valid_time=vt, hs=lambda la, lo: _field(la, lo) + euro_offset)),
                ("ICON", _product("ICON", valid_time=vt))]
    return out


def test_collect_writes_each_frame_once_under_its_own_prefix(tmp_path):
    src = FakeSource(_scene([VT, VT + timedelta(hours=24), VT + timedelta(hours=3)]))
    sink = pub.LocalSink(tmp_path)
    now = VT
    built, index, stats = pub.collect(src, sink, now=now, step_h=24, max_frames=8)
    assert stats["built"] == 2 and stats["selected"] == 2 and stats["aligned"] == 3   # +27 h is not a 24 h step
    assert all(k.startswith("model_spread/global_mid/") for k in sink.headers)           # never a pipeline key
    assert sink.headers[pub.INDEX]["cache-control"] == "no-cache"
    frame_keys = [k for k in sink.headers if k.endswith(".json.gz")]
    assert all(sink.headers[k]["cache-control"].endswith("immutable") for k in frame_keys)
    frame = json.loads(gzip.decompress((tmp_path / frame_keys[0]).read_bytes()))
    assert all(s == pytest.approx(0.4, abs=2e-3) for s in frame["nodes"]["spread"])
    on_disk = json.loads((tmp_path / pub.INDEX).read_bytes())
    assert [f["key"] for f in on_disk["frames"]] == sorted(frame_keys)
    assert on_disk["last_run"]["decile_report"] and on_disk["last_run"]["stats"]["built"] == 2

    loads = len(src.loads)
    _built, _index, again = pub.collect(src, sink, now=now, step_h=24, max_frames=8)
    assert again["built"] == 0 and again["already"] == 2 and len(src.loads) == loads     # nothing reloaded


def test_collect_skips_a_member_whose_loaded_copy_is_another_run(tmp_path):
    src = FakeSource(_scene([VT]))
    euro = next(fn for fn in src.files if fn.startswith("EURO"))
    src.files[euro] = _product("EURO", run_time=RUN - timedelta(hours=12))
    _b, _i, stats = pub.collect(src, pub.LocalSink(tmp_path), now=VT, step_h=24, max_frames=8)
    assert stats["stale_member"] == 1 and stats["built"] == 0


def test_collect_prunes_frames_past_retention(tmp_path):
    sink = pub.LocalSink(tmp_path)
    pub.collect(FakeSource(_scene([VT])), sink, now=VT, step_h=24, max_frames=8)
    later = VT + timedelta(days=30)
    _b, index, stats = pub.collect(FakeSource(_scene([later], euro_offset=0.1)), sink, now=later,
                                   step_h=24, max_frames=8, retain_days=21)
    assert stats["pruned"] == 1 and len(sink.deleted) == 1
    assert not (tmp_path / sink.deleted[0]).exists()
    assert [f["valid_time"][:10] for f in index["frames"]] == [later.date().isoformat()]


# ── dark: only the repository variable runs it, and it cannot fail an ingest cycle ───────────────────────────


def test_forecast_ingest_runs_it_only_behind_the_repository_variable():
    wf = yaml.safe_load((_ROOT / ".github" / "workflows" / "forecast-ingest.yml").read_text(encoding="utf-8"))
    steps = [s for job in wf["jobs"].values() for s in job["steps"]
             if "publish_model_spread.py" in str(s.get("run", ""))]
    assert len(steps) == 1
    step = steps[0]
    assert "vars.MODEL_SPREAD_PUBLISH == '1'" in step["if"]
    assert step["continue-on-error"] is True
    assert step.get("working-directory") == "backend"
    for other in ("forecast-ingest-pilots.yml", "precompute.yml"):
        text = (_ROOT / ".github" / "workflows" / other).read_text(encoding="utf-8")
        assert "publish_model_spread" not in text
