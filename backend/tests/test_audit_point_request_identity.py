"""W-01: an advisory grid hint cannot select another model/domain's numbers.

Actual resolver and sampler, distinct 1m/2m products, offline injected store/index.
The dark-switch controls deliberately retain the legacy behavior.
"""
from types import SimpleNamespace as S

import pytest

from services.weather_pipeline.point_resolution import PointResolutionService
from tests.test_dynamic_cycle_selection import fixture


async def resolve(monkeypatch, requested, hinted, *, domain="marine", layer="waves", enabled="1", hint="drawn"):
    if enabled is None:
        monkeypatch.delenv("POINT_PRODUCT_IDENTITY", raising=False)
    else:
        monkeypatch.setenv("POINT_PRODUCT_IDENTITY", enabled)
    old, new, _ = fixture()
    old.model, new.model = hinted, requested
    old.domain, old.layer = domain, layer
    # No scheduled products: automatic selection is the injected matching index.
    calls = []

    def select(**kw):
        calls.append(kw)
        return {"product_id": new.product_id}

    store = S(get_manifest=lambda: S(products=[]),
              load_product=lambda name: {old.product_id: old, new.product_id: new}.get(name))
    service = PointResolutionService(store=store, dynamic_index=S(find_product_containing=select), provider=S())
    result = await service._resolve_point_internal(requested, "marine", "waves", 28, -80,
                                                  new.valid_time.isoformat(), old.product_id if hint == "drawn" else hint, None)
    return result, calls, old, new


@pytest.mark.asyncio
@pytest.mark.parametrize("requested,hinted", [(a, b) for a in ("GFS", "ICON", "EURO", "CONSENSUS")
                                            for b in ("GFS", "ICON", "EURO") if a != b])
async def test_cross_model_hint_is_discarded(monkeypatch, requested, hinted):
    result, calls, _, new = await resolve(monkeypatch, requested, hinted)
    assert result.model == requested
    assert result.point.speed == 2
    assert result.product_id == new.product_id
    assert len(calls) == 1 and calls[0]["model"] == requested


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["GFS", "ICON", "EURO"])
async def test_valid_hint_keeps_drawn_product(monkeypatch, model):
    result, calls, old, _ = await resolve(monkeypatch, model, model)
    assert result.point.speed == 1
    assert result.product_id == old.product_id
    assert result.grid_parity is True
    assert calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("domain", ["wind", "weather"])
async def test_cross_domain_hint_is_discarded(monkeypatch, domain):
    result, calls, _, new = await resolve(monkeypatch, "GFS", "GFS", domain=domain)
    assert result.domain == "marine" and result.point.speed == 2
    assert result.product_id == new.product_id and len(calls) == 1


@pytest.mark.asyncio
async def test_existing_layer_guard_still_resolves(monkeypatch):
    result, calls, _, new = await resolve(monkeypatch, "GFS", "GFS", layer="wind_waves")
    assert result.point.speed == 2 and result.product_id == new.product_id and len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [None, "0", "", "true"])
async def test_dark_switch_keeps_legacy_selection(monkeypatch, enabled):
    result, calls, old, _ = await resolve(monkeypatch, "GFS", "ICON", enabled=enabled)
    assert result.point.speed == 1 and result.model == "ICON"
    assert result.product_id == old.product_id and calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("hint", [None, "missing.json"])
async def test_absent_or_unloadable_hint_still_resolves(monkeypatch, hint):
    result, calls, _, new = await resolve(monkeypatch, "GFS", "ICON", hint=hint)
    assert result.point.speed == 2 and result.product_id == new.product_id and len(calls) == 1
