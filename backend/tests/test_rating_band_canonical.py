"""WC01: the dark band must grade the same resolved sea as rate_one_spot."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct, ManifestProduct, PipelineManifest,
)
from services.weather_pipeline.dynamic_index import DynamicProductIndex
from services.weather_pipeline.grid_resolver_surf import apply_surf_overlay
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.spot_ratings import rate_one_spot
from services.weather_pipeline.surf_point import resolve_surf_geometry
from services.weather_pipeline.surf_rating import KT_TO_MS


SPOTS = [("Snapper Rocks", -28.1677, 153.5504), ("Cocoa Beach", 28.3664, -80.6015),
         ("Trestles", 33.3825, -117.5886)]
NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def offline_flags(monkeypatch):
    # Local flags only: keep all optional I/O seams offline for the differential.
    for flag in ("RATING_LOCAL_SIZE", "RATING_OBS_GATE", "RATING_TIDE", "SURF_PARTITIONS",
                 "SURF_NEARSHORE_MOP", "SURF_TIDE_DEPTH", "RATING_BREAKER_TYPE"):
        monkeypatch.setenv(flag, "0")
    monkeypatch.setenv("SURF_TRANSFORM", "1")
    monkeypatch.setenv("SURF_RATING", "1")


def setup(tmp_path, spot, state=(4., 16., 0., 6.)):
    name, lat, lng = spot
    height, period, relative, wind_kn = state
    normal = resolve_surf_geometry(lat, lng).shore_normal_deg
    direction = ((normal or 0) + relative) % 360
    wind_from = ((normal or 0) + 180) % 360
    bounds = CoverageBounds(west=lng, south=lat, east=lng + .25, north=lat + .25)
    products = {}
    items = []
    for domain, layer, speed in (("marine", "waves", height), ("wind", "wind", wind_kn)):
        filename = f"gfs_{domain}_{layer}_fixture.json"
        product = NormalizedProduct(
            model="GFS", provider="fixture", domain=domain, layer=layer, run_time=NOW, valid_time=NOW,
            is_forecast_authoritative=True, is_estimated=False, coverage=bounds,
            value_kind="wave_height" if domain == "marine" else "wind_speed",
            value_unit="m" if domain == "marine" else "kn", display_unit_hint="ft",
            source_variables=[], freshness_sec=0, product_id=filename,
            grid=NormalizedGrid(bounds=bounds, cols=2, rows=2, diagnostics={}, vectors=[
                GridVector(lat=la, lng=ln, speed=speed, period=period,
                           direction=direction if domain == "marine" else wind_from, u=1., v=-2.)
                for la in (lat, lat + .25) for ln in (lng, lng + .25)]))
        products[filename] = product
        items.append(ManifestProduct(
            model="GFS", provider="fixture", domain=domain, layer=layer, run_time=NOW,
            valid_time_start=NOW, valid_time_end=NOW, resolution=.25, freshness_sec=0,
            is_forecast_authoritative=True, coverage=bounds, filename=filename))
    manifest = PipelineManifest(last_manifest_update=NOW, products=items)
    store = SimpleNamespace(get_manifest=lambda: manifest,
                            load_product=lambda filename, **kw:
                            products[filename].model_copy(deep=True) if filename in products else None)

    class NoProvider:
        async def fetch_point(self, **kwargs):
            raise AssertionError("stored rating comparison must not reach upstream")

    resolver = PointResolutionService(store=store, dynamic_index=DynamicProductIndex(tmp_path),
                                      provider=NoProvider())
    return products["gfs_marine_waves_fixture.json"], store, manifest, resolver, wind_kn, wind_from


async def compare(tmp_path, monkeypatch, spot, state, enabled):
    from services.weather_pipeline import grid_resolver_surf as overlay
    product, store, manifest, resolver, wind_kn, wind_from = setup(tmp_path, spot, state)

    async def wind_sampler(*args):
        return lambda lat, lng: (wind_kn * KT_TO_MS, wind_from)

    monkeypatch.setattr(overlay, "_build_wind_sampler", wind_sampler)
    monkeypatch.setenv("SURF_RATING_CANONICAL_BAND", str(int(enabled)))
    reference = await rate_one_spot(resolver, {"id": "fixture", "name": spot[0],
                                    "latitude": spot[1], "longitude": spot[2]},
                                    "GFS", NOW.isoformat(), reference_size_m=None)
    band = await apply_surf_overlay(product, store=store, manifest=manifest, model="GFS",
                                    domain="marine", layer="waves", surf=True, target_dt=NOW)
    return band, reference, product


@pytest.mark.parametrize("spot", SPOTS)
async def test_dark_overlay_matches_real_point_resolver_and_reference(tmp_path, monkeypatch, spot):
    band, reference, original = await compare(tmp_path, monkeypatch, spot, (4., 16., 0., 6.), True)
    assert band.grid.vectors[0].speed * 10 == pytest.approx(reference["score"], abs=.0006)
    assert original.grid.vectors[0].speed == 4.
    assert original.grid.vectors[0].phys_speed is None
    assert band.grid.vectors[0].phys_speed == 4.
    assert (band.grid.vectors[0].u, band.grid.vectors[0].v) == (1., -2.)


async def test_default_off_retains_the_existing_divergence_as_null_control(tmp_path, monkeypatch):
    band, reference, _ = await compare(tmp_path, monkeypatch, SPOTS[1], (4., 16., 0., 6.), False)
    assert abs(band.grid.vectors[0].speed * 10 - reference["score"]) > 10


@pytest.mark.parametrize("mutant", [None, "score", "geometry"])
async def test_heterogeneous_real_reference_jacobians_and_mutants(tmp_path, monkeypatch, mutant):
    from services.weather_pipeline import rating_band_canonical as canonical
    if mutant == "score":
        original = canonical.rate_one_spot

        async def wrong(*args, **kwargs):
            result = await original(*args, **kwargs)
            result["score"] *= 1.01
            return result

        monkeypatch.setattr(canonical, "rate_one_spot", wrong)
    elif mutant == "geometry":
        original = canonical.estimate_surf_at

        def wrong_height(*args, **kwargs):
            height, regime = original(*args, **kwargs)
            return height * 1.1, regime

        monkeypatch.setattr(canonical, "estimate_surf_at", wrong_height)

    async def sample(spot, state):
        band, reference, _ = await compare(tmp_path, monkeypatch, spot, state, True)
        return band.grid.vectors[0].speed * 10, reference["score"]

    async def check():
        for spot, state in zip(SPOTS, ((1.5, 12., 45., 6.), (.55, 9., 80., 12.), (2.5, 16., 0., 4.))):
            base_band, base_reference = await sample(spot, state)
            for column, step in enumerate((.08, .5, 2., .5)):
                changed = list(state)
                changed[column] += step
                band, reference = await sample(spot, changed)
                assert abs((band-base_band)/step - (reference-base_reference)/step) < .015
            assert base_band == pytest.approx(base_reference, abs=.0006)

    if mutant:
        with pytest.raises(AssertionError):
            await check()
    else:
        await check()


async def test_reference_delegation_and_no_per_cell_tide_fetch(tmp_path, monkeypatch):
    from services.weather_pipeline import rating_band_canonical as canonical, tide
    product, _, _, _, wind_kn, wind_from = setup(tmp_path, SPOTS[1])
    monkeypatch.setenv("RATING_TIDE", "1")
    calls = []
    original = canonical.rate_one_spot

    async def observed(*args, **kwargs):
        calls.append(kwargs)
        return await original(*args, **kwargs)

    async def forbidden(*args, **kwargs):
        raise AssertionError("anonymous band cells must not fetch tides")

    monkeypatch.setattr(canonical, "rate_one_spot", observed)
    monkeypatch.setattr(tide, "tide_norm_at", forbidden)
    import asyncio
    counts = await asyncio.to_thread(canonical.transform_rating_band, product,
                                    lambda lat, lng: (wind_kn * KT_TO_MS, wind_from))
    assert counts[0] > 0 and len(calls) == counts[0]
    assert all(call["tide_state_override"] is None for call in calls)


async def test_old_reference_call_still_fetches_and_grades_tide(tmp_path, monkeypatch):
    from services.weather_pipeline import tide
    _, _, _, resolver, _, _ = setup(tmp_path, SPOTS[1])
    monkeypatch.setenv("RATING_TIDE", "1")
    calls = []

    async def existing(*args, **kwargs):
        calls.append(args)
        return {"norm": .25, "trend": "rising"}

    monkeypatch.setattr(tide, "tide_norm_at", existing)
    result = await rate_one_spot(resolver, {"id": "fixture", "latitude": SPOTS[1][1],
                               "longitude": SPOTS[1][2], "best_tide": "low"},
                               "GFS", NOW.isoformat())
    assert len(calls) == 1 and result["tide"]["norm"] == .25


@pytest.mark.parametrize("flag", ["SURF_PARTITIONS", "SURF_TIDE_DEPTH", "SURF_NEARSHORE_MOP"])
async def test_unsupported_optional_inputs_refuse_without_mutation(tmp_path, monkeypatch, flag):
    from services.weather_pipeline import rating_band_canonical as canonical
    product, _, _, _, _, _ = setup(tmp_path, SPOTS[1])
    before = product.model_dump()
    monkeypatch.setenv(flag, "1")
    import asyncio
    with pytest.raises(ValueError, match="canonical_band_inputs_missing"):
        await asyncio.to_thread(canonical.transform_rating_band, product)
    assert product.model_dump() == before


async def test_invalid_and_open_ocean_cells_are_masked_and_measured_zero_is_kept(tmp_path):
    import asyncio
    from services.weather_pipeline import rating_band_canonical as canonical
    product, _, _, _, _, _ = setup(tmp_path, SPOTS[1])
    product.grid.vectors = [
        GridVector(lat=0., lng=-140., speed=2., period=12.),
        GridVector(lat=SPOTS[1][1], lng=SPOTS[1][2], speed=2., is_valid=False),
        GridVector(lat=SPOTS[1][1], lng=SPOTS[1][2], speed=0., period=12.),
    ]
    rated, masked = await asyncio.to_thread(canonical.transform_rating_band, product)
    assert (rated, masked) == (0, 2)
    assert not product.grid.vectors[0].is_valid and product.grid.vectors[0].phys_speed == 2.
    assert not product.grid.vectors[1].is_valid
    assert product.grid.vectors[2].is_valid and product.grid.vectors[2].speed == 0.


async def test_callback_failures_stay_fail_open_and_observation_cap_is_retained(tmp_path):
    import asyncio
    from services.weather_pipeline import rating_band_canonical as canonical
    product, _, _, _, _, _ = setup(tmp_path, SPOTS[1])

    def fail(*args):
        raise ValueError("offline callback failure")

    rated, _ = await asyncio.to_thread(canonical.transform_rating_band, product, fail, fail,
                                     lambda lat, lng, score: min(score, 30.))
    assert rated > 0
    assert all(vector.speed <= 3. for vector in product.grid.vectors if vector.phys_speed)


async def test_default_off_is_byte_identical_when_flag_is_absent(tmp_path, monkeypatch):
    disabled, _, _ = await compare(tmp_path, monkeypatch, SPOTS[1], (1.5, 12., 45., 6.), False)
    from services.weather_pipeline import grid_resolver_surf as overlay
    product, store, manifest, _, _, _ = setup(tmp_path, SPOTS[1], (1.5, 12., 45., 6.))
    monkeypatch.delenv("SURF_RATING_CANONICAL_BAND")
    absent = await overlay.apply_surf_overlay(product, store=store, manifest=manifest, model="GFS",
                                            domain="marine", layer="waves", surf=True, target_dt=NOW)
    assert absent.model_dump() == disabled.model_dump()


async def test_worker_failure_rolls_back_all_cells_before_overlay_fail_open(tmp_path, monkeypatch):
    from services.weather_pipeline import rating_band_canonical as canonical, grid_resolver_surf as overlay
    product, store, manifest, _, _, _ = setup(tmp_path, SPOTS[1])
    before = [v.model_dump() for v in product.grid.vectors]
    original = canonical.resolve_surf_geometry
    calls = []

    def fail_second(*args):
        calls.append(args)
        if len(calls) == 2:
            raise ValueError("offline second-cell geometry failure")
        return original(*args)

    async def wind_sampler(*args):
        return lambda lat, lng: (6. * KT_TO_MS, 90.)

    monkeypatch.setattr(canonical, "resolve_surf_geometry", fail_second)
    monkeypatch.setattr(overlay, "_build_wind_sampler", wind_sampler)
    monkeypatch.setenv("SURF_RATING_CANONICAL_BAND", "1")
    band = await apply_surf_overlay(product, store=store, manifest=manifest, model="GFS",
                                    domain="marine", layer="waves", surf=True, target_dt=NOW)
    assert len(calls) == 2
    assert [v.model_dump() for v in band.grid.vectors] == before
    assert [v.model_dump() for v in product.grid.vectors] == before
    assert band.value_kind == "wave_height"
    assert "second-cell geometry failure" in band.grid.diagnostics["surf_skip_reason"]


@pytest.mark.parametrize("scope", ["global", "swell_1", "height"])
async def test_flag_respects_global_skip_other_layers_and_height_mode(tmp_path, monkeypatch, scope):
    from services.weather_pipeline import rating_band_canonical as canonical, grid_resolver_surf as overlay
    product, store, manifest, _, _, _ = setup(tmp_path, SPOTS[1])
    layer = "waves"
    if scope == "global":
        product.grid.bounds = CoverageBounds(west=-180., south=-90., east=180., north=90.)
    elif scope == "swell_1":
        product.layer = layer = scope
    else:
        monkeypatch.setenv("SURF_RATING", "0")

    def forbidden(*args, **kwargs):
        raise AssertionError("canonical worker called outside its waves-rating scope")

    async def no_wind(*args):
        return None

    monkeypatch.setattr(canonical, "transform_rating_band", forbidden)
    monkeypatch.setattr(overlay, "_build_wind_sampler", no_wind)
    monkeypatch.setenv("SURF_RATING_CANONICAL_BAND", "0")
    disabled = await apply_surf_overlay(product, store=store, manifest=manifest, model="GFS",
                                        domain="marine", layer=layer, surf=True, target_dt=NOW)
    monkeypatch.setenv("SURF_RATING_CANONICAL_BAND", "1")
    enabled = await apply_surf_overlay(product, store=store, manifest=manifest, model="GFS",
                                       domain="marine", layer=layer, surf=True, target_dt=NOW)
    assert enabled.model_dump() == disabled.model_dump()
    assert "surf_skip_reason" not in enabled.grid.diagnostics


@pytest.mark.parametrize("flag", ["SURF_PARTITIONS", "SURF_TIDE_DEPTH", "SURF_NEARSHORE_MOP"])
async def test_public_overlay_refuses_missing_inputs_as_raw_height(tmp_path, monkeypatch, flag):
    from services.weather_pipeline import grid_resolver_surf as overlay
    product, store, manifest, _, _, _ = setup(tmp_path, SPOTS[1])
    before = product.model_dump()

    async def no_wind(*args):
        return None

    monkeypatch.setattr(overlay, "_build_wind_sampler", no_wind)
    monkeypatch.setenv("SURF_RATING_CANONICAL_BAND", "1")
    monkeypatch.setenv(flag, "1")
    band = await apply_surf_overlay(product, store=store, manifest=manifest, model="GFS",
                                    domain="marine", layer="waves", surf=True, target_dt=NOW)
    assert band.value_kind == "wave_height"
    assert band.grid.vectors == product.grid.vectors
    assert product.model_dump() == before
    assert "canonical_band_inputs_missing" in band.grid.diagnostics["surf_skip_reason"]


async def test_preloaded_tide_override_retains_reference_grade_without_fetch(tmp_path, monkeypatch):
    from services.weather_pipeline import tide
    _, _, _, resolver, _, _ = setup(tmp_path, SPOTS[1])
    monkeypatch.setenv("RATING_TIDE", "1")
    calls = []
    state = {"norm": .25, "trend": "rising"}

    async def acquire(*args, **kwargs):
        calls.append(args)
        return state

    monkeypatch.setattr(tide, "tide_norm_at", acquire)
    spot = {"id": "fixture", "latitude": SPOTS[1][1], "longitude": SPOTS[1][2], "best_tide": "low"}
    auto = await rate_one_spot(resolver, spot, "GFS", NOW.isoformat())
    loaded = await rate_one_spot(resolver, spot, "GFS", NOW.isoformat(), tide_state_override=state)
    assert len(calls) == 1
    assert loaded == auto
