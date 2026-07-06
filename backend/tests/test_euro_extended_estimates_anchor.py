"""Anchor-pool selection for the EURO extended-estimates job (regression, 2026-07-05).

THE OUTAGE: the global_coarse branch required is_estimated:true anchors — written when native
CMEMS global products were mislabeled estimated. After provenance was fixed (7b89eadf, natives →
is_estimated:false) the pool matched only leftover stale estimated tails; the first full
re-ingestion after the cron outage pruned those → pool empty → every layer silently skipped →
no 241-336h estimated products → EURO 404'd past ~240h ("lost its last 4 days") and ICON's
>168h blend died with it. The pool must anchor on NATIVE products for every region.
"""
from types import SimpleNamespace
from datetime import datetime, timezone

from services.weather_pipeline.scheduler_helpers import euro_estimate_anchor_pool


def _p(region_id, layer="waves", est=False, auth=True, model="EURO", domain="marine", vt=None):
    return SimpleNamespace(
        model=model, domain=domain, layer=layer, region_id=region_id,
        is_estimated=est, is_forecast_authoritative=auth,
        valid_time_start=vt or datetime(2026, 7, 15, 0, 0, tzinfo=timezone.utc),
    )


def test_global_coarse_anchors_on_native_products():
    # The exact post-provenance-fix production state: ONLY native (is_estimated=False) globals.
    products = [_p("global_coarse", est=False, auth=True) for _ in range(3)]
    pool = euro_estimate_anchor_pool(products, "global_coarse", "waves", is_test_or_local=False)
    assert len(pool) == 3, "native global products must be anchor candidates (the 2026-07-05 outage)"


def test_global_coarse_rejects_estimated_anchors_in_production():
    products = [
        _p("global_coarse", est=True),   # stale estimated tail — never an anchor in production
        _p("global_coarse", est=False),
    ]
    pool = euro_estimate_anchor_pool(products, "global_coarse", "waves", is_test_or_local=False)
    assert len(pool) == 1
    assert pool[0].is_estimated is False


def test_regional_requires_authoritative_in_production():
    products = [
        _p("us_west_coast_socal", auth=False),
        _p("us_west_coast_socal", auth=True),
    ]
    pool = euro_estimate_anchor_pool(products, "us_west_coast_socal", "waves", is_test_or_local=False)
    assert len(pool) == 1
    assert pool[0].is_forecast_authoritative is True


def test_test_or_local_relaxation_keeps_fixtures_usable():
    products = [
        _p("global_coarse", est=True),
        _p("us_west_coast_socal", auth=False),
    ]
    assert len(euro_estimate_anchor_pool(products, "global_coarse", "waves", is_test_or_local=True)) == 1
    assert len(euro_estimate_anchor_pool(products, "us_west_coast_socal", "waves", is_test_or_local=True)) == 1


def test_global_mid_anchors_on_native_products():
    products = [_p("global_mid", est=False, auth=True)]
    pool = euro_estimate_anchor_pool(products, "global_mid", "waves", is_test_or_local=False)
    assert len(pool) == 1


def test_pool_filters_model_layer_region():
    products = [
        _p("global_coarse", layer="swell_1"),
        _p("hawaii"),
        _p("global_coarse", model="GFS"),
        _p("global_coarse"),
    ]
    pool = euro_estimate_anchor_pool(products, "global_coarse", "waves", is_test_or_local=False)
    assert len(pool) == 1
    assert pool[0].region_id == "global_coarse" and pool[0].layer == "waves"
