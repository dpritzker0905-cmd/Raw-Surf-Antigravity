from datetime import timedelta
from itertools import permutations
from types import SimpleNamespace as S

import pytest
from tests.test_point_tiebreak_resolution import _prod, NOW
from services.weather_pipeline.point_resolution import PointResolutionService, _selection_key
from services.weather_pipeline.product_selection import _select_best_from_list
from services.weather_pipeline.product_selection import select_best_candidate
from services.weather_pipeline.selection_identity import selection_identity


def products():
    old, new = _prod(.25, -81, 27, -79, 29), _prod(.25, -81, 27, -79, 29)
    for p, name, hour in [(old, 'a-old.json', 0), (new, 'z-new.json', 6)]:
        p.filename = name
        p.model_run_time = NOW.replace(hour=hour)
        p.model_run_time_status = 'known'
    return old, new


@pytest.mark.asyncio
async def test_scheduled_resolver_ignores_order_and_receipt_time():
    old, new = products()
    for ordered in permutations([old, new]):
        for shift in [0, 6]:
            old.run_time = NOW + timedelta(hours=shift)
            store = S(get_manifest=lambda: S(products=list(ordered)),
                      load_product=lambda name: {p.filename: p for p in ordered}[name])
            resolver = PointResolutionService(store=store, dynamic_index=S(find_product_containing=lambda **kw: None), provider=S())
            assert await resolver.find_cached_grid_product('GFS', 'marine', 'waves', 28, -80, NOW) is new
            pairs = [(p, 0) for p in ordered]
            assert _select_best_from_list(pairs, -80.5, 27.5, -79.5, 28.5) is new
            assert _select_best_from_list(pairs) is new


def test_unknown_cycles_use_stable_identity_never_receipt():
    old, new = products()
    for p in [old, new]:
        p.model_run_time_status = 'missing'
    for ordered in permutations([old, new]):
        assert min([(p, 0) for p in ordered], key=_selection_key)[0] is old
        assert _select_best_from_list([(p, 0) for p in ordered]) is old


def test_time_and_resolution_precede_cycle():
    old, new = products()
    assert min([(old, 0), (new, 600)], key=_selection_key)[0] is old
    new.resolution = 1
    assert min([(old, 0), (new, 0)], key=_selection_key)[0] is old


def test_authority_and_existing_valid_time_exception_precede_cycle():
    old, new = products()
    assert select_best_candidate([(old, 0)], [(new, 0)]) is old
    assert select_best_candidate([(old, 3600)], [(new, 0)]) is new


@pytest.mark.parametrize('cycle', [None, 'bad', '2026-08-09T06:00:00', NOW.replace(tzinfo=None)])
def test_malformed_or_naive_known_stamp_is_ranked_unknown(cycle):
    p = S(model_run_time=cycle, model_run_time_status='known', filename='a')
    assert selection_identity(p) == (1, 0, 'a')
