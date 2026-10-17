"""SAMPLER_SCALAR_HEIGHT (dark): a marine height is interpolated as the scalar it is.

The bilinear branches average the corners' (u, v) and report sqrt(u^2 + v^2) as the point's height. For wind,
a vector, that is right. For a significant wave height it can only shrink the answer, by as much as the corners'
directions diverge, which is where surf spots are. The fixture is REAL: the four GFS-Wave 0.25-deg nodes around
NDBC 51202 (Mokapu Point, Oahu) in `gfs_marine_waves_hawaii_20261001T030000Z.json`, read from production /grid on
2026-09-30: a 14 s south swell (189 deg) on two corners and an 8 s east trade sea (75-84 deg) on the other two.
Served /point there read 0.9795 m; Open-Meteo's same-model cell read 1.44 m; the corners are 1.39-1.57 m.
"""
import math
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from services.weather_pipeline.sampler import PointSampler, scalar_marine_height_enabled
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct,
)

BACKEND = Path(__file__).resolve().parents[1]
BUOY = (21.417, -157.679)   # NDBC 51202's position as sampled on 2026-09-30

# (lat, lng): (speed m, direction deg FROM, u, v, period s), verbatim from the production product
MOKAPU = {
    (21.25, -157.75): (1.57, 189.25, 0.2524, 1.5496, 14.45),
    (21.25, -157.5): (1.42, 144.32, -0.8282, 1.1534, 14.06),
    (21.5, -157.75): (1.43, 75.1, -1.3819, -0.3677, 7.86),
    (21.5, -157.5): (1.39, 83.56, -1.3812, -0.1559, 10.26),
}


def _vec(lat, lng, speed, direction, u=None, v=None, period=10.0, valid=True):
    if u is None:
        u = -speed * math.sin(math.radians(direction))
        v = -speed * math.cos(math.radians(direction))
    return GridVector(lat=lat, lng=lng, speed=speed if valid else 0.0, direction=direction if valid else 0.0,
                      u=u if valid else 0.0, v=v if valid else 0.0, period=period if valid else 0.0,
                      is_valid=valid)


def _product(vectors, domain="marine", layer="waves", model="GFS"):
    cov = CoverageBounds(west=-157.75, south=21.25, east=-157.5, north=21.5)
    now = datetime(2026, 10, 1, 3, tzinfo=timezone.utc)
    return NormalizedProduct(
        model=model, provider="open-meteo", domain=domain, layer=layer, run_time=now, valid_time=now,
        is_forecast_authoritative=True, is_estimated=False, coverage=cov,
        grid=NormalizedGrid(bounds=cov, cols=2, rows=2, vectors=vectors),
        value_kind="wave_height" if domain == "marine" else "wind_speed", value_unit="m", display_unit_hint="ft",
        product_id="gfs_marine_waves_hawaii_20261001T030000Z.json", source_variables=["wave_height"],
        freshness_sec=1800, region_id="hawaii", coverage_mode="regional_tile",
    )


def _mokapu(domain="marine", layer="waves", model="GFS"):
    return _product([_vec(la, lo, s, d, u, v, p) for (la, lo), (s, d, u, v, p) in MOKAPU.items()], domain, layer,
                    model)


def _pt(product, lat=BUOY[0], lng=BUOY[1]):
    return PointSampler().sample_point(product, lat, lng).point


def test_dark_by_default_the_served_answer_is_the_vector_mean(monkeypatch):
    """Null control: with the flag unset nothing moves; this is the number production serves today."""
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    p = _pt(_mokapu())
    assert p.interpolation_method == "bilinear"
    assert p.speed == pytest.approx(0.9795, abs=1e-4)


def test_on_the_height_is_the_scalar_mean_and_the_direction_is_unchanged(monkeypatch):
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    off = _pt(_mokapu())
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    on = _pt(_mokapu())
    assert on.interpolation_method == "bilinear"
    assert on.speed == pytest.approx(1.4547, abs=1e-4)          # inside the corners' 1.39-1.57 m
    assert min(s for s, *_ in MOKAPU.values()) <= on.speed <= max(s for s, *_ in MOKAPU.values())
    assert on.direction == pytest.approx(off.direction, abs=0.01)
    assert on.period == off.period
    # u/v are rebuilt from the height and direction, so the point is one self-consistent vector
    assert math.hypot(on.u, on.v) == pytest.approx(on.speed, abs=2e-4)
    assert math.degrees(math.atan2(-on.u, -on.v)) % 360 == pytest.approx(on.direction, abs=0.02)


def test_aligned_corners_give_the_same_answer_either_way(monkeypatch):
    """The fix acts only where directions diverge: an open-ocean cell with one swell reads identically."""
    vecs = [_vec(21.25, -157.75, 1.6, 300.0), _vec(21.25, -157.5, 1.2, 300.0),
            _vec(21.5, -157.75, 1.4, 300.0), _vec(21.5, -157.5, 1.1, 300.0)]
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "0")
    off = _pt(_product(vecs))
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    on = _pt(_product(vecs))
    assert on.speed == pytest.approx(off.speed, abs=1e-4)
    assert on.direction == pytest.approx(off.direction, abs=0.01)


def test_wind_is_a_vector_and_stays_one(monkeypatch):
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    assert not scalar_marine_height_enabled("wind")
    assert not scalar_marine_height_enabled("weather")
    assert scalar_marine_height_enabled("marine") and scalar_marine_height_enabled("MARINE")
    p = _pt(_mokapu(domain="wind", layer="wind"))
    assert p.speed == pytest.approx(0.9795, abs=1e-4)


def test_the_ocean_masked_branch_takes_the_scalar_mean_of_its_surviving_corners(monkeypatch):
    items = list(MOKAPU.items())
    vecs = [_vec(la, lo, s, d, u, v, p) for (la, lo), (s, d, u, v, p) in items[:3]]
    (la, lo), _ = items[3]
    vecs.append(_vec(la, lo, 0.0, 0.0, valid=False))            # a land corner
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "0")
    off = _pt(_product(vecs))
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    on = _pt(_product(vecs))
    assert on.interpolation_method == off.interpolation_method == "bilinear_ocean_masked"
    lat, lng = BUOY
    t = (lng - -157.75) / 0.25
    u = (lat - 21.25) / 0.25
    w = [(1 - t) * (1 - u), t * (1 - u), (1 - t) * u]
    expected = sum(wi * s for wi, ((_, _), (s, *_)) in zip(w, items[:3])) / sum(w)
    assert on.speed == pytest.approx(expected, abs=1e-4)
    assert on.speed > off.speed
    assert on.direction == pytest.approx(off.direction, abs=0.01)


def test_a_perfectly_cancelling_mean_takes_the_heaviest_corners_direction(monkeypatch):
    """Two equal, opposite seas at the cell centre: the vector mean is zero and has no direction."""
    vecs = [_vec(21.25, -157.75, 1.0, 90.0), _vec(21.25, -157.5, 1.0, 270.0),
            _vec(21.5, -157.75, 1.0, 270.0), _vec(21.5, -157.5, 1.0, 90.0)]
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "0")
    assert _pt(_product(vecs), 21.375, -157.625).speed == pytest.approx(0.0, abs=1e-4)
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    on = _pt(_product(vecs), 21.375, -157.625)
    assert on.speed == pytest.approx(1.0, abs=1e-4)
    assert on.direction in (90.0, 270.0)


def test_the_scalar_answer_is_never_below_the_vector_answer(monkeypatch):
    """|sum w_i h_i e_i| <= sum w_i h_i: the defect is one-sided (a low bias), so the fix only raises."""
    import random
    rnd = random.Random(20260930)
    for _ in range(200):
        vecs = [_vec(la, lo, rnd.uniform(0.2, 4.0), rnd.uniform(0, 360), period=rnd.uniform(5, 18))
                for la in (21.25, 21.5) for lo in (-157.75, -157.5)]
        lat, lng = rnd.uniform(21.26, 21.49), rnd.uniform(-157.74, -157.51)
        monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "0")
        off = _pt(_product(vecs), lat, lng).speed
        monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
        on = _pt(_product(vecs), lat, lng).speed
        assert on >= off - 1e-4


def test_every_lane_that_samples_a_point_declares_the_switch_flipped_and_equal():
    """Glyphs (precompute, core ingest) and the consensus builder (pilots) sample through this code; a flip
    in one lane alone would serve two interpolations of the same sea."""
    values = {}
    for wf in ("forecast-ingest.yml", "forecast-ingest-pilots.yml", "precompute.yml"):
        d = yaml.safe_load((BACKEND.parent / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        found = [st["env"]["SAMPLER_SCALAR_HEIGHT"] for j in d["jobs"].values() for st in j.get("steps", [])
                 if isinstance(st, dict) and "SAMPLER_SCALAR_HEIGHT" in (st.get("env") or {})]
        assert len(found) == 1, wf
        values[wf] = found[0]
    assert set(values.values()) == {"1"}, values      # FLIPPED 2026-10-17 (GFS first, via SAMPLER_SCALAR_HEIGHT_MODELS)


# ─── THE LEDGER'S SCALAR SHADOW LANE: paired buoy truth for the flip ─────────────────────────────────────────────

def test_force_scalar_height_is_a_context_and_touches_only_marine(monkeypatch):
    from services.weather_pipeline.sampler import force_scalar_height
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    assert _pt(_mokapu()).speed == pytest.approx(0.9795, abs=1e-4)
    with force_scalar_height():
        assert _pt(_mokapu()).speed == pytest.approx(1.4547, abs=1e-4)
        assert _pt(_mokapu(domain="wind", layer="wind")).speed == pytest.approx(0.9795, abs=1e-4)
    assert _pt(_mokapu()).speed == pytest.approx(0.9795, abs=1e-4)      # restored on exit


def test_the_ledger_grades_a_scalar_lane_only_while_the_switch_is_dark(monkeypatch):
    from services.weather_pipeline import forecast_skill as fs
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    monkeypatch.delenv("SAMPLER_SCALAR_LEDGER", raising=False)
    assert fs.GFS_SCALAR not in fs.compare_models("GFS")
    monkeypatch.setenv("SAMPLER_SCALAR_LEDGER", "1")
    assert fs.GFS_SCALAR in fs.compare_models("GFS")
    assert fs.GFS_SCALAR not in fs.compare_models("EURO")
    assert fs.source_for(fs.GFS_SCALAR, "GFS") == "raw_surf:GFS_SCALAR"
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")                    # served: the shadow would double-count
    assert fs.GFS_SCALAR not in fs.compare_models("GFS")


def test_the_scalar_lane_resolves_gfs_with_a_scalar_sampler_and_the_served_lane_does_not(monkeypatch):
    import asyncio
    from services.weather_pipeline import buoy_calibration as bc
    from services.weather_pipeline import forecast_skill as fs
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    monkeypatch.setenv("SAMPLER_SCALAR_LEDGER", "1")
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "")
    monkeypatch.setenv("FORECAST_SKILL_PERSISTENCE", "0")
    monkeypatch.delenv("CONSENSUS_INGEST", raising=False)
    monkeypatch.delenv("CONSENSUS_SERVE", raising=False)
    seen = []

    async def fake_calibrate(resolver, spots, model, target):
        seen.append((model, scalar_marine_height_enabled("marine")))
        return {"spots": []}

    async def no_coords():
        return {}
    monkeypatch.setattr(bc, "calibrate_spots", fake_calibrate)
    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", no_coords)
    monkeypatch.setattr(bc, "load_calibration_rows_l2", lambda *a, **k: ([], False))
    monkeypatch.setattr(bc, "upload_calibration_l2", lambda *a, **k: None)
    try:
        asyncio.run(fs.run_skill_ledger(None, None, [], "GFS", {"spots": []}))
    except Exception:
        pass                                              # only the lane resolution is under test here
    assert ("GFS", False) in seen and ("GFS", True) in seen   # served lane vector; GFS_SCALAR lane scalar
    assert all(m == "GFS" for m, _ in seen)
    assert not scalar_marine_height_enabled("marine")         # nothing leaks out of the lane


def test_both_ledger_lanes_declare_the_scalar_shadow_equal():
    values = {}
    for wf in ("forecast-ingest.yml", "precompute.yml"):
        d = yaml.safe_load((BACKEND.parent / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        found = [st["env"]["SAMPLER_SCALAR_LEDGER"] for j in d["jobs"].values() for st in j.get("steps", [])
                 if isinstance(st, dict) and "SAMPLER_SCALAR_LEDGER" in (st.get("env") or {})]
        assert len(found) == 1, wf
        values[wf] = found[0]
    assert len(set(values.values())) == 1, values


# ─── MODEL SCOPE: the switch was keyed on DOMAIN, so flipping it moved EURO and ICON, which no scalar lane graded ──
# 2026-10-17 the one-off scored-rows job returned GATE YES for GFS (raw_surf:GFS_SCALAR beats served in every graded
# cell). EURO and ICON have no scalar shadow lane, and ICON already leans high (+0.06..+0.09 m) while the scalar is
# one-sided upward. SAMPLER_SCALAR_HEIGHT_MODELS (default GFS) says which models the master switch applies to.
# ★ `force_scalar_height()` (the ledger's measurement instrument) ignores the list on purpose; `model=None` keeps the
# pre-list rule so no caller that cannot name its model regresses silently.

MASTER, LIST = "SAMPLER_SCALAR_HEIGHT", "SAMPLER_SCALAR_HEIGHT_MODELS"
VECTOR_M, SCALAR_M = 0.9795, 1.4547          # the Mokapu fixture's two answers (see the first two tests)
ALL_THREE = {"GFS", "EURO", "ICON"}


@pytest.fixture(autouse=True)
def _no_ambient_model_list(monkeypatch):
    """A developer's shell must not decide which models these tests treat as scalar."""
    monkeypatch.delenv(LIST, raising=False)


def _masked_vectors():
    items = list(MOKAPU.items())
    vecs = [_vec(la, lo, s, d, u, v, p) for (la, lo), (s, d, u, v, p) in items[:3]]
    (la, lo), _ = items[3]
    return vecs + [_vec(la, lo, 0.0, 0.0, valid=False)]            # a land corner


def _masked_scalar_expected():
    items = list(MOKAPU.items())
    t = (BUOY[1] - -157.75) / 0.25
    u = (BUOY[0] - 21.25) / 0.25
    w = [(1 - t) * (1 - u), t * (1 - u), (1 - t) * u]
    return sum(wi * s for wi, ((_, _), (s, *_)) in zip(w, items[:3])) / sum(w)


def _both_call_sites(model):
    """(4-corner point, ocean-masked point) of the Mokapu fixture sampled AS `model`: the sampler's two bilinear sites."""
    four, masked = _pt(_mokapu(model=model)), _pt(_product(_masked_vectors(), model=model))
    assert (four.interpolation_method, masked.interpolation_method) == ("bilinear", "bilinear_ocean_masked")
    return four, masked


def _vector_baseline(monkeypatch):
    """What production serves today for each branch (the master switch dark)."""
    monkeypatch.delenv(MASTER, raising=False)
    four, masked = _both_call_sites("GFS")
    assert four.speed == pytest.approx(VECTOR_M, abs=1e-4) and masked.speed < _masked_scalar_expected() - 0.01
    return four, masked


@pytest.mark.parametrize("model", ["GFS", "EURO", "ICON"])
@pytest.mark.parametrize("listing", [None, "*", "GFS,EURO,ICON", "ICON"])
def test_master_dark_no_model_reads_the_scalar_whatever_the_list_says(monkeypatch, model, listing):
    """Null control: the new variable has no effect while the master switch is '0'."""
    base_four, base_masked = _vector_baseline(monkeypatch)
    if listing is not None:
        monkeypatch.setenv(LIST, listing)
    four, masked = _both_call_sites(model)
    assert (four, masked) == (base_four, base_masked)


def test_flag_on_with_the_default_list_gfs_reads_the_scalar_and_euro_and_icon_stay_the_vector(monkeypatch):
    base_four, base_masked = _vector_baseline(monkeypatch)
    monkeypatch.setenv(MASTER, "1")
    four, masked = _both_call_sites("GFS")
    assert four.speed == pytest.approx(SCALAR_M, abs=1e-4)
    assert masked.speed == pytest.approx(_masked_scalar_expected(), abs=1e-4)
    for model in ("EURO", "ICON"):
        # the WHOLE point, not just the height: EURO and ICON are identical to the dark answer
        assert _both_call_sites(model) == (base_four, base_masked), model


def test_star_applies_the_scalar_to_every_model_at_both_call_sites(monkeypatch):
    _vector_baseline(monkeypatch)
    monkeypatch.setenv(MASTER, "1")
    monkeypatch.setenv(LIST, "*")
    for model in sorted(ALL_THREE):
        four, masked = _both_call_sites(model)
        assert four.speed == pytest.approx(SCALAR_M, abs=1e-4), model
        assert masked.speed == pytest.approx(_masked_scalar_expected(), abs=1e-4), model


def test_a_list_that_names_icon_alone_moves_icon_only(monkeypatch):
    base_four, base_masked = _vector_baseline(monkeypatch)
    monkeypatch.setenv(MASTER, "1")
    monkeypatch.setenv(LIST, "ICON")
    assert _both_call_sites("GFS") == (base_four, base_masked)
    assert _both_call_sites("EURO") == (base_four, base_masked)
    assert _both_call_sites("ICON")[0].speed == pytest.approx(SCALAR_M, abs=1e-4)


def test_the_products_model_is_matched_without_regard_to_case_or_padding(monkeypatch):
    monkeypatch.setenv(MASTER, "1")
    assert _both_call_sites("gfs")[0].speed == pytest.approx(SCALAR_M, abs=1e-4)
    assert _both_call_sites("euro")[0].speed == pytest.approx(VECTOR_M, abs=1e-4)      # not listed, whatever its case
    monkeypatch.setenv(LIST, "euro")
    assert _both_call_sites("EURO")[0].speed == pytest.approx(SCALAR_M, abs=1e-4)
    assert _both_call_sites(" Euro ")[0].speed == pytest.approx(SCALAR_M, abs=1e-4)
    assert _both_call_sites("GFS")[0].speed == pytest.approx(VECTOR_M, abs=1e-4)


@pytest.mark.parametrize("listing, scalar_models", [
    ("GFS", {"GFS"}),
    ("gfs", {"GFS"}),
    ("  gfs ,  icon  ", {"GFS", "ICON"}),
    ("EURO,,ICON,", {"EURO", "ICON"}),
    (",GFS", {"GFS"}),
    ("euro, BOGUS", {"EURO"}),              # an unknown name is inert, not an error
    ("*", ALL_THREE),
    (" * ", ALL_THREE),
    ("GFS,*", ALL_THREE),
    # an EMPTY list names nobody (the repo convention: '' = none, as FORECAST_SKILL_COMPARE_MODELS and
    # CONSENSUS_SERVE_KEEP_GFS); only `*` says "all", so a blank Render variable can never widen the flip
    ("", set()),
    ("   ", set()),
    (",,", set()),
])
def test_list_parsing(monkeypatch, listing, scalar_models):
    monkeypatch.setenv(MASTER, "1")
    monkeypatch.setenv(LIST, listing)
    for model in sorted(ALL_THREE):
        assert scalar_marine_height_enabled("marine", model) is (model in scalar_models), (listing, model)


def test_an_unlisted_model_name_gets_the_vector_even_if_it_is_not_one_of_the_three(monkeypatch):
    """CONSENSUS (the shadow product: GFS cells scaled by the equal mean) is not GFS, so it follows the list and
    reads the vector by default. Pinned so a change is a decision, not an accident."""
    monkeypatch.setenv(MASTER, "1")
    assert not scalar_marine_height_enabled("marine", "CONSENSUS")
    monkeypatch.setenv(LIST, "GFS,CONSENSUS")
    assert scalar_marine_height_enabled("marine", "CONSENSUS")


@pytest.mark.parametrize("unknown", [None, "", "   "])
def test_a_caller_that_cannot_name_its_model_keeps_the_pre_list_rule(monkeypatch, unknown):
    monkeypatch.setenv(MASTER, "1")
    monkeypatch.setenv(LIST, "ICON")                              # names nobody who is asking
    assert scalar_marine_height_enabled("marine", unknown) is True
    assert scalar_marine_height_enabled("MARINE", unknown) is True
    assert not scalar_marine_height_enabled("wind", unknown)       # the domain gate is untouched
    monkeypatch.setenv(MASTER, "0")
    assert scalar_marine_height_enabled("marine", unknown) is False
    monkeypatch.delenv(MASTER)
    assert scalar_marine_height_enabled("marine", unknown) is False


@pytest.mark.parametrize("value", ["true", "yes", "2", "01", " 1", "1 ", "on"])
def test_only_the_exact_string_1_arms_the_master_switch(monkeypatch, value):
    """A typo or a 'true' in an env panel must never flip a served number: the rule is `== "1"`, nothing looser."""
    monkeypatch.setenv(LIST, "*")
    monkeypatch.setenv(MASTER, value)
    assert scalar_marine_height_enabled("marine", "GFS") is False
    assert scalar_marine_height_enabled("marine") is False
    assert _both_call_sites("GFS")[0].speed == pytest.approx(VECTOR_M, abs=1e-4)


def test_omitting_model_is_the_same_as_none(monkeypatch):
    monkeypatch.setenv(MASTER, "1")
    monkeypatch.setenv(LIST, "ICON")
    assert scalar_marine_height_enabled("marine") is scalar_marine_height_enabled("marine", None) is True


def test_force_scalar_height_forces_a_model_the_list_does_not_name(monkeypatch):
    """The ledger's GFS_SCALAR lane is the measurement instrument: it must scalar-sample whatever it is pointed at."""
    from services.weather_pipeline.sampler import force_scalar_height
    base_four, base_masked = _vector_baseline(monkeypatch)
    with force_scalar_height():                                   # master dark, list default: EURO is not listed
        four, masked = _both_call_sites("EURO")
        assert four.speed == pytest.approx(SCALAR_M, abs=1e-4)
        assert masked.speed == pytest.approx(_masked_scalar_expected(), abs=1e-4)
        assert not scalar_marine_height_enabled("wind", "EURO")  # still marine only
    assert _both_call_sites("EURO") == (base_four, base_masked)  # restored on exit
    monkeypatch.setenv(MASTER, "1")
    monkeypatch.setenv(LIST, "ICON")                              # master ON, and the list excludes GFS
    assert not scalar_marine_height_enabled("marine", "GFS")
    with force_scalar_height():
        assert scalar_marine_height_enabled("marine", "GFS")
    assert not scalar_marine_height_enabled("marine", "GFS")


def test_no_call_site_in_the_sampler_omits_the_model():
    """A third bilinear branch that forgets `model` would silently keep the pre-list rule for EURO and ICON."""
    import ast
    src = (BACKEND / "services" / "weather_pipeline" / "sampler.py").read_text(encoding="utf-8")
    calls = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Call)
             and getattr(n.func, "id", None) == "scalar_marine_height_enabled"]
    assert len(calls) == 2, "the two bilinear branches are the only call sites; a new one needs its own model argument"
    for c in calls:
        passed = len(c.args) >= 2 or any(k.arg == "model" for k in c.keywords)
        assert passed, f"line {c.lineno}: scalar_marine_height_enabled() called without the product's model"


def test_every_lane_declares_the_model_list_equal_and_at_the_code_default():
    """The master switch is pinned equal across the three lanes for a reason: a flip in one alone serves two
    interpolations of the same sea. The model list has the same hazard, so it is declared in the same three places."""
    from services.weather_pipeline.sampler import SCALAR_HEIGHT_MODELS_DEFAULT
    assert SCALAR_HEIGHT_MODELS_DEFAULT == "GFS"                  # GFS first; ICON/EURO join after their own lanes grade
    values = {}
    for wf in ("forecast-ingest.yml", "forecast-ingest-pilots.yml", "precompute.yml"):
        d = yaml.safe_load((BACKEND.parent / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        found = [st["env"][LIST] for j in d["jobs"].values() for st in j.get("steps", [])
                 if isinstance(st, dict) and LIST in (st.get("env") or {})]
        assert len(found) == 1, wf
        values[wf] = found[0]
    assert set(values.values()) == {SCALAR_HEIGHT_MODELS_DEFAULT}, values
