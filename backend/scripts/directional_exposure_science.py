"""directional_exposure_science.py — what a REAL directional spectrum delivers, vs our single ray.

THE QUESTION
------------
`surf_rating.swell_exposure` and `surf_transform._height_exposure_factor` both reduce the forecast
by how far the swell is off the shore normal, and both treat the sea as ONE direction:

    quality  exposure = clamp(0.10 + 0.90 * max(0, cos dtheta))          floors at 0.10
    height   factor   = 0.55 + 0.45 * exposure                           floors at 0.595

A real sea state is a DIRECTIONAL SPECTRUM (Longuet-Higgins 1963; Mitsuyasu et al. 1975):

    G(phi) = A(s) * cos^(2s)(phi / 2)

with the spreading parameter s ~ 10 for a WIND SEA and s ~ 70 for SWELL — a 7x difference in
narrowness. The literature notes this model "predicts that a small amount of wave energy propagates
at angles greater than 90 deg", which is the physical justification for a floor EXISTING. What it
does not justify is ONE CONSTANT floor for every sea state.

WHAT THIS COMPUTES (exact quadrature; the A(s) normalisation cancels in every ratio)
  REACH  energy arriving from inside the +/-90 deg window that can reach the coast at all
  FLUX   the SHORE-NORMAL energy flux — weighted by cos(theta) for obliquity, i.e. the same
         P*cos(dtheta) quantity the owner mandate already uses to rank the animation. Normalised so
         a head-on spectrum is 1.0, which is the scale the engine's factor is on.

★ THE CONTROL, and it is the reason to believe the rest: as s -> infinity the spectrum collapses to
a ray and FLUX must converge on the engine's own cos(dtheta). Measured: 0.5000 vs cos(60)=0.5000 at
s >= 70. If that ever stops holding, this script is wrong and the engine is not.

⛔⛔ WHAT THIS IS **NOT** — READ BEFORE TOUCHING A CONSTANT
This is DEEP-WATER SPREADING ONLY. The same literature says two things that push the other way:
  * refraction NARROWS the directional spread toward shore-normal as waves shoal, concentrating
    energy the deep-water number does not credit;
  * ULTRA-REFRACTION — direction changes exceeding 90 deg over short distances — has "a powerful
    influence on coastal areas that otherwise appear sheltered", which is precisely the wrapping
    point-break case (Arugam, the Bukit) this repo keeps arguing about.
⇒ These numbers are a LOWER BOUND on what a real coast receives, not a target to tune to. The
principled fix remains the EMPIRICAL per-spot directional exposure from the ERA5 record
(`directional_exposure_probe.py`), not a better constant.

USAGE
    python scripts/directional_exposure_science.py
    python scripts/directional_exposure_science.py --s-swell 70 --s-windsea 10
"""
from __future__ import annotations

import argparse
import math

DEG = math.pi / 180.0


def spread_density(phi_deg: float, s: float) -> float:
    """cos^2s(phi/2), zero beyond +/-180. Log space: cos^140 underflows in direct form."""
    if abs(phi_deg) >= 180.0:
        return 0.0
    c = math.cos(phi_deg * DEG / 2.0)
    if c <= 0.0:
        return 0.0
    return math.exp(2.0 * s * math.log(c))


def _simpson(f, lo: float, hi: float, n: int = 20001) -> float:
    if n % 2 == 0:
        n += 1
    h = (hi - lo) / (n - 1)
    total = f(lo) + f(hi)
    for i in range(1, n - 1):
        total += (4 if i % 2 else 2) * f(lo + i * h)
    return total * h / 3.0


def reach_fraction(dtheta: float, s: float) -> float:
    """Share of the spectrum's energy arriving from within the +/-90 deg shoreward window."""
    den = _simpson(lambda p: spread_density(p, s), -180.0, 180.0)
    if den <= 0:
        return 0.0
    return _simpson(lambda t: spread_density(t - dtheta, s), -90.0, 90.0) / den


def onshore_flux(dtheta: float, s: float) -> float:
    """Shore-normal energy flux, normalised so a head-on spectrum = 1.0."""
    den = _simpson(lambda t: spread_density(t, s) * math.cos(t * DEG), -90.0, 90.0)
    if den <= 0:
        return 0.0
    return _simpson(lambda t: spread_density(t - dtheta, s) * math.cos(t * DEG), -90.0, 90.0) / den


def engine_quality_factor(dtheta: float) -> float:
    """`surf_rating.swell_exposure`, inlined so this script has no import-time dependency on it."""
    return max(0.0, min(1.0, 0.10 + 0.90 * max(0.0, math.cos(dtheta * DEG))))


def engine_height_factor(dtheta: float) -> float:
    """`surf_transform._height_exposure_factor`."""
    return 0.55 + 0.45 * engine_quality_factor(dtheta)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--s-swell", type=float, default=70.0)
    ap.add_argument("--s-windsea", type=float, default=10.0)
    args = ap.parse_args()
    ss, sw = args.s_swell, args.s_windsea

    print("CONTROL - as s grows the spectrum becomes a ray and FLUX must approach cos(dtheta):")
    for s in (10, 70, 400):
        v = onshore_flux(60.0, s)
        print(f"   s={s:4.0f}  flux(60)={v:.4f}  cos(60)={math.cos(60*DEG):.4f}  "
              f"diff {abs(v - math.cos(60 * DEG)):.4f}")

    print(f"\n=== ONSHORE ENERGY FLUX vs the engine's single-ray factors "
          f"(swell s={ss:.0f}, windsea s={sw:.0f}) ===")
    print(f"{'dtheta':>7s} {'quality':>8s} {'height':>7s} | {'swell flux':>11s} {'windsea flux':>13s}")
    for d in (0, 30, 60, 80, 90, 100, 110, 120, 135, 150, 180):
        print(f"{d:7d} {engine_quality_factor(d):8.3f} {engine_height_factor(d):7.3f} | "
              f"{onshore_flux(d, ss):11.4f} {onshore_flux(d, sw):13.4f}")

    print("\n=== BEYOND 90 deg, WHERE BOTH ENGINE FACTORS ARE CONSTANT ===")
    for d in (90, 100, 110, 120, 135):
        q, fs, fw = engine_quality_factor(d), onshore_flux(d, ss), onshore_flux(d, sw)
        print(f"  dtheta {d:3d}: quality {q:.3f}  swell flux {fs:.4f} ({fs/q:5.2f}x)  "
              f"windsea flux {fw:.4f} ({fw/q:5.2f}x)")
    print("  => one constant serves a quantity that differs ~8x between the two sea states at 100 deg.")

    print("\n=== THE TWO ENGINE FACTORS DISAGREE WITH EACH OTHER ===")
    print("  `_height_exposure_factor` says height 'scales gentler than energy', i.e. H ~ sqrt(E).")
    print(f"  {'exposure e':>10s} {'height impl':>12s} {'sqrt(e)':>9s} {'ratio':>7s} {'implied E':>10s}")
    for e in (0.10, 0.30, 0.50, 1.00):
        imp = 0.55 + 0.45 * e
        print(f"  {e:10.2f} {imp:12.3f} {math.sqrt(e):9.3f} {imp/math.sqrt(e):6.2f}x {imp**2:10.3f}")
    print("  => at the floor the height factor implies E=0.354 while the quality factor says 0.10:")
    print("     a 3.5x internal inconsistency between two reductions of the SAME physical quantity.")
    print("\n  [!] Do NOT 'fix' either constant from this script alone - see the module docstring:")
    print("     these are deep-water LOWER BOUNDS, and refraction/ultra-refraction push the other way.")


if __name__ == "__main__":
    main()
