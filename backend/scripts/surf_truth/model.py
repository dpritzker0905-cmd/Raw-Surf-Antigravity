"""The pre-registered latent model (#989 Model section + amendment 2 D and H), in NumPyro. OFFLINE ONLY.

    log y_i = log T_c + log k_z(i) + log k_set(i) + log P + b_j + e_i,   e_i ~ N(0, (sigma_j * m_g(i))^2)

- z(i) marginalized: P(z = declared) = 0.9; k_face = 1, k_hawaiian ~ lognormal(log 0.5, 0.25) (amendment 2 edit 3).
- k_set: sets = 1; typical ~ lognormal(-log 1.27, 0.10).
- P ~ lognormal(log 0.6, 0.25), CONSTANT (edit 4). With no physical-reference rows (none may enter until amendment
  2 L is registered) P stays at its prior and only T x P is identified. The model then samples the IDENTIFIED quantity
  directly, u_c = log(T_c x P) ("anchor-scale face height"), and P is NOT sampled: sampling an unidentified P only
  adds a P-T ridge the chains cannot mix along (measured on a synthetic world: R-hat 1.12, ESS 20, every run VOID).
  P's posterior is then exactly its prior, reported as such; its convergence check is vacuous.
- b_j: anchors ~ N(0, tau) with their MEAN SUBTRACTED (mean active-anchor bias = 0); others ~ N(mu_role, tau).
  An observer is in the anchor group iff any of its fit rows was filed while it was an ACTIVE anchor.
- sigma_j = exp(log_sigma_role + s_sd * eta_j); flag multipliers m_g = 1 + HalfNormal(0.5) for the two flag classes,
  m_clean = 1 (amendment 2 H: flags only down-weight).
- log T: per spot-day random walk over its cells in time order: first cell ~ N(log 1 m, 1), steps ~ N(0, 0.15).
- Ranges: interval-censored likelihood; "8ft+" right-censored. Typed values: point likelihood.

Scoring (amendment 2 B): parameters from the FIT ONLY; for each held-out cell, T is inferred per posterior draw from
the cell's OTHER reports (a Gaussian update on log T; a range enters at its scoring point with its interval's
log-width variance; an observer unseen in the fit takes its role prior), then the target's report is predicted
including the target observer's bias and noise. Approximations here are the scoring stage's and are stated for the
research lead's review.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .prep import FT, entry_interval_m, entry_point_m, flag_class, is_anchor

ROLES = ("anchor", "anchor_probation", "photographer", "surfer")
FLAG_CLASSES = ("clean", "unverified_location", "range_only")
P_DECLARED = 0.9


def _role_of(rows: list[dict]) -> str:
    if any(is_anchor(r) for r in rows):
        return "anchor"
    role = rows[0].get("observer_role") or "surfer"
    return role if role in ROLES else "surfer"


@dataclass
class Design:
    obs_index: dict          # observer_key -> j
    obs_role: np.ndarray     # j -> role index
    cell_index: dict         # (spot_id, start_iso) -> c, ordered by (day, start)
    seg_of_cell: np.ndarray  # c -> spot-day segment
    first_of_seg: np.ndarray # segment -> first cell
    row_obs: np.ndarray
    row_cell: np.ndarray
    row_hawaiian: np.ndarray # declared scale is Hawaiian
    row_typical: np.ndarray
    row_flag: np.ndarray
    row_point: np.ndarray    # log metres (nan for censored)
    row_lo: np.ndarray       # log metres (-inf if 0)
    row_hi: np.ndarray       # log metres (+inf if open)
    row_censored: np.ndarray


def _cell_of(r: dict):
    from .prep import cell_key
    return cell_key(r)


def build_design(rows: list[dict]) -> Design:
    by_obs: dict = {}
    for r in rows:
        by_obs.setdefault(r["observer_key"], []).append(r)
    obs_keys = sorted(by_obs)
    obs_index = {k: j for j, k in enumerate(obs_keys)}
    obs_role = np.array([ROLES.index(_role_of(by_obs[k])) for k in obs_keys], dtype=np.int32)
    keys = sorted({_cell_of(r) for r in rows}, key=lambda k: (k[0], k[2], k[1]))
    cell_index = {(k[0], k[1]): c for c, k in enumerate(keys)}
    seg_ids, seg_of_cell, first_of_seg = {}, [], []
    for c, k in enumerate(keys):
        seg = (k[0], k[2])
        if seg not in seg_ids:
            seg_ids[seg] = len(seg_ids)
            first_of_seg.append(c)
        seg_of_cell.append(seg_ids[seg])
    pts, los, his, cens = [], [], [], []
    for r in rows:
        if r.get("height_bucket"):
            lo, hi = entry_interval_m(r)
            los.append(math.log(lo) if lo > 0 else -np.inf)
            his.append(np.inf if hi is None else math.log(hi))
            pts.append(np.nan)
            cens.append(True)
        else:
            v = entry_point_m(r)
            pts.append(math.log(max(v, 1e-3)))
            los.append(-np.inf)
            his.append(np.inf)
            cens.append(False)
    return Design(
        obs_index=obs_index, obs_role=obs_role, cell_index=cell_index,
        seg_of_cell=np.array(seg_of_cell, dtype=np.int32), first_of_seg=np.array(first_of_seg, dtype=np.int32),
        row_obs=np.array([obs_index[r["observer_key"]] for r in rows], dtype=np.int32),
        row_cell=np.array([cell_index[_cell_of(r)[:2]] for r in rows], dtype=np.int32),
        row_hawaiian=np.array([r["height_scale"] == "hawaiian" for r in rows]),
        row_typical=np.array([r["set_or_avg"] == "typical" for r in rows]),
        row_flag=np.array([FLAG_CLASSES.index(flag_class(r)) for r in rows], dtype=np.int32),
        row_point=np.array(pts), row_lo=np.array(los), row_hi=np.array(his), row_censored=np.array(cens),
    )


def numpyro_model(d: Design):
    import jax.numpy as jnp
    import numpyro
    import numpyro.distributions as dist
    from jax.scipy.special import logsumexp
    from jax.scipy.stats import norm

    n_obs, n_cell = d.obs_role.size, d.seg_of_cell.size
    log_p = 0.0                                          # P absorbed into u = log(T x P); see the docstring
    log_kh = numpyro.sample("log_k_hawaiian", dist.Normal(math.log(0.5), 0.25))
    log_ktyp = numpyro.sample("log_k_typical", dist.Normal(-math.log(1.27), 0.10))
    mu_role = numpyro.sample("mu_role", dist.Normal(0.0, 0.3).expand([len(ROLES)]))
    mu_role = mu_role.at[0].set(0.0)                     # anchors are the relative reference
    tau = numpyro.sample("tau", dist.HalfNormal(0.3))
    b_raw = numpyro.sample("b_raw", dist.Normal(0.0, 1.0).expand([n_obs]))
    is_anchor_obs = jnp.asarray(d.obs_role == 0)
    b = mu_role[d.obs_role] + tau * b_raw
    n_anchor = jnp.maximum(is_anchor_obs.sum(), 1)
    anchor_mean = jnp.where(is_anchor_obs, b, 0.0).sum() / n_anchor
    b = numpyro.deterministic("b", jnp.where(is_anchor_obs, b - anchor_mean, b))
    log_sig_role = numpyro.sample("log_sigma_role", dist.Normal(math.log(0.2), 0.5).expand([len(ROLES)]))
    s_sd = numpyro.sample("sigma_sd", dist.HalfNormal(0.3))
    eta = numpyro.sample("sigma_eta", dist.Normal(0.0, 1.0).expand([n_obs]))
    sigma = jnp.exp(log_sig_role[d.obs_role] + s_sd * eta)
    m_extra = numpyro.sample("m_extra", dist.HalfNormal(0.5).expand([2]))
    m = jnp.concatenate([jnp.ones(1), 1.0 + m_extra])
    innov = numpyro.sample("t_innov", dist.Normal(0.0, 1.0).expand([n_cell]))
    first = jnp.zeros(n_cell, dtype=bool).at[d.first_of_seg].set(True)
    step = jnp.where(first, math.log(0.6) + 1.0 * innov, 0.15 * innov)   # u = log(T x P): T ~ 1 m, P ~ 0.6
    cs = jnp.cumsum(step)
    seg_base = cs[d.first_of_seg] - step[d.first_of_seg]
    log_t = numpyro.deterministic("log_TP", cs - seg_base[d.seg_of_cell])

    base = log_t[d.row_cell] + jnp.where(d.row_typical, log_ktyp, 0.0) + log_p + b[d.row_obs]
    s = sigma[d.row_obs] * m[d.row_flag]
    mean_decl = base + jnp.where(d.row_hawaiian, log_kh, 0.0)
    mean_alt = base + jnp.where(d.row_hawaiian, 0.0, log_kh)
    lw = jnp.log(jnp.array([P_DECLARED, 1.0 - P_DECLARED]))

    def point_ll(mean):
        return norm.logpdf(jnp.nan_to_num(d.row_point), mean, s)

    def cens_ll(mean):
        hi = jnp.where(jnp.isfinite(d.row_hi), norm.cdf((jnp.where(jnp.isfinite(d.row_hi), d.row_hi, 0.0) - mean) / s), 1.0)
        lo = jnp.where(jnp.isfinite(d.row_lo), norm.cdf((jnp.where(jnp.isfinite(d.row_lo), d.row_lo, 0.0) - mean) / s), 0.0)
        return jnp.log(jnp.clip(hi - lo, 1e-12, 1.0))

    ll_decl = jnp.where(d.row_censored, cens_ll(mean_decl), point_ll(mean_decl))
    ll_alt = jnp.where(d.row_censored, cens_ll(mean_alt), point_ll(mean_alt))
    numpyro.factor("lik", logsumexp(jnp.stack([ll_decl + lw[0], ll_alt + lw[1]]), axis=0).sum())


@dataclass
class Fit:
    design: Design
    samples: dict
    diagnostics: dict


def fit(rows: list[dict], *, chains: int = 4, warmup: int = 1000, samples: int = 1000, seed: int = 20261116) -> Fit:
    """The GATED fit (amendment 2 D): NUTS, 4 chains; VOID unless R-hat < 1.01 and bulk ESS > 400 on P, mu, tau and
    divergences <= 0.1% after warmup."""
    import jax
    from numpyro.diagnostics import summary
    from numpyro.infer import MCMC, NUTS

    d = build_design(rows)
    mcmc = MCMC(NUTS(numpyro_model), num_warmup=warmup, num_samples=samples, num_chains=chains,
                chain_method="sequential", progress_bar=False)
    mcmc.run(jax.random.PRNGKey(seed), d, extra_fields=("diverging",))
    grouped = mcmc.get_samples(group_by_chain=True)
    stats = summary({k: grouped[k] for k in ("mu_role", "tau", "log_k_hawaiian", "log_k_typical")},
                    group_by_chain=True)
    rhat = max(float(np.nanmax(np.atleast_1d(v["r_hat"]))) for v in stats.values())
    ess = min(float(np.nanmin(np.atleast_1d(v["n_eff"]))) for v in stats.values())
    div = float(np.asarray(mcmc.get_extra_fields()["diverging"]).mean())
    diagnostics = {"r_hat_max": rhat, "ess_bulk_min": ess, "divergent_fraction": div,
                   "P": "prior only: no physical-reference rows (amendment 2 L); outputs are anchor-scale",
                   "converged": rhat < 1.01 and ess > 400 and div <= 0.001,
                   "chains": chains, "warmup": warmup, "samples": samples, "seed": seed}
    return Fit(design=d, samples={k: np.asarray(v) for k, v in mcmc.get_samples().items()}, diagnostics=diagnostics)


def _row_offset(r: dict, s: dict, i: int) -> float:
    off = 0.0                                            # P is inside u = log(T x P)
    if r["set_or_avg"] == "typical":
        off += s["log_k_typical"][i]
    if r["height_scale"] == "hawaiian":
        off += s["log_k_hawaiian"][i]
    return off


def _obs_params(f: Fit, r: dict, i: int, rng) -> tuple[float, float]:
    """(b, sigma) for draw i: the fitted ones, else the role prior (amendment 2 B)."""
    s = f.samples
    j = f.design.obs_index.get(r["observer_key"])
    if j is not None:
        b = s["b"][i, j]
        sig = math.exp(s["log_sigma_role"][i, f.design.obs_role[j]] + s["sigma_sd"][i] * s["sigma_eta"][i, j])
        return float(b), sig
    role = ROLES.index("anchor" if is_anchor(r) else (r.get("observer_role") if r.get("observer_role") in ROLES
                                                      else "surfer"))
    mu = 0.0 if role == 0 else s["mu_role"][i, role]
    b = rng.normal(mu, s["tau"][i])
    sig = math.exp(s["log_sigma_role"][i, role] + s["sigma_sd"][i] * rng.normal())
    return float(b), sig


FLAT_LOG_VARIANCE = math.log(4.0) ** 2 / 12.0      # log-uniform on [0.125, 0.5] ft (amendment 3.5)


def _range_variance(o: dict):
    """Extra log-variance of a range entering the scoring update: None = drop it (right-censored "8ft+");
    Flat = a log-uniform on [0.125, 0.5] ft; a bounded range = (log-width)^2 / 12; a typed value = 0."""
    if not o.get("height_bucket"):
        return 0.0
    if o["height_bucket"] == "Flat":
        return FLAT_LOG_VARIANCE
    lo, hi = entry_interval_m(o)
    if hi is None:
        return None
    return (math.log(hi) - math.log(lo)) ** 2 / 12.0


def predict_target(f: Fit, target: dict, others: list[dict], *, n_draws: int = 400, seed: int = None) -> np.ndarray:
    """Posterior-predictive draws of the target's report (metres, the target's declared scale). `others` must be
    the cell's reports INDEPENDENT of the target (amendment 3.5); the cell's u is updated from them alone, with no
    borrowing from neighbouring cells through the random walk (conservative)."""
    from .prep import row_seed
    rng = np.random.default_rng(row_seed(target["row_key"]) if seed is None else seed)   # amendment 4.8
    total = f.samples["tau"].shape[0]
    picks = rng.choice(total, size=min(n_draws, total), replace=False)
    m_all = f.samples["m_extra"]
    out = []
    for i in picks:
        prec, num = 1.0, math.log(0.6)                    # prior N(log 0.6, 1) on u = log(T x P)
        for o in others:
            extra = _range_variance(o)
            if extra is None:                            # "8ft+": dropped from the update (amendment 3.5)
                continue
            b, sig = _obs_params(f, o, i, rng)
            g = FLAG_CLASSES.index(flag_class(o))
            s_o = sig * (1.0 if g == 0 else 1.0 + m_all[i, g - 1])
            var = s_o ** 2 + extra
            est = math.log(max(entry_point_m(o), 1e-3)) - _row_offset(o, f.samples, i) - b
            prec += 1.0 / var
            num += est / var
        log_t = rng.normal(num / prec, math.sqrt(1.0 / prec))
        b_t, sig_t = _obs_params(f, target, i, rng)
        g = FLAG_CLASSES.index(flag_class(target))
        s_t = sig_t * (1.0 if g == 0 else 1.0 + m_all[i, g - 1])
        mean = log_t + _row_offset(target, f.samples, i) + b_t
        if rng.random() > P_DECLARED:                    # the latent scale may differ from the declared one
            k = f.samples["log_k_hawaiian"][i]
            mean += -k if target["height_scale"] == "hawaiian" else k
        out.append(math.exp(rng.normal(mean, s_t)))
    return np.array(out)


__all__ = ["ROLES", "Design", "Fit", "build_design", "numpyro_model", "fit", "predict_target", "FT"]
