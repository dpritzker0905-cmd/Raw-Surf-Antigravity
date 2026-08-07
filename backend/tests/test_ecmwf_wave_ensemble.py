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


# ── THE DECODE HALF (2026-08-07) ────────────────────────────────────────────────────────────────
# `3a95f9a1` wired the REQUEST and the REDUCER and said plainly that the decode had no member axis:
# `by[rid][kind][vt] = vals` ASSIGNS, and every member shares a shortName and a validDate, so member
# 50 overwrote 1..49 and was served as if deterministic. These pin the fix.
#
# ⭐ TWO FACTS BELOW WERE MEASURED, NOT ASSUMED — key probe run 31134428972, 3 members of one step:
#     perturbationNumber / number  VARIED 1..3     <- the discriminators
#     ensembleMember               <absent>        <- the name one would naturally guess. Wrong.
#     shortName / validDate        CONSTANT        <- this IS the overwrite, proven
#     arrival order                msg0=member2, msg1=member1, msg2=member3   <- OUT OF ORDER

def test_members_arriving_out_of_order_are_not_mislabelled():
    """The probe measured msg 0 carrying member 2. Keying by the member id must make arrival
    order irrelevant — a positional decode would silently attribute one member's sea to another."""
    from services.ecmwf_opendata_fetcher import reduce_member_values

    in_order = {1: [1.0, 10.0], 2: [2.0, 20.0], 3: [3.0, 30.0]}
    shuffled = {2: [2.0, 20.0], 3: [3.0, 30.0], 1: [1.0, 10.0]}
    assert reduce_member_values(in_order) == reduce_member_values(shuffled), (
        "the reduction depends on insertion order — with messages arriving out of order that is a "
        "silent mislabelling, not a rounding difference")


def test_the_mean_is_the_per_point_mean_across_members():
    from services.ecmwf_opendata_fetcher import reduce_member_values
    means, sds, counts = reduce_member_values({1: [1.0, 4.0], 2: [3.0, 8.0]})
    assert means == [2.0, 6.0]
    assert counts == [2, 2]
    assert sds[0] == pytest.approx(1.0) and sds[1] == pytest.approx(2.0)


def test_the_spread_refuses_below_two_members_but_the_mean_does_not():
    """⭐ DIFFERENT QUESTIONS, DIFFERENT REFUSAL THRESHOLDS.

    A mean is answerable from one finite member — it is still the best estimate available. A SPREAD
    is not: one member yields sd 0.0, which reads as perfect agreement, the most confident answer the
    scale can express, when it means 'not sampled'. Collapsing the two would reintroduce exactly the
    conflation `spread_from_members` was written to refuse.
    """
    from services.ecmwf_opendata_fetcher import reduce_member_values
    means, sds, counts = reduce_member_values({1: [5.0], 2: [float("nan")]})
    assert means == [5.0], "the mean should still be answerable from the one finite member"
    assert sds == [None], "sd from a single member must be None, never 0.0"
    assert counts == [1]


def test_a_point_no_member_saw_is_nan_and_never_zero():
    """0.0 would claim a calm sea where there was no observation."""
    from services.ecmwf_opendata_fetcher import reduce_member_values
    means, sds, counts = reduce_member_values({1: [float("nan")], 2: [None]})
    assert means[0] != means[0], f"expected NaN for an unobserved point, got {means[0]!r}"
    assert sds == [None] and counts == [0]


def test_ragged_member_series_do_not_crash_or_silently_truncate():
    """Members are separate downloads; one arriving short must not shorten every other member."""
    from services.ecmwf_opendata_fetcher import reduce_member_values
    means, _sds, counts = reduce_member_values({1: [1.0, 2.0, 3.0], 2: [1.0]})
    assert len(means) == 3, "the reduction truncated to the shortest member"
    assert counts == [2, 1, 1]


def test_the_decode_accumulates_by_member_instead_of_assigning():
    """STRUCTURAL: the defect was a bare assignment. Pin that the ensemble branch accumulates into a
    member-keyed dict, so it cannot regress to `by[rid][kind][vt] = vals` under the flag."""
    import ast, os as _os
    p = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                      "services", "ecmwf_opendata_fetcher.py")
    src = open(p, encoding="utf-8").read()
    assert "ens.setdefault(rid, {}).setdefault(kind, {}).setdefault(vt, {})[member] = vals" in src, (
        "the member-keyed accumulation is gone — with the flag on, members overwrite each other again")
    tree = ast.parse(src)
    assert any(isinstance(n, ast.FunctionDef) and n.name == "reduce_member_values"
               for n in ast.walk(tree)), "reduce_member_values was removed"


def test_the_member_id_is_read_from_the_MEASURED_keys():
    """`ensembleMember` was measured <absent>; reading it would yield None for every message and
    skip the whole ensemble. Pin that the code reads the keys that actually carry the number."""
    import os as _os
    p = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                      "services", "ecmwf_opendata_fetcher.py")
    src = open(p, encoding="utf-8").read()
    assert '("perturbationNumber", "number")' in src, (
        "the member discriminator is no longer the pair measured present on real messages")
