"""SURF_NEARSHORE_LITE: default OFF and byte-identical; ON replaces ONLY Kr and exposure; honest coverage; registry parity."""
import numpy as np
import pytest

from routes.admin.surf_forecast import _RATING_FLAGS
from scripts import flag_guardrail as fg
from services import runtime_flags as rf
from services.weather_pipeline import surf_transform as st
from services.weather_pipeline.nearshore_lite import coefficients as coef
from services.weather_pipeline.nearshore_lite.ray_trace import DepthGrid, trace_target

FLAG = "SURF_NEARSHORE_LITE"
PARTS = [{"h": 2.0, "tp": 12.0, "dir": 275.0, "kind": "swell"}, {"h": 1.0, "tp": 7.0, "dir": 250.0, "kind": "windsea"}]
KW = dict(depth_m=40.0, coastal=True, shelf_width_km=20.0, shore_normal_deg=270.0, break_depth_m=8.0)


def _table():
    x = np.arange(320) * 25.0
    x0 = 314 * 25.0
    h = np.tile((0.02 * (x0 - x))[None, :], (440, 1))
    h[h < 0.5] = np.nan
    f = np.array([0.08, 0.09, 0.10, 0.11, 0.12, 0.14, 0.16])
    t = trace_target(DepthGrid(h, 25.0), x0 - 8.0 / 0.02, 5500.0, freqs=f)
    return coef.Table(coef.build_payload("plane", t, {}))


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)


def test_registered_default_off_in_every_registry():
    assert rf.GUARDED[FLAG] == "0" and rf.FIX_VERSION[FLAG]
    assert _RATING_FLAGS[FLAG][0] == "0"
    assert fg.coverage(FLAG)[0] == fg.BLIND          # honest: the replay has no coefficient tables


def test_off_is_byte_identical_even_with_a_table_supplied():
    base = st.estimate_surf_partitioned(PARTS, **KW)
    assert st.estimate_surf_partitioned(PARTS, lite_table=_table(), **KW) == base
    assert st.estimate_surf(2.0, 12.0, 40.0, swell_from_deg=275.0, shore_normal_deg=270.0, lite_kr=0.5) == \
        st.estimate_surf(2.0, 12.0, 40.0, swell_from_deg=275.0, shore_normal_deg=270.0)


def test_on_without_a_table_changes_nothing(monkeypatch):
    base = st.estimate_surf_partitioned(PARTS, **KW)
    monkeypatch.setenv(FLAG, "1")
    assert st.estimate_surf_partitioned(PARTS, **KW) == base


def test_on_with_a_table_moves_the_height_and_replaces_only_kr_and_exposure(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    h_kw = dict(swell_from_deg=275.0, shore_normal_deg=270.0)
    # the factor replaces REFRACTION_KR x exposure and nothing else: lite_kr = Kr * exposure reproduces the baseline
    baseline, _ = st.estimate_surf(2.0, 12.0, 40.0, shelf_width_km=20.0, **h_kw)
    equivalent = st.REFRACTION_KR * st._height_exposure_factor(275.0, 270.0)
    same, _ = st.estimate_surf(2.0, 12.0, 40.0, shelf_width_km=20.0, lite_kr=equivalent, **h_kw)
    assert same == pytest.approx(baseline, rel=1e-9)
    half, _ = st.estimate_surf(2.0, 12.0, 40.0, shelf_width_km=20.0, lite_kr=0.5 * equivalent, **h_kw)
    assert half < baseline
    on, _ = st.estimate_surf_partitioned(PARTS, lite_table=_table(), **KW)
    monkeypatch.delenv(FLAG)
    off, _ = st.estimate_surf_partitioned(PARTS, **KW)
    assert on != off


def test_a_sheltered_partition_carries_zero_energy_not_the_constants(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    from_land = [{"h": 2.0, "tp": 12.0, "dir": 90.0, "kind": "swell"}]            # from the shore side: R = 0
    h, _ = st.estimate_surf_partitioned(from_land, lite_table=_table(), **KW)
    monkeypatch.delenv(FLAG)
    constants, _ = st.estimate_surf_partitioned(from_land, **KW)
    assert constants > 0.3                                                        # the constants would have served a height
    assert h is None or h < 0.01 * constants                                      # LITE: only spreading-tail energy (< 1%)


def test_partition_kr_is_the_table_ratio_over_the_chains_own_shoaling():
    tab = _table()
    r = tab.apply_partition(2.0, 12.0, 270.0, "swell")
    ks = st.shoaling_coefficient(12.0, tab.depth_t_m)
    assert coef.partition_kr(tab, 2.0, 12.0, 270.0, "swell", ks) == pytest.approx(r["ratio"] / ks)
    assert coef.partition_kr(tab, 2.0, 12.0, 270.0, "swell", 0.0) is None
