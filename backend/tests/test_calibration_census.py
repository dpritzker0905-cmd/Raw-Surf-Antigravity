"""Guards for the Forecast Calibration Census (2026-08-01).

Both scripts are pure over their inputs once the blob is fetched, so everything below runs with no
network. What is pinned here is not arithmetic — it is the two design decisions that make these
instruments worth having, either of which a later "simplification" would quietly remove:

  1. PSI IS BLIND TO A PERMUTATION, so per-spot drift is not redundant with it.
  2. FRESHNESS PAGES ON A SHARE, NOT ON THE WORST SPOT, so a transient cannot cry wolf.
"""
import importlib.util
import os
import random
from datetime import datetime, timedelta, timezone

import pytest

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")


def _load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SCRIPTS, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


drift = _load("climatology_drift_census")
fresh = _load("served_freshness_census")


# ── 1. THE DRIFT CENSUS ─────────────────────────────────────────────────────────────────────────

def _refs(n=400, seed=3):
    rnd = random.Random(seed)
    return {f"spot-{i}": round(rnd.uniform(0.4, 3.4), 3) for i in range(n)}


def test_psi_is_zero_against_itself():
    h = drift.histogram(list(_refs().values()))
    assert drift.psi(h, h) == 0.0


def test_psi_catches_a_global_shift():
    r = _refs()
    base = drift.histogram(list(r.values()))
    shifted = drift.histogram([v * 1.6 for v in r.values()])
    assert drift.psi(base, shifted) >= drift.PSI_CRITICAL


def test_PSI_IS_BLIND_TO_A_PERMUTATION_and_per_spot_drift_is_not():
    """⚠️⚠️ THE REASON THIS CENSUS HAS TWO SIGNALS INSTEAD OF ONE.

    If Florida's reference and Pipeline's were exchanged, the DISTRIBUTION would be byte-identical
    and PSI would read 0.000 — while every rating in both places became nonsense. That is the exact
    inversion the rollout plan named exemplars to catch, and it is what an aggregate cannot see.
    Deleting the per-spot half because "PSI already covers drift" would reopen it.
    """
    r = _refs()
    keys, vals = list(r), [r[k] for k in r]
    random.Random(11).shuffle(vals)
    permuted = dict(zip(keys, vals))

    h_base = drift.histogram(list(r.values()))
    assert drift.psi(h_base, drift.histogram(list(permuted.values()))) == 0.0, (
        "a permutation must leave the distribution — and therefore PSI — untouched; that is the "
        "premise of this test, not an accident of the fixture"
    )
    moved = drift.compare({"references": r}, permuted)
    assert moved["moved_share_pct"] >= drift.SPOT_MOVE_SHARE_PCT, (
        "per-spot drift is the ONLY signal that sees a permutation"
    )


def test_a_quiet_refresh_moves_neither_signal():
    """Hysteresis has to be real in both directions: the healthy case must stay green, or the gate
    is a permanent red and gets muted."""
    r = _refs()
    jittered = {k: v * (1 + random.Random(5).uniform(-0.02, 0.02)) for k, v in r.items()}
    assert drift.psi(drift.histogram(list(r.values())),
                     drift.histogram(list(jittered.values()))) < drift.PSI_WARN
    assert drift.compare({"references": r}, jittered)["moved_share_pct"] < drift.SPOT_MOVE_SHARE_PCT


def test_psi_survives_an_empty_bin():
    """A zero-count bin must not send the statistic to infinity — the floor is deliberate, and
    dropping the bin instead would hide exactly the tail movement worth seeing."""
    a = drift.histogram([0.6] * 100)
    b = drift.histogram([3.2] * 100)
    v = drift.psi(a, b)
    assert v == v and v != float("inf") and v > drift.PSI_CRITICAL


def test_compare_reports_added_and_dropped_spots():
    base, live = _refs(50), _refs(50)
    live["spot-new"] = 1.0
    live.pop("spot-0")
    out = drift.compare({"references": base}, live)
    assert out["added"] == 1 and out["dropped"] == 1


# ── 2. THE FRESHNESS CENSUS ─────────────────────────────────────────────────────────────────────

NOW = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)


def _blob(ages_h, n_spots):
    runs = [[(NOW - timedelta(hours=h)).isoformat().replace("+00:00", "Z")] * 2 for h in ages_h]
    spots = [{"name": f"s{i}", "run": i % len(ages_h)} for i in range(n_spots)]
    return {"frames": [{"runs": runs, "spots": spots, "valid_time": "2026-08-01T12:00:00Z"}]}


def test_collect_expands_the_interned_run_table():
    """`frame['runs']` is [[marine, wind], ...] and each spot carries an integer index — the
    interning that keeps ~20 products off ~900 spots. A census that read `spot['run_time']`
    directly would find NOTHING and report a clean zero, which is how this was first written."""
    rows = fresh.collect(_blob([3.0], 5), NOW)
    assert len(rows) == 10                      # 5 spots x (marine, wind)
    assert {k for _, k, _, _ in rows} == {"marine", "wind"}
    assert all(abs(a - 3.0) < 1e-6 for a, _, _, _ in rows)


def test_a_single_stale_spot_does_NOT_breach_the_share_budget():
    """★ The recorded case: one spot served a ~2-day-old run and healed within hours. Operational
    guidance is to alert on sustained consumption, not momentary blips — a gate keyed on the worst
    spot would have paged on that and then been muted before the systemic case ever arrived."""
    rows = fresh.collect(_blob([3.0] * 99 + [50.0], 100), NOW)
    s = fresh.summarize(rows, fresh.DEFAULT_CRITICAL_H)
    assert s["over_critical_pct"] <= fresh.DEFAULT_CRITICAL_SHARE_PCT


def test_a_systemic_stall_DOES_breach_it():
    rows = fresh.collect(_blob([3.0] * 9 + [60.0], 100), NOW)
    s = fresh.summarize(rows, fresh.DEFAULT_CRITICAL_H)
    assert s["over_critical_pct"] > fresh.DEFAULT_CRITICAL_SHARE_PCT


def test_an_empty_blob_is_not_a_healthy_one():
    assert fresh.collect({"frames": []}, NOW) == []


def test_a_run_index_out_of_range_is_skipped_not_crashed():
    blob = _blob([3.0], 3)
    blob["frames"][0]["spots"].append({"name": "bad", "run": 99})
    assert len(fresh.collect(blob, NOW)) == 6


@pytest.mark.parametrize("stamp", [None, "", "not-a-date", 12345])
def test_an_unparseable_stamp_yields_no_sample_rather_than_a_zero_age(stamp):
    """A malformed stamp must not silently read as age 0 — that would make a broken lane look like
    the freshest one in the census."""
    assert fresh._age_h(stamp, NOW) is None
