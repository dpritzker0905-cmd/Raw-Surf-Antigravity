#!/usr/bin/env python3
"""
Does the PYTHON INTERPRETER change the artifacts the forecast lanes produce?

⚠️ WHY THIS IS NEEDED. Production runs 3.12 (measured: /api/health `runtime.python`) and ci.yml was
aligned to 3.12 on 2026-08-06. Every OTHER workflow is still 3.11 — including forecast-ingest,
forecast-ingest-pilots, precompute, l2-orphan-sweep and forecast-calibration-census, which WRITE the
artifacts the 3.12 server READS. Installing the same requirements on both gives 150 distributions on
3.11 against 146 on 3.12, differing in numpy 2.4.6 vs 2.5.1.
⇒ Before moving those lanes, the question to answer is not "does the job go green" but "does the
  ARTIFACT change". This produces the artifact deterministically so the two interpreters can be
  compared byte-for-byte.

★ WHAT AN EARLIER FRAMING GOT WRONG, KEPT HERE BECAUSE IT IS THE USEFUL PART: I first justified this
  as "zarr 3.1.6 writes what zarr 3.3.0 reads". **zarr is imported NOWHERE in this repo** — no
  `import zarr`, no `.zarr` store, no `to_zarr`; it is an unexercised transitive of xarray. And the
  rating chain itself (spot_ratings / surf_rating / surf_point) imports **no numpy at all** and
  emits JSON. So the exposure is far narrower than "the numeric core changed": it is confined to the
  numpy-backed helpers, chiefly ocean_access, which swell_fetch imports.
  ⇒ Both sections below are measured anyway. "It is pure Python so it must be fine" is reasoning,
    not measurement, and this file exists to stop that standing in for evidence.

DETERMINISM: fixed inputs only — no clock, no randomness, no network, no Supabase, and nothing is
uploaded. Production's own serialization is reused verbatim (`json.dumps(separators=(",", ":"))`),
because the artifact is the BYTES, not the dict.
⚠️ The real L2 wrapper adds `"generated_at": datetime.now(...)`, which would differ on every run.
That wrapper is deliberately NOT included — comparing it would only ever measure the clock.

REFUSAL (standing rule 27): if a section cannot run, it is reported UNAVAILABLE and the exit code is
2. A digest computed over sections that silently did nothing would compare equal on both
interpreters and mean nothing at all.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import traceback

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

# A fixed spread: two exposed reef/point breaks, one high-latitude, one low-energy, one
# southern-hemisphere. Chosen to exercise different geometry branches, not for realism.
SITES = [
    ("pipeline", 21.6650, -158.0530),
    ("trestles", 33.3850, -117.5900),
    ("jeffreys", -34.0490, 24.9280),
    ("nazare", 39.6010, -9.0850),
    ("hossegor", 43.6620, -1.4400),
]

# (Hs_m, Tp_s, swell_from_deg, wind_speed_ms, wind_from_deg)
CONDITIONS = [
    (1.0, 8.0, 290.0, 2.0, 60.0),
    (2.5, 14.0, 315.0, 6.0, 200.0),
    (4.0, 18.0, 270.0, 12.0, 180.0),
    (0.4, 6.0, 200.0, 1.0, 10.0),
]


def _plain(value):
    """Coerce to a JSON-safe primitive AND record the concrete type name.

    ★ The type is part of the artifact's identity, not decoration: a numpy scalar leaking where a
      float is expected is exactly the kind of thing a numpy bump changes, and it would otherwise be
      invisible once json.dumps had coerced it.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return {"t": type(value).__name__, "v": value}
    if hasattr(value, "item"):          # numpy scalar
        return {"t": type(value).__name__, "v": value.item()}
    if isinstance(value, (list, tuple)):
        return {"t": type(value).__name__, "v": [_plain(v) for v in value]}
    if hasattr(value, "_asdict"):
        return {"t": type(value).__name__, "v": {k: _plain(v) for k, v in value._asdict().items()}}
    if hasattr(value, "__dict__"):
        return {"t": type(value).__name__,
                "v": {k: _plain(v) for k, v in sorted(vars(value).items()) if not k.startswith("_")}}
    return {"t": type(value).__name__, "v": repr(value)}


def section_composition(bump: float = 0.0) -> list:
    """THE ONE FORECAST COMPOSITION, as CLAUDE.md mandates: resolve geometry once per coordinate,
    then estimate the nearshore breaking height, then the 0-100 quality. Pure Python today — this
    section exists to prove that stays true, not to assume it."""
    from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at
    from services.weather_pipeline.surf_rating import compute_surf_rating

    out = []
    for name, lat, lng in SITES:
        geom = resolve_surf_geometry(lat, lng)
        row = {"site": name, "geometry": _plain(geom), "hours": []}
        for hs, tp, swell_from, wind_ms, wind_from in CONDITIONS:
            surf = estimate_surf_at(lat, lng, hs + bump, tp, swell_from_deg=swell_from)
            surf_h = surf[0] if isinstance(surf, tuple) else surf
            shore_normal = getattr(geom, "shore_normal_deg", None)
            rating = compute_surf_rating(
                surf_h if isinstance(surf_h, (int, float)) else None,
                tp, wind_ms, wind_from_deg=wind_from,
                shore_normal_deg=shore_normal, swell_from_deg=swell_from,
            )
            row["hours"].append({
                "in": [hs + bump, tp, swell_from, wind_ms, wind_from],
                "surf": _plain(surf),
                "rating": _plain(rating),
            })
        out.append(row)
    return out


def section_ocean_access(bump: float = 0.0) -> list:
    """The numpy-backed helpers — the ONLY place in the ingest path where a numpy version could
    plausibly move a number. A fixed synthetic bathymetry grid, so the input is identical on both
    interpreters rather than whatever the network returned that minute."""
    from services.weather_pipeline import ocean_access

    lats = [round(30.0 + 0.1 * i, 4) for i in range(24)]
    lons = [round(-120.0 + 0.1 * j, 4) for j in range(24)]
    # A deterministic shelf: deep to the west, land to the east, with a ridge to make the
    # exposure/fetch geometry non-trivial.
    elev = []
    for i in range(len(lats)):
        row = []
        for j in range(len(lons)):
            depth = -400.0 + 22.0 * j + 3.0 * ((i * 7) % 5) + bump
            if j > 17:
                depth = 12.0 + 2.0 * (j - 17)
            row.append(round(depth, 3))
        elev.append(row)

    lat, lon = lats[12], lons[9]
    results = {
        "ocean_access_km": ocean_access.ocean_access_km(elev, lats, lons, lat, lon),
        "swell_exposure_fraction": ocean_access.swell_exposure_fraction(
            elev, lats, lons, lat, lon, 270.0),
        "placement_verdict": ocean_access.placement_verdict(elev, lats, lons, lat, lon),
    }
    return [{"fn": k, "out": _plain(v)} for k, v in sorted(results.items())]


SECTIONS = {
    "composition": section_composition,
    "ocean_access": section_ocean_access,
}


def build(bump: float) -> tuple[dict, list]:
    payload, unavailable = {}, []
    for name, fn in sorted(SECTIONS.items()):
        try:
            payload[name] = fn(bump)
        except Exception:
            unavailable.append(name)
            payload[name] = {"UNAVAILABLE": traceback.format_exc().strip().splitlines()[-1]}
    return payload, unavailable


def main() -> int:
    ap = argparse.ArgumentParser(description="Artifact bytes under this interpreter.")
    ap.add_argument("--emit", metavar="PATH", help="write the artifact bytes here for diffing")
    ap.add_argument("--mutate", action="store_true",
                    help="perturb the inputs; the digest MUST change, which is what proves this "
                         "harness can detect a difference at all")
    args = ap.parse_args()

    payload, unavailable = build(0.017 if args.mutate else 0.0)
    # Production's own serialization, verbatim: the artifact is the bytes.
    data = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(data).hexdigest()

    print(f"python        {'.'.join(str(p) for p in sys.version_info[:3])}")
    try:
        import numpy
        print(f"numpy         {numpy.__version__}")
    except Exception:
        print("numpy         <not importable>")
    print(f"mutated       {args.mutate}")
    print(f"sections      {', '.join(sorted(SECTIONS))}")
    print(f"bytes         {len(data)}")
    print(f"sha256        {digest}")
    if args.emit:
        with open(args.emit, "wb") as fh:
            fh.write(data)
        print(f"written       {args.emit}")

    if unavailable:
        print(f"REFUSING: section(s) could not run: {', '.join(unavailable)}")
        print("  A digest over sections that did nothing compares equal everywhere and means"
              " nothing. Fix the section or exclude it explicitly.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
