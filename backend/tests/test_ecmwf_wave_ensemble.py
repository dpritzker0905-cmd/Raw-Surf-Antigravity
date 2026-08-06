"""The `waef` wave-ensemble request, and the spread reducer that refuses to guess.

`services/ecmwf_opendata_fetcher.py`. Both functions under test are PURE, which is the whole point:
`ecmwf.opendata` is not importable on a dev workstation and pygrib needs a Linux wheel, so the only
thing that can be verified anywhere is the DECISION — which stream, which type, which members. A
request built inside the I/O call could only be asserted about by reading source.

The load-bearing test here is the CONTROL: with the flag off, the request must be byte-identical to
what this module sent before the ensemble existed. A new lane bolted onto a working fetcher is only
safe if the old path is provably untouched.
"""
import os
import sys
from pathlib import Path

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.ecmwf_opendata_fetcher import (  # noqa: E402
    ENSEMBLE_MEMBERS_MAX,
    ENSEMBLE_STREAM,
    retrieve_spec,
    spread_from_members,
    wave_ensemble_members,
)

STEPS = [0, 3, 6]
WAVE_PARAMS = ["swh", "mwp", "pp1d", "mwd"]


# ── THE CONTROL: the deterministic path must not move ───────────────────────────────────────────

def test_with_the_flag_OFF_the_request_is_BYTE_IDENTICAL_to_the_legacy_call(monkeypatch):
    """This is the test that makes the change safe. The literal below is the kwargs the module sent
    before `retrieve_spec` existed — `type='fc', stream=LAYER_STREAM[layer], levtype='sfc',
    param=params, step=steps`. If this drifts, the deterministic EURO wave lane has moved."""
    monkeypatch.delenv("ECMWF_WAVE_ENSEMBLE", raising=False)
    assert retrieve_spec("waves", WAVE_PARAMS, STEPS) == {
        "type": "fc", "stream": "wave", "levtype": "sfc",
        "param": ["swh", "mwp", "pp1d", "mwd"], "step": [0, 3, 6],
    }


@pytest.mark.parametrize("layer,stream", [("wind", "oper"), ("pressure", "oper")])
def test_the_flag_cannot_reach_a_NON_WAVE_layer(monkeypatch, layer, stream):
    """A wave-ensemble switch that silently rerouted wind or pressure would be a coverage defect
    dressed as a feature. Even switched ON, only `waves` may change."""
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE", "1")
    spec = retrieve_spec(layer, ["10u"], STEPS)
    assert spec["type"] == "fc" and spec["stream"] == stream
    assert "number" not in spec


# ── the ensemble request ────────────────────────────────────────────────────────────────────────

def test_the_flag_ON_switches_exactly_THREE_fields_and_no_others(monkeypatch):
    """type fc->pf, stream wave->waef, plus `number`. Anything else changing means the ensemble
    request has drifted away from the deterministic one it must otherwise mirror."""
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE", "1")
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE_MEMBERS", "10")
    off = {"type": "fc", "stream": "wave", "levtype": "sfc",
           "param": list(WAVE_PARAMS), "step": list(STEPS)}
    on = retrieve_spec("waves", WAVE_PARAMS, STEPS)
    assert on["type"] == "pf"
    assert on["stream"] == ENSEMBLE_STREAM == "waef"
    assert on["number"] == list(range(1, 11))
    # everything else identical
    assert {k: v for k, v in on.items() if k not in ("type", "stream", "number")} == \
           {k: v for k, v in off.items() if k not in ("type", "stream", "number")}


@pytest.mark.parametrize("requested,expected_n", [
    ("1", 2),                       # the floor — see below
    ("0", 2),
    ("-5", 2),
    ("10", 10),
    ("50", 50),
    ("999", ENSEMBLE_MEMBERS_MAX),  # priced ceiling: 50 members of swh is 40.7 MB/step
    ("not-a-number", 10),           # malformed -> the priced default, never a crash
])
def test_member_count_is_CLAMPED_and_never_below_two(monkeypatch, requested, expected_n):
    """⛔ THE FLOOR OF 2 IS THE POINT. One member yields sd 0.0, and 0.0 reads as UNANIMITY — the
    most confident answer the scale can express — when it actually means 'not sampled'."""
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE_MEMBERS", requested)
    assert wave_ensemble_members() == expected_n


def test_members_are_a_CONTIGUOUS_run_starting_at_1(monkeypatch):
    """ECMWF numbers perturbed members 1..50; 0 is the control and lives on a different type."""
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE", "1")
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE_MEMBERS", "4")
    assert retrieve_spec("waves", WAVE_PARAMS, STEPS)["number"] == [1, 2, 3, 4]


# ── the spread reducer ──────────────────────────────────────────────────────────────────────────

def test_spread_REFUSES_below_two_members_rather_than_returning_zero():
    """The defect this closes: sd([x]) is 0.0, which is indistinguishable from perfect agreement.
    A check that cannot tell 'not sampled' from 'unanimous' must refuse (standing rule 27)."""
    assert spread_from_members([]) is None
    assert spread_from_members(None) is None
    assert spread_from_members([1.4]) is None
    assert spread_from_members([1.4, None]) is None, "one finite value is still one member"


def test_spread_computes_mean_sd_and_n_over_the_FINITE_members_only():
    got = spread_from_members([1.0, 2.0, 3.0])
    assert got is not None
    mean, sd, n = got
    assert (mean, n) == (2.0, 3)
    assert sd == pytest.approx((2.0 / 3.0) ** 0.5)      # population sd


def test_spread_drops_None_and_NaN_but_still_counts_what_survived():
    got = spread_from_members([1.0, None, float("nan"), 3.0])
    assert got is not None
    mean, sd, n = got
    assert (mean, n) == (2.0, 2), "n must report the members ACTUALLY used, not those offered"
    assert sd == pytest.approx(1.0)


def test_identical_members_give_zero_spread_which_is_a_REAL_answer_at_n_ge_2():
    """Zero spread from 2+ members means the members agree — that is a finding. Zero from one
    member means nothing. Same number, different claim; only the n distinguishes them."""
    got = spread_from_members([1.5, 1.5, 1.5])
    assert got == (1.5, 0.0, 3)
