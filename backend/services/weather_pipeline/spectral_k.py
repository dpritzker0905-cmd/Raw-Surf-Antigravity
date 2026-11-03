"""spectral_k.py — California per-spot SPECTRAL TRANSFER from CDIP MOP's published ray coefficients (PURE).

WHAT K IS. CDIP's MOP (O'Reilly & Guza) publishes, for 11,594 California points on the 10 m contour, the ray-traced
energy transfer from deep water to the point, per frequency and 5-degree direction bin:
  * `swl_et[10 f, 72 dir]`  swell band 0.05-0.14 Hz, from MOP's REGIONAL boundary (islands, banks and shelf rays);
  * `sea_et[17 f, 72 dir]`  0.05-0.25 Hz, from LOCAL deep water (508 m): no island sheltering.
`et` multiplies BIN energy (the m^2/Hz each 5-degree bin carries); the transformed point spectrum is the sum over
direction. (Research 2026-11-03, memory `research-spectral-transfer-ca-2026-11-03`: `et` on CDIP buoy MEM spectra
reproduces MOP's own nowcast at the point, median ratio 0.89-1.2.)

THE ARM (SURF_SPECTRAL_K, pre-registered 2026-11-03, NOT tuned on the evaluation window):
  1. one member's partitions ({h, tp, dir, kind}) at ONE open-ocean read point per region (`spectral_k_serving`),
     reconciled to that point's total Hs (the repo's rule: the total is the SCALE, the trains the SHAPE);
  2. E(f, theta) rebuilt per partition: JONSWAP gamma 3.3 x cos^2s spreading, s = 25 (swell) / 10 (wind sea);
  3. K applied with a FREQUENCY SPLIT at FC_SPLIT_HZ = 0.09: below it `swl_et`, at and above it `sea_et`;
  4. integrated to Hs and peak period at the MOP point's depth (~10 m) -> the EXISTING breaking step
     (`mop_nearshore.estimate_surf_from_nearshore`, through `surf_point.estimate_surf_at(nearshore=...)`).
Everything here is numpy arithmetic on arrays already in memory: no I/O, no environment reads.

⚠️ KNOWN, RECORDED BIAS DIRECTION: above 0.09 Hz the open-ocean energy goes through `sea_et`, which carries no island
sheltering, so inside the Southern California Bight that band is likely OVER-transferred (the read point sits outside
the islands by design). The split check (log `docs/weather-program/log/2026-11-03-claude-surf-spectral-k.md`) measures it.
"""
import math
from typing import Optional

import numpy as np

G = 9.81
FINE = np.arange(0.030, 0.4001, 0.0025)            # Hz: the integration grid
DIRS = np.arange(5.0, 360.1, 5.0)                   # MOP's direction bin centres (deg, nautical FROM)
FC_SPLIT_HZ = 0.09                                   # below: swl_et (regional); at/above: sea_et (local deep)
GAMMA = 3.3
SPREAD_S = {"swell": 25.0, "windsea": 10.0}
DEEP_REF_M = 500.0                                   # sea_et's deep reference (MOP: 508 m)
SEA_HIGH_KEEP = 0.5                                  # above sea_et's range: keep half (shelter + whitecapping, crude)


def wavenumber(f, h):
    """Linear dispersion k(f, h) by Newton iteration (vectorised)."""
    w = 2 * np.pi * np.asarray(f, float)
    k = w * w / G / np.sqrt(np.tanh(w * w * h / G))
    for _ in range(40):
        th = np.tanh(k * h)
        k = k - (G * k * th - w * w) / (G * th + G * k * h * (1 - th * th))
    return k


def group_velocity(f, h):
    k = wavenumber(f, h)
    kh = k * h
    c = 2 * np.pi * np.asarray(f, float) / k
    return 0.5 * c * (1 + 2 * kh / np.sinh(2 * kh))


def jonswap(hs_m, tp_s, gamma=GAMMA):
    """1-D JONSWAP on FINE scaled to Hs (m0 = Hs^2/16)."""
    fp = 1.0 / tp_s
    f = FINE
    sig = np.where(f <= fp, 0.07, 0.09)
    s = f ** -5 * np.exp(-1.25 * (fp / f) ** 4) * gamma ** np.exp(-((f - fp) ** 2) / (2 * sig ** 2 * fp ** 2))
    m0 = float(np.trapezoid(s, f))
    return s * (hs_m ** 2 / 16.0) / m0 if m0 > 0 else s * 0.0


def spreading(dir_from_deg, s):
    """cos^2s((theta - mean)/2) as bin FRACTIONS over the 72 MOP bins (sums to 1)."""
    d = np.radians((DIRS - float(dir_from_deg) + 540.0) % 360.0 - 180.0)
    w = np.cos(d / 2.0) ** (2.0 * s)
    return w / w.sum()


def rebuild(partitions) -> Optional[np.ndarray]:
    """{h, tp, dir, kind} trains -> bin energy E[FINE, 72]. Trains without height, period or direction are skipped
    (a train with no bearing cannot be ray-transferred). None when nothing usable remains."""
    E = np.zeros((FINE.size, DIRS.size))
    used = 0
    for p in partitions or []:
        h, tp, dr = p.get("h"), p.get("tp"), p.get("dir")
        if h is None or tp is None or dr is None:
            continue
        h, tp, dr = float(h), float(tp), float(dr)
        if not (h > 0.02 and tp > 1.0) or h != h or tp != tp or dr != dr:
            continue
        s = SPREAD_S["windsea"] if p.get("kind") == "windsea" else SPREAD_S["swell"]
        E += np.outer(jonswap(h, tp), spreading(dr, s))
        used += 1
    return E if used else None


class Transfer:
    """One MOP point's K on FINE: `swl` and `sea` [FINE, 72], plus its depth and shore normal."""

    def __init__(self, swl_et, sea_et, swell_freq, sea_freq, depth_m, shore_normal=None, label=None):
        self.depth_m, self.shore_normal, self.label = float(depth_m), shore_normal, label
        sf, qf = np.asarray(swell_freq, float), np.asarray(sea_freq, float)
        self.swl = self._interp(sf, np.asarray(swl_et, float))
        self.sea = self._interp(qf, np.asarray(sea_et, float))
        self.swl[FINE > sf[-1] + 0.005] = np.nan
        hi = FINE > qf[-1] + 0.025
        ks2 = group_velocity(FINE, DEEP_REF_M) / group_velocity(FINE, self.depth_m)
        self.sea[hi, :] = (SEA_HIGH_KEEP * ks2[hi])[:, None]
        self.swl = np.where(np.isnan(self.swl), self.sea, self.swl)

    @staticmethod
    def _interp(fr, et):
        et = np.where(np.isfinite(et) & (et >= 0), et, 0.0)
        out = np.empty((FINE.size, et.shape[1]))
        for j in range(et.shape[1]):
            out[:, j] = np.interp(FINE, fr, et[:, j])
        return out

    def apply(self, E, fc_hz: float = FC_SPLIT_HZ) -> np.ndarray:
        """Point frequency spectrum E_n(f) at the MOP depth: swl below fc, sea at and above it."""
        lo = (FINE < fc_hz)[:, None]
        return (np.where(lo, self.swl, self.sea) * E).sum(axis=1)


def hs_of(Ef) -> float:
    return 4.0 * math.sqrt(max(float(np.trapezoid(Ef, FINE)), 0.0))


def peak_period(Ef) -> Optional[float]:
    """1/fp, fp the discrete peak refined by a 3-point parabola (inside the grid). None for an empty spectrum."""
    Ef = np.asarray(Ef, float)
    if not np.any(Ef > 0):
        return None
    i = int(np.argmax(Ef))
    fp = FINE[i]
    if 0 < i < FINE.size - 1:
        a, b, c = Ef[i - 1], Ef[i], Ef[i + 1]
        den = a - 2 * b + c
        if den < 0:
            fp = FINE[i] + 0.5 * (a - c) / den * (FINE[1] - FINE[0])
    return float(1.0 / fp)


def shoal_to_depth(Ef, from_depth_m, to_depth_m) -> np.ndarray:
    """Energy-flux conservation per frequency, no refraction: E(f) * Cg(from) / Cg(to)."""
    return np.asarray(Ef, float) * group_velocity(FINE, float(from_depth_m)) / group_velocity(FINE, float(to_depth_m))


def nearshore_sea(partitions, transfer: Transfer, fc_hz: float = FC_SPLIT_HZ) -> Optional[dict]:
    """The arm's nearshore sea at the MOP point: {hs, tp, dp: None, depth_m}, or None (nothing usable).
    `dp` is None on purpose: `et` transfers energy, not direction, and the breaking step does not read it."""
    E = rebuild(partitions)
    if E is None:
        return None
    En = transfer.apply(E, fc_hz)
    hs, tp = hs_of(En), peak_period(En)
    if tp is None or not hs > 0:
        return None
    return {"hs": hs, "tp": tp, "dp": None, "depth_m": transfer.depth_m, "spectrum": En}
