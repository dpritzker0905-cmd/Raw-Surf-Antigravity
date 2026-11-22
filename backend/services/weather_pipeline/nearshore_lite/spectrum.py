"""Frozen parametric spectra for a served partition (gate section 2). Nothing here is fitted to any buoy.

  * frequency: JONSWAP, gamma = 3.3 for swell, 1.0 for wind sea
  * direction: cos^(2s) spreading, s = 20 for swell (Tp >= 10 s), s = 4 for wind sea
  * sensitivity arms (reported, never gating): LITE_S10 / LITE_S40 (swell s) and LITE_G1 (swell gamma = 1)

Both shapes are normalised on the frequency band of the coefficient table, so a partition's Hs is the in-band Hs.
"""
import math

import numpy as np

SWELL_GAMMA, WINDSEA_GAMMA = 3.3, 1.0
SWELL_S, WINDSEA_S = 20.0, 4.0
SWELL_TP_MIN_S = 10.0          # gate: swell spreading applies at Tp >= 10 s
G = 9.81

# the frozen shape variants (name -> overrides). "base" is the gated arm.
SHAPES = {
    "base": {},
    "S10": {"swell_s": 10.0},
    "S40": {"swell_s": 40.0},
    "G1": {"swell_gamma": 1.0},
}


def shape_params(tp_s, kind, variant="base"):
    """(gamma, s) for a partition. kind 'windsea' selects the wind-sea shape; anything else is swell by Tp."""
    over = SHAPES[variant]
    swell = (kind != "windsea") and tp_s >= SWELL_TP_MIN_S
    if swell:
        return over.get("swell_gamma", SWELL_GAMMA), over.get("swell_s", SWELL_S)
    return WINDSEA_GAMMA, WINDSEA_S


def jonswap_shape(freqs_hz, tp_s, gamma):
    """Unit-area (integral S df = 1 over the grid) JONSWAP shape on `freqs_hz`."""
    f = np.asarray(freqs_hz, dtype=float)
    fp = 1.0 / float(tp_s)
    sigma = np.where(f <= fp, 0.07, 0.09)
    r = np.exp(-((f - fp) ** 2) / (2.0 * sigma ** 2 * fp ** 2))
    s = f ** -5.0 * np.exp(-1.25 * (fp / f) ** 4) * gamma ** r
    area = float(np.sum(s) * _df(f))
    if not math.isfinite(area) or area <= 0.0:
        return None
    return s / area


def _df(f):
    return float(f[1] - f[0]) if len(f) > 1 else 1.0


def spreading(theta_from_deg, mean_from_deg, s):
    """cos^(2s) directional density per RADIAN, unit area over the circle, evaluated at theta (compass 'from')."""
    d = np.radians(((np.asarray(theta_from_deg, dtype=float) - float(mean_from_deg) + 180.0) % 360.0) - 180.0)
    d = np.where(np.abs(d) < math.pi, d, math.pi)
    c = np.cos(d / 2.0) ** (2.0 * s)
    # normaliser: integral_{-pi}^{pi} cos^(2s)(x/2) dx = 2*sqrt(pi)*Gamma(s+0.5)/Gamma(s+1)
    norm = 2.0 * math.sqrt(math.pi) * math.exp(math.lgamma(s + 0.5) - math.lgamma(s + 1.0))
    return c / norm
