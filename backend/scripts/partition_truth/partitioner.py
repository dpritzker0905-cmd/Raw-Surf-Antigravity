"""Observed wave partitions from a buoy's directional spectrum (pure numpy, no GRIB, no network).

METHOD (named, so a reader can check it against the literature):
  1. Directional spectrum E(f, theta) from the buoy's Fourier coefficients. Directions are compass FROM, clockwise
     from true north. DEFAULT model "wrapped_normal": at each frequency one direction alpha1(f) and the Kuik et al.
     (1988) spread sigma = sqrt(2 (1 - r1)); a2, b2 are not used. This is deliberate: the Maximum Entropy Method
     (Lygre & Krogstad 1986, model="mem") reproduces all four moments but, whenever r2 < r1^2, returns a spurious
     DOUBLE peak 20-30 degrees either side of a single swell (Benoit 1992; reproduced in test_partition_truth.py), which
     the watershed then reports as two trains. A heave-pitch-roll buoy cannot resolve two trains in the SAME
     frequency bin; the default does not pretend to.
  2. Spectral partitioning by the watershed method (Gerling 1992; Hanson & Phillips 2001): every (f, theta) cell is
     assigned to the local maximum reached by steepest ascent over its 8 neighbours (theta is circular). Two
     neighbouring partitions are merged when the saddle between them is shallow: saddle >= MERGE_RATIO x the LOWER
     of the two peaks (Hanson & Phillips merge on the same idea; the ratio is a parameter, MERGE_RATIO below, and the
     run script reports sensitivity to it). A partition below MIN_PARTITION_HS_M is not a train (kept in `residual_hs`).
  3. Wind sea versus swell by wave age (Hanson & Phillips 2001): a partition is WIND SEA when
     WAVE_AGE_LIMIT x U10 x cos(peak_dir - wind_dir) > c_p, with c_p = g / (2 pi f_p) the phase speed at the
     partition's peak frequency. Without a wind the label is None for every partition (never guessed from period).

WHAT IT RETURNS per spectrum: a list of partitions ranked by Hs (largest first), each with hs_m (4 sqrt(m0)),
tp_s (1 / peak frequency of the partition's frequency spectrum), dir_deg (energy-weighted circular mean direction of
the partition), fp_hz, windsea (True / False / None). Swell trains are the non-wind-sea ones.

LIMITS: a buoy measures a1, b1, a2, b2 (first and second Fourier harmonics), not the full directional spectrum; MEM
makes the narrowest spectrum consistent with them and can split or smear a broad train. Two trains closer than about
15-20 degrees in direction and one frequency bin in period are not separable from a heave-pitch-roll buoy at all.
The controls in tests/test_partition_truth.py show what this partitioner recovers and what it does not.
"""
import math
from typing import Dict, List, Optional, Sequence

import numpy as np

G = 9.80665
NDIR = 72                      # 5 degree bins
MERGE_RATIO = 0.80             # saddle / lower peak at or above this merges the two partitions
MIN_PARTITION_HS_M = 0.10      # below this a partition is residual, not a train
NOISE_FRACTION = 1e-3          # cells below this fraction of the spectral peak are not partitioned
WAVE_AGE_LIMIT = 1.3           # Hanson & Phillips 2001
DIR_MERGE_DEG = 20.0           # touching partitions closer than this in mean direction ...
DIR_MERGE_SADDLE = 0.50        # ... are one train when their saddle is at least this fraction of the lower peak
ANEMOMETER_TO_10M = 1.10       # NDBC buoy anemometers sit near 4-5 m; (10/4.5)^(1/7) ~ 1.12 under neutral stability


def angdiff(a, b):
    """Signed smallest difference a - b in degrees, in (-180, 180]."""
    return (np.asarray(a, float) - np.asarray(b, float) + 180.0) % 360.0 - 180.0


def circ_mean_deg(angles_deg, weights) -> Optional[float]:
    w = np.asarray(weights, float)
    a = np.radians(np.asarray(angles_deg, float))
    s, c = float(np.sum(w * np.sin(a))), float(np.sum(w * np.cos(a)))
    if s == 0.0 and c == 0.0:
        return None
    return float(np.degrees(np.arctan2(s, c)) % 360.0)


def mem_spectrum(energy, a1, b1, a2, b2, ndir: int = NDIR) -> np.ndarray:
    """E(f, theta) in m2/Hz/deg, shape (nf, ndir), by Lygre & Krogstad (1986) from one record (1-D arrays over f).
    a1 = r1 cos(alpha1), b1 = r1 sin(alpha1), a2 = r2 cos(2 alpha2), b2 = r2 sin(2 alpha2); alpha is compass FROM."""
    theta = np.radians(np.arange(ndir) * (360.0 / ndir))
    c1 = np.nan_to_num(np.asarray(a1, float)) + 1j * np.nan_to_num(np.asarray(b1, float))
    c2 = np.nan_to_num(np.asarray(a2, float)) + 1j * np.nan_to_num(np.asarray(b2, float))
    mag = np.abs(c1)
    c1 = np.where(mag >= 0.999, c1 * 0.999 / np.maximum(mag, 1e-12), c1)
    phi1 = (c1 - c2 * np.conj(c1)) / (1 - np.abs(c1) ** 2)
    phi2 = c2 - c1 * phi1
    num = 1 - phi1 * np.conj(c1) - phi2 * np.conj(c2)
    e1 = np.exp(-1j * theta)[None, :]
    den = np.abs(1 - phi1[:, None] * e1 - phi2[:, None] * e1 ** 2) ** 2
    d = np.clip(np.real(num[:, None] / den), 0, None)
    s = d.sum(axis=1, keepdims=True)
    d = np.where(s > 0, d / np.where(s > 0, s, 1), 1.0 / ndir)
    return np.nan_to_num(np.asarray(energy, float))[:, None] * d / (360.0 / ndir)


def wrapped_normal_spectrum(energy, a1, b1, ndir: int = NDIR) -> np.ndarray:
    """E(f, theta), shape (nf, ndir): per frequency a wrapped normal about alpha1(f) with the Kuik spread.
    A bin with no direction (NDBC 999 / NaN) is spread uniformly, so it keeps its energy and claims no direction."""
    e = np.nan_to_num(np.asarray(energy, float))
    a1 = np.asarray(a1, float)
    b1 = np.asarray(b1, float)
    ok = np.isfinite(a1) & np.isfinite(b1)
    r1 = np.where(ok, np.hypot(np.where(ok, a1, 0), np.where(ok, b1, 0)), 0.0)
    alpha = np.degrees(np.arctan2(np.where(ok, b1, 0), np.where(ok, a1, 1))) % 360.0
    sigma = np.degrees(np.sqrt(2.0 * np.clip(1.0 - r1, 0.0, 1.0)))
    sigma = np.clip(sigma, 5.0, 80.0)
    th = np.arange(ndir) * (360.0 / ndir)
    d = np.exp(-0.5 * (angdiff(th[None, :], alpha[:, None]) / sigma[:, None]) ** 2)
    d = np.where(ok[:, None] & (r1[:, None] > 0.02), d, 1.0)
    d = d / d.sum(axis=1, keepdims=True)
    return e[:, None] * d / (360.0 / ndir)


def _bin_widths(freq: np.ndarray) -> np.ndarray:
    return np.gradient(freq)


def _watershed_labels(S: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Label each masked cell by the local maximum steepest ascent reaches. theta (axis 1) wraps."""
    nf, nd = S.shape
    best = np.full((nf, nd), -1, dtype=np.int64)
    best_val = S.copy()
    flat = np.arange(nf * nd).reshape(nf, nd)
    best[:] = flat
    for df in (-1, 0, 1):
        for dd in (-1, 0, 1):
            if df == 0 and dd == 0:
                continue
            sh = np.roll(S, (-df, -dd), axis=(0, 1))          # neighbour value at (i + df, j + dd)
            idx = np.roll(flat, (-df, -dd), axis=(0, 1))
            valid = np.ones((nf, nd), bool)
            if df == 1:
                valid[-1, :] = False
            if df == -1:
                valid[0, :] = False
            better = valid & (sh > best_val)
            best_val = np.where(better, sh, best_val)
            best = np.where(better, idx, best)
    ptr = best.ravel()
    for _ in range(nf * nd):                                  # follow pointers to the peaks (terminates: strict ascent)
        nxt = ptr[ptr]
        if np.array_equal(nxt, ptr):
            break
        ptr = nxt
    lab = ptr.reshape(nf, nd)
    return np.where(mask, lab, -1)


def _label_dir(cell: np.ndarray, lab: np.ndarray, l: int, dirs: np.ndarray) -> float:
    w = np.where(lab == l, cell, 0.0).sum(axis=0)
    return circ_mean_deg(dirs, w)


def _merge(S: np.ndarray, lab: np.ndarray, ratio: float, cell: Optional[np.ndarray] = None) -> np.ndarray:
    """Merge neighbouring partitions whose saddle is shallow (saddle >= ratio x lower peak), or, when `cell` (energy per
    cell) is given, whose mean directions are within DIR_MERGE_DEG and whose saddle is at least DIR_MERGE_SADDLE x the
    lower peak: a noisy 30-minute buoy spectrum ripples, and ripples inside one direction are not separate trains.
    Repeats until stable."""
    nf, nd = S.shape
    dirs = np.arange(nd) * (360.0 / nd)
    lab = lab.copy()
    while True:
        peaks = {int(l): float(S.flat[int(l)]) for l in np.unique(lab[lab >= 0])}
        saddle: Dict[tuple, float] = {}
        for df, dd in ((0, 1), (1, 0), (1, 1), (1, -1)):
            if df == 0:
                a, b = lab, np.roll(lab, -dd, axis=1)
                va, vb = S, np.roll(S, -dd, axis=1)
            else:
                a, b = lab[:-1], np.roll(lab, -dd, axis=1)[1:]
                va, vb = S[:-1], np.roll(S, -dd, axis=1)[1:]
            m = (a >= 0) & (b >= 0) & (a != b)
            for la, lb, x, y in zip(a[m], b[m], va[m], vb[m]):
                k = (min(int(la), int(lb)), max(int(la), int(lb)))
                saddle[k] = max(saddle.get(k, 0.0), float(min(x, y)))
        cand = None
        for (p, q), sv in saddle.items():
            low = min(peaks[p], peaks[q])
            near = False
            if cell is not None and low > 0 and sv >= DIR_MERGE_SADDLE * low:
                dp, dq = _label_dir(cell, lab, p, dirs), _label_dir(cell, lab, q, dirs)
                near = dp is not None and dq is not None and abs(float(angdiff(dp, dq))) < DIR_MERGE_DEG
            if low > 0 and (sv >= ratio * low or near):
                score = sv / low
                if cand is None or score > cand[0]:
                    cand = (score, p, q)
        if cand is None:
            return lab
        _, p, q = cand
        keep, drop = (p, q) if peaks[p] >= peaks[q] else (q, p)
        lab[lab == drop] = keep


def partition_spectrum(freq: Sequence[float], energy, a1, b1, a2, b2, wind_speed_ms: Optional[float] = None,
                       wind_dir_from_deg: Optional[float] = None, merge_ratio: float = MERGE_RATIO,
                       min_hs_m: float = MIN_PARTITION_HS_M, model: str = "wrapped_normal") -> Dict:
    """Partition one spectrum. Returns {'hs_m', 'partitions': [...], 'residual_hs', 'windsea_method'}."""
    freq = np.asarray(freq, float)
    efth = (mem_spectrum(energy, a1, b1, a2, b2) if model == "mem" else wrapped_normal_spectrum(energy, a1, b1))
    dth = 360.0 / efth.shape[1]
    df = _bin_widths(freq)
    cell_m0 = efth * df[:, None] * dth
    total_m0 = float(cell_m0.sum())
    out = {"hs_m": 4.0 * math.sqrt(max(total_m0, 0.0)), "partitions": [], "residual_hs": 0.0,
           "windsea_method": "wave_age" if wind_speed_ms is not None and wind_dir_from_deg is not None else "none"}
    peak = float(efth.max())
    if not np.isfinite(peak) or peak <= 0:
        return out
    mask = efth >= NOISE_FRACTION * peak
    lab = _merge(efth, _watershed_labels(efth, mask), merge_ratio, cell_m0)
    dirs = np.arange(efth.shape[1]) * dth
    parts: List[Dict] = []
    used = 0.0
    for l in np.unique(lab[lab >= 0]):
        sel = lab == l
        m0 = float(cell_m0[sel].sum())
        hs = 4.0 * math.sqrt(max(m0, 0.0))
        if hs < min_hs_m:
            continue
        fspec = np.where(sel, efth, 0.0).sum(axis=1)
        fp = float(freq[int(np.argmax(fspec))])
        wdir = np.where(sel, cell_m0, 0.0).sum(axis=0)
        used += m0
        p = {"hs_m": hs, "tp_s": 1.0 / fp if fp > 0 else None, "fp_hz": fp,
             "dir_deg": circ_mean_deg(dirs, wdir), "windsea": None}
        if wind_speed_ms is not None and wind_dir_from_deg is not None and p["dir_deg"] is not None and fp > 0:
            cp = G / (2.0 * math.pi * fp)
            u10 = wind_speed_ms * ANEMOMETER_TO_10M
            proj = u10 * math.cos(math.radians(float(angdiff(p["dir_deg"], wind_dir_from_deg))))
            p["windsea"] = bool(WAVE_AGE_LIMIT * proj > cp)
        parts.append(p)
    parts.sort(key=lambda p: -p["hs_m"])
    out["partitions"] = parts
    out["residual_hs"] = 4.0 * math.sqrt(max(total_m0 - used, 0.0))
    return out


def trains(result: Dict) -> Dict:
    """Split a partition_spectrum result into {'swell': [...ranked], 'windsea': best or None}. With no wind label
    every partition is reported under 'unlabelled' and 'swell' is empty: a period guess is not a label."""
    parts = result["partitions"]
    if result["windsea_method"] == "none":
        return {"swell": [], "windsea": None, "unlabelled": parts}
    sw = [p for p in parts if p["windsea"] is False]
    ws = [p for p in parts if p["windsea"] is True]
    return {"swell": sw, "windsea": ws[0] if ws else None, "unlabelled": []}
