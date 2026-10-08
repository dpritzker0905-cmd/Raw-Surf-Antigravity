"""LIVE01: real hub producer must reuse an unchanged index only within its request."""
import json
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline.dynamic_index import DynamicProductIndex
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.dynamic_index_reads import dynamic_index_read_scope


def count_parses(monkeypatch, index):
    calls = []
    original = json.load

    def counted(stream, *args, **kwargs):
        if str(stream.name) == str(index.index_path):
            calls.append(stream.name)
        return original(stream, *args, **kwargs)

    monkeypatch.setattr(json, "load", counted)
    return calls


async def test_real_hub_request_parses_unchanged_index_once(tmp_path, monkeypatch):
    index = DynamicProductIndex(tmp_path)
    index._save_index([])
    calls = count_parses(monkeypatch, index)

    class NoProvider:
        async def fetch_point(self, **kwargs):
            return None

    store = SimpleNamespace(get_manifest=lambda: SimpleNamespace(products=[]))
    resolver = PointResolutionService(store=store, dynamic_index=index, provider=NoProvider())
    await resolver.resolve_spot_conditions("GFS", 28.36, -80.60, forecast_days=2)
    assert len(calls) == 1, f"one hub request parsed its unchanged index {len(calls)} times"
    await resolver.resolve_spot_conditions("GFS", 28.36, -80.60, forecast_days=2)
    assert len(calls) == 2, "the next request must read its own fresh index"


def row(name="first", **changes):
    now = datetime.now(timezone.utc)
    result = dict(product_id=name, model="GFS", domain="marine", layer="waves",
                valid_time=now.isoformat(), expires_at=(now + timedelta(hours=2)).isoformat(),
                served_bbox="-82,26,-78,30", requested_bbox="-82,26,-78,30",
                  cache_key=name, nested={"warnings": []})
    result.update(changes)
    return result


def lookup(index, target=None, **kwargs):
    return index.find_product_containing("GFS", "marine", "waves",
                                         target or datetime.now(timezone.utc), 28, -80, **kwargs)


def test_results_and_raw_reads_are_mutation_isolated(tmp_path):
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    with dynamic_index_read_scope():
        lookup(index)["nested"]["warnings"].append("caller")
        index._load_index()[0]["nested"]["warnings"].append("raw caller")
        assert lookup(index)["nested"]["warnings"] == []
        assert index.find_product("GFS", "marine", "waves", datetime.now(timezone.utc),
                                  "first")["nested"]["warnings"] == []


def test_external_atomic_writer_is_seen_within_scope(tmp_path, monkeypatch):
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    calls = count_parses(monkeypatch, index)
    with dynamic_index_read_scope():
        assert lookup(index)["product_id"] == "first"
        replacement = tmp_path / "replacement.json"
        replacement.write_text(json.dumps([row("other")]))
        replacement.replace(index.index_path)
        assert lookup(index)["product_id"] == "other"
        assert len(calls) == 2


def test_successful_save_invalidates_snapshot(tmp_path, monkeypatch):
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    calls = count_parses(monkeypatch, index)
    with dynamic_index_read_scope():
        assert lookup(index)["product_id"] == "first"
        index._save_index([row("other")])
        assert lookup(index)["product_id"] == "other"
        assert len(calls) == 2


def test_failed_save_never_publishes_uncommitted_rows(tmp_path, monkeypatch):
    import services.weather_pipeline.dynamic_index as module
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    with dynamic_index_read_scope():
        assert lookup(index)["product_id"] == "first"

        def fail(*args):
            raise OSError("offline write failure")

        monkeypatch.setattr(module.os, "replace", fail)
        index.add_product("uncommitted", "GFS", "marine", "waves", datetime.now(timezone.utc),
                          "-82,26,-78,30", "-82,26,-78,30", "viewport", .25, "first", "fixture")
        assert [r["product_id"] for r in index._load_index()] == ["first"]
    assert [r["product_id"] for r in index._load_index()] == ["first"]


def test_expiry_crossing_is_checked_each_lookup(tmp_path, monkeypatch):
    import services.weather_pipeline.dynamic_index as module
    now = datetime.now(timezone.utc)
    clock = [now]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0]

    index = DynamicProductIndex(tmp_path)
    index._save_index([row(expires_at=(now + timedelta(seconds=1)).isoformat())])
    monkeypatch.setattr(module, "datetime", Clock)
    with dynamic_index_read_scope():
        assert lookup(index, now) is not None
        clock[0] += timedelta(seconds=2)
        assert lookup(index, now) is None
        assert index._load_index() == []


@pytest.mark.parametrize("failure", [ValueError, asyncio.CancelledError])
def test_scope_cleans_up_after_exception_or_cancellation(tmp_path, monkeypatch, failure):
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    calls = count_parses(monkeypatch, index)
    with pytest.raises(failure):
        with dynamic_index_read_scope():
            lookup(index)
            raise failure()
    lookup(index)
    lookup(index)
    assert len(calls) == 5, "outside requests each lookup retains its prune/read parses"


async def test_concurrent_requests_do_not_share_cache(tmp_path, monkeypatch):
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    calls = count_parses(monkeypatch, index)
    arrived = asyncio.Event()
    leave = asyncio.Event()

    async def first():
        with dynamic_index_read_scope():
            lookup(index)
            arrived.set()
            await leave.wait()
            lookup(index)

    async def second():
        await arrived.wait()
        with dynamic_index_read_scope():
            lookup(index)
            lookup(index)
        leave.set()

    await asyncio.gather(first(), second())
    assert len(calls) == 2


async def test_inherited_child_context_stops_caching_after_parent_exit(tmp_path, monkeypatch):
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    calls = count_parses(monkeypatch, index)
    leave = asyncio.Event()

    async def child():
        await leave.wait()
        lookup(index)
        lookup(index)

    with dynamic_index_read_scope():
        lookup(index)
        task = asyncio.create_task(child())
    leave.set()
    await task
    assert len(calls) == 5


def test_nested_scopes_restore_the_outer_request(tmp_path, monkeypatch):
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    calls = count_parses(monkeypatch, index)
    with dynamic_index_read_scope():
        lookup(index)
        with dynamic_index_read_scope():
            lookup(index)
        lookup(index)
    assert len(calls) == 2


def test_missing_or_corrupt_file_can_recover_inside_request(tmp_path):
    index = DynamicProductIndex(tmp_path)
    with dynamic_index_read_scope():
        assert lookup(index) is None
        index.index_path.write_text("{broken")
        assert lookup(index) is None
        index._save_index([row()])
        assert lookup(index)["product_id"] == "first"


def test_distinct_index_paths_do_not_collide(tmp_path, monkeypatch):
    first = DynamicProductIndex(tmp_path / "a")
    second = DynamicProductIndex(tmp_path / "b")
    first._save_index([row("first")])
    second._save_index([row("second")])
    with dynamic_index_read_scope():
        assert lookup(first)["product_id"] == "first"
        assert lookup(second)["product_id"] == "second"


def test_ranking_and_dateline_selection_are_preserved(tmp_path):
    index = DynamicProductIndex(tmp_path)
    now = datetime.now(timezone.utc)
    index._save_index([
        row("wide", served_bbox="-90,20,-70,35"),
        row("near", valid_time=(now + timedelta(hours=1)).isoformat()),
        row("exact", valid_time=now.isoformat()),
        row("date", served_bbox="170,26,-170,30"),
    ])
    with dynamic_index_read_scope():
        assert lookup(index, now)["product_id"] == "exact"
        assert lookup(index, now, grid_bbox="-90,20,-70,35")["product_id"] == "wide"
        assert index.find_product_containing("GFS", "marine", "waves", now,
                                             28, 179)["product_id"] == "date"


def test_file_changed_during_json_read_is_not_cached(tmp_path, monkeypatch):
    index = DynamicProductIndex(tmp_path)
    index._save_index([row()])
    original = json.load
    changed = []

    def replace_during_read(stream, *args, **kwargs):
        result = original(stream, *args, **kwargs)
        if not changed:
            changed.append(True)
            # In-place writer is portable while a read descriptor is open;
            # Windows refuses atomic replacement of that open descriptor.
            index.index_path.write_text(json.dumps([row("other")]))
        return result

    monkeypatch.setattr(json, "load", replace_during_read)
    with dynamic_index_read_scope():
        assert index._load_index()[0]["product_id"] == "first"
        assert index._load_index()[0]["product_id"] == "other"


@pytest.mark.parametrize("mutant", [None, "speed", "period"])
async def test_real_hub_cached_and_uncached_physical_jacobians_match(tmp_path, monkeypatch, mutant):
    """Nine columns through real selection, sampling, geometry and hub composition.

    Store/provider are offline fixtures. Two numeric sampler mutants must be
    detected by the same comparison; this is value preservation, not skill.
    """
    from contextlib import nullcontext
    from services.weather_pipeline import point_resolution as point_module
    from services.weather_pipeline import spot_conditions as hub
    from services.weather_pipeline.schemas import (
        NormalizedProduct, NormalizedGrid, CoverageBounds, GridVector,
        PipelineManifest, ManifestProduct,
    )
    now = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    monkeypatch.setattr(hub, "datetime", Clock)
    index = DynamicProductIndex(tmp_path)
    index._save_index([])
    products = {}
    coverage = CoverageBounds(west=-81, south=27, east=-79, north=29)
    manifest = PipelineManifest(last_manifest_update=now, products=[])
    times = [now] + [now + timedelta(days=i) for i in range(1, 11)]
    for valid in times:
        for domain, layer in (("marine", "waves"), ("marine", "swell_1"), ("wind", "wind")):
            name = f"{domain}_{layer}_{valid:%Y%m%d}.json"
            product = NormalizedProduct(
                model="GFS", provider="fixture", domain=domain, layer=layer,
                run_time=now - timedelta(hours=6), valid_time=valid, coverage=coverage,
                is_forecast_authoritative=True, is_estimated=False,
                value_kind="wind_speed" if domain == "wind" else "wave_height",
                value_unit="kn" if domain == "wind" else "m", display_unit_hint="ft",
                source_variables=[], freshness_sec=0, product_id=name,
                grid=NormalizedGrid(bounds=coverage, cols=3, rows=3, diagnostics={}, vectors=[
                    GridVector(lat=lat, lng=lng, speed=1, period=12, direction=90, u=0, v=-1)
                    for lat in (27, 28, 29) for lng in (-81, -80, -79)]))
            products[name] = product
            manifest.products.append(ManifestProduct(
                model="GFS", provider="fixture", domain=domain, layer=layer,
                run_time=product.run_time, valid_time_start=valid, valid_time_end=valid,
                resolution=1, freshness_sec=0, is_forecast_authoritative=True,
                coverage=coverage, filename=name))

    class NoProvider:
        async def fetch_point(self, **kwargs):
            raise AssertionError("warm stored path must not reach upstream")

    store = SimpleNamespace(get_manifest=lambda: manifest,
                            load_product=lambda name: products[name].model_copy(deep=True))
    resolver = PointResolutionService(store=store, dynamic_index=index, provider=NoProvider())
    original_sample = resolver.sampler.sample_point
    cached = [False]

    def sample_product(*args, **kwargs):
        result = original_sample(*args, **kwargs)
        if mutant and cached[0]:
            result = result.model_copy(deep=True)
            value = getattr(result.point, mutant)
            if value is not None:
                setattr(result.point, mutant, value * 1.01)
        return result

    monkeypatch.setattr(resolver.sampler, "sample_point", sample_product)

    async def sample(state, scoped):
        cached[0] = scoped
        monkeypatch.setattr(point_module, "dynamic_index_read_scope",
                            dynamic_index_read_scope if scoped else nullcontext)
        for product in products.values():
            height = state[0] if product.layer == "waves" else state[0] * .7
            for vector in product.grid.vectors:
                vector.speed = 8 if product.domain == "wind" else height
                vector.period = state[1]
                vector.direction = state[2]
        result = await resolver.resolve_spot_conditions("GFS", 28.36, -80.60)
        current = result["current_conditions"]
        assert current["data_source"]["kind"] == "stored_product"
        return tuple(current[key] for key in
                     ("wave_height_ft", "wave_period", "wave_direction", "rating", "swell_height_ft"))

    async def compare():
        for state in ((.55, 9., 90.), (1.2, 12., 100.), (2.5, 16., 80.)):
            before, after = await sample(state, False), await sample(state, True)
            for column, step in enumerate((.08, .5, 2.)):
                changed = list(state)
                changed[column] += step
                b, a = await sample(changed, False), await sample(changed, True)
                for output in range(len(before)):
                    assert abs((b[output] - before[output])/step -
                               (a[output] - after[output])/step) < 1e-10
            assert before == after

    if mutant:
        with pytest.raises(AssertionError):
            await compare()
    else:
        await compare()
