"""PJ-02/WJ-02: one physical sea must not grow when its labels are split."""
import copy
import math

import pytest

from services.weather_pipeline.surf_point import SurfGeometry, estimate_surf_at
from services.weather_pipeline.surf_transform import estimate_surf, estimate_surf_partitioned


STATES = [
    ([{'h': 1.5, 'tp': 14., 'dir': 0., 'kind': 'swell'}], 1000., 0., 1000.),
    ([{'h': 2.1, 'tp': 16., 'dir': 30., 'kind': 'swell'},
      {'h': .7, 'tp': 6., 'dir': 80., 'kind': 'windsea'}], 24., 80., 5.9),
    ([{'h': 4., 'tp': 18., 'dir': 5., 'kind': 'swell'},
      {'h': 2., 'tp': 10., 'dir': 65., 'kind': 'swell'}], 100., 10., 3.),
]


def split(parts, n):
    return [dict(p, h=p['h'] / math.sqrt(n)) for p in parts for _ in range(n)]


@pytest.mark.parametrize('state', STATES)
@pytest.mark.parametrize('n', [2, 3, 6])
@pytest.mark.parametrize('friction', ['0', '.25'])
def test_public_composition_is_invariant_when_each_train_is_split(monkeypatch, state, n, friction):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    monkeypatch.setenv('SURF_SHELF_CF_SCALE', friction)
    parts, depth, width, cap = state
    g = SurfGeometry(depth_m=depth, coastal=True, shelf_width_km=width, shore_normal_deg=0.,
                     shore_normal_src='fixture', magnet_factor=1., magnet_name=None,
                     break_depth_m=cap, nearshore=True)
    def sample(ps):
        return estimate_surf_at(0., 0., 2., 14., 0., geometry=g, partitions=ps)
    h, regime = sample(parts)
    split_h, split_regime = sample(split(parts, n))
    assert split_h == pytest.approx(h, rel=1e-12)
    assert split_regime == regime


@pytest.mark.parametrize('komar', ['0', '1'])
@pytest.mark.parametrize('flux', ['0', '1'])
@pytest.mark.parametrize('state', [(1.5, 14., 20., 100.), (.08, 18., 65., 100.), (8., 16., 0., 3.)])
def test_single_train_preserves_scalar_height_and_regime(monkeypatch, komar, flux, state):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    monkeypatch.setenv('SURF_V3_KOMAR', komar)
    monkeypatch.setenv('SURF_EXPOSURE_FLUX', flux)
    h, tp, bearing, cap = state
    kw = dict(shelf_width_km=80., shore_normal_deg=0., magnet_factor=1.1, break_depth_m=cap)
    scalar = estimate_surf(h, tp, 24., swell_from_deg=bearing, **kw)
    candidate = estimate_surf_partitioned([{'h': h, 'tp': tp, 'dir': bearing}], 24., **kw)
    assert candidate[0] == pytest.approx(scalar[0], rel=1e-12)
    assert candidate[1] == scalar[1]


def test_unsaturated_height_matches_independent_additive_komar_algebra(monkeypatch):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    monkeypatch.setenv('SURF_SHELF_CF_SCALE', '0')
    monkeypatch.setenv('SURF_V3_JACK_MAX', '100')
    monkeypatch.setenv('SURF_REFRACTION_KR', '1')
    monkeypatch.setenv('SURF_HEIGHT_H110', '0')
    parts = [{'h': 1.5, 'tp': 14., 'dir': 0.}, {'h': .9, 'tp': 7., 'dir': 60.}]
    # Legacy height-angle proxy is retained; power 2.5 is the algebraic inverse of .4.
    angle = .55 + .45 * (.1 + .9 * math.cos(math.radians(60)))
    f = 1.5**2 * 14 + .9**2 * 7 * angle**2.5
    expected = .56 * (9.81 / (2 * math.pi))**.2 * f**.4
    actual, _ = estimate_surf_partitioned(parts, 1000., shore_normal_deg=0.)
    assert actual == pytest.approx(expected, rel=1e-12)


def test_old_quadrature_is_a_detected_positive_control(monkeypatch):
    parts, depth, width, cap = STATES[0]
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    expected = estimate_surf_partitioned(parts, depth, break_depth_m=cap)[0]
    monkeypatch.setenv('SURF_PARTITION_FLUX', '0')
    bad = estimate_surf_partitioned(split(parts, 6), depth, break_depth_m=cap)[0]
    assert bad / expected == pytest.approx(6**.1)


def test_flag_is_default_off(monkeypatch):
    monkeypatch.delenv('SURF_PARTITION_FLUX', raising=False)
    parts, depth, _, cap = STATES[0]
    original = estimate_surf_partitioned(split(parts, 3), depth, break_depth_m=cap)
    monkeypatch.setenv('SURF_PARTITION_FLUX', '0')
    assert estimate_surf_partitioned(split(parts, 3), depth, break_depth_m=cap) == original


@pytest.mark.parametrize('h110', ['0', '1'])
def test_one_final_cap_inherits_tide_and_statistic(monkeypatch, h110):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    monkeypatch.setenv('SURF_TIDE_DEPTH', '1')
    monkeypatch.setenv('SURF_HEIGHT_H110', h110)
    parts = [{'h': 12., 'tp': 18., 'dir': 0.}]
    kw = dict(break_depth_m=3., water_level_m=-4., shore_normal_deg=0.)
    expected = estimate_surf(12., 18., 100., swell_from_deg=0., **kw)
    assert estimate_surf_partitioned(split(parts, 6), 100., **kw) == expected
    assert expected == pytest.approx((.81 * .3, 'breaking'))


@pytest.mark.parametrize('coastal,depth,regime', [(False, 24., 'open_ocean'), (True, None, 'unknown_depth')])
def test_no_shore_or_depth_retains_offshore_quadrature(monkeypatch, coastal, depth, regime):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    ps = [{'h': 3., 'tp': 12.}, {'h': 4., 'tp': 6.}]
    assert estimate_surf_partitioned(ps, depth, coastal=coastal) == (5., regime)


def test_order_and_input_ownership(monkeypatch):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    parts, depth, width, cap = STATES[1]
    saved = copy.deepcopy(parts)
    kw = dict(shelf_width_km=width, break_depth_m=cap, shore_normal_deg=0.)
    h, r = estimate_surf_partitioned(parts, depth, **kw)
    rev, rr = estimate_surf_partitioned(list(reversed(parts)), depth, **kw)
    assert rev == pytest.approx(h, rel=1e-12) and rr == r
    assert parts == saved


def test_empty_and_invalid_trains_do_not_raise_or_set_the_cap(monkeypatch):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    junk = [None, {}, {'h': float('nan'), 'tp': 20.}, {'h': 2., 'tp': float('inf')},
            {'h': 'bad', 'tp': 900.}, {'h': 0., 'tp': 1000.}]
    assert estimate_surf_partitioned(junk, 100.) == (None, 'unknown')
    p = [{'h': 8., 'tp': 5., 'dir': 0.}]
    assert estimate_surf_partitioned(p + junk, 100., break_depth_m=3.) == estimate_surf_partitioned(p, 100., break_depth_m=3.)


def test_linear_kill_switch_is_also_split_invariant(monkeypatch):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    monkeypatch.setenv('SURF_V3_KOMAR', '0')
    p, d, w, b = STATES[1]
    kw = dict(shelf_width_km=w, break_depth_m=b, shore_normal_deg=0.)
    a, r = estimate_surf_partitioned(p, d, **kw)
    h, rr = estimate_surf_partitioned(split(p, 6), d, **kw)
    assert h == pytest.approx(a) and rr == r


@pytest.mark.parametrize('spot,state', [
    (('Cocoa', 28.3664, -80.6015), (1.5, 14., 30., 6.)),
    (('Trestles', 33.3825, -117.5886), (2.1, 16., 10., 8.)),
    (('Snapper', -28.1677, 153.5504), (3., 12., 50., 10.)),
])
async def test_stored_point_rating_and_wire_consume_one_partition_height(tmp_path, monkeypatch, spot, state):
    from test_rating_band_canonical import setup, NOW
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    from services.weather_pipeline.spot_ratings import rate_one_spot
    from services.weather_pipeline.surf_rating import compute_surf_rating, KT_TO_MS
    from routes.weather import SpotRatingItem, SpotRatingsResponse
    for flag in ('RATING_TIDE', 'RATING_OBS_GATE', 'RATING_LOCAL_SIZE', 'RATING_BREAKER_TYPE',
                 'SURF_NEARSHORE_MOP', 'SURF_TIDE_DEPTH'):
        monkeypatch.setenv(flag, '0')
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    monkeypatch.setenv('SURF_TRANSFORM', '1')
    _, _, _, resolver, wind_kn, wind_from = setup(tmp_path, spot, state)
    name, lat, lng = spot
    g = resolve_surf_geometry(lat, lng)
    parts = [{'h': state[0] * .8, 'tp': state[1], 'dir': g.shore_normal_deg, 'kind': 'swell'},
             {'h': state[0] * .6, 'tp': 7., 'dir': (g.shore_normal_deg + 60) % 360, 'kind': 'windsea'}]
    async def supplied(*args):
        return copy.deepcopy(parts)
    monkeypatch.setattr(resolver, '_resolve_partitions', supplied)
    point = await resolver.resolve_point(model='GFS', domain='marine', layer='waves', lat=lat, lng=lng, valid_time_str=NOW.isoformat())
    expected, regime = estimate_surf_at(lat, lng, state[0], state[1], g.shore_normal_deg, geometry=g, partitions=parts)
    assert point.surf_height_m == pytest.approx(expected, abs=.00005) and point.surf_regime == regime
    assert point.partitions == parts
    rated = await rate_one_spot(resolver, {'id': name, 'name': name, 'latitude': lat, 'longitude': lng}, 'GFS', NOW.isoformat(), tide_state_override=None)
    score, level = compute_surf_rating(point.surf_height_m, state[1], wind_kn * KT_TO_MS,
        wind_from_deg=wind_from, shore_normal_deg=g.shore_normal_deg, swell_from_deg=g.shore_normal_deg + state[2],
        break_depth_m=g.break_depth_m, partitions=parts)
    assert rated['score'] == round(score, 1) and rated['level'] == level
    wire = SpotRatingsResponse(model='GFS', valid_time=NOW.isoformat(), count=1, source='live',
                              spots=[SpotRatingItem(**rated)]).model_dump()['spots'][0]
    assert wire['surf_height_m'] == round(point.surf_height_m, 3)


def test_flag_without_component_inputs_keeps_scalar_composition(monkeypatch):
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    g = resolve_surf_geometry(28.3664, -80.6015)
    monkeypatch.setenv('SURF_PARTITION_FLUX', '0')
    before = estimate_surf_at(28.3664, -80.6015, 1.5, 14., g.shore_normal_deg, geometry=g)
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    assert estimate_surf_at(28.3664, -80.6015, 1.5, 14., g.shore_normal_deg, geometry=g) == before


def test_zero_direct_arrivals_do_not_fall_back_to_a_positive_bulk_height(monkeypatch):
    monkeypatch.setenv('SURF_PARTITION_FLUX', '1')
    monkeypatch.setenv('SURF_EXPOSURE_FLUX', '1')
    g = SurfGeometry(100., 0., True, 0., 'fixture', 1., None, 100., True)
    assert estimate_surf_at(0., 0., 2., 14., 0., geometry=g,
                           partitions=[{'h': 2., 'tp': 14., 'dir': 180.}]) == (0., 'shelf')
