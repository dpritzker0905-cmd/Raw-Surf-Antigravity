"""SURF_SPECTRAL_K (default ON since the sheltered-scope rework #727 passed; #706's all-spots scope FAILED round 7, PR #722): California spots break from CDIP MOP's published ray K applied to one member's
partitions at one open-ocean read point per region, through the EXISTING breaking step.

Pins: the kill switch '0' is byte-identical (a hash of the served augmentation, equal to origin/dev's before #706), and
the default is ON (D-065);
K on a synthetic spectrum reproduces a hand-computed answer; the frequency split; a point without a MOP entry keeps
the bulk chain; every member and the full 14-day horizon run the arm; the read point is resolved once per member,
region and hour; the committed table is what its index says; the harness replays the arm on its own instrument.
"""
import hashlib
import json
import math
import types

import numpy as np
import pytest

from services.weather_pipeline import spectral_k as K
from services.weather_pipeline import spectral_k_serving as S

FLAGS = ("SURF_SPECTRAL_K", "SURF_NEARSHORE_MOP", "SURF_PARTITIONS", "SURF_REFRACTION_KR", "SURF_V3_KOMAR",
         "SURF_TIDE_DEPTH", "SURF_BREAK_DEPTH", "SURF_HEIGHT_H110", "SURF_CAP_SEAM_MONOTONE", "SURF_V3_EXPOSURE",
         "SURF_V3_MAGNETS", "SURF_V3_JACK_MAX", "RATING_DIRECTIONAL_CONFLICT", "SURF_TRANSFORM")
BLACKS = (32.8925, -117.2536)          # a covered spot (D0542, 0.59 km)
SWAMIS = (33.0348, -117.3248)          # a California spot with NO shoreFlag-1 point within 1 km
VT0, VT336 = "2026-10-06T00:00:00Z", "2026-10-20T00:00:00Z"
PARTS = {"waves": (1.6, 13.0, 285.0), "swell_1": (1.3, 14.0, 290.0), "swell_2": (0.5, 18.0, 205.0),
         "wind_waves": (0.7, 6.0, 300.0)}


@pytest.fixture
def clean(monkeypatch):
    for k in FLAGS:
        monkeypatch.delenv(k, raising=False)
    # #706's tests pin the K MECHANICS on Bight points (Blacks, Del Mar): they run at #706's scope. The 2026-11-04
    # rework's default scope ('sheltered') is pinned by tests/test_spectral_k_sheltered.py.
    monkeypatch.setenv("SURF_SPECTRAL_K_ALL_SPOTS", "1")
    # HERMETIC: SURF_TIDE_DEPTH is ON by default (D-065), so the augmentation asks `tide_norm_at`, which reaches
    # Open-Meteo whenever the network is open (GitHub's runners: the FLAG_OFF_SHA pin then moved with the live
    # tide, ff55d0e4 vs fad3cb8e, run 41951077989). The pin was taken with no tide (eta 0); keep it that way.
    from services.weather_pipeline import tide as _tide

    async def _no_tide(*a, **k):
        return None
    monkeypatch.setattr(_tide, "tide_norm_at", _no_tide)
    S._reset_for_test()
    yield monkeypatch
    S._reset_for_test()


class Raw:
    """A raw (un-augmented) resolver: the read point's total and trains, counting every ask."""

    def __init__(self, seas=None, basis=None):
        self.seas, self.basis, self.asked = seas or PARTS, basis, []

    async def raw(self, model, layer, lat, lng, vt):
        self.asked.append((model, layer, round(lat, 2), round(lng, 2), vt))
        h, tp, d = self.seas[layer]
        return types.SimpleNamespace(point=types.SimpleNamespace(speed=h, period=tp, direction=d),
                                     estimate_basis=self.basis if layer != "waves" else None)


def _resp(lat, lng, hs=1.6, tp=13.0, d=285.0):
    from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
    return NormalizedPointResponse(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time="2026-10-06T00:00:00Z", valid_time=VT0, is_forecast_authoritative=True, is_estimated=False,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", source_variables=["wave_height"],
        freshness_sec=0, point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat,
                                                     sampled_lng=lng, speed=hs, direction=d, period=tp,
                                                     interpolation_method="nearest"))


async def _no_parts(*a, **k):
    return None


# ── the flag off is byte-identical ───────────────────────────────────────────────────────────────────────────────
# sha256 of the augmentation below at origin/dev d153dfc09 (BEFORE this change, called without `resolve_raw`),
# recomputed on this branch with the flag off and a resolver that WOULD answer. Equal = byte-identical.
FLAG_OFF_SHA = "fad3cb8e76dc2ef90670c3c1ca392fee35f83354d0f6afc58f09aa92b744d6af"
POINTS = [BLACKS, SWAMIS, (34.0388, -118.62), (36.9514, -122.0263), (21.6650, -158.0530)]
SEAS = [(0.6, 9.0, 270.0), (1.6, 13.0, 285.0), (3.2, 17.0, 300.0)]


async def _flag_off_rows(resolve_raw):
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    rows = []
    for lat, lng in POINTS:
        for hs, tp, d in SEAS:
            kw = {} if resolve_raw is None else {"resolve_raw": resolve_raw}
            r = await augment_with_surf(_resp(lat, lng, hs, tp, d), "GFS", "marine", "waves", lat, lng, VT0,
                                        _no_parts, **kw)
            rows.append([lat, lng, hs, tp, d, r.surf_height_m, r.surf_regime, r.surf_source, r.shelf_depth_m,
                         r.break_depth_m, r.shore_normal_deg])
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


@pytest.mark.asyncio
async def test_the_kill_switch_is_byte_identical_and_never_reads_the_read_point(clean):
    clean.setenv("SURF_SPECTRAL_K", "0")
    raw = Raw()
    assert await _flag_off_rows(raw.raw) == FLAG_OFF_SHA
    assert raw.asked == [], "kill switch: the read point is never resolved"


@pytest.mark.asyncio
async def test_the_default_is_on_and_the_kill_switch_is_byte_identical(clean):
    assert S.enabled(), "unset = ON (D-065; the sheltered-scope rework #727 passed)"
    clean.setenv("SURF_SPECTRAL_K", "0")
    raw = Raw()
    assert not S.enabled()
    assert await _flag_off_rows(raw.raw) == FLAG_OFF_SHA and raw.asked == []


# ── K on a synthetic spectrum: hand-computed ─────────────────────────────────────────────────────────────────────
SF = np.round(np.arange(0.05, 0.145, 0.01), 3)                     # the published swell axis (10)
QF = np.array([0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.25])


def _transfer(swl=0.25, sea=1.0, depth=10.0):
    return K.Transfer(np.full((10, 72), swl), np.full((17, 72), sea), SF, QF, depth)


def test_one_bin_of_energy_comes_back_times_that_bins_coefficient():
    """Energy in ONE (f, theta) bin returns exactly the published coefficient of that bin, from the swell table below
    the split and the sea table at and above it (frequencies on the published axes, so no interpolation)."""
    swl = np.arange(720, dtype=float).reshape(10, 72) / 1000.0
    sea = 5.0 + np.arange(17 * 72, dtype=float).reshape(17, 72) / 1000.0
    T = K.Transfer(swl, sea, SF, QF, 10.0)
    for f, j, want in ((0.07, 53, swl[2, 53]), (0.08, 0, swl[3, 0]), (0.12, 17, sea[7, 17]), (0.09, 71, sea[4, 71])):
        E = np.zeros((K.FINE.size, 72))
        i = int(np.argmin(abs(K.FINE - f)))
        assert abs(K.FINE[i] - f) < 1e-9
        E[i, j] = 2.0
        En = T.apply(E)
        assert En[i] == pytest.approx(2.0 * want, rel=1e-12) and np.count_nonzero(En) == 1


def test_a_jonswap_through_constant_k_matches_the_hand_integral():
    """One 1.0 m 14 s swell from 270 through swl = 0.25 / sea = 1.0: the transformed m0 is the hand integral of an
    independently written JONSWAP times the piecewise coefficient (0.25 below 0.09 Hz, 1 to 0.275 Hz, then half the
    500 m -> 10 m energy shoaling), so Hs = 4 sqrt(m0)."""
    f = K.FINE
    fp, g = 1 / 14.0, 3.3
    sig = np.where(f <= fp, 0.07, 0.09)
    s = f ** -5 * np.exp(-1.25 * (fp / f) ** 4) * g ** np.exp(-((f - fp) ** 2) / (2 * sig ** 2 * fp ** 2))
    s *= (1.0 / 16.0) / np.trapezoid(s, f)

    def cg(ff, h):
        w = 2 * np.pi * ff
        k = w * w / 9.81
        for _ in range(60):
            k = w * w / (9.81 * np.tanh(k * h))
        c = w / k
        return 0.5 * c * (1 + 2 * k * h / np.sinh(2 * k * h))
    coef = np.where(f < 0.09, 0.25, np.where(f > QF[-1] + 0.025, 0.5 * cg(f, 500.0) / cg(f, 10.0), 1.0))
    want = 4 * math.sqrt(np.trapezoid(coef * s, f))
    sea = K.nearshore_sea([{"h": 1.0, "tp": 14.0, "dir": 270.0, "kind": "swell"}], _transfer())
    assert sea["hs"] == pytest.approx(want, rel=1e-6)
    assert sea["depth_m"] == 10.0 and sea["dp"] is None
    assert sea["tp"] == pytest.approx(14.0, abs=0.3)


def test_the_frequency_split_is_090_hz_and_moves_energy_between_the_tables():
    assert K.FC_SPLIT_HZ == 0.09
    T = _transfer(swl=0.0, sea=1.0)
    E = np.zeros((K.FINE.size, 72))
    lo, hi = int(np.argmin(abs(K.FINE - 0.0875))), int(np.argmin(abs(K.FINE - 0.09)))
    E[lo, 30] = E[hi, 30] = 1.0
    En = T.apply(E)
    assert En[lo] == 0.0, "0.0875 Hz is swell band: swl_et (0 here)"
    assert En[hi] == 1.0, "0.09 Hz is sea band: sea_et (1 here)"
    assert T.apply(E, fc_hz=0.145)[hi] == 0.0, "the split is the parameter, not the tables"


def test_spreading_and_rebuild_conserve_the_partition_energy():
    E = K.rebuild([{"h": 1.2, "tp": 12.0, "dir": 250.0, "kind": "swell"},
                   {"h": 0.5, "tp": 5.0, "dir": 300.0, "kind": "windsea"},
                   {"h": 0.9, "tp": 9.0, "dir": None, "kind": "swell"}])          # dirless: cannot be transferred
    assert 4 * math.sqrt(np.trapezoid(E.sum(axis=1), K.FINE)) == pytest.approx(math.hypot(1.2, 0.5), rel=1e-9)
    assert K.spreading(250.0, 25).sum() == pytest.approx(1.0)
    assert K.rebuild([{"h": 0.0, "tp": 12.0, "dir": 250.0}]) is None


def test_shoaling_to_the_buoy_conserves_flux_and_is_identity_at_the_same_depth():
    Ef = K.jonswap(1.0, 12.0)
    assert np.allclose(K.shoal_to_depth(Ef, 10.0, 10.0), Ef)
    deeper = K.shoal_to_depth(Ef, 10.0, 20.0)
    assert K.hs_of(deeper) < K.hs_of(Ef), "a 12 s sea is smaller at 20 m than at 10 m (Cg grows with depth)"
    assert np.allclose(deeper * K.group_velocity(K.FINE, 20.0), Ef * K.group_velocity(K.FINE, 10.0))


# ── serving: coverage, members, horizon, memo ────────────────────────────────────────────────────────────────────
def test_the_committed_table_is_what_its_index_says(clean):
    t = S.load_table()
    with open(S.TABLE_JSON, encoding="utf-8") as f:
        idx = json.load(f)
    with np.load(S.TABLE_NPZ, allow_pickle=False) as z:
        assert z["swl_et"].dtype == np.float16 and z["sea_et"].dtype == np.float16
        assert z["swl_et"].shape == (idx["n_entries"], 10, 72) and z["sea_et"].shape == (idx["n_entries"], 17, 72)
        assert z["swl_et"][0].nbytes + z["sea_et"][0].nbytes == 3888
    assert len(t["transfers"]) == idx["n_entries"] == len(idx["entries"]) >= 40
    for e in idx["entries"]:
        assert e["shore_flag"] == 1 and 32.4 < e["lat"] < 42.1 and -124.6 < e["lng"] < -117.0
        assert e["km"] <= (1.0 if e["kind"] == "spot" else 3.0)
    assert {r[0] for r in S.READ_POINTS} == {"socal", "central", "bay", "north"}


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["GFS", "EURO", "ICON"])
@pytest.mark.parametrize("vt", [VT0, VT336])
async def test_every_member_and_the_full_horizon_run_the_arm(clean, model, vt):
    clean.setenv("SURF_SPECTRAL_K", "1")
    raw = Raw()
    sea = await S.nearshore_for_point(model, *BLACKS, vt, raw.raw)
    assert sea and sea["region"] == "socal" and sea["label"] == "D0542" and 0 < sea["hs"] < 3
    assert {a[0] for a in raw.asked} == {model} and {a[4] for a in raw.asked} == {vt}
    assert {(a[2], a[3]) for a in raw.asked} == {(32.0, -119.8)}, "read at the region's frozen read point only"


@pytest.mark.asyncio
async def test_the_read_point_is_resolved_once_per_member_region_and_hour(clean):
    clean.setenv("SURF_SPECTRAL_K", "1")
    raw = Raw()
    for _ in range(3):
        await S.nearshore_for_point("GFS", *BLACKS, VT0, raw.raw)
        await S.nearshore_for_point("GFS", 32.8565, -117.2585, VT0, raw.raw)       # La Jolla Shores, same region
    assert len(raw.asked) == 4, "waves + three trains, once"
    await S.nearshore_for_point("EURO", *BLACKS, VT0, raw.raw)
    assert len(raw.asked) == 8


@pytest.mark.asyncio
async def test_no_mop_point_keeps_the_bulk_chain_unchanged(clean):
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    raw = Raw()
    clean.setenv("SURF_SPECTRAL_K", "0")
    off = await augment_with_surf(_resp(*SWAMIS), "GFS", "marine", "waves", *SWAMIS, VT0, _no_parts,
                                  resolve_raw=raw.raw)
    clean.setenv("SURF_SPECTRAL_K", "1")
    assert S.entry_for_point(*SWAMIS) is None
    on = await augment_with_surf(_resp(*SWAMIS), "GFS", "marine", "waves", *SWAMIS, VT0, _no_parts,
                                 resolve_raw=raw.raw)
    assert (on.surf_height_m, on.surf_regime, on.surf_source) == (off.surf_height_m, off.surf_regime, "parametric")
    assert raw.asked == [], "an uncovered point reads nothing"
    assert await S.nearshore_for_point("GFS", 21.665, -158.053, VT0, raw.raw) is None, "outside California"


@pytest.mark.asyncio
async def test_flag_on_a_covered_spot_breaks_through_the_one_breaking_step(clean):
    from services.weather_pipeline.mop_nearshore import estimate_surf_from_nearshore
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    clean.setenv("SURF_SPECTRAL_K", "1")
    raw = Raw()
    r = await augment_with_surf(_resp(*BLACKS), "GFS", "marine", "waves", *BLACKS, VT0, _no_parts,
                                resolve_raw=raw.raw)
    sea = await S.nearshore_for_point("GFS", *BLACKS, VT0, Raw().raw)
    g = resolve_surf_geometry(*BLACKS)
    want, _ = estimate_surf_from_nearshore(sea["hs"], sea["tp"], sea["depth_m"], g.depth_m, g.shelf_width_km,
                                           g.break_depth_m)
    assert r.surf_source == "cdip_mop_k" and r.surf_height_m == pytest.approx(round(want, 4))


@pytest.mark.asyncio
async def test_unusable_read_points_fall_back_to_bulk(clean):
    clean.setenv("SURF_SPECTRAL_K", "1")
    ratio = Raw(basis={"method": "wave_component_ratio_estimation"})
    assert await S.nearshore_for_point("GFS", *BLACKS, VT0, ratio.raw) is None, "ratio-derived trains are not partitions"
    thin = Raw(seas=dict(PARTS, swell_1=(0.1, 14.0, 290.0), swell_2=(0.1, 18.0, 205.0), wind_waves=(0.1, 6.0, 300.0)))
    assert await S.nearshore_for_point("GFS", *BLACKS, VT0, thin.raw) is None, "trains that do not represent the total"
    assert await S.nearshore_for_point("GFS", *BLACKS, VT0, None) is None


@pytest.mark.asyncio
async def test_the_station_instrument_shoals_the_buoys_own_k_to_the_buoy_depth(clean):
    clean.setenv("SURF_SPECTRAL_K", "1")
    e = next(x for x in S.load_table()["entries"] if x["key"] == "station:153p1")
    hs_buoy = await S.station_hs("GFS", "153p1", 17.0, VT0, Raw().raw)
    parts = await S.read_point_partitions(Raw().raw, "GFS", "socal", VT0)
    sea = K.nearshore_sea(parts, S.load_table()["transfers"][e["key"]])
    assert hs_buoy == pytest.approx(K.hs_of(K.shoal_to_depth(sea["spectrum"], e["depth_m"], 17.0)))
    assert hs_buoy < sea["hs"]
    assert await S.station_hs("GFS", "142p1", 14.9, VT0, Raw().raw) is None, "no MOP point within 3 km"
    clean.setenv("SURF_SPECTRAL_K", "0")
    assert await S.station_hs("GFS", "153p1", 17.0, VT0, Raw().raw) is None


def test_the_flag_is_registered_and_deferred_to_the_manifest_in_every_rating_lane():
    import os
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(repo, "backend", "routes", "admin", "surf_forecast.py"), encoding="utf-8") as f:
        assert '"SURF_SPECTRAL_K":' in f.read()
    for lane in ("precompute.yml", "forecast-ingest.yml", "sim-parity-monitor.yml"):
        with open(os.path.join(repo, ".github", "workflows", lane), encoding="utf-8") as f:
            assert "SURF_SPECTRAL_K: ''  # D-065 GUARDED" in f.read(), lane


def test_the_flip_budget_counts_the_partition_span():
    from datetime import datetime, timezone
    import importlib.util
    import os
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "flip_scorecard.py")
    spec = importlib.util.spec_from_file_location("flip_scorecard_k", p)
    fs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fs)
    a, b = datetime(2026, 10, 6, tzinfo=timezone.utc), datetime(2026, 10, 15, 18, tzinfo=timezone.utc)
    base = fs.range_downloads(a, b, [24, 48, 72])
    assert fs.range_downloads(a, b, [24, 48, 72], flags={"SURF_SPECTRAL_K": "1"}) == base * 3 // 2
    assert fs.range_downloads(a, b, [24, 48, 72], flags={"SURF_TIDE_DEPTH": "1"}) == base
    assert fs.range_downloads(a, b, [24, 48, 72], flags={"SURF_SPECTRAL_K": "1"}) <= fs.MAX_RANGE_DOWNLOADS


# ── the evaluation harness replays the arm on its own instrument ─────────────────────────────────────────────────
def _crop(lat, lng, keys):
    from services.weather_pipeline import eval_gfswave as gw
    vals = {"HTSGW": 1.6, "PERPW": 13.0, "DIRPW": 285.0, "U": -3.0, "V": 1.0, "SWELL:1": 1.3, "SWPER:1": 14.0,
            "SWDIR:1": 290.0, "SWELL:2": 0.5, "SWPER:2": 18.0, "SWDIR:2": 205.0, "WVHGT": 0.7, "WVPER": 6.0,
            "WVDIR": 300.0}
    lats = [round(lat - 0.25 + 0.25 * i, 2) for i in range(3)]
    lngs = [round(lng - 0.25 + 0.25 * j, 2) for j in range(3)]
    assert set(keys) <= set(vals) and gw.PART_KEYS
    return dict({"lats": lats, "lngs": lngs}, **{k: [[vals[k]] * 3 for _ in lats] for k in keys})


@pytest.mark.asyncio
async def test_the_harness_replays_the_arm_at_the_buoy_and_keeps_the_bulk_instrument_off(clean):
    from datetime import datetime, timezone
    from services.weather_pipeline import eval_gfswave as gw
    from services.weather_pipeline import eval_replay as rp
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    cyc, valid = datetime(2026, 10, 5, tzinfo=timezone.utc), datetime(2026, 10, 6, tzinfo=timezone.utc)
    spot = {"name": "Blacks Beach", "lat": BLACKS[0], "lng": BLACKS[1]}
    prods = gw.products(_crop(*BLACKS, ("HTSGW", "PERPW", "DIRPW", "U", "V")), cyc, valid)
    prods["kread"] = {"socal": dict(gw.layer_products(_crop(32.0, -119.8, ("HTSGW", "PERPW", "DIRPW") + gw.PART_KEYS),
                                                      cyc, valid), _at=(32.0, -119.8))}
    geom = resolve_surf_geometry(32.95654, -117.27956)

    async def one():
        gaps = {g: 0 for g in rp.GAPS}
        return await rp.replay_one(prods, spot, valid, gaps, geom, 17.0, "153p1")
    clean.setenv("SURF_SPECTRAL_K", "0")
    off = await one()
    clean.setenv("SURF_SPECTRAL_K", "1")
    on = await one()
    rr = rp.ReplayResolver(prods, {g: 0 for g in rp.GAPS})
    tr = await rr._resolve_raw("GFS", "swell_1", 32.0, -119.8, "2026-10-06T00:00:00Z")
    assert tr.point.speed == pytest.approx(1.3) and tr.point.period == pytest.approx(14.0)
    assert await rr._resolve_raw("GFS", "swell_1", 32.5, -119.8, "2026-10-06T00:00:00Z") is None
    want = await S.station_hs("GFS", "153p1", 17.0, "2026-10-06T00:00:00Z", rr._resolve_raw)
    assert on["hs_station_m"] == pytest.approx(round(want, 4)) and on["hs_station_m"] != off["hs_station_m"]
    assert on["outputs"]["surf_height_m"] != off["outputs"]["surf_height_m"], "Blacks is covered: the spot moves too"


def test_a_point_is_a_covered_spot_only_inside_the_match_radius(clean):
    t = S.load_table()
    spots = [e for e in t["entries"] if e["kind"] == "spot"]
    for e in spots[:8]:
        assert S.entry_for_point(e["lat"], e["lng"], t)["key"] == e["key"]
    near_miss = next(((e["lat"], e["lng"] + d) for e in spots for d in (0.005, -0.005, 0.007, -0.007)
                      if 0.35 < S._km(e["lat"], e["lng"] + d, e["lat"], e["lng"]) < 0.9
                      and min(S._km(e["lat"], e["lng"] + d, x["lat"], x["lng"]) for x in spots) > S.SPOT_MATCH_KM), None)
    assert near_miss and S.entry_for_point(*near_miss, t) is None


def test_wind_sea_spreads_wider_than_swell_and_k_sees_the_difference():
    assert K.SPREAD_S == {"swell": 25.0, "windsea": 10.0}
    swl = np.zeros((10, 72))
    sea = np.zeros((17, 72))
    sea[:, 53] = swl[:, 53] = 1.0                      # only the 270-deg bin transfers
    T = K.Transfer(swl, sea, SF, QF, 10.0)
    as_sea = K.nearshore_sea([{"h": 1.0, "tp": 6.0, "dir": 270.0, "kind": "windsea"}], T)["hs"]
    as_swell = K.nearshore_sea([{"h": 1.0, "tp": 6.0, "dir": 270.0, "kind": "swell"}], T)["hs"]
    assert as_sea < as_swell, "a wider wind sea puts less of its energy in the one open bin"
