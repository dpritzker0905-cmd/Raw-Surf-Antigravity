"""emos_core.py - truncated-normal EMOS for wind speed (Thorarinsdottir & Gneiting 2010), pure numpy. Serves nothing.

Pre-registration: docs/weather-program/log/2026-11-16-wind-emos-preregistration.md (+ amendments). Predictive law:
speed ~ N0(mu, sigma^2), a normal truncated at 0, with mu = a + b*m and sigma^2 = c^2 + d^2*s2 (c, d squared so the
variance stays positive), where m and s2 are the ENS member mean and variance of speed. Fitted by minimum mean CRPS
(closed form) with a small Nelder-Mead. No scipy: the backend's pinned environment has none, so Phi uses
Abramowitz-Stegun 7.1.26 (|error| < 1.5e-7), far below the CRPS differences any gate line reads.
"""
import math
from typing import Callable, Sequence, Tuple

import numpy as np

_SQRT2 = math.sqrt(2.0)
_SQRTPI = math.sqrt(math.pi)


def _erf(x):
    x = np.asarray(x, dtype=float)
    s = np.sign(x)
    a = np.abs(x)
    t = 1.0 / (1.0 + 0.3275911 * a)
    y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-a * a)
    return s * y


def norm_cdf(x):
    return 0.5 * (1.0 + _erf(np.asarray(x, dtype=float) / _SQRT2))


def norm_pdf(x):
    x = np.asarray(x, dtype=float)
    return np.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def norm_ppf(p):
    """Inverse of norm_cdf by bisection (vectorised; 60 halvings)."""
    p = np.clip(np.asarray(p, dtype=float), 1e-12, 1 - 1e-12)
    lo, hi = np.full_like(p, -10.0), np.full_like(p, 10.0)
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        below = norm_cdf(mid) < p
        lo = np.where(below, mid, lo)
        hi = np.where(below, hi, mid)
    return 0.5 * (lo + hi)


def crps_tn0(mu, sigma, y):
    """CRPS of N0(mu, sigma^2) (normal truncated at 0) at observation y (Thorarinsdottir & Gneiting 2010, eq. 5)."""
    mu, sigma, y = (np.asarray(v, dtype=float) for v in (mu, sigma, y))
    sigma = np.maximum(sigma, 1e-6)
    r = mu / sigma
    p = np.maximum(norm_cdf(r), 1e-12)
    z = (y - mu) / sigma
    return sigma / (p * p) * (z * p * (2.0 * norm_cdf(z) + p - 2.0) + 2.0 * norm_pdf(z) * p
                              - norm_cdf(_SQRT2 * r) / _SQRTPI)


def median_tn0(mu, sigma):
    mu, sigma = np.asarray(mu, dtype=float), np.maximum(np.asarray(sigma, dtype=float), 1e-6)
    q0 = norm_cdf(-mu / sigma)
    return np.maximum(mu + sigma * norm_ppf(q0 + 0.5 * (1.0 - q0)), 0.0)


def quantile_tn0(mu, sigma, q):
    mu, sigma = np.asarray(mu, dtype=float), np.maximum(np.asarray(sigma, dtype=float), 1e-6)
    q0 = norm_cdf(-mu / sigma)
    return np.maximum(mu + sigma * norm_ppf(q0 + q * (1.0 - q0)), 0.0)


def crps_ensemble(members, y):
    """CRPS of the raw ensemble as an empirical distribution: E|X-y| - 0.5 E|X-X'| (members along axis 0)."""
    X = np.asarray(members, dtype=float)
    y = np.asarray(y, dtype=float)
    t1 = np.nanmean(np.abs(X - y[None, ...]), axis=0)
    Xs = np.sort(X, axis=0)
    n = Xs.shape[0]
    i = np.arange(1, n + 1, dtype=float).reshape((n,) + (1,) * (X.ndim - 1))
    t2 = np.sum((2 * i - n - 1) * Xs, axis=0) / (n * n)           # 0.5 E|X-X'| via sorted members
    return t1 - t2


def params_to_mu_sigma(theta, m, s2):
    a, b, c, d = theta
    return a + b * m, np.sqrt(c * c + d * d * np.maximum(s2, 0.0))


def nelder_mead(f: Callable[[np.ndarray], float], x0: Sequence[float], step: float = 0.5, iters: int = 400,
                tol: float = 1e-7) -> Tuple[np.ndarray, float]:
    """Plain Nelder-Mead (reflect 1, expand 2, contract 0.5, shrink 0.5)."""
    n = len(x0)
    pts = [np.asarray(x0, dtype=float)]
    for k in range(n):
        p = np.asarray(x0, dtype=float).copy()
        p[k] += step if p[k] == 0 else step * max(abs(p[k]), 1.0)
        pts.append(p)
    vals = [f(p) for p in pts]
    for _ in range(iters):
        order = np.argsort(vals)
        pts = [pts[i] for i in order]
        vals = [vals[i] for i in order]
        if abs(vals[-1] - vals[0]) < tol:
            break
        cen = np.mean(pts[:-1], axis=0)
        xr = cen + (cen - pts[-1])
        fr = f(xr)
        if fr < vals[0]:
            xe = cen + 2.0 * (cen - pts[-1])
            fe = f(xe)
            pts[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            pts[-1], vals[-1] = xr, fr
        else:
            xc = cen + 0.5 * (pts[-1] - cen)
            fc = f(xc)
            if fc < vals[-1]:
                pts[-1], vals[-1] = xc, fc
            else:
                pts = [pts[0] + 0.5 * (p - pts[0]) for p in pts]
                vals = [f(p) for p in pts]
    k = int(np.argmin(vals))
    return pts[k], float(vals[k])


def fit_emos(m, s2, y, x0=(0.0, 1.0, 1.0, 1.0)) -> Tuple[np.ndarray, float]:
    """(theta = a, b, c, d; mean training CRPS) by minimum CRPS over the finite rows."""
    m, s2, y = (np.asarray(v, dtype=float) for v in (m, s2, y))
    ok = np.isfinite(m) & np.isfinite(s2) & np.isfinite(y)
    m, s2, y = m[ok], s2[ok], y[ok]
    if m.size < 10:
        raise ValueError(f"only {m.size} training rows")

    def obj(theta):
        mu, sig = params_to_mu_sigma(theta, m, s2)
        return float(np.mean(crps_tn0(mu, sig, y)))
    return nelder_mead(obj, x0)
