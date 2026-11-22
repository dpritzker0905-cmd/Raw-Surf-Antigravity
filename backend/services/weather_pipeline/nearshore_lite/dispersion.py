"""Linear wave dispersion, vectorised (numpy). sigma^2 = g k tanh(k h)."""
import numpy as np

G = 9.81


def wavenumber(freq_hz, depth_m):
    """k (rad/m) for frequency (Hz) and depth (m, > 0). Broadcasts. Newton from the Eckart start."""
    f = np.asarray(freq_hz, dtype=float)
    h = np.maximum(np.asarray(depth_m, dtype=float), 1e-3)
    sigma = 2.0 * np.pi * f
    k0 = sigma * sigma / G                                  # deep-water start
    k = k0 / np.sqrt(np.tanh(k0 * h))                       # Eckart (1952) approximation
    for _ in range(6):
        t = np.tanh(k * h)
        fk = G * k * t - sigma * sigma
        dfk = G * (t + k * h * (1.0 - t * t))
        k = k - fk / dfk
    return k


def phase_speed(freq_hz, depth_m):
    return 2.0 * np.pi * np.asarray(freq_hz, dtype=float) / wavenumber(freq_hz, depth_m)


def group_speed(freq_hz, depth_m):
    h = np.maximum(np.asarray(depth_m, dtype=float), 1e-3)
    k = wavenumber(freq_hz, h)
    c = 2.0 * np.pi * np.asarray(freq_hz, dtype=float) / k
    kh2 = 2.0 * k * h
    n = 0.5 * (1.0 + kh2 / np.sinh(kh2))
    return n * c


def deep_wavelength(freq_hz):
    return G / (2.0 * np.pi * np.asarray(freq_hz, dtype=float) ** 2)
