"""WHEN THE SIZE AND THE QUALITY DISAGREE, THE PAYLOAD MUST SAY SO.

MEASURED 2026-08-04 (MASTER-AUDIT-2.0 section 2). "How much of the swell is aimed at this coast" is
reduced TWICE, with floors 5.95x apart:

    quality  surf_rating.swell_exposure             = 0.10 + 0.90*max(0, cos dtheta)   floor 0.100
    height   surf_transform._height_exposure_factor = 0.55 + 0.45*exposure             floor 0.595

Height scales as sqrt(energy) by its own docstring, so the energy the HEIGHT chain implies at the
floor is 0.354 against the QUALITY chain's 0.100 — 3.54x. On 4 of 4 world-class spots sampled the
served payload said, in one object, "5.3 ft Head High" AND "3.3/100 very_poor", publishing
`swell_alignment_pct: 10` while its own height had used 59.5%.

⛔ THIS DOES NOT FIX THE DISAGREEMENT. Reconciling the floors is a two-sided change gated on the
ERA5 record, and height is currently right BY CANCELLATION. This is step 1 of the audit's own
sequencing — the only step that was never blocked — and the principle behind it is the one this repo
keeps relearning: a number that contradicts its neighbour should say so.

★ THE SHAPE IS `display_adjustment`'s: ABSENT unless it binds. A caveat on every spot is a caveat
nobody reads, so the tests below pin BOTH arms — it fires off-angle and is silent head-on.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import wave_physics as WP                   # noqa: E402

NORMAL = 90.0


def _at(dtheta):
    return WP.directional_conflict(NORMAL + dtheta, NORMAL)


# ── the statistic ───────────────────────────────────────────────────────────────────────────────

def test_head_on_the_two_chains_agree_exactly():
    assert WP.directional_energy_disagreement(NORMAL, NORMAL) == pytest.approx(1.0, abs=1e-6)


def test_past_the_cutoff_the_disagreement_is_the_measured_3_54x():
    for dtheta in (90.0, 100.0, 120.0, 180.0):
        r = WP.directional_energy_disagreement(NORMAL + dtheta, NORMAL)
        assert r == pytest.approx(3.54, abs=0.01), f"dtheta={dtheta} -> {r}"


def test_the_disagreement_grows_monotonically_with_angle():
    seq = [WP.directional_energy_disagreement(NORMAL + d, NORMAL)
           for d in (0, 30, 45, 60, 75, 85, 90)]
    assert all(b >= a - 1e-9 for a, b in zip(seq, seq[1:])), seq


@pytest.mark.parametrize("swell,normal", [(None, 90.0), (90.0, None), (None, None)])
def test_unknown_geometry_reports_nothing_rather_than_a_false_conflict(swell, normal):
    """The engine fails OPEN to 1.0 on both sides when geometry is unknown, so there is genuinely no
    disagreement to report — and inventing one would accuse every blind spot."""
    assert WP.directional_energy_disagreement(swell, normal) is None
    assert WP.directional_conflict(swell, normal) is None


# ── absent unless it binds ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("dtheta", [0.0, 30.0, 45.0, 60.0])
def test_SILENT_when_the_two_chains_broadly_agree(dtheta):
    """The arm that stops this becoming noise. At these angles the chains differ by under 50% in
    implied energy, which is not something to interrupt a forecast about."""
    assert _at(dtheta) is None


@pytest.mark.parametrize("dtheta", [85.0, 90.0, 100.0, 150.0])
def test_FIRES_where_the_payload_would_otherwise_contradict_itself(dtheta):
    c = _at(dtheta)
    assert c is not None, f"no conflict reported at dtheta={dtheta}"
    assert c["reason"] == "size_and_quality_disagree_on_swell_exposure"
    assert c["energy_disagreement"] >= WP.DIRECTIONAL_CONFLICT_MIN


def test_the_block_carries_BOTH_numbers_so_a_reader_can_check_it():
    """A caveat that does not show its working is just a warning label."""
    c = _at(120.0)
    assert c["quality_exposure"] == pytest.approx(0.10, abs=1e-3)
    assert c["height_exposure_factor"] == pytest.approx(0.595, abs=1e-3)
    assert c["height_implied_energy"] == pytest.approx(0.354, abs=1e-3)
    assert c["energy_disagreement"] == pytest.approx(3.54, abs=0.01)
    # and it names which one to distrust
    assert "upper bound" in c["means"]
    assert "35%" in c["means"] and "10%" in c["means"]


# ── ⭐ REACHABILITY: does the SIM payload actually carry it? ─────────────────────────────────────

SPOT = {"latitude": 21.6637, "longitude": -158.0515, "name": "T"}


def _sim(offset_from_normal):
    """Aim the swell RELATIVE to the normal the engine actually resolves.

    ⚠️ An earlier version passed `shore_normal_deg` in the spot dict and assumed it was used. It is
    not: `shore_normal_for` resolves real geometry from the COORDINATES (this spot's normal is
    ~325 deg, not 90), so a swell aimed at 90 was 130 deg off and the 'head-on' control fired
    correctly. The test was wrong, not the code — and a test that hard-codes geometry the engine
    derives is testing its own assumption."""
    from services.weather_pipeline.sim_rating import calculate_surf_rating, shore_normal_for
    normal = shore_normal_for(SPOT)
    assert normal is not None, "setup: this spot must resolve a shore normal, or nothing is tested"
    out = calculate_surf_rating(SPOT, swell_h=2.0, swell_p=12.0,
                                swell_dir=(normal + offset_from_normal) % 360.0,
                                wind_spd=5.0, wind_dir=270.0)
    return out, normal


def test_the_sim_payload_carries_the_conflict_when_the_swell_is_off_angle():
    """A unit test on the helper would pass even if nothing published it — this drives the real
    payload builder, which is the only assertion that can tell 'implemented' from 'wired'."""
    out, _n = _sim(130.0)
    assert "directional_conflict" in out, (
        "the sim reported a height and a quality that disagree, and said nothing about it")
    assert out["directional_conflict"]["energy_disagreement"] >= WP.DIRECTIONAL_CONFLICT_MIN
    # the contradiction it exists to disclose is right there in the same payload
    assert out["breaking_height_ft"] > 0 and out["conditions_label"]
    assert out["swell_alignment_pct"] <= 10


def test_the_sim_payload_is_SILENT_when_the_swell_is_head_on():
    out, _n = _sim(0.0)
    assert "directional_conflict" not in out
    assert out["swell_alignment_pct"] == 100
