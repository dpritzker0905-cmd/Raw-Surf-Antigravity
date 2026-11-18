"""L1 wave-ensemble instrument (scripts/wave_emos_core.py, scripts/wave_l1_score.py): closed forms, the rolling-fit
data rule, the controls, and two synthetic end-to-end runs (an informative ensemble passes; an uninformative one does
not). Offline: nothing is fetched."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wave_emos_core as W  # noqa: E402
import wave_l1_score as S  # noqa: E402
from emos_core import crps_ensemble  # noqa: E402


def test_crps_lognormal_matches_monte_carlo():
    rng = np.random.default_rng(1)
    for mu, sg, y in ((0.3, 0.4, 1.1), (1.0, 0.2, 2.0), (-0.5, 0.6, 0.2)):
        x = np.exp(mu + sg * rng.standard_normal(400_000))
        mc = np.mean(np.abs(x - y)) - 0.5 * np.mean(np.abs(x - rng.permutation(x)))
        assert W.crps_lognormal(mu, sg, y) == pytest.approx(mc, abs=4e-3)


def test_weighted_ensemble_crps_equals_unweighted_for_equal_weights():
    rng = np.random.default_rng(2)
    X, y = rng.gamma(2.0, 1.0, size=(50, 9)), rng.gamma(2.0, 1.0, size=50)
    got = W.crps_weighted_ensemble(X, np.full(9, 1 / 9), y)
    assert np.allclose(got, crps_ensemble(X.T, y), atol=1e-12)


def test_lead_bins():
    assert list(W.lead_bin([24, 47, 48, 216, 239, 240, 264])) == [24, 24, 48, 216, 216, 216, 264]


def test_training_mask_rules():
    D = np.datetime64("2026-01-08T00", "h")
    valid = np.array(["2025-09-30T00", "2025-12-01T00", "2026-01-07T18", "2026-01-07T18", "2026-01-08T00"],
                     "datetime64[h]")
    pub = np.array(["2025-09-20T00", "2025-11-25T00", "2026-01-01T00", "2026-01-08T06", "2026-01-01T00"],
                   "datetime64[h]")
    # before FIT_START; inside; inside; published after D; valid at D (not before)
    assert list(W.training_mask(D, valid, pub)) == [False, True, True, False, False]
    # an upgrade on 2025-12-15 restarts the window
    assert list(W.training_mask(D, valid, pub, ["2025-12-15T00"])) == [False, False, True, False, False]


def test_derangement_never_keeps_own_buoy():
    valid = np.array(["2026-01-01T00"] * 3 + ["2026-01-01T06"] * 2 + ["2026-01-01T12"], "datetime64[h]")
    lead = np.array([48, 48, 48, 48, 48, 48])
    buoy = np.array(["a", "b", "c", "a", "b", "a"])
    j = S.derange_index(valid, lead, buoy)
    assert j[-1] == -1
    for i in range(5):
        assert buoy[j[i]] != buoy[i] and valid[j[i]] == valid[i]


def test_null_crpss_is_exactly_zero():
    rng = np.random.default_rng(3)
    c = rng.gamma(2.0, 0.2, 500)
    v = S.TEST_START + np.arange(500).astype("timedelta64[h]") * 6
    r = S.crpss(c, c, S.block_ids(v, 10))
    assert r["crpss"] == 0.0 and r["ci"] == [0.0, 0.0]


def _synthetic(informative: bool, seed=7):
    """Six buoys, two per basin, 00/12 UTC valid times from 2025-10-01 to 2026-07-01, leads 48/96/168 h. Truth is a
    per-buoy AR(1) log-Hs; the ensembles see the truth with a flow-dependent error whose size each row's spread
    announces (informative) or carry no information about it (uninformative). R1 is the truth plus a fixed error."""
    rng = np.random.default_rng(seed)
    buoys = [("p1", "pacific"), ("p2", "pacific"), ("a1", "atlantic_gulf"), ("a2", "atlantic_gulf"),
             ("h1", "hawaii"), ("h2", "hawaii")]
    times = np.arange(np.datetime64("2025-10-01T00", "h"), np.datetime64("2026-07-01T00", "h"),
                      np.timedelta64(12, "h"))
    rows = {k: [] for k in ("valid", "init", "published", "lead_h", "buoy", "basin", "y", "gefs", "ecmwf", "r1")}
    hist = {}
    for b, basin in buoys:
        z = np.zeros(len(times))
        for t in range(1, len(times)):
            z[t] = 0.9 * z[t - 1] + 0.25 * rng.standard_normal()
        logy = 0.5 + z
        # arm C history: a full pre-TEST year (the real panel history starts 2025-01-01), from the same process
        ht = np.arange(np.datetime64("2025-01-01T00", "h"), S.TEST_START, np.timedelta64(12, "h"))
        hz = np.zeros(len(ht))
        for t in range(1, len(ht)):
            hz[t] = 0.9 * hz[t - 1] + 0.25 * rng.standard_normal()
        hist[b] = (ht, np.exp(0.5 + hz))
        for lead in (48, 96, 168, 288):
            s = 0.08 + 0.35 * rng.random(len(times))                     # the row's true error SD
            err = s * rng.standard_normal(len(times))
            centre = logy + err if informative else logy + 0.3 * rng.standard_normal(len(times))
            spread = s if informative else 0.08 + 0.35 * rng.random(len(times))
            g = np.exp(centre[:, None] + 0.05 + spread[:, None] * rng.standard_normal((len(times), 31)))
            e = np.exp(centre[:, None] - 0.03 + spread[:, None] * rng.standard_normal((len(times), 50)))
            r1 = np.exp(logy + 0.3 * rng.standard_normal(len(times)))
            init = times - np.timedelta64(lead, "h")
            rows["valid"].append(times)
            rows["init"].append(init)
            rows["published"].append(init + np.timedelta64(7, "h"))
            rows["lead_h"].append(np.full(len(times), lead))
            rows["buoy"].append(np.full(len(times), b))
            rows["basin"].append(np.full(len(times), basin))
            rows["y"].append(np.exp(logy))
            rows["gefs"].append(g)
            rows["ecmwf"].append(e)
            rows["r1"].append(r1)
    T = {k: np.concatenate(v) for k, v in rows.items()}
    return T, hist


@pytest.fixture
def fast(monkeypatch):
    monkeypatch.setattr(W, "REFIT_DAYS", 28)
    monkeypatch.setattr(W, "MIN_FIT_ROWS", 60)
    monkeypatch.setattr(S, "N_BOOT", 400)


def test_end_to_end_informative_ensemble_passes(fast):
    T, hist = _synthetic(informative=True)
    r = S.score(T, hist)
    assert r["void_reasons"] == [], r["void_reasons"]
    assert r["verdict"].startswith("PASS"), r["lines"]["G1_pooled"]
    assert r["lines"]["G1_pooled"]["blocks10"]["crpss"] > 0.05
    # here most of the gain is a mean correction: the spread term is real (CI > 0) but the shuffled-spread E2 keeps
    # more than half the gain, so the registered consequence (amendment 2) ships the constant-spread form
    rep = r["reported"]
    assert rep["spread_term_fitted_vs_constant"]["ci"][0] > 0
    assert rep["E2_shuffled_spread_vs_R2"]["crpss"] >= 0.5 * r["lines"]["G1_pooled"]["blocks10"]["crpss"]
    assert rep["shipped_form"] == "constant_spread" and "mean correction only" in r["verdict"]
    assert rep["controls"]["halved_spread"]["crps_worse"]
    assert rep["week2_brier_skill_p90_E2_vs_R2"]["n"] > 0          # reported only (288 h is outside the gate)
    assert r["size"]["rows_scored"] == rep["E1_vs_R2"]["n"]


def test_end_to_end_uninformative_ensemble_does_not_pass(fast):
    T, hist = _synthetic(informative=False)
    r = S.score(T, hist)
    assert not r["verdict"].startswith("PASS")
