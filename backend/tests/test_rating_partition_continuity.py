"""WJ01: grade a complete mixed sea without selecting its tallest train."""
import copy
import math

import pytest

from services.weather_pipeline import surf_rating as sr
from services.weather_pipeline.spot_ratings import rate_one_spot
from test_rating_band_canonical import NOW, SPOTS, setup


@pytest.fixture(autouse=True)
def flags(monkeypatch):
    for flag in ('RATING_LOCAL_SIZE', 'RATING_OBS_GATE', 'RATING_TIDE', 'RATING_BREAKER_TYPE',
                 'SURF_NEARSHORE_MOP', 'SURF_TIDE_DEPTH', 'SURF_BREAK_DEPTH_PLAUSIBILITY', 'SURF_EXPOSURE_FLUX'):
        monkeypatch.setenv(flag, '0')
    for flag in ('SURF_TRANSFORM', 'SURF_PARTITIONS', 'SURF_PARTITION_FLUX', 'RATING_PARTITION_CONTINUITY'):
        monkeypatch.setenv(flag, '1')


def parts(h2=1.51, kind='windsea'):
    return [{'h': 1.5, 'tp': 14., 'dir': 0., 'kind': 'swell'},
            {'h': h2, 'tp': 7., 'dir': 90., 'kind': kind}]


def factors(ps, total_period=7., total_direction=90., normal=0.):
    return sr.rating_factors(1.5, total_period, 3., wind_from_deg=180.,
                             shore_normal_deg=normal, swell_from_deg=total_direction, partitions=ps)


def same_factors(a, b):
    assert a['score'] == b['score']
    assert a['limiter'] == b['limiter']
    assert a['limiter_value'] == b['limiter_value']
    assert a['factors'] == pytest.approx(b['factors'], abs=1e-12)


@pytest.mark.parametrize('kind', ['windsea', 'swell'])
def test_crossing_tallest_train_does_not_switch_rating(kind):
    a, b = factors(parts(1.49, kind), 14., 0.), factors(parts(1.51, kind))
    assert abs(a['score'] - b['score']) <= 1., (a, b)


@pytest.mark.parametrize('k', [2, 3, 6])
@pytest.mark.parametrize('train', [0, 1])
def test_relabelling_energy_into_identical_trains_is_invariant(k, train):
    ps = parts(1.49, 'swell')
    base = factors(ps)
    split = copy.deepcopy(ps)
    p = split.pop(train)
    split += [dict(p, h=p['h'] / math.sqrt(k)) for _ in range(k)]
    same_factors(factors(split), base)
    same_factors(factors(list(reversed(split))), base)


def test_complete_components_do_not_depend_on_total_peak():
    assert factors(parts(), 14., 0.) == factors(parts(), 7., 90.)


def test_one_train_retains_scalar_factors():
    p = [{'h': 1.5, 'tp': 14., 'dir': 25., 'kind': 'swell'}]
    same_factors(factors(p, 14., 25.), factors(None, 14., 25.))


@pytest.mark.parametrize('bad', [None, [], [{'h': 0., 'tp': 14., 'dir': 0.}],
                               [{'h': 1., 'tp': None, 'dir': 0.}],
                               [{'h': 1., 'tp': 14., 'dir': None}]])
def test_incomplete_components_keep_legacy_behavior(monkeypatch, bad):
    candidate = factors(bad)
    monkeypatch.setenv('RATING_PARTITION_CONTINUITY', '0')
    assert factors(bad) == candidate


def test_default_is_exactly_legacy(monkeypatch):
    monkeypatch.delenv('RATING_PARTITION_CONTINUITY')
    default = factors(parts())
    monkeypatch.setenv('RATING_PARTITION_CONTINUITY', '0')
    assert factors(parts()) == default


def test_actual_component_input_mutation_is_detected():
    ps = parts(1.49)
    base = factors(ps)
    ps[0]['tp'] *= 1.01
    assert factors(ps) != base


def test_marginal_swell_does_not_grade_whole_sea_as_groundswell():
    ps = [{'h': .1, 'tp': 16., 'dir': 0., 'kind': 'swell'},
          {'h': 3., 'tp': 2., 'dir': 0., 'kind': 'windsea'}]
    # Preserve the scalar period curve's nonzero floor; the tiny swell must not lift the
    # windsea-dominated state above the actual short-period scalar grade.
    assert factors(ps, 2., 0.)['score'] <= factors(None, 2., 0.)['score'] + .1


@pytest.mark.parametrize('key,bad', [('h', float('inf')), ('tp', float('nan')), ('dir', float('inf'))])
def test_nonfinite_component_refuses_candidate(monkeypatch, key, bad):
    from services.weather_pipeline.partition_rating import partition_factors
    ps = parts()
    ps[0][key] = bad
    assert partition_factors(ps, 0.) is None


def test_missing_geometry_and_input_ownership():
    from services.weather_pipeline.partition_rating import partition_factors
    ps = parts()
    original = copy.deepcopy(ps)
    assert partition_factors(ps, None)[0] == 1.
    assert ps == original


def test_sim_explanation_reconstructs_candidate_without_inventing_period():
    from services.weather_pipeline import sim_explain
    ps = parts()
    f = factors(ps)
    out = sim_explain.explain(surf_h_m=1.5, tp_s=7., wind_speed_knots=3. * sr.MS_TO_KT, wind_from_deg=180.,
                             shore_normal_deg=0., swell_from_deg=90., partitions=ps, engine_score=f['score'])
    assert out['reconstruction_error'] == 0.
    assert 'warning' not in out
    assert 'graded_period_sec' not in out['inputs']
    assert out['inputs']['period_grading'] == 'component_energy_weighted_factors'


async def stored(tmp_path, spot, h2):
    total_tp, relative = (14., 0.) if h2 <= 1.5 else (7., 90.)
    product, store, manifest, resolver, _, _ = setup(tmp_path, spot, (math.hypot(1.5, h2), total_tp, relative, 6.))
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    normal = resolve_surf_geometry(spot[1], spot[2]).shore_normal_deg
    components = {}
    # Real stored grids, real resolver, real representative/reconciliation gates: no injected partitions.
    for layer, h, tp, angle in [('swell_1', 1.5, 14., 0.), ('swell_2', 0., 14., 0.),
                                ('wind_waves', h2, 7., 90.)]:
        filename = f'gfs_marine_{layer}_fixture.json'
        p = product.model_copy(deep=True)
        p.layer, p.product_id = layer, filename
        for v in p.grid.vectors:
            v.speed, v.period, v.direction = h, tp, (normal + angle) % 360
        components[filename] = p
        entry = manifest.products[0].model_copy(deep=True)
        entry.layer, entry.filename = layer, filename
        manifest.products.append(entry)
    original = store.load_product
    store.load_product = lambda filename, **kw: (components[filename].model_copy(deep=True)
                                                if filename in components else original(filename, **kw))
    calls = []
    async def forbidden(**kw):
        calls.append(kw)
        raise AssertionError('components must resolve from stored products')
    resolver.provider.fetch_point = forbidden
    point = await resolver.resolve_point('GFS', 'marine', 'waves', spot[1], spot[2], NOW.isoformat())
    row = await rate_one_spot(resolver, {'id': spot[0], 'name': spot[0], 'latitude': spot[1],
                                       'longitude': spot[2]}, 'GFS', NOW.isoformat(), tide_state_override=None)
    assert not calls
    assert point.partitions and len(point.partitions) == 2
    assert row['surf_height_m'] == round(point.surf_height_m, 3)
    return point, row


@pytest.mark.asyncio
@pytest.mark.parametrize('spot', SPOTS)
async def test_real_stored_crossover(tmp_path, monkeypatch, spot):
    a, b = await stored(tmp_path/'a', spot, 1.49), await stored(tmp_path/'b', spot, 1.51)
    assert a[0].point.period == 14. and b[0].point.period == 7.
    assert abs(a[1]['surf_height_m'] - b[1]['surf_height_m']) < .02
    assert abs(a[1]['score'] - b[1]['score']) <= 1., (a[1], b[1])
    assert 'mixed-sea periods' in b[1]['why']
    # Positive control: restore the actual old rating path; the remaining jump must reappear.
    monkeypatch.setenv('RATING_PARTITION_CONTINUITY', '0')
    old_a, old_b = await stored(tmp_path/'old-a', spot, 1.49), await stored(tmp_path/'old-b', spot, 1.51)
    assert old_a[1]['score'] - old_b[1]['score'] > 40.
