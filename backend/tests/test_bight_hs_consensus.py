"""SURF_BIGHT_HS_CONSENSUS (2026-11-03, dark): the GFS+EURO mean offshore Hs inside the frozen SoCal Bight polygon.

Pins, on real product types through the real serving view (consensus_serve.ServedStore):
  * OFF is byte-identical (a pinned sha256 of the served frame), for every value that is not exactly "1";
  * ON: inside the polygon the cell carries (GFS + EURO) / 2 with GFS's period and direction; outside it is GFS's own
    object; EURO missing / masked / estimated / beyond the resolver's 3 h window keeps GFS;
  * the polygon is round 4's, frozen, with its edge conventions;
  * every surface reads the same number: /point (rate_one_spot's input, the infobox, alerts, the sim), the hub's
    cached-grid lane and the glyph precompute's resolver;
  * precedence: a frame served as its CONSENSUS twin is not composed again; serve_raw() answers raw;
  * registered and declared '0' in every lane; refused by the v0 harness (EURO is not archived).
"""
import asyncio
import hashlib
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from services.weather_pipeline import bight_hs_consensus as B
from services.weather_pipeline import consensus_serve as S
from services.weather_pipeline.schemas import (CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct,
                                               PipelineManifest)
from services.weather_pipeline.store_helpers import _build_manifest_item, _build_product_filename

REPO = Path(__file__).resolve().parents[2]
T0 = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)
RUN = T0 - timedelta(hours=12)
SC = (-119.5, 32.0, -117.0, 34.5)            # west, south, east, north: straddles the line, both sides


def _vec(lat, lng, hs, d, tp, valid=True):
    if not valid:                    # a dry node as the normalizer stores it: zeros, is_valid False
        return GridVector(lat=round(lat, 4), lng=round(lng, 4), speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0,
                          is_valid=False)
    rad = math.radians(d)
    return GridVector(lat=round(lat, 4), lng=round(lng, 4), speed=round(hs, 4), direction=round(d, 2),
                      u=round(-hs * math.sin(rad), 4), v=round(-hs * math.cos(rad), 4), period=round(tp, 2),
                      is_valid=valid)


def _product(model, box, res, field, region_id="us_west_coast_socal", mode="regional_tile", valid_time=T0,
             run_time=RUN, layer="waves", land=lambda lat, lng: False, estimated=False):
    w, s, e, n = box
    cols, rows = int(round((e - w) / res)) + 1, int(round((n - s) / res)) + 1
    vs = [_vec(s + j * res, w + i * res, *field(s + j * res, w + i * res), valid=not land(s + j * res, w + i * res))
          for j in range(rows) for i in range(cols)]
    b = CoverageBounds(west=w, south=s, east=e, north=n)
    return NormalizedProduct(model=model, provider="open-meteo", domain="marine", layer=layer, run_time=run_time,
                             valid_time=valid_time, is_forecast_authoritative=not estimated, is_estimated=estimated,
                             coverage=b, grid=NormalizedGrid(bounds=b, cols=cols, rows=rows, vectors=vs),
                             value_kind="height", value_unit="m", display_unit_hint="ft", source_variables=["hs"],
                             freshness_sec=0, region_id=region_id, coverage_mode=mode)


def _gfs_field(lat, lng):            # non-uniform so a wrong cell or a wrong weight shows
    return 1.0 + 0.2 * (lat - 32.0) + 0.1 * (lng + 119.5), 265.0 + 2.0 * (lat - 32.0), 12.0 + 0.5 * (lng + 119.5)


def _euro_field(lat, lng):
    return 1.6 + 0.1 * (lat - 32.0), 250.0, 15.0


class FakeStore:
    """A ProductStore stand-in whose manifest items are built by the production helper; counts loads."""

    def __init__(self, products):
        self.files, items = {}, []
        for p, res in products:
            fn = _build_product_filename(p)
            p.product_id = fn
            self.files[fn] = p
            items.append(_build_manifest_item(p, fn, res, False))
        self.manifest = PipelineManifest(last_manifest_update=T0, products=items)
        self.loads, self.cache_dir, self.fail = [], Path("/nowhere"), set()

    def get_manifest(self):
        return self.manifest

    def load_product(self, filename, stride=None):
        self.loads.append(filename)
        if filename in self.fail:
            raise OSError("bucket unavailable")
        p = self.files.get(filename)
        if p is None:
            return None
        p = p.model_copy(deep=True)
        if stride and stride > 1:
            g = p.grid
            keep = [v for k, v in enumerate(g.vectors) if (k // g.cols) % stride == 0 and (k % g.cols) % stride == 0]
            p.grid = g.model_copy(update={"vectors": keep})
        return p

    def name(self, model, layer="waves"):
        return next(fn for fn, p in self.files.items() if p.model == model and p.layer == layer)


def _scene(euro=True, euro_kw=None, extra=()):
    prods = [(_product("GFS", SC, 0.25, _gfs_field, land=lambda la, lo: la > 34.3 and lo > -118.0), 0.25)]
    if euro:
        prods.append((_product("EURO", SC, 0.25, _euro_field, **(euro_kw or {})), 0.25))
    prods.extend(extra)
    return FakeStore(prods)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("SURF_BIGHT_HS_CONSENSUS", "1")
    monkeypatch.delenv("CONSENSUS_SERVE", raising=False)
    S._index = None


def _dump(p):
    return p.model_dump_json().encode("utf-8")


# ── OFF: byte-identical ─────────────────────────────────────────────────────────────────────────────

# sha256 of the served SoCal GFS frame of `_scene()` with the flag off: the raw stored frame, byte for byte.
OFF_SHA256 = "c92971651a2974045977b3a2ad279111776626b48e6afca215bab7829b5806d6"


@pytest.mark.parametrize("value", [None, "0", "", "true", "on", "1 "])
def test_off_the_served_frame_is_the_stored_frame_byte_for_byte(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("SURF_BIGHT_HS_CONSENSUS", raising=False)
    else:
        monkeypatch.setenv("SURF_BIGHT_HS_CONSENSUS", value)
    raw = _scene()
    view = S.served_store(raw)
    fn = raw.name("GFS")
    served = view.load_product(fn)
    assert _dump(served) == _dump(raw.files[fn])
    assert hashlib.sha256(_dump(served)).hexdigest() == OFF_SHA256
    assert raw.loads == [fn]                          # off never reads the manifest's EURO, never loads it
    assert B.enabled() is False


# ── ON: inside the mean, outside unchanged ────────────────────────────────────────────────────────────

def test_on_inside_cells_carry_the_mean_with_gfs_period_and_direction_and_outside_cells_are_gfs(on):
    raw = _scene()
    fn = raw.name("GFS")
    gfs = raw.files[fn]
    served = S.served_store(raw).load_product(fn)
    inside = outside = 0
    for g, s in zip(gfs.grid.vectors, served.grid.vectors):
        assert (s.lat, s.lng, s.period, s.direction, s.is_valid) == (g.lat, g.lng, g.period, g.direction, g.is_valid)
        if g.is_valid and B.inside_bight(g.lat, g.lng):
            inside += 1
            want = 0.5 * (math.hypot(g.u, g.v) + _euro_field(g.lat, g.lng)[0])
            assert s.speed == pytest.approx(want, abs=1e-4)
            assert math.hypot(s.u, s.v) == pytest.approx(want, abs=2e-4)          # the vector lane agrees
            assert math.degrees(math.atan2(-s.u, -s.v)) % 360 == pytest.approx(
                math.degrees(math.atan2(-g.u, -g.v)) % 360, abs=0.05)             # direction is GFS's
        else:
            outside += 1
            assert s == g
    assert inside >= 40 and outside >= 40                                         # the scene straddles the line
    d = served.grid.diagnostics["bight_hs_consensus"]
    assert d["cells"]["blended"] == inside and d["polygon"] == B.POLYGON_VERSION
    assert served.model == "GFS" and served.upstream_model == gfs.upstream_model  # labels untouched (log)


def test_on_the_stored_product_is_never_mutated(on):
    raw = _scene()
    fn = raw.name("GFS")
    before = _dump(raw.files[fn])
    prod = raw.load_product(fn)
    out = B.compose(prod, B.euro_chooser(raw.manifest, T0, raw.load_product, {}))
    assert out is not None and _dump(prod) == before


def test_on_a_strided_series_frame_is_composed_cell_for_cell(on):
    raw = _scene()
    fn = raw.name("GFS")
    full = S.served_store(raw).load_product(fn)
    strided = S.served_store(raw).load_product(fn, stride=2)
    by = {(v.lat, v.lng): v.speed for v in full.grid.vectors}
    assert strided.grid.vectors and all(by[(v.lat, v.lng)] == v.speed for v in strided.grid.vectors)


# ── EURO missing means GFS ──────────────────────────────────────────────────────────────────────────

def _assert_gfs(served, gfs):
    assert [v.speed for v in served.grid.vectors] == [v.speed for v in gfs.grid.vectors]


def test_no_euro_product_serves_gfs(on):
    raw = _scene(euro=False)
    fn = raw.name("GFS")
    served = S.served_store(raw).load_product(fn)
    assert _dump(served) == _dump(raw.files[fn])


def test_a_dry_euro_node_keeps_gfs_it_is_never_averaged_in_as_zero(on):
    """The GFS and EURO tiles share one lattice, so the sampler takes its exact-match path, which returns a dry
    node's stored 0.0 m (SAMPLER_EXACT_VALIDITY '0'). Averaged in, that halves the coast."""
    dry = lambda la, lo: lo > -118.0                                    # noqa: E731
    raw = _scene(euro_kw={"land": dry})
    fn = raw.name("GFS")
    served = S.served_store(raw).load_product(fn)
    gfs = raw.files[fn]
    d = served.grid.diagnostics["bight_hs_consensus"]["cells"]
    assert d["blended"] > 0 and d["euro_missing"] > 0
    for g, s in zip(gfs.grid.vectors, served.grid.vectors):
        if g.is_valid and B.inside_bight(g.lat, g.lng):
            if dry(g.lat, g.lng):
                assert s.speed == g.speed                               # GFS kept, never (GFS + 0) / 2
            else:
                assert s.speed == pytest.approx(0.5 * (math.hypot(g.u, g.v) + _euro_field(g.lat, g.lng)[0]),
                                                abs=1e-4)


def test_off_lattice_euro_reads_its_wet_corners_and_never_a_nearest_fallback(on):
    """A EURO grid offset by half a cell: the bilinear stencil answers where it has a wet corner; a cell whose
    whole stencil is dry stays GFS (no nearest-wet-node reach)."""
    box = (-119.625, 31.875, -116.875, 34.625)
    dry = lambda la, lo: lo > -117.9                                    # noqa: E731
    raw = _scene(euro=False, extra=[(_product("EURO", box, 0.25, _euro_field, land=dry), 0.25)])
    fn = raw.name("GFS")
    served = S.served_store(raw).load_product(fn)
    gfs = raw.files[fn]
    for g, s in zip(gfs.grid.vectors, served.grid.vectors):
        if g.is_valid and B.inside_bight(g.lat, g.lng):
            if g.lng > -117.7:                                          # every corner dry
                assert s.speed == g.speed
            elif g.lng < -118.2:                                        # every corner wet
                assert s.speed > g.speed


@pytest.mark.parametrize("kw", [{"estimated": True}, {"valid_time": T0 + timedelta(hours=4)}, {"layer": "swell_1"}])
def test_an_estimated_off_hour_or_other_layer_euro_is_not_an_answer(on, kw):
    raw = _scene(euro_kw=kw)
    fn = raw.name("GFS")
    _assert_gfs(S.served_store(raw).load_product(fn), raw.files[fn])


def test_a_euro_frame_within_the_resolvers_window_answers_and_is_counted(on):
    raw = _scene(euro_kw={"valid_time": T0 + timedelta(hours=3)})          # MAX_TIME_DIFF_S, as /point serves it
    d = S.served_store(raw).load_product(raw.name("GFS")).grid.diagnostics["bight_hs_consensus"]
    assert d["cells"]["blended"] > 0 and d["euro_frame_offset_cells"] == d["cells"]["blended"]


def test_a_euro_load_failure_serves_gfs(on):
    raw = _scene()
    raw.fail.add(raw.name("EURO"))
    fn = raw.name("GFS")
    _assert_gfs(S.served_store(raw).load_product(fn), raw.files[fn])


def test_a_frame_off_the_bight_is_never_examined(on):
    far = _product("GFS", (-81.0, 26.0, -79.0, 28.0), 0.25, _gfs_field, region_id="florida_east_coast")
    raw = FakeStore([(far, 0.25), (_product("EURO", SC, 0.25, _euro_field), 0.25)])
    fn = raw.name("GFS")
    assert _dump(S.served_store(raw).load_product(fn)) == _dump(raw.files[fn])
    assert raw.loads == [fn]


@pytest.mark.parametrize("model,layer", [("EURO", "waves"), ("GFS", "swell_1"), ("ICON", "waves")])
def test_other_models_and_layers_are_untouched(on, model, layer):
    p = _product(model, SC, 0.25, _gfs_field, layer=layer)
    raw = FakeStore([(p, 0.25), (_product("EURO", SC, 0.25, _euro_field, region_id="x"), 0.25)])
    fn = next(f for f, q in raw.files.items() if q is p)
    assert _dump(S.served_store(raw).load_product(fn)) == _dump(p)


def test_composed_frames_are_cached_and_a_new_run_under_the_same_filename_recomposes(on):
    """Filenames carry no run (store_helpers._build_product_filename), so the cache key carries the runs."""
    raw = _scene()
    view = S.served_store(raw)
    fn, efn = raw.name("GFS"), raw.name("EURO")
    a = view.load_product(fn)
    b = view.load_product(fn)
    assert raw.loads.count(efn) == 1 and a is not b and _dump(a) == _dump(b)
    newer = _product("EURO", SC, 0.25, lambda la, lo: (2.4, 250.0, 15.0), run_time=RUN + timedelta(hours=6))
    assert _build_product_filename(newer) == efn
    newer.product_id = efn
    raw.files[efn] = newer
    raw.manifest.products = [i for i in raw.manifest.products if i.filename != efn] + [
        _build_manifest_item(newer, efn, 0.25, False)]
    c = view.load_product(fn)
    assert raw.loads.count(efn) == 2 and _dump(c) != _dump(a)
    g2 = _product("GFS", SC, 0.25, lambda la, lo: (0.5, 265.0, 12.0), run_time=RUN + timedelta(hours=6))
    g2.product_id = fn
    raw.files[fn] = g2
    d = view.load_product(fn)
    assert max(v.speed for v in d.grid.vectors) < 1.5                 # the new GFS run, never the cached old one


def test_a_frame_euro_cannot_answer_anywhere_is_cached_as_gfs(on):
    raw = _scene(euro_kw={"land": lambda la, lo: True})
    view = S.served_store(raw)
    fn, efn = raw.name("GFS"), raw.name("EURO")
    for _ in range(3):
        _assert_gfs(view.load_product(fn), raw.files[fn])
    assert raw.loads.count(efn) == 1


# ── the frozen polygon ────────────────────────────────────────────────────────────────────────────────

def test_the_polygon_is_round_fours_frozen_boundary():
    assert B.BIGHT_LINE == ((34.45, -120.47), (34.03, -120.37), (33.25, -119.50), (32.82, -118.35),
                            (31.75, -116.75))
    assert B.BIGHT_BBOX == (31.75, 34.6, -120.6, -116.5)


@pytest.mark.parametrize("name,lat,lng,inside", [
    # the round-4 harness stations (CDIP nearshore / NDBC offshore): Bight in, outside out
    ("103p1 Topanga", 34.022068, -118.5784, True), ("153p1", 32.95654, -117.27956, True),
    ("262p1", 33.062077, -117.31407, True), ("201p1", 32.867851, -117.26667, True),
    ("264p1", 33.29076, -117.501455, True), ("284p1", 33.445168, -117.680152, True),
    ("142p1 Rodeo", 37.788, -122.6318, False), ("285p1 Pismo", 35.16396, -120.73756, False),
    ("46025 Santa Monica Basin", 33.765, -119.077, True), ("46221", 33.86, -118.641, True),
    ("46069 west of the islands", 33.657, -120.227, False), ("46219 San Nicolas", 33.226, -119.891, False),
    ("46086 San Clemente Basin", 32.504, -118.029, False), ("46011 Santa Maria", 34.937, -120.999, False),
    # spots
    ("Rincon", 34.373, -119.478, True), ("Trestles", 33.382, -117.589, True), ("Imperial Beach", 32.58, -117.135, True),
    ("Jalama, west of Pt Conception", 34.50, -120.50, False), ("Morro Bay", 35.37, -120.87, False),
    # SURF_SPECTRAL_K's frozen SoCal read point (spectral_k_serving.READ_POINTS, #706): must stay OUTSIDE
    ("SSK socal read point", 32.00, -119.80, False),
])
def test_known_places(name, lat, lng, inside):
    assert B.inside_bight(lat, lng) is inside, name


def test_edges():
    # ON a segment is outside (strict east); a hair east of it is inside
    lat = 33.64
    lo = -120.37 + (lat - 34.03) / (33.25 - 34.03) * (-119.50 + 120.37)
    assert not B.inside_bight(lat, lo) and B.inside_bight(lat, lo + 1e-6)
    # a shared vertex latitude is decided by the northern segment; the vertex itself is outside
    assert not B.inside_bight(33.25, -119.50) and B.inside_bight(33.25, -119.4999)
    # north of Point Conception's latitude, inside the bbox, the line is the meridian 120.47 W
    assert B.inside_bight(34.5, -120.46) and not B.inside_bight(34.5, -120.47)
    # the bbox closes it: inclusive edges, nothing beyond
    assert B.inside_bight(31.75, -116.5) and not B.inside_bight(31.7499, -116.6)
    assert not B.inside_bight(34.6001, -119.0) and not B.inside_bight(33.0, -116.4999)
    assert B.inside_bight(34.6, -119.0)


# ── every surface reads the same value ──────────────────────────────────────────────────────────────

class _NoUpstream:
    def __init__(self):
        self.calls = []

    async def fetch_point(self, *a, **k):
        self.calls.append((a, k))
        raise RuntimeError("no upstream in this test")


@pytest.mark.parametrize("lat,lng", [(33.62, -118.27), (33.03, -117.33), (32.6, -119.2)])
def test_point_hub_and_glyph_lanes_read_the_same_offshore_hs(on, lat, lng):
    from services.weather_pipeline.point_resolution import PointResolutionService
    from services.weather_pipeline.sampler import PointSampler
    from services.weather_pipeline.spot_ratings import rate_one_spot
    raw = _scene()
    up = _NoUpstream()
    svc = PointResolutionService(store=S.served_store(raw), sampler=PointSampler(), provider=up)
    vt = T0.isoformat()
    point = asyncio.run(svc.resolve_point("GFS", "marine", "waves", lat, lng, vt)).point.speed     # /point, sim, alerts
    prod = asyncio.run(svc.find_cached_grid_product("GFS", "marine", "waves", lat, lng, T0))         # the hub's lane
    hub = svc.sampler.sample_point(prod, lat, lng).point.speed
    spot = {"id": "s1", "name": "x", "latitude": lat, "longitude": lng, "accuracy_flag": None,
            "is_verified_peak": False}
    glyph = asyncio.run(rate_one_spot(svc, spot, "GFS", vt))["offshore_hs_m"]                # glyphs, hub rating
    assert point == pytest.approx(hub, abs=1e-9) and glyph == pytest.approx(round(point, 3), abs=1e-9)
    gfs_only = PointSampler().sample_point(raw.files[raw.name("GFS")], lat, lng).point.speed
    assert (point != pytest.approx(gfs_only, abs=1e-3)) is B.inside_bight(lat, lng)
    assert not any(a and a[0] == "GFS" for a, _ in up.calls if a)    # a stored frame answered; no marine upstream


def test_the_precompute_resolver_and_the_routes_store_are_the_view_that_composes():
    import routes.weather
    from services.weather_pipeline.spot_ratings_precompute import _make_point_resolver
    assert isinstance(routes.weather.store, S.ServedStore)
    assert isinstance(_make_point_resolver().store, S.ServedStore)


# ── precedence ──────────────────────────────────────────────────────────────────────────────────────

def _with_twin(raw):
    from services.weather_pipeline.consensus_ingest import as_shadow
    gfs = raw.files[raw.name("GFS")]
    twin = as_shadow(gfs.model_copy(deep=True))
    for v in twin.grid.vectors:
        k = 9.0 / max(math.hypot(v.u, v.v), 1e-9)
        v.speed, v.u, v.v = 9.0, v.u * k, v.v * k
    tfn = _build_product_filename(twin)
    twin.product_id = tfn
    raw.files[tfn] = twin
    raw.manifest.products.append(_build_manifest_item(twin, tfn, 0.25, False))
    return tfn


def test_a_frame_served_as_its_consensus_twin_is_not_composed_again(on, monkeypatch):
    raw = _scene()
    _with_twin(raw)
    monkeypatch.setenv("CONSENSUS_SERVE", "1")
    S._index = None
    served = S.served_store(raw).load_product(raw.name("GFS"))
    assert "served_consensus" in served.grid.diagnostics and "bight_hs_consensus" not in served.grid.diagnostics
    assert all(v.speed == 9.0 for v in served.grid.vectors if v.is_valid)
    assert raw.name("EURO") not in raw.loads


def test_consensus_on_without_a_twin_still_gets_the_bight_mean(on, monkeypatch):
    monkeypatch.setenv("CONSENSUS_SERVE", "1")
    raw = _scene()
    served = S.served_store(raw).load_product(raw.name("GFS"))
    assert served.grid.diagnostics["bight_hs_consensus"]["cells"]["blended"] > 0


def test_consensus_keep_gfs_region_gets_the_bight_mean(on, monkeypatch):
    raw = _scene()
    _with_twin(raw)
    monkeypatch.setenv("CONSENSUS_SERVE", "1")
    monkeypatch.setenv("CONSENSUS_SERVE_KEEP_GFS", "us_west_coast_socal")
    S._index = None
    served = S.served_store(raw).load_product(raw.name("GFS"))
    assert "served_consensus" not in (served.grid.diagnostics or {})
    assert served.grid.diagnostics["bight_hs_consensus"]["cells"]["blended"] > 0


def test_serve_raw_answers_raw_gfs(on):
    raw = _scene()
    fn = raw.name("GFS")
    with S.serve_raw():
        assert B.enabled() is False
        assert _dump(S.served_store(raw).load_product(fn)) == _dump(raw.files[fn])


# ── registration ───────────────────────────────────────────────────────────────────────────────────

LANES = ("forecast-ingest.yml", "precompute.yml", "forecast-ingest-pilots.yml", "sim-parity-monitor.yml")


def _env_values(name, flag):
    doc = yaml.safe_load((REPO / ".github" / "workflows" / name).read_text(encoding="utf-8"))
    out = []
    for job in (doc.get("jobs") or {}).values():
        for step in job.get("steps") or []:
            env = step.get("env") or {}
            if flag in env:
                out.append(str(env[flag]))
        if flag in (job.get("env") or {}):
            out.append(str(job["env"][flag]))
    return out


@pytest.mark.parametrize("lane", LANES)
def test_every_lane_declares_the_flag_dark(lane):
    vals = _env_values(lane, B.FLAG)
    assert vals and set(vals) == {"0"}, (lane, vals)


def test_the_flag_is_registered_dark_and_the_v0_harness_refuses_it():
    from tests.test_flag_lane_parity import REGISTRY
    from services.weather_pipeline.eval_replay import UNREPLAYABLE, parse_arm
    assert REGISTRY[B.FLAG][0] == "0"
    assert B.FLAG in UNREPLAYABLE
    with pytest.raises(ValueError):
        parse_arm(f"{B.FLAG}=1")


def test_no_ingest_module_imports_the_composition():
    import ast
    for module in ("consensus_ingest", "scheduler", "scheduler_helpers", "store", "store_helpers", "lattice_fill",
                   "icon_marine_extension", "euro_wind_extension", "coarse_gulf_fill"):
        tree = ast.parse((REPO / "backend" / "services" / "weather_pipeline" / f"{module}.py").read_text(
            encoding="utf-8"))
        names = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
        assert not any("bight_hs_consensus" in n for n in names), module


def test_compose_itself_refuses_an_estimated_or_foreign_euro_whatever_the_chooser_returns():
    """Defence in depth: the chooser already drops estimated candidates; compose refuses them too."""
    raw = _scene()
    gfs = raw.files[raw.name("GFS")]
    for bad in (_product("EURO", SC, 0.25, _euro_field, estimated=True), _product("ICON", SC, 0.25, _euro_field),
                _product("EURO", SC, 0.25, _euro_field, layer="swell_1")):
        assert B.compose(gfs, lambda lat, lng, p=bad: p) is None
    assert B.compose(gfs, lambda lat, lng: raw.files[raw.name("EURO")]) is not None
