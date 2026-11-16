"""Truncated-normal EMOS core (scripts/emos_core.py): the CDF, the closed-form CRPS, the fitter."""
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import emos_core as E  # noqa: E402


def test_cdf_and_ppf():
    xs = np.array([-3.0, -1.0, 0.0, 0.5, 2.0])
    want = [0.5 * (1 + math.erf(x / math.sqrt(2))) for x in xs]
    assert np.allclose(E.norm_cdf(xs), want, atol=2e-7)
    assert np.allclose(E.norm_ppf(E.norm_cdf(xs)), xs, atol=1e-5)


def test_crps_tn0_matches_monte_carlo_and_far_from_zero_reduces_to_normal():
    rng = np.random.default_rng(1)
    mu, sig, y = 3.0, 2.0, 4.5
    draws = rng.normal(mu, sig, 400000)
    draws = draws[draws > 0]
    mc = np.mean(np.abs(draws - y)) - 0.5 * np.mean(np.abs(draws[:100000] - draws[100000:200000]))
    assert float(E.crps_tn0(mu, sig, y)) == pytest.approx(mc, abs=0.01)
    # far from 0 the truncation vanishes: the normal CRPS sigma*(z(2Phi-1) + 2phi - 1/sqrt(pi))
    z = (12.5 - 12.0) / 1.0
    normal = z * (2 * E.norm_cdf(z) - 1) + 2 * E.norm_pdf(z) - 1 / math.sqrt(math.pi)
    assert float(E.crps_tn0(12.0, 1.0, 12.5)) == pytest.approx(float(normal), abs=1e-6)


def test_ensemble_crps_matches_definition():
    X = np.array([[1.0], [2.0], [4.0]])
    y = np.array([2.5])
    direct = np.mean(np.abs(X[:, 0] - 2.5)) - 0.5 * np.mean(np.abs(X[:, 0][:, None] - X[:, 0][None, :]))
    assert float(E.crps_ensemble(X, y)[0]) == pytest.approx(direct)


def test_median_and_quantiles_of_tn0():
    assert float(E.median_tn0(10.0, 1.0)) == pytest.approx(10.0, abs=1e-4)
    assert float(E.median_tn0(0.0, 1.0)) == pytest.approx(0.6745, abs=1e-3)   # half-normal median
    assert float(E.quantile_tn0(10.0, 1.0, 0.9)) == pytest.approx(11.2816, abs=1e-3)


def test_fit_recovers_a_biased_underdispersive_ensemble():
    """Truth = 1.5 + 0.8*m + noise(sd 1.6); the ensemble spread says sd 0.8. EMOS must find a~1.5, b~0.8 and a
    larger sigma, and beat the raw ensemble on CRPS."""
    rng = np.random.default_rng(3)
    n = 4000
    m = rng.uniform(2, 14, n)
    s2 = np.full(n, 0.64)
    y = np.maximum(1.5 + 0.8 * m + rng.normal(0, 1.6, n), 0.0)
    theta, crps = E.fit_emos(m, s2, y)
    a, b, c, d = theta
    assert a == pytest.approx(1.5, abs=0.3) and b == pytest.approx(0.8, abs=0.05)
    mu, sig = E.params_to_mu_sigma(theta, m, s2)
    assert float(np.mean(sig)) == pytest.approx(1.6, abs=0.15)
    members = m[None, :] + rng.normal(0, 0.8, (51, n))
    assert crps < float(np.mean(E.crps_ensemble(members, y)))


def test_fit_refuses_tiny_training_sets():
    with pytest.raises(ValueError):
        E.fit_emos(np.ones(5), np.ones(5), np.ones(5))
