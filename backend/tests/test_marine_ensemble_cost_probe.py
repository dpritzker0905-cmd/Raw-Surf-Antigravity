"""
test_ensemble_cost_probe.py — the pure half of the M3 ensemble cost probe.

`scripts/ensemble_cost_probe.py` answers one question before any ensemble work starts: what does
`ifs/waef` cost per cycle against the deterministic stream we fetch today? The NETWORK half needs
ECMWF; the arithmetic half — `summarise` — is pure and is what decides the schedule, so it is
tested here.

Measured live 2026-08-02, cycle 20260802/06z step 0, params swh/mwd/pp1d/mwp:
    deterministic   4 rows      3.7 MB/step     240 MB per 65-step fetch
    ensemble      200 rows    184.9 MB/step  12,015.7 MB per 65-step fetch
    ratio         50.07x, on 50 confirmed members

⇒ a naive full-fidelity M3 ingest is 12 GB per cycle on a 1-CPU box whose ingest lane already runs
at ~82% of its 165-minute timeout. `SURF_PARTITIONS` cost 4x and that was the binding constraint;
this is 50x. The value has to come from a SUBSET, and cost scales linearly in
members x params x steps — which is exactly what `summarise` has to report correctly for anyone to
size that subset.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from ensemble_cost_probe import summarise  # noqa: E402


def _row(param, length, number=None):
    r = {"param": param, "_length": length}
    if number is not None:
        r["number"] = number
    return r


def test_deterministic_shape_has_no_members():
    rows = [_row("swh", 1000), _row("mwd", 2000), _row("ignored", 999999)]
    out = summarise(rows, ("swh", "mwd"))
    assert out["rows"] == 2, "rows outside the requested params were counted"
    assert out["bytes"] == 3000
    assert out["members"] == 0, "a deterministic index has no `number` field — must not fake one"


def test_ensemble_members_are_counted_DISTINCTLY_not_summed():
    """★ The member count is what the whole cost argument turns on. Counting rows instead of
    distinct members would report 50x members for a 2-param fetch and mis-size the subset."""
    rows = [_row("swh", 10, number=n) for n in range(1, 51)]
    rows += [_row("mwd", 20, number=n) for n in range(1, 51)]
    out = summarise(rows, ("swh", "mwd"))
    assert out["members"] == 50, f"expected 50 distinct members, got {out['members']}"
    assert out["rows"] == 100
    assert out["bytes"] == 50 * 10 + 50 * 20


def test_bytes_are_attributed_per_param():
    """Sizing a subset means dropping PARAMS as well as members, so the per-param split has to be
    right — swh-only is the cheapest useful ensemble and its cost must be readable here."""
    rows = [_row("swh", 100, number=1), _row("swh", 100, number=2), _row("mwd", 400, number=1)]
    out = summarise(rows, ("swh", "mwd"))
    assert out["per_param"]["swh"] == {"rows": 2, "bytes": 200}
    assert out["per_param"]["mwd"] == {"rows": 1, "bytes": 400}


def test_a_param_absent_from_the_index_reports_zero_rather_than_vanishing():
    """A silently-dropped param would UNDER-report the cost, which is the dangerous direction: it
    would make an infeasible ingest look affordable."""
    out = summarise([_row("swh", 100, number=1)], ("swh", "pp1d"))
    assert out["per_param"]["pp1d"] == {"rows": 0, "bytes": 0}
    assert set(out["per_param"]) == {"swh", "pp1d"}


def test_missing_length_is_treated_as_zero_not_an_exception():
    """The probe must degrade to a number, not crash mid-measurement — a partial answer with a
    visible zero is auditable, a traceback is not."""
    out = summarise([{"param": "swh", "number": 1}], ("swh",))
    assert out["bytes"] == 0 and out["rows"] == 1
