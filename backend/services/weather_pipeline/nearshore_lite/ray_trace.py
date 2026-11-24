"""Backward linear ray tracing over a gridded MSL depth field (stationary, no currents).

Method (gate section 2; O'Reilly and Guza linear spectral refraction as MOP uses it): for each frequency f and each
2-degree target direction theta_t, a ray is started AT the target travelling the way the wave travels there and is
integrated BACKWARD to the offshore boundary. Along the ray the directional energy density obeys Liouville's
theorem (conservation of wave action in wavenumber space), which at fixed f gives

    E_t(f, theta_t) / E_b(f, theta_b) = (c_b Cg_b) / (c_t Cg_t)            (R below)

so Hs_t^2 = Integral Integral E_b(f, theta_b(f, theta_t)) * R(f, theta_t) dtheta_t df. A ray that reaches land (or a
cell with no depth) carries ZERO energy (sheltering). R already contains shoaling to the target depth.

Conventions: depth positive down, referenced to MSL (gate section 1a). Directions are compass bearings the wave comes
FROM (0 = N, clockwise), like the served partitions. Grid: x east, y north, metres, regular spacing dx.
"""
import numpy as np

from .dispersion import deep_wavelength, group_speed, phase_speed

MIN_DEPTH_M = 0.5            # a ray entering water shallower than this has reached the shore
FREQS_HZ = np.round(np.arange(0.04, 0.2501, 0.01), 4)   # gate: 0.04-0.25 Hz in 0.01 Hz steps
THETA_STEP_DEG = 2.0         # gate: every 2 degrees
MAX_STEPS = 20000
EDGE_DEEP_FRACTION = 0.25    # an edge exit counts as the offshore boundary only when h >= 0.25 * deep wavelength
REACHED_DEEP, REACHED_EDGE, REACHED_LAND = 0, 1, 2


class DepthGrid:
    """Regular grid of MSL depth (m, positive down; NaN or < MIN_DEPTH_M = land / no data)."""

    def __init__(self, depth, dx_m, x0_m=0.0, y0_m=0.0):
        self.h = np.asarray(depth, dtype=float)
        self.dx = float(dx_m)
        self.x0 = float(x0_m)
        self.y0 = float(y0_m)
        self.ny, self.nx = self.h.shape

    def _cell(self, x, y):
        fx = (x - self.x0) / self.dx
        fy = (y - self.y0) / self.dx
        ix = np.floor(fx).astype(int)
        iy = np.floor(fy).astype(int)
        inside = (ix >= 0) & (iy >= 0) & (ix < self.nx - 1) & (iy < self.ny - 1)
        ix = np.clip(ix, 0, self.nx - 2)
        iy = np.clip(iy, 0, self.ny - 2)
        return fx - ix, fy - iy, ix, iy, inside

    def sample(self, x, y):
        """(depth, d/dx, d/dy, inside, wet): bilinear depth and gradient. wet = all four corners are water."""
        tx, ty, ix, iy, inside = self._cell(x, y)
        corners = np.stack([self.h[iy, ix], self.h[iy, ix + 1], self.h[iy + 1, ix], self.h[iy + 1, ix + 1]])
        wet = np.all(np.isfinite(corners) & (corners >= MIN_DEPTH_M), axis=0) & inside
        c = np.where(np.isfinite(corners), corners, 0.0)
        h = c[0] * (1 - tx) * (1 - ty) + c[1] * tx * (1 - ty) + c[2] * (1 - tx) * ty + c[3] * tx * ty
        dhdx = ((c[1] - c[0]) * (1 - ty) + (c[3] - c[2]) * ty) / self.dx
        dhdy = ((c[2] - c[0]) * (1 - tx) + (c[3] - c[1]) * tx) / self.dx
        return h, dhdx, dhdy, inside, wet


def _from_to_vec(from_deg):
    """Propagation unit vector (east, north) of a wave coming FROM the compass bearing."""
    a = np.radians(from_deg)
    return -np.sin(a), -np.cos(a)


def _vec_to_from(ux, uy):
    return np.degrees(np.arctan2(-ux, -uy)) % 360.0


def trace_target(grid, x_t, y_t, freqs=FREQS_HZ, theta_step_deg=THETA_STEP_DEG, step_factor=1.0):
    """Transfer table for ONE target point.

    `step_factor` scales the ray step (0.5 = the freeze-time convergence check, amendment A7).

    Returns a dict: freqs_hz (nf), theta_t_from_deg (nth), theta_b_from_deg (nf, nth), R (nf, nth; 0 = blocked),
    blocked (bool, nf x nth), reached (int8 codes DEEP/EDGE/LAND), depth_t_m."""
    freqs = np.asarray(freqs, dtype=float)
    thetas = np.arange(0.0, 360.0, theta_step_deg)
    nf, nth = len(freqs), len(thetas)
    F = np.repeat(freqs[:, None], nth, axis=1).ravel()
    TH = np.tile(thetas[None, :], (nf, 1)).ravel()
    n = F.size
    h_t = grid.sample(np.array([x_t], dtype=float), np.array([y_t], dtype=float))[0][0]
    if not np.isfinite(h_t) or h_t < MIN_DEPTH_M:
        raise ValueError(f"target is not in water at x={x_t}, y={y_t} (depth {h_t})")
    c_t, cg_t = phase_speed(F, h_t), group_speed(F, h_t)
    ux, uy = _from_to_vec(TH)                                  # direction of travel at the target
    x = np.full(n, float(x_t))
    y = np.full(n, float(y_t))
    theta = np.arctan2(uy, ux)                                 # travel angle from +x, radians
    active = np.ones(n, dtype=bool)
    code = np.full(n, REACHED_EDGE, dtype=np.int8)
    lam0 = deep_wavelength(F)
    h_last = np.full(n, float(h_t))                            # last depth seen INSIDE the domain
    for _ in range(MAX_STEPS):
        if not active.any():
            break
        idx = np.nonzero(active)[0]
        xa, ya, tha, fa = x[idx], y[idx], theta[idx], F[idx]
        h, dhdx, dhdy, inside, wet = grid.sample(xa, ya)
        h_last[idx[inside]] = h[inside]
        deep = wet & (h >= 0.5 * lam0[idx])
        lost = ~inside
        land = inside & ~wet
        code[idx[deep]] = REACHED_DEEP
        code[idx[lost]] = REACHED_EDGE
        code[idx[land]] = REACHED_LAND
        done = deep | lost | land
        active[idx[done]] = False
        keep = ~done
        if not keep.any():
            continue
        idx, xa, ya, tha, fa, h, dhdx, dhdy = (a[keep] for a in (idx, xa, ya, tha, fa, h, dhdx, dhdy))
        c = phase_speed(fa, h)
        dh = np.maximum(0.01 * h, 0.01)
        lo = np.maximum(h - dh, 1e-3)
        dcdh = (phase_speed(fa, h + dh) - phase_speed(fa, lo)) / (h + dh - lo)
        dcdx, dcdy = dcdh * dhdx, dcdh * dhdy
        ds = step_factor * np.minimum((c / fa) / 10.0, grid.dx / 2.0)   # <= lambda/10 (gate) and sub-cell; step_factor < 1 = convergence check
        dtheta_ds = (dcdx * np.sin(tha) - dcdy * np.cos(tha)) / c
        # BACKWARD: step against the travel direction and un-turn
        x[idx] = xa - ds * np.cos(tha)
        y[idx] = ya - ds * np.sin(tha)
        theta[idx] = tha - ds * dtheta_ds
    h_b = np.where(np.isfinite(h_last) & (h_last >= MIN_DEPTH_M), h_last, h_t)
    c_b, cg_b = phase_speed(F, h_b), group_speed(F, h_b)
    # A ray that leaves the domain carries energy only if it left in (nearly) deep water, i.e. through the offshore
    # side. A lateral exit in shallow water is NOT a boundary: it is TRUNCATED and carries zero (amendment question A3).
    truncated = (code == REACHED_EDGE) & (h_b < EDGE_DEEP_FRACTION * lam0)
    R = np.where((code == REACHED_LAND) | truncated, 0.0, (c_b * cg_b) / (c_t * cg_t))
    theta_b = _vec_to_from(np.cos(theta), np.sin(theta))
    return {
        "freqs_hz": freqs, "theta_t_from_deg": thetas,
        "theta_b_from_deg": theta_b.reshape(nf, nth), "R": R.reshape(nf, nth),
        "blocked": (code == REACHED_LAND).reshape(nf, nth), "reached": code.reshape(nf, nth),
        "truncated": truncated.reshape(nf, nth),
        "depth_b_m": h_b.reshape(nf, nth), "depth_t_m": float(h_t),
    }


def truncated_share(table):
    """Share of NON-LAND rays that were truncated at a lateral domain edge (amendment A3). Flag a target above
    TRUNCATED_FLAG_SHARE (20%) in its report."""
    t = np.asarray(table["truncated"], dtype=bool)
    live = ~np.asarray(table["blocked"], dtype=bool)
    n = int(live.sum())
    return float(t[live].sum()) / n if n else 0.0


TRUNCATED_FLAG_SHARE = 0.20


def convergence(table_full, table_half, med_max=0.01, p95_max=0.03):
    """Step-halving check (amendment A7): relative change of R over rays carrying energy in both, median < 1% and p95 < 3%."""
    a = np.asarray(table_full["R"], dtype=float)
    b = np.asarray(table_half["R"], dtype=float)
    ok = (a > 0) & (b > 0)
    if not ok.any():
        return {"n": 0, "median": float("nan"), "p95": float("nan"), "ok": False}
    d = np.abs(b[ok] - a[ok]) / a[ok]
    med, p95 = float(np.median(d)), float(np.percentile(d, 95))
    return {"n": int(ok.sum()), "median": med, "p95": p95, "ok": bool(med < med_max and p95 < p95_max)}
