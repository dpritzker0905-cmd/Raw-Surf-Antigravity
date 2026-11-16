"""surf_ablation.py: the S0 ablation of the surf chain's multipliers, OFFLINE (changes no served number).

RULE: docs/weather-program/log/2026-11-16-fable-surf-ablation-s0-prereg.md. WHY: the owner's field report at 29.77 N
81.25 W (1.12 m at 7.3 s served as 1.58 m of surf on a gently sloping beach). This script answers ONE question and no
other: what does each multiplier in the served chain do to the number, per spot class and sea state? Whether a
multiplier is RIGHT is a question for truth data and the gate in the rule; this script never answers it.

HOW. It calls the production chain itself (`surf_point.resolve_surf_geometry` + `estimate_surf_at`), never a copy of
the physics, with one of the chain's own kill switches set for the duration of one call:

  komar      SURF_V3_KOMAR=0          Komar & Gaughan breaker height off (legacy linear shoaling instead)
  exposure   SURF_V3_EXPOSURE=0       no swell-angle factor on the height
  refraction SURF_REFRACTION_KR=1.0   the constant refraction factor off (REFRACTION_KR, 0.873 in the code today)
  magnet     SURF_V3_MAGNETS=0        per-spot wave-magnet factors off
  h110       SURF_HEIGHT_H110=0       no H1/10 conversion (x1.27 on an unsaturated height)
  cap        SURF_BREAK_DEPTH=0       the nearshore break-depth cap off. The cap itself has no switch: this returns it
                                      to the shelf-median depth, where it almost never binds.

`all_off` sets all six: what is left is the legacy pass-through (linear shoaling, shelf friction as configured).

A factor's CONTRIBUTION is served / (served with that factor off): above 1 the factor raises the served number, below
1 it lowers it. Where no ceiling binds the contributions multiply back to served / all_off; where the depth cap or the
Komar jack limit binds they do not (a minimum is not a product). That gap is printed as `interaction` (1 = none).

The environment is changed only inside `switched`, which restores it, and only for the names above. Nothing is read
from the network; the geometry comes from the bathymetry bundled in the repo."""
import math
import os
import random
import sys
from contextlib import contextmanager

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

FACTORS = {
    "komar": {"SURF_V3_KOMAR": "0"},
    "exposure": {"SURF_V3_EXPOSURE": "0"},
    "refraction": {"SURF_REFRACTION_KR": "1.0"},
    "magnet": {"SURF_V3_MAGNETS": "0"},
    "h110": {"SURF_HEIGHT_H110": "0"},
    "cap": {"SURF_BREAK_DEPTH": "0"},
}
ALL_OFF = {k: v for env in FACTORS.values() for k, v in env.items()}
# Sea states for the model-only decomposition: (label, Hs m, Tp s). `report` is the owner's hour as read on 2026-11-15.
SEA_STATES = (("wind_sea", 1.0, 5.0), ("report", 1.12, 7.28), ("swell", 1.5, 12.0), ("groundswell", 2.0, 16.0))
ANGLES_OFF_NORMAL = (0.0, 45.0)
BOOT_DRAWS = 2000
BOOT_SEED = 20261116


@contextmanager
def switched(env):
    """Set these environment names for the body and restore exactly what was there before."""
    old = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        yield
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _chain(lat, lng, hs, tp, direction, geometry, partitions=None):
    from services.weather_pipeline.surf_point import estimate_surf_at
    return estimate_surf_at(lat, lng, hs, tp, direction, geometry=geometry, partitions=partitions)


def ablate(lat, lng, hs, tp, direction=None, geometry=None, partitions=None, chain=_chain) -> dict:
    """The served height, the height with each factor off, with all off, and each factor's contribution."""
    served, regime = chain(lat, lng, hs, tp, direction, geometry, partitions)
    out = {"served_m": served, "regime": regime, "off_m": {}, "contribution": {}, "regime_off": {}}
    for name, env in FACTORS.items():
        with switched(env):
            h, reg = chain(lat, lng, hs, tp, direction, geometry, partitions)
        out["off_m"][name], out["regime_off"][name] = h, reg
        out["contribution"][name] = (served / h) if (served and h) else None
    with switched(ALL_OFF):
        out["all_off_m"], out["all_off_regime"] = chain(lat, lng, hs, tp, direction, geometry, partitions)
    out["ratio_to_offshore"] = (served / hs) if (served is not None and hs) else None
    total = (served / out["all_off_m"]) if (served and out["all_off_m"]) else None
    known = [c for c in out["contribution"].values() if c]
    out["all_factors"] = total
    out["interaction"] = (total / math.prod(known)) if (total and len(known) == len(FACTORS)) else None
    return out


def period_variants(lat, lng, hs, periods: dict, direction=None, geometry=None, chain=_chain) -> dict:
    """The served chain run on each named period (peak, mean, wind-sea partition...). A missing period is skipped."""
    out = {}
    for name, tp in (periods or {}).items():
        if tp is None or not tp > 0:
            continue
        h, reg = chain(lat, lng, hs, tp, direction, geometry, None)
        out[name] = {"tp_s": tp, "surf_m": h, "regime": reg, "ratio_to_offshore": (h / hs) if (h is not None and hs) else None}
    return out


def geometric_mean_ci(values, draws: int = BOOT_DRAWS, seed: int = BOOT_SEED) -> dict:
    """Geometric mean of positive ratios with a 95% bootstrap interval over the values (one value per SPOT)."""
    v = [math.log(x) for x in values if x and x > 0]
    if not v:
        return {"n": 0}
    out = {"n": len(v), "gmean": round(math.exp(sum(v) / len(v)), 3), "ci95": None}
    if len(v) >= 5:
        rng = random.Random(seed)
        means = sorted(sum(v[rng.randrange(len(v))] for _ in v) / len(v) for _ in range(draws))
        out["ci95"] = [round(math.exp(means[int(0.025 * draws)]), 3), round(math.exp(means[int(0.975 * draws) - 1]), 3)]
    return out


def decompose(panel, resolve=None, chain=_chain, sea_states=SEA_STATES, angles=ANGLES_OFF_NORMAL) -> list:
    """One row per spot x sea state x angle: the ablation at that spot's own geometry. Model only: no truth is read."""
    if resolve is None:
        from services.weather_pipeline.surf_point import resolve_surf_geometry as resolve
    rows = []
    for name, lat, lng, coast, kind in panel:
        g = resolve(lat, lng)
        normal = getattr(g, "swell_normal_deg", None)
        normal = normal if normal is not None else getattr(g, "shore_normal_deg", None)
        for label, hs, tp in sea_states:
            for off in angles:
                direction = ((normal + off) % 360.0) if normal is not None else None
                if normal is None and off:
                    continue                                   # no shore normal: the angle cannot be set
                a = ablate(lat, lng, hs, tp, direction, geometry=g, chain=chain)
                rows.append({"spot": name, "coast": coast, "class": kind, "sea_state": label, "hs_m": hs, "tp_s": tp,
                             "angle_off_normal": off, "depth_m": getattr(g, "depth_m", None),
                             "break_depth_m": getattr(g, "break_depth_m", None),
                             "magnet_factor": getattr(g, "magnet_factor", None), **a})
    return rows


def summarize(rows, by=("class", "sea_state")) -> list:
    """Per group: the geometric mean over SPOTS of served/offshore, of each factor's contribution and of all factors."""
    groups = {}
    for r in rows:
        groups.setdefault(tuple(r[k] for k in by), []).append(r)
    out = []
    for key in sorted(groups):
        rs = groups[key]
        entry = dict(zip(by, key))
        entry["spots"] = len({r["spot"] for r in rs})
        entry["regimes"] = sorted({r["regime"] for r in rs if r.get("regime")})
        entry["ratio_to_offshore"] = geometric_mean_ci([r["ratio_to_offshore"] for r in rs])
        entry["all_factors"] = geometric_mean_ci([r["all_factors"] for r in rs])
        entry["contribution"] = {f: geometric_mean_ci([r["contribution"][f] for r in rs]) for f in FACTORS}
        out.append(entry)
    return out


MONO_HS = tuple(round(0.1 * i, 1) for i in range(1, 121))        # 0.1 .. 12.0 m
MONO_PERIODS = (5.0, 7.28, 10.0, 12.0, 16.0, 20.0)


def monotone_violations(points, chain=_chain, hs_grid=MONO_HS, periods=MONO_PERIODS, configs=None, resolve=None) -> dict:
    """MC-01 guardrail for every arm: a bigger offshore height must never give smaller surf. For each (name, lat, lng)
    point, period and configuration, walk the height grid and list every step where the surf DROPS. Head-on.
    Returns {"calls": n, "violations": [(config, point, tp, hs, before, after), ...]}; an empty list is a pass."""
    if resolve is None:
        from services.weather_pipeline.surf_point import resolve_surf_geometry as resolve
    if configs is None:
        configs = {"served": {}, **{k + "_off": v for k, v in FACTORS.items()}, "all_off": ALL_OFF}
    calls, bad = 0, []
    for name, lat, lng in points:
        g = resolve(lat, lng)
        normal = getattr(g, "swell_normal_deg", None)
        normal = normal if normal is not None else getattr(g, "shore_normal_deg", None)
        for cname, env in configs.items():
            with switched(env):
                for tp in periods:
                    prev = None
                    for hs in hs_grid:
                        h, _reg = chain(lat, lng, hs, tp, normal, g, None)
                        calls += 1
                        if prev is not None and h is not None and h < prev - 1e-9:
                            bad.append((cname, name, tp, hs, prev, h))
                        if h is not None:
                            prev = h
    return {"calls": calls, "violations": bad}


def _fmt(g) -> str:
    if not g or not g.get("n"):
        return ""
    return "%.2f" % g["gmean"] + (" [%.2f, %.2f]" % tuple(g["ci95"]) if g.get("ci95") else " (n<5)")


def render(summary, by=("class", "sea_state")) -> str:
    head = list(by) + ["spots", "surf / offshore"] + list(FACTORS) + ["all six", "regimes"]
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for e in summary:
        cells = [str(e[k]) for k in by] + [str(e["spots"]), _fmt(e["ratio_to_offshore"])]
        cells += [_fmt(e["contribution"][f]) for f in FACTORS] + [_fmt(e["all_factors"]), ", ".join(e["regimes"])]
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out) + "\n"


def main(argv=None) -> int:
    from surf_spot_panel import PANEL
    rows = decompose(PANEL)
    head_on = [r for r in rows if r["angle_off_normal"] == 0.0]
    sys.stdout.write("## Surf chain ablation, model only (no truth read)\n\n")
    sys.stdout.write("A factor column is served / served-with-that-factor-off, as a geometric mean over spots with a 95% "
                     "interval over SPOTS. It says what the factor does, not whether it is right.\n\n### Head-on\n\n")
    sys.stdout.write(render(summarize(head_on)))
    sys.stdout.write("\n### 45 degrees off the shore normal\n\n")
    sys.stdout.write(render(summarize([r for r in rows if r["angle_off_normal"] == 45.0])))
    sys.stdout.write("\n### By coast, head-on, the `report` sea state (1.12 m at 7.28 s)\n\n")
    sys.stdout.write(render(summarize([r for r in head_on if r["sea_state"] == "report"], by=("coast",)), by=("coast",)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
