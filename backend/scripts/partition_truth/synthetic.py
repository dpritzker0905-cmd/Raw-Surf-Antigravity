"""Synthetic buoy spectra with KNOWN trains, for the partitioner's positive and null controls.

A train is a Gaussian in frequency (Hs, Tp, relative width) times a cos^(2s) directional spreading about a
compass-FROM direction. The four Fourier coefficients are integrated from the true directional distribution, which is
exactly what a buoy reports, so the partitioner has to reconstruct the directions from the moments."""
import numpy as np

NBINS = 360
# NDBC's 47-bin frequency set (Hz): 0.033-0.485.
FREQ = np.array([0.033, 0.038, 0.043, 0.048, 0.053, 0.058, 0.063, 0.068, 0.073, 0.078, 0.083, 0.088, 0.093, 0.100,
                 0.110, 0.120, 0.130, 0.140, 0.150, 0.160, 0.170, 0.180, 0.190, 0.200, 0.210, 0.220, 0.230, 0.240,
                 0.250, 0.260, 0.270, 0.280, 0.290, 0.300, 0.310, 0.320, 0.330, 0.340, 0.350, 0.365, 0.385, 0.405,
                 0.425, 0.445, 0.465, 0.485])


def train_energy(hs, tp, rel_width=0.10, freq=FREQ):
    """1-D energy density (m2/Hz) with variance (hs/4)^2, Gaussian about 1/tp."""
    fp = 1.0 / tp
    g = np.exp(-0.5 * ((freq - fp) / (rel_width * fp)) ** 2)
    df = np.gradient(freq)
    m0 = float(np.sum(g * df))
    return g * ((hs / 4.0) ** 2 / m0)


def spreading(dir_from, s=25.0):
    th = np.arange(NBINS) * (360.0 / NBINS)
    d = np.cos(np.radians(th - dir_from) / 2.0) ** (2 * s)
    return d / d.sum()


def moments(energy_by_train, dirs_by_train, s_by_train=None):
    """Total energy and the a1,b1,a2,b2 a buoy would report for trains that overlap in frequency."""
    th = np.radians(np.arange(NBINS) * (360.0 / NBINS))
    tot = np.zeros_like(FREQ)
    A1 = np.zeros_like(FREQ); B1 = np.zeros_like(FREQ); A2 = np.zeros_like(FREQ); B2 = np.zeros_like(FREQ)
    for k, (e, d) in enumerate(zip(energy_by_train, dirs_by_train)):
        dist = spreading(d, (s_by_train or [25.0] * len(dirs_by_train))[k])
        A1 += e * np.sum(dist * np.cos(th)); B1 += e * np.sum(dist * np.sin(th))
        A2 += e * np.sum(dist * np.cos(2 * th)); B2 += e * np.sum(dist * np.sin(2 * th))
        tot += e
    safe = np.where(tot > 0, tot, 1.0)
    return tot, A1 / safe, B1 / safe, A2 / safe, B2 / safe


def spectrum(trains, s=25.0):
    """trains: [(hs, tp, dir_from_deg)] -> (freq, energy, a1, b1, a2, b2)."""
    es = [train_energy(h, t) for h, t, _ in trains]
    return (FREQ,) + moments(es, [d for _, _, d in trains], [s] * len(trains))
