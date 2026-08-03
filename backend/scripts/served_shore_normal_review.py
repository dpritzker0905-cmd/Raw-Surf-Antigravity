"""served_shore_normal_review.py — grade the shore normal PRODUCTION ACTUALLY SERVES, and kill the
identical-normal test before anyone spends a cycle on it.

WHY THIS EXISTS ALONGSIDE `validate_shore_normals_osm.py`
---------------------------------------------------------
That script grades `shore_normal_build_review.csv` — the BUILD-TIME ETOPO fit. That is not what the
app serves. `resolve_surf_geometry` layers four sources in precedence order:

    coarse (0.25 deg grid, a 194.6 km window)  ->  etopo (asset entry within MATCH_RADIUS_KM)
    ->  etopo:borrowed (a NEIGHBOUR's entry out to BEARING_RADIUS_KM)  ->  override:<name>

so a spot can be graded "accepted" at build time and still be served a borrowed or coarse bearing.
This emits the SERVED value in the schema the existing grader already reads, which means the
independent OSM truth column can be pointed at the shipped number with no change to that
instrument. Reuse, not a second grader.

    python scripts/served_shore_normal_review.py --out served_normals.csv --per-source 55
    python scripts/validate_shore_normals_osm.py --csv served_normals.csv --verdict served \
        --limit 200 --compare-coarse --out-csv graded.csv

⛔⛔ AND THE COLLISION TEST IS VOID — MEASURED, NOT ARGUED
---------------------------------------------------------
MASTER AUDIT 1.0 §8.0 proposed a cheap discriminator: "flag any two spots sharing an identical
normal", on the theory that identical bearings at distinct coordinates mean one coarse cell is
serving both. Run over the live catalogue (n=1,773) that test flags **786 spots, 44.3%** — and a
permutation control shows it is measuring nothing:

    OBSERVED   colliding spots 786   pairs <=3km 182   pairs >3km 532
    NULL       colliding spots 786   pairs <=3km   0   pairs >3km 714      (200 shuffles)

★★★ SHUFFLING WHICH SPOT HOLDS WHICH NORMAL LEAVES THE COLLIDING-SPOT COUNT **EXACTLY UNCHANGED**,
every time, p = 1.000. It has to: the count depends only on the multiset of values, never on which
coordinate holds them. 1,755 normals into ~3,600 bins at 0.1 deg quantisation is the birthday
paradox, and the widest "collisions" are spots **19,563 km apart** both reading 60.7 deg.

⭐ THE SPATIAL FORM IS THE REAL ONE. Pairs sharing a normal WITHIN 3 km: observed 182, null median
0, max 3 — overwhelming. But that signal is mostly the asset working as designed: `_nearest` borrows
a gate-passed bearing out to BEARING_RADIUS_KM precisely so adjacent breaks share a coastline
orientation, and OSM-graded that borrow is p50 12.6 deg. **Adjacency is the mechanism, not the
defect** — so this script reports collisions with their SOURCE and their SPAN, never a bare count.

⇒ Whether a served bearing is WRONG is not answerable from collisions in any form. It needs the
independent instrument. That is what the CSV is for.
"""
import argparse
import csv
import json
import math
import os
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The asset's borrow radius: a collision spanning further than this CANNOT be one asset entry
# answering both spots, so it is either the coarse grid or coincidence.
BEARING_RADIUS_KM_DEFAULT = 3.0


def _hav_km(a, b):
    r = 6371.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp = math.radians(b["lat"] - a["lat"])
    dl = math.radians(b["lng"] - a["lng"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def resolve_catalogue():
    """Every active spot with the geometry production would serve it. Never a stale local DB.

    ⚠️ `backend/dev.db` has drifted since 2026-07-12 — p90 3.470 km from production, FURTHER than
    the 3 km borrow radius this script reasons about. Sizing geometry work off it over-counted by
    2.5x once already. The app's own catalogue endpoint is the source."""
    from services.weather_pipeline.sim_forecast import fetch_catalog
    from services.weather_pipeline.surf_point import resolve_surf_geometry

    cat = fetch_catalog()
    if not cat:
        raise SystemExit(
            "REFUSING: the live catalogue is unavailable, and dev.db is stale by more than the "
            "effect being measured. Fix the app reachability rather than grading the wrong spots.")
    rows, raised = [], 0
    for s in cat:
        try:
            g = resolve_surf_geometry(float(s["latitude"]), float(s["longitude"]))
        except Exception:
            raised += 1
            continue
        rows.append({"id": s["id"], "name": s["name"], "region": s.get("region"),
                     "lat": float(s["latitude"]), "lng": float(s["longitude"]),
                     "normal": g.shore_normal_deg, "src": g.shore_normal_src,
                     "match_km": g.shore_normal_match_km})
    print(f"catalogue {len(cat)} spots -> resolved {len(rows)} ({raised} raised)")
    return rows


def collision_census(rows, radius_km=BEARING_RADIUS_KM_DEFAULT, shuffles=200, seed=20260803):
    """Identical-normal collisions, WITH the permutation control that voids the bare count.

    Reports the null alongside every observed number. A count quoted without its null is how this
    test came to be proposed as a discriminator in the first place."""
    have = [r for r in rows if r["normal"] is not None]
    vals = [round(r["normal"], 4) for r in have]

    def count(assign):
        g = defaultdict(list)
        for r, v in assign:
            g[v].append(r)
        coll = sum(len(v) for v in g.values() if len(v) > 1)
        near = far = 0
        for v in g.values():
            for i, a in enumerate(v):
                for b in v[i + 1:]:
                    if _hav_km(a, b) <= radius_km:
                        near += 1
                    else:
                        far += 1
        return coll, near, far

    obs = count(list(zip(have, vals)))
    rng = random.Random(seed)
    sims = []
    for _ in range(shuffles):
        sv = vals[:]
        rng.shuffle(sv)
        sims.append(count(list(zip(have, sv))))

    out = {"n": len(have), "distinct_normals": len(set(vals)),
           "observed": {"colliding_spots": obs[0], "pairs_within": obs[1], "pairs_beyond": obs[2]},
           "null": {}, "verdict": {}}
    for i, label in enumerate(("colliding_spots", "pairs_within", "pairs_beyond")):
        xs = sorted(s[i] for s in sims)
        p = sum(1 for x in xs if x >= obs[i]) / len(xs)
        out["null"][label] = {"median": xs[len(xs) // 2], "min": xs[0], "max": xs[-1],
                              "p_null_ge_observed": round(p, 4)}
        # ★ A test whose null reproduces the observation is not a test.
        out["verdict"][label] = "VOID — indistinguishable from chance" if p > 0.05 else "SIGNAL"
    return out


def write_csv(rows, path, per_source=55, named=(), seed=20260803):
    """Stratified sample in `validate_shore_normals_osm.py`'s schema, `normal_deg` = the SERVED
    value. Named exemplars are always carried — an index-based sample cannot be argued with later,
    a named one can."""
    by_src = defaultdict(list)
    for r in rows:
        if r["normal"] is not None:
            by_src["override" if r["src"].startswith("override") else r["src"]].append(r)

    picked, seen = [], set()
    wanted = {n.strip().lower() for n in named if n.strip()}
    for r in rows:
        if r["normal"] is not None and (r["name"] or "").lower() in wanted and r["name"] not in seen:
            seen.add(r["name"])
            picked.append(r)
    n_named = len(picked)

    rng = random.Random(seed)
    for src in ("etopo", "etopo:borrowed", "coarse", "override"):
        pool = [r for r in by_src.get(src, []) if r["name"] not in seen]
        rng.shuffle(pool)
        take = pool[:per_source]
        seen.update(r["name"] for r in take)
        picked.extend(take)
        print(f"  {src:16s} pool={len(by_src.get(src, [])):5d}  sampled={len(take)}")
    print(f"  named exemplars carried: {n_named}")

    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["name", "lat", "lng", "normal_deg", "spread_deg",
                                           "verdict", "ocean_verdict", "src", "match_km", "region"])
        w.writeheader()
        for r in picked:
            w.writerow({"name": r["name"], "lat": r["lat"], "lng": r["lng"],
                        "normal_deg": r["normal"], "spread_deg": "",
                        "verdict": "served", "ocean_verdict": "ON_OCEAN",
                        "src": r["src"], "match_km": r["match_km"], "region": r["region"]})
    print(f"wrote {len(picked)} rows -> {path}")
    return picked


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="served_normals.csv", help="CSV for the OSM grader")
    ap.add_argument("--per-source", type=int, default=55)
    ap.add_argument("--named", default="Padang Padang,Bingin,Uluwatu,Impossibles,Balangan",
                    help="comma-separated exemplars always included")
    ap.add_argument("--shuffles", type=int, default=200)
    ap.add_argument("--json", default="", help="also dump the raw resolved rows here")
    args = ap.parse_args()

    rows = resolve_catalogue()

    print("\n=== SERVED shore-normal source distribution ===")
    total = len(rows)
    for k, v in Counter(r["src"] for r in rows).most_common():
        print(f"  {k:44s} {v:5d}  {100 * v / total:5.1f}%")

    print("\n=== identical-normal collisions, WITH the permutation control ===")
    cen = collision_census(rows, shuffles=args.shuffles)
    print(f"  n={cen['n']}  distinct normals={cen['distinct_normals']}")
    for label in ("colliding_spots", "pairs_within", "pairs_beyond"):
        o, nl = cen["observed"][label], cen["null"][label]
        print(f"  {label:16s} observed {o:5d}   null median {nl['median']:5d} "
              f"[{nl['min']}, {nl['max']}]   p={nl['p_null_ge_observed']:.3f}   "
              f"{cen['verdict'][label]}")
    # ASCII only in printed output: Windows consoles encode stdout as cp1252 and a stray arrow
    # raises UnicodeEncodeError *after* the measurement has already been computed and printed,
    # which reads as a crashed run rather than a finished one.
    print("  => the bare collision count is invariant under shuffling BY CONSTRUCTION. Only the\n"
          "     spatial form carries signal, and adjacency is the asset borrowing as designed.")

    print("\n=== stratified sample for the independent (OSM) instrument ===")
    write_csv(rows, args.out, args.per_source, args.named.split(","))
    if args.json:
        json.dump(rows, open(args.json, "w", encoding="utf-8"), indent=0)
        print(f"wrote raw rows -> {args.json}")
    print("\nNEXT: python scripts/validate_shore_normals_osm.py --csv "
          f"{args.out} --verdict served --limit 200 --compare-coarse --out-csv graded.csv")


if __name__ == "__main__":
    main()
