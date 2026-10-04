"""Bounded offline sensitivity instrument; not a forecast-skill or physics calibration.

Run through run_backend.py with this file's explicit path. Real point resolver and
sampler, injected two-product store, fresh objects per perturbation, no network.
"""
import json
from pathlib import Path
from types import SimpleNamespace as S

import pytest
from services.weather_pipeline.point_resolution import PointResolutionService
from tests.test_dynamic_cycle_selection import fixture


async def sample(requested, requested_height=2.0, hint_height=1.0):
    old, new, _ = fixture()
    old.model = "GFS" if requested == "ICON" else "ICON"
    new.model = requested
    for product, height in ((old, hint_height), (new, requested_height)):
        for vector in product.grid.vectors:
            vector.speed, vector.u = height, -height
    store = S(get_manifest=lambda: S(products=[]),
              load_product=lambda name: {old.product_id: old, new.product_id: new}.get(name))
    resolver = PointResolutionService(store=store, provider=S(),
        dynamic_index=S(find_product_containing=lambda **kw: {"product_id": new.product_id}))
    answer = await resolver._resolve_point_internal(requested, "marine", "waves", 28, -80,
                                                    new.valid_time.isoformat(), old.product_id, None)
    return answer.point.speed


@pytest.mark.asyncio
@pytest.mark.parametrize("requested", ["GFS", "ICON", "EURO"])
@pytest.mark.parametrize("enabled", ["0", "1"])
async def test_product_selection_jacobian(monkeypatch, requested, enabled):
    monkeypatch.setenv("POINT_PRODUCT_IDENTITY", enabled)
    epsilon = 0.05
    requested_derivative = ((await sample(requested, 2 + epsilon)) -
                            (await sample(requested, 2 - epsilon))) / (2 * epsilon)
    hint_derivative = ((await sample(requested, hint_height=1 + epsilon)) -
                       (await sample(requested, hint_height=1 - epsilon))) / (2 * epsilon)
    derivatives = [requested_derivative, hint_derivative]
    assert derivatives == pytest.approx([1, 0] if enabled == "1" else [0, 1], abs=1e-10)
    out = Path(__file__).resolve().parent / "visual/point-jacobian-readings.json"
    readings = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    readings[f"{requested}/flag{enabled}"] = {"epsilon_m": epsilon,
        "columns": ["requested_product_height", "cross_model_hint_height"],
        "height_derivatives": derivatives}
    out.write_text(json.dumps(readings, indent=2) + "\n", encoding="utf-8")
