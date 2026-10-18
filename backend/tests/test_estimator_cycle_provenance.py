"""Stored blend cycles describe actual contributors, never synthetic model authority."""
from datetime import timedelta, timezone

import pytest

from services.weather_pipeline.estimator import estimate_euro_grid
from services.weather_pipeline.schemas import NormalizedProduct
from tests.test_estimator_zero_blend_guard import T0, T1, grid_2x2, make_product


ROLES = ("native_anchor", "gfs_anchor", "gfs_target")


def donors(icon=False):
    result = {
        "native_anchor": make_product("EURO", "copernicus", T0, grid_2x2(2.0)),
        "gfs_anchor": make_product("GFS", "open-meteo", T0, grid_2x2(1.8)),
        "gfs_target": make_product("GFS", "open-meteo", T1, grid_2x2(2.2)),
    }
    if icon:
        result.update({
            "icon_anchor": make_product("ICON", "open-meteo", T0, grid_2x2(1.7)),
            "icon_target": make_product("ICON", "open-meteo", T1, grid_2x2(2.1)),
        })
    for role, product in result.items():
        product.product_id = role + ".json"
        product.model_run_time = T0 - timedelta(hours=12)
        product.model_run_time_status = "known"
    return result


def estimate(products, hour=78):
    return estimate_euro_grid(
        hour, 72, "waves", products["native_anchor"], products["gfs_target"],
        products["gfs_anchor"], products.get("icon_target"), products.get("icon_anchor"),
    )


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("mode,expected", [
    ("missing", "incomplete"), ("conflicting", "conflicting"),
    ("invalid", "invalid"), ("unverified", "incomplete"),
    ("date_missing", "incomplete"),
])
def test_each_required_donor_governs_cycle_claim(role, mode, expected):
    products = donors()
    product = products[role]
    if mode == "missing":
        product.model_run_time = None
        product.model_run_time_status = "missing"
    elif mode == "conflicting":
        product.model_run_time += timedelta(hours=6)
    elif mode == "invalid":
        product.model_run_time = product.model_run_time.replace(tzinfo=None)
    elif mode == "unverified":
        product.model_run_time_status = "missing"
    else:
        product.model_run_time = None
    result = estimate(products)
    assert result.model_run_time is None
    assert result.model_run_time_status == expected
    assert result.is_estimated and not result.is_forecast_authoritative
    assert result.run_time == products["native_anchor"].run_time


def test_equivalent_utc_cycles_roundtrip_with_separate_source_identity():
    products = donors()
    products["gfs_target"].model_run_time = products["gfs_target"].model_run_time.astimezone(
        timezone(timedelta(hours=5, minutes=30)))
    result = NormalizedProduct.model_validate_json(estimate(products).model_dump_json())
    assert result.model_run_time == T0 - timedelta(hours=12)
    assert result.model_run_time_status == "known"
    assert result.estimate_basis["cycle_semantics"] == "shared_contributor_cycle"
    sources = result.estimate_basis["cycle_sources"]
    assert [source["role"] for source in sources] == list(ROLES)
    assert [source["model"] for source in sources] == ["EURO", "GFS", "GFS"]
    assert [source["product_id"] for source in sources] == [role + ".json" for role in ROLES]
    assert all(source["model_run_time_status"] == "known" for source in sources)
    assert all(source["model_run_time"] == (T0 - timedelta(hours=12)).isoformat() for source in sources)


def test_unknown_sources_do_not_borrow_receipt_or_valid_time():
    products = donors()
    for product in products.values():
        product.model_run_time = None
        product.model_run_time_status = "missing"
    result = estimate(products)
    assert result.model_run_time is None and result.model_run_time_status == "missing"
    assert all(source["model_run_time"] is None for source in result.estimate_basis["cycle_sources"])


@pytest.mark.parametrize("mode,expected", [
    ("known", "known"), ("missing", "incomplete"), ("conflicting", "conflicting"),
])
def test_used_icon_donors_are_part_of_cycle_evidence(mode, expected):
    products = donors(icon=True)
    if mode == "missing":
        products["icon_target"].model_run_time = None
    elif mode == "conflicting":
        products["icon_target"].model_run_time += timedelta(hours=6)
    result = estimate(products)
    assert result.model_run_time_status == expected
    assert [source["role"] for source in result.estimate_basis["cycle_sources"]] == [
        *ROLES, "icon_anchor", "icon_target"]


@pytest.mark.parametrize("unused", ["zero_weight", "no_support", "unresolved_direction"])
def test_unused_icon_cannot_taint_verified_contributors(unused):
    products = donors(icon=True)
    products["icon_target"].model_run_time = None
    hour = 192 if unused == "zero_weight" else 78
    if unused == "no_support":
        for cell in products["icon_target"].grid.vectors:
            cell.is_valid = False
    elif unused == "unresolved_direction":
        for cell in products["icon_target"].grid.vectors:
            cell.u = cell.v = 0
    result = estimate(products, hour)
    assert result.model_run_time_status == "known"
    assert [source["role"] for source in result.estimate_basis["cycle_sources"]] == list(ROLES)


def test_icon_used_earlier_is_retained_when_last_cell_falls_back():
    products = donors(icon=True)
    products["icon_target"].grid.vectors[-1].is_valid = False
    products["icon_target"].model_run_time = None
    result = estimate(products)
    assert result.grid.diagnostics["weights"]["icon"] == 0
    assert result.model_run_time_status == "incomplete"
    assert "icon_target" in [source["role"] for source in result.estimate_basis["cycle_sources"]]


def test_zero_icon_trend_with_positive_period_weight_still_contributes():
    products = donors(icon=True)
    # Native2 + ICONtarget0 - ICONanchor3 clamps to zero: unlike a
    # positive trend with an unresolved target direction, this is usable.
    products["icon_anchor"].grid = grid_2x2(3.0)
    for cell in products["icon_target"].grid.vectors:
        cell.speed = cell.u = cell.v = 0
    result = estimate(products)
    assert result.model_run_time_status == "known"
    assert len(result.estimate_basis["cycle_sources"]) == 5


def test_cycle_collection_does_not_mutate_donors():
    products = donors(icon=True)
    before = {role: product.model_dump_json() for role, product in products.items()}
    result = estimate(products)
    assert result.model_run_time_status == "known"
    assert {role: product.model_dump_json() for role, product in products.items()} == before


def test_reused_icon_extension_keeps_actual_native_donor_model():
    products = donors()
    products["native_anchor"].model = "ICON"
    result = estimate(products)
    assert result.model_run_time_status == "known"
    assert result.estimate_basis["cycle_sources"][0]["model"] == "ICON"
    assert result.estimate_basis["cycle_sources"][0]["role"] == "native_anchor"


@pytest.mark.parametrize("icon", [False, True])
@pytest.mark.parametrize("mode", ["known", "missing", "conflicting", "invalid"])
def test_cycle_metadata_cannot_change_physical_payload(icon, mode):
    products = donors(icon)
    before = estimate(products).grid.model_dump()
    if mode == "missing":
        products["gfs_target"].model_run_time = None
    elif mode == "conflicting":
        products["gfs_target"].model_run_time += timedelta(hours=6)
    elif mode == "invalid":
        products["gfs_target"].model_run_time = products["gfs_target"].model_run_time.replace(tzinfo=None)
    assert estimate(products).grid.model_dump() == before


@pytest.mark.parametrize('role', ['gfs_anchor', 'gfs_target', 'icon_anchor', 'icon_target'])
@pytest.mark.parametrize('damage', ['conflicting', 'missing', 'naive', 'dataset'])
def test_dark_coherent_trend_guard_refuses_unverifiable_active_pair(monkeypatch, role, damage):
    monkeypatch.setenv('ESTIMATE_COHERENT_TRENDS', '1')
    products = donors(icon=role.startswith('icon'))
    for p in products.values(): p.source_dataset = p.model + '_waves'
    p = products[role]
    if damage == 'conflicting': p.model_run_time += timedelta(hours=6)
    elif damage == 'missing': p.model_run_time = None
    elif damage == 'naive': p.model_run_time = p.model_run_time.replace(tzinfo=None)
    else: p.source_dataset = 'wrong_dataset'
    assert estimate(products) is None


@pytest.mark.parametrize('native_model', ['ICON', 'EURO'])
def test_coherent_trend_guard_allows_independent_native_model_cycle(monkeypatch, native_model):
    products = donors()
    products['native_anchor'].model = native_model
    products['native_anchor'].model_run_time -= timedelta(hours=6)
    for p in products.values(): p.source_dataset = p.model + '_waves'
    monkeypatch.delenv('ESTIMATE_COHERENT_TRENDS', raising=False)
    before = estimate(products).model_dump_json()
    monkeypatch.setenv('ESTIMATE_COHERENT_TRENDS', '1')
    result = estimate(products)
    assert result is not None and result.model_dump_json() == before


@pytest.mark.parametrize('hour', [78, 192])
def test_guard_default_off_preserves_legacy_payload_and_unused_icon(monkeypatch, hour):
    products = donors(icon=True)
    for p in products.values(): p.source_dataset = p.model + '_waves'
    products['icon_target'].model_run_time += timedelta(hours=6)
    monkeypatch.delenv('ESTIMATE_COHERENT_TRENDS', raising=False)
    before = estimate(products, hour)
    monkeypatch.setenv('ESTIMATE_COHERENT_TRENDS', '0')
    assert estimate(products, hour).model_dump_json() == before.model_dump_json()
    monkeypatch.setenv('ESTIMATE_COHERENT_TRENDS', '1')
    result = estimate(products, hour)
    assert (result is None) == (hour == 78)
    if result is not None: assert result.model_dump_json() == before.model_dump_json()
