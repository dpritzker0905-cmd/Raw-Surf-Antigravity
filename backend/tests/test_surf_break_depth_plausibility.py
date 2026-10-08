"""PJ-01 public geometry/height seam; real assets, offline, dark candidate only."""
import pytest

from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at


@pytest.mark.parametrize('lat,lng', [(-17.868, -149.258), (15.858, -97.068)])
def test_dark_candidate_never_uses_deep_or_missing_sample_as_shelf_cap(monkeypatch, lat, lng):
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY', '1')
    g = resolve_surf_geometry(lat, lng)
    assert g.coastal
    assert g.break_depth_m is not None and 0 < g.break_depth_m <= 30
    h, regime = estimate_surf_at(lat, lng, 12, 18, g.shore_normal_deg, geometry=g)
    assert regime == 'breaking'
    assert h < 16


@pytest.mark.parametrize('lat,lng', [(-28.1677,153.5504),(28.3664,-80.6015),(33.3825,-117.5886)])
def test_dark_candidate_preserves_plausible_measured_depth(monkeypatch, lat, lng):
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','0')
    old = resolve_surf_geometry(lat,lng)
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    new = resolve_surf_geometry(lat,lng)
    assert new.break_depth_m == old.break_depth_m
    assert estimate_surf_at(lat,lng,12,18,new.shore_normal_deg,geometry=new) == estimate_surf_at(lat,lng,12,18,old.shore_normal_deg,geometry=old)


@pytest.mark.parametrize('sample', [None, 0, -1, 30.01, 273, float('nan'), float('inf')])
def test_unusable_samples_take_a_labelled_prior(monkeypatch, sample):
    from services.weather_pipeline import shore_normal_asset as asset
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    monkeypatch.setattr(asset,'break_depth_at',lambda *a: sample)
    g = resolve_surf_geometry(28.3664,-80.6015)
    assert g.break_depth_source == 'regional_prior'
    assert 0 < g.break_depth_m <= 30


@pytest.mark.parametrize('flag', ['SURF_BREAK_DEPTH', 'SHORE_NORMAL_ASSET'])
def test_existing_kill_switches_win(monkeypatch, flag):
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','0')
    monkeypatch.setenv(flag,'0')
    old = resolve_surf_geometry(-17.868,-149.258)
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    new = resolve_surf_geometry(-17.868,-149.258)
    assert new == old


def test_open_ocean_stays_open(monkeypatch):
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    g = resolve_surf_geometry(30,-140)
    assert not g.coastal and g.break_depth_m is None and g.break_depth_source is None
    assert estimate_surf_at(30,-140,12,18,geometry=g) == (12.,'open_ocean')


def test_unavailable_asset_does_not_restore_deep_sample(monkeypatch):
    from services.weather_pipeline import break_depth_policy as policy
    def missing(*a):
        raise OSError('asset unavailable')
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    monkeypatch.setattr(policy,'default_depth',missing)
    g = resolve_surf_geometry(-17.868,-149.258)
    assert g.break_depth_m is None and g.break_depth_source == 'unavailable'


def test_threshold_is_inclusive_and_default_is_off(monkeypatch):
    from services.weather_pipeline import shore_normal_asset as asset
    monkeypatch.delenv('SURF_BREAK_DEPTH_PLAUSIBILITY',raising=False)
    old = resolve_surf_geometry(-17.868,-149.258)
    assert old.break_depth_m == 273 and old.break_depth_source is None
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    monkeypatch.setattr(asset,'break_depth_at',lambda *a: 30.)
    new = resolve_surf_geometry(-17.868,-149.258)
    assert new.break_depth_m == 30 and new.break_depth_source == 'measured'


def test_regional_median_and_sparse_global_prior(monkeypatch):
    from services.weather_pipeline import break_depth_policy as policy
    # Distinct valid donors; the far donor may enter the global prior only.
    monkeypatch.setattr(policy,'_donors',lambda: ((0.,0.,4.),(0.,.1,8.),(0.,.2,12.),(40.,80.,30.)))
    policy.default_depth.cache_clear()
    try:
        assert policy.default_depth(0.,.1) == (8.,'regional_prior')
        assert policy.default_depth(-40.,-80.) == (10.,'global_prior')
    finally:
        policy.default_depth.cache_clear()


def test_prior_donors_exclude_invalid_and_duplicate_coordinates(tmp_path,monkeypatch):
    import json
    from services.weather_pipeline import break_depth_policy as policy, shore_normal_asset as asset
    data = {'entries':[[0,0,90,0,4],[0,0,90,0,4],[0,.1,90,0,8],[0,.2,90,0,12],
                       [0,.3,90,0,273],[0,.4,90,0,None],[91,0,90,0,5]],
            'land_present':[[0,.5,1,0],[0,.6,1,-1]]}
    p = tmp_path/'asset.json'
    p.write_text(json.dumps(data),encoding='utf-8')
    monkeypatch.setattr(asset,'_ASSET',str(p))
    policy._donors.cache_clear()
    policy.default_depth.cache_clear()
    try:
        assert policy.default_depth(0,.1) == (8.,'regional_prior')
        assert len(policy._donors()) == 3
    finally:
        policy._donors.cache_clear()
        policy.default_depth.cache_clear()


def test_empty_asset_keeps_prior_unknown(monkeypatch):
    from services.weather_pipeline import break_depth_policy as policy
    monkeypatch.setattr(policy,'_donors',lambda: ())
    policy.default_depth.cache_clear()
    try:
        assert policy.resolve_depth(0,0,273) == (None,'unavailable')
    finally:
        policy.default_depth.cache_clear()


@pytest.mark.parametrize('spot,state', [
    (('Teahupoo',-17.868,-149.258),(12.,18.,0.,6.)),
    (('Puerto',15.858,-97.068),(10.,16.,0.,7.)),
    (('Cocoa',28.3664,-80.6015),(8.,14.,0.,5.)),
    (('Trestles',33.3825,-117.5886),(6.,16.,0.,8.)),
])
async def test_point_rating_and_geometry_share_the_same_depth(tmp_path,monkeypatch,spot,state):
    from test_rating_band_canonical import setup, NOW
    from services.weather_pipeline.spot_ratings import rate_one_spot
    from services.weather_pipeline.surf_rating import compute_surf_rating, KT_TO_MS
    for flag in ('RATING_TIDE','RATING_OBS_GATE','RATING_LOCAL_SIZE','RATING_BREAKER_TYPE','SURF_PARTITIONS','SURF_NEARSHORE_MOP'):
        monkeypatch.setenv(flag,'0')
    monkeypatch.setenv('SURF_TRANSFORM','1')
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    _,_,_,resolver,wind_kn,wind_from = setup(tmp_path,spot,state)
    name,lat,lng = spot
    g = resolve_surf_geometry(lat,lng)
    point = await resolver.resolve_point(model='GFS',domain='marine',layer='waves',lat=lat,lng=lng,valid_time_str=NOW.isoformat())
    height,regime = estimate_surf_at(lat,lng,state[0],state[1],g.shore_normal_deg,geometry=g)
    assert point.surf_height_m == pytest.approx(height)
    assert point.surf_regime == regime
    assert point.break_depth_m == g.break_depth_m
    assert point.break_depth_source == g.break_depth_source
    rated = await rate_one_spot(resolver,{'id':name,'latitude':lat,'longitude':lng},'GFS',NOW.isoformat(),tide_state_override=None)
    score,level = compute_surf_rating(height,state[1],wind_kn*KT_TO_MS,wind_from_deg=wind_from,
        shore_normal_deg=g.shore_normal_deg,swell_from_deg=g.shore_normal_deg,break_depth_m=g.break_depth_m)
    assert rated['score'] == pytest.approx(round(score,1))
    assert rated['level'] == level
    assert rated['break_depth_source'] == g.break_depth_source


@pytest.mark.parametrize('lat,lng', [(-17.868,-149.258),(15.858,-97.068),(28.3664,-80.6015)])
def test_capped_seas_have_zero_height_derivative_and_detect_bad_depth(monkeypatch,lat,lng):
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    g = resolve_surf_geometry(lat,lng)
    def f(hs,geom=g):
        return estimate_surf_at(lat,lng,hs,18,g.shore_normal_deg,geometry=geom)[0]
    # Distinct real geometries; both sides are in the capped regime.
    assert (f(12.01)-f(11.99))/.02 == 0
    mutant = g._replace(break_depth_m=g.break_depth_m*1.01)
    assert f(12,mutant) != f(12)


async def test_legacy_cached_height_is_not_graded_using_a_new_prior(tmp_path,monkeypatch):
    from test_rating_band_canonical import setup, NOW
    from services.weather_pipeline.spot_ratings import rate_one_spot
    for flag in ('RATING_TIDE','RATING_OBS_GATE','RATING_LOCAL_SIZE','RATING_BREAKER_TYPE','SURF_PARTITIONS','SURF_NEARSHORE_MOP'):
        monkeypatch.setenv(flag,'0')
    monkeypatch.setenv('SURF_TRANSFORM','1')
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','0')
    spot=('Teahupoo',-17.868,-149.258)
    _,_,_,resolver,_,_ = setup(tmp_path,spot,(12.,18.,0.,6.))
    frame=await resolver.resolve_point(model='GFS',domain='marine',layer='waves',lat=spot[1],lng=spot[2],valid_time_str=NOW.isoformat())
    class FrozenMarine:
        async def resolve_point(self,**kw):
            return frame if kw['domain']=='marine' else await resolver.resolve_point(**kw)
    def sample():
        return rate_one_spot(FrozenMarine(),{'id':spot[0],'latitude':spot[1],'longitude':spot[2]},'GFS',NOW.isoformat(),tide_state_override=None)
    before=await sample()
    monkeypatch.setenv('SURF_BREAK_DEPTH_PLAUSIBILITY','1')
    after=await sample()
    assert (after['score'],after['level']) == (before['score'],before['level'])
    assert 'break_depth_source' not in after
    assert frame.break_depth_source is None
