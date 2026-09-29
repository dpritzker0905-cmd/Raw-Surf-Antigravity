"""The equal GFS/EURO/ICON consensus, built as a GFS waves product (consensus_product.build_equal_mean, DARK).

The ledger and the nearshore judge settled the served offshore input on 2026-09-29: the equal three-model mean. This
is its builder, and these pin what it must never get wrong: the consensus cell is the FULL equal mean carrying GFS's
period and direction (the function the judge's consensus arm grades, one definition); a member that cannot answer
leaves GFS's cell untouched and is counted; land stays land; the inputs are never mutated; mismatched inputs are
refused, not blended; and the memoized sampler it needs for speed answers exactly what the fresh one does.
"""
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services.weather_pipeline import consensus_product as cp
from services.weather_pipeline import nearshore_validation
from services.weather_pipeline import sampler as sampler_mod
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

T0 = datetime(2026, 9, 29, 12, tzinfo=timezone.utc)
BOX = (-81.0, 27.0, -79.0, 29.0)          # west, south, east, north: 9 x 9 nodes at 0.25 deg


def _vec(lat, lng, hs, d, tp, valid=True):
    rad = math.radians(d)                  # the normalizer's own formula (normalizer.py: u = -speed sin, v = -speed cos)
    lng = lng - 360.0 if lng > 180.0 else lng   # products store wrapped longitudes
    return GridVector(lat=round(lat, 4), lng=round(lng, 4), speed=round(hs, 4), direction=round(d, 2),
                      u=round(-hs * math.sin(rad), 4), v=round(-hs * math.cos(rad), 4), period=round(tp, 2),
                      is_valid=valid)


def _product(model, field, box=BOX, res=0.25, land=lambda lat, lng: False, valid_time=T0, layer="waves",
             domain="marine", unit="m", pid=None):
    w, s, e, n = box
    cols, rows = int(round((e - w) / res)) + 1, int(round((n - s) / res)) + 1
    vs = []
    for j in range(rows):
        for i in range(cols):
            lat, lng = s + j * res, w + i * res
            hs, d, tp = field(lat, lng)
            vs.append(_vec(lat, lng, hs, d, tp, valid=not land(lat, lng)))
    b = CoverageBounds(west=w, south=s, east=e, north=n)
    return NormalizedProduct(model=model, provider="test", domain=domain, layer=layer, run_time=T0 - timedelta(hours=6),
                             valid_time=valid_time, is_forecast_authoritative=True, is_estimated=False, coverage=b,
                             grid=NormalizedGrid(bounds=b, cols=cols, rows=rows, vectors=vs), value_kind="height",
                             value_unit=unit, display_unit_hint="ft", source_variables=["hs"], freshness_sec=0,
                             product_id=pid or f"{model}_{domain}_{layer}_test")


def _uniform(hs, d, tp):
    return lambda lat, lng: (hs, d, tp)


LAND = lambda lat, lng: lng >= -79.5 and lat >= 28.0      # noqa: E731  a NE corner of land


def _trio(**kw):
    return (_product("GFS", _uniform(0.8, 90.0, 9.0), land=LAND, **kw),
            _product("EURO", _uniform(1.0, 100.0, 10.0), land=LAND),
            _product("ICON", _uniform(1.2, 110.0, 11.0), land=LAND))


# ── the builder ──────────────────────────────────────────────────────────────────────────────────────

def test_every_answered_cell_is_the_full_equal_mean_with_gfs_period_and_direction():
    gfs, euro, icon = _trio()
    out = cp.build_equal_mean(gfs, euro, icon)
    blended = [(a, b) for a, b in zip(gfs.grid.vectors, out.grid.vectors) if a.is_valid]
    assert blended
    for before, after in blended:
        assert after.speed == pytest.approx(1.0)                                    # (0.8 + 1.0 + 1.2) / 3
        assert math.hypot(after.u, after.v) == pytest.approx(1.0, abs=2e-4)          # |(u, v)| IS the served height
        assert after.period == before.period == 9.0                                  # GFS's period, not a member's
        assert after.direction == before.direction == 90.0
        assert math.degrees(math.atan2(-after.u, -after.v)) % 360 == pytest.approx(90.0, abs=0.01)
    d = out.grid.diagnostics["consensus"]
    assert d["cells"]["blended"] == len(blended) and d["cells"]["kept_primary"] == 0
    assert d["consensus_over_primary"] == {"p10": 1.25, "median": 1.25, "p90": 1.25}


def test_the_product_answers_at_a_point_what_the_judges_consensus_arm_computes_there():
    """ONE definition: at every GFS node, the built product's /point answer equals equal_consensus over the three
    members' /point answers there, which is what the judge's CONSENSUS arm grades (run_nearshore_validation)."""
    rng = random.Random(7)
    wavy = lambda a: (lambda lat, lng: (a + 0.4 * math.sin(3 * lat) + 0.3 * math.cos(2 * lng),   # noqa: E731
                                        (200 + 40 * math.sin(lat + lng)) % 360, 8 + 3 * math.cos(lat)))
    gfs, euro, icon = (_product(m, wavy(a), land=LAND) for m, a in (("GFS", 0.9), ("EURO", 1.1), ("ICON", 1.4)))
    out = cp.build_equal_mean(gfs, euro, icon)
    s = PointSampler()
    nodes = [v for v in gfs.grid.vectors if v.is_valid]
    for v in rng.sample(nodes, 25):
        members = {m: cp.member_answer(s, p, v.lat, v.lng) for m, p in (("GFS", gfs), ("EURO", euro), ("ICON", icon))}
        want = nearshore_validation.equal_consensus(members)
        got = s.sample_point(out, v.lat, v.lng).point
        assert got.speed == pytest.approx(want["hs"], abs=3e-4)
        assert got.period == pytest.approx(want["tp"]) and got.direction == pytest.approx(want["dir"], abs=0.05)


def test_gfs_own_height_at_a_node_is_what_the_sampler_serves_there():
    """The builder reads GFS's Hs as |(u, v)| at the node; the positive control that /point reads the same."""
    gfs, _, _ = _trio()
    s = PointSampler()
    for v in gfs.grid.vectors:
        if v.is_valid:
            assert s.sample_point(gfs, v.lat, v.lng).point.speed == pytest.approx(math.hypot(v.u, v.v), abs=1e-4)


def test_a_member_that_cannot_answer_leaves_the_gfs_cell_and_is_counted():
    gfs = _product("GFS", _uniform(0.8, 90.0, 9.0))
    euro = _product("EURO", _uniform(1.0, 100.0, 10.0), box=(-81.0, 27.0, -80.0, 29.0))   # covers the west half only
    icon = _product("ICON", _uniform(1.2, 110.0, 11.0))
    out = cp.build_equal_mean(gfs, euro, icon)
    d = out.grid.diagnostics["consensus"]
    for before, after in zip(gfs.grid.vectors, out.grid.vectors):
        if before.lng > -80.0:
            assert after.model_dump() == before.model_dump()          # untouched: never a two-model mean
        else:
            assert after.speed == pytest.approx(1.0)
    east = sum(v.lng > -80.0 for v in gfs.grid.vectors)
    assert d["member_missing"] == {"EURO": east, "ICON": 0}
    assert d["cells"] == {"blended": len(gfs.grid.vectors) - east, "kept_primary": east, "not_ocean": 0}


def test_land_stays_land_and_the_counts_cover_every_cell():
    gfs, euro, icon = _trio()
    out = cp.build_equal_mean(gfs, euro, icon)
    for before, after in zip(gfs.grid.vectors, out.grid.vectors):
        if not before.is_valid:
            assert after.model_dump() == before.model_dump()
    c = out.grid.diagnostics["consensus"]["cells"]
    assert c["not_ocean"] == sum(not v.is_valid for v in gfs.grid.vectors) > 0
    assert sum(c.values()) == len(gfs.grid.vectors)


def test_a_gfs_cell_with_no_sea_to_scale_is_kept_and_counted():
    gfs, euro, icon = _trio()
    calm = next(v for v in gfs.grid.vectors if v.is_valid)
    calm.u = calm.v = calm.speed = 0.0
    out = cp.build_equal_mean(gfs, euro, icon)
    d = out.grid.diagnostics["consensus"]
    assert d["primary_zero"] == 1 and d["cells"]["kept_primary"] == 1
    assert out.grid.vectors[gfs.grid.vectors.index(calm)].speed == 0.0


def test_identical_members_are_a_null_change():
    gfs = _product("GFS", _uniform(0.8, 90.0, 9.0), land=LAND)
    out = cp.build_equal_mean(gfs, _product("EURO", _uniform(0.8, 90.0, 9.0), land=LAND),
                              _product("ICON", _uniform(0.8, 90.0, 9.0), land=LAND))
    for before, after in zip(gfs.grid.vectors, out.grid.vectors):
        assert (after.speed, after.u, after.v) == pytest.approx((before.speed, before.u, before.v), abs=1e-4)
    assert out.grid.diagnostics["consensus"]["consensus_over_primary"]["median"] == 1.0


def test_the_inputs_are_never_mutated_and_provenance_names_every_member():
    gfs, euro, icon = _trio()
    snap = [p.model_dump_json() for p in (gfs, euro, icon)]
    out = cp.build_equal_mean(gfs, euro, icon)
    assert [p.model_dump_json() for p in (gfs, euro, icon)] == snap
    d = out.grid.diagnostics["consensus"]
    assert d["members"] == ["GFS", "EURO", "ICON"] and d["carried_from_primary"] == ["period", "direction"]
    assert {m: v["product_id"] for m, v in d["member_products"].items()} == {
        "GFS": gfs.product_id, "EURO": euro.product_id, "ICON": icon.product_id}
    assert d["valid_time"] == T0.isoformat() and out.model == "GFS" and out.product_id == gfs.product_id
    assert '"consensus"' in out.model_dump_json()                  # a declared field: it survives serialization


@pytest.mark.parametrize("bad", ["valid_time", "layer", "model", "unit", "no_grid", "missing"])
def test_mismatched_inputs_are_refused_not_blended(bad):
    gfs, euro, icon = _trio()
    if bad == "valid_time":
        euro = _product("EURO", _uniform(1.0, 100.0, 10.0), valid_time=T0 + timedelta(hours=3))
    elif bad == "layer":
        icon = _product("ICON", _uniform(1.2, 110.0, 11.0), layer="swell_1")
    elif bad == "model":
        euro = _product("ICON", _uniform(1.0, 100.0, 10.0))
    elif bad == "unit":
        icon = _product("ICON", _uniform(1.2, 110.0, 11.0), unit="ft")
    elif bad == "no_grid":
        gfs.grid = None
    else:
        euro = None
    with pytest.raises(ValueError, match="consensus"):
        cp.build_equal_mean(gfs, euro, icon)


def test_the_judge_and_the_builder_share_one_equal_mean():
    assert nearshore_validation.equal_consensus is cp.equal_consensus
    assert nearshore_validation.CONSENSUS_MEMBERS is cp.CONSENSUS_MEMBERS == ("GFS", "EURO", "ICON")


# ── the memoized sampler ─────────────────────────────────────────────────────────────────────────────

def _messy(model, box, res, seed, layer="waves", domain="marine"):
    rng = random.Random(seed)
    masked = {(j, i) for j in range(200) for i in range(200) if rng.random() < 0.3}
    w, s = box[0], box[1]
    p = _product(model, lambda lat, lng: (0.5 + rng.random() * 2, rng.random() * 360, 5 + rng.random() * 10),
                 box=box, res=res, layer=layer, domain=domain,
                 land=lambda lat, lng: (round((lat - s) / res), round((lng - w) / res)) in masked)
    if domain == "weather":
        for v in p.grid.vectors:
            v.value = None if not v.is_valid else v.speed
    return p


@pytest.mark.parametrize("box,res,layer,domain", [
    ((-81.0, 27.0, -79.0, 29.0), 0.25, "waves", "marine"),         # bilinear, masked, nearest, coarse-masked
    ((-81.0, 27.0, -79.0, 29.0), 0.25, "swell_1", "marine"),       # the partition reach rule
    ((178.0, -20.0, 182.0, -16.0), 0.5, "waves", "marine"),        # an antimeridian-crossing grid
    ((-81.0, 27.0, -79.0, 29.0), 0.25, "pressure", "weather"),     # the scalar branch and its nearest fallback
])
def test_the_memoized_sampler_answers_exactly_what_a_fresh_one_does(box, res, layer, domain):
    p = _messy("GFS", box, res, seed=11, layer=layer, domain=domain)
    rng = random.Random(3)
    w, s, e, n = box
    pts = [(rng.uniform(s - 1, n + 1), rng.uniform(w - 1, e + 1)) for _ in range(300)]       # incl. out of bounds
    pts += [(v.lat, v.lng) for v in p.grid.vectors[::7]]                                     # incl. exact nodes
    fresh, memo = PointSampler(), PointSampler(memoize=True)
    methods = set()
    for lat, lng in pts:
        lng = lng - 360 if lng > 180 else lng
        a, b = fresh.sample_point(p, lat, lng), memo.sample_point(p, lat, lng)
        assert b.model_dump() == a.model_dump()
        methods.add(a.point.interpolation_method)
    assert len(memo._memo) == 1 and fresh._memo is None
    assert "out_of_bounds_fallback" in methods and len(methods) >= 3                      # the branches were reached


def test_the_memo_builds_each_member_index_once(monkeypatch):
    calls = []
    real = sampler_mod._to_monotonic_lng
    monkeypatch.setattr(sampler_mod, "_to_monotonic_lng", lambda x, w: calls.append(1) or real(x, w))
    gfs, euro, icon = _trio()
    cp.build_equal_mean(gfs, euro, icon)
    samples = 2 * sum(v.is_valid for v in gfs.grid.vectors)
    # one index per member (a call per vector) + one call per sample; unmemoized this is samples x (grid + 1)
    assert len(calls) == len(euro.grid.vectors) + len(icon.grid.vectors) + samples


def test_only_short_lived_samplers_memoize():
    """The memo holds every product it sees until the sampler is dropped, so the long-lived module-level samplers
    (routes/, scheduler/) must stay unmemoized: memoize=True appears only where a sampler is built for one
    job and dropped after it (the consensus builder and its per-hour ingest)."""
    assert PointSampler()._memo is None
    backend = Path(__file__).resolve().parents[1]
    hits = sorted(str(f.relative_to(backend)).replace("\\", "/") for f in backend.rglob("*.py")
                  if "tests" not in f.parts and ".venv" not in f.parts and "PointSampler(memoize=True" in f.read_text("utf-8", "ignore"))
    # consensus_ingest.build_hour: one sampler per forecast hour, dropped with it (2026-09-29, D-009).
    assert hits == ["services/weather_pipeline/consensus_ingest.py", "services/weather_pipeline/consensus_product.py"]
