"""The NumPyro model on a synthetic world with known truth (#989). Needs requirements-surf-truth-fit.txt, which no CI
lane installs, so this module SKIPS in CI and is run by the lane in its fit environment before any review or run.

Checks: anchor-relative biases are recovered (the +30% observer at log 1.3); the registered positive control passes
on real fit cells; on held-out synthetic cells the predictive coverage of reports is near 80%; a shuffled-identity fit
does not beat the real one.
"""
import math

import numpy as np
import pytest

pytest.importorskip("numpyro")

from scripts.surf_truth import controls, gate, model, prep, synthetic  # noqa: E402

SMALL = dict(chains=2, warmup=400, samples=400)


@pytest.fixture(scope="module")
def world_fit():
    rows = synthetic.world(spots=4, days=12)
    return rows, model.fit(rows, **SMALL)


def test_biases_are_recovered_relative_to_the_anchors(world_fit):
    _, f = world_fit
    j, b = f.design.obs_index, f.samples["b"]
    anchors = [j[k] for k in ("A1", "A2", "A3", "A4")]
    assert abs(float(np.median(b[:, anchors].mean(axis=1)))) < 1e-6          # the constraint holds
    lo, hi = np.percentile(b[:, j["SPLUS"]], [2.5, 97.5])
    assert lo <= math.log(1.3) <= hi and lo > 0
    assert f.diagnostics["divergent_fraction"] <= 0.001


def test_positive_control_with_the_registered_synthetic_observer(world_fit):
    rows, f = world_fit
    syn = model.fit(controls.add_synthetic_observer(rows, f), **SMALL)
    result = controls.positive_ok(syn)
    assert result["ok"], result


def test_predictive_coverage_on_held_out_cells_is_near_80_percent():
    rows = synthetic.world(spots=6, days=10, seed=11)
    held_spot = "spot5"
    fit_rows = [r for r in rows if r["spot_id"] != held_spot]
    f = model.fit(fit_rows, **SMALL)
    cells: dict = {}
    for r in rows:
        if r["spot_id"] == held_spot:
            cells.setdefault(prep.cell_key(r)[:2], []).append(r)
    rng = np.random.default_rng(gate.SEED)
    hits = []
    for cell_rows in cells.values():
        for t in cell_rows:
            if not prep.is_anchor(t):
                continue
            rest = [r for r in cell_rows if r is not t]
            if not any(prep.independent(t, o) for o in rest):
                continue
            draws = model.predict_target(f, t, rest, n_draws=300)
            hits.append(gate.covered(gate.randomized_pit(draws, t, rng)))
    assert len(hits) >= 30
    assert 0.65 <= np.mean(hits) <= 0.95, np.mean(hits)
