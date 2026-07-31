"""backfill_geometry_reject_reasons.py — make "this pin must move" queryable product state.

THE PROBLEM (START-HERE 2026-07-31 §2, audit-corrected order): 413 spot rows sit in the reconcile
queue as `never_resolved`, but a 24-spot sample measured that EVERY one had been deliberately
REJECTED by the fit gate (62% ambiguous_coastline, 38% placement). A naive reconcile job would
burn 413 x ~22 s of public NOAA ERDDAP reproducing known rejections, every cycle, forever. The
staleness contract already refuses to re-queue a row with a `geometry_reject_reason` — this
script's job is to PUT the reason there, once.

HOW IT CLASSIFIES (three buckets, cheapest first — the gate CSV was a build artifact and is gone):
  seedable     — the runtime chain ALREADY resolves a fine bearing here (asset/overlay grew since
                 the seed): write the full geometry row. Offline, free.
  not_coastal  — the PRODUCT's own geography-only coastal gate says this coordinate is not a
                 coast: reason `not_coastal_placement`. Offline, free. (The product already serves
                 this spot on that basis — this is not a new detector, cf. the water-blind
                 placement-detector trap.)
  needs_fit    — actionable per readiness: pays ONE ~22 s ERDDAP fit through the SAME
                 measure()/accepted() gate the asset build uses (`resolve_one`), bounded by
                 --limit and resumable (a re-run re-reads the DB and skips written rows).
                 published -> full row (+ overlay) · depth_only -> break depth + reason ·
                 rejected -> reason · failed -> left in the queue (retryable).

WRITES NOTHING ITSELF. Emits an idempotent SQL artifact (every UPDATE guarded on
`geometry_resolved_at IS NULL AND geometry_reject_reason IS NULL`) for the approved direct-SQL
lane — REST PATCH is 403 by RLS posture on surf_spots, and this workstation's machine-wide
`PGHOSTADDR=0.0.0.0` hijacks any local libpq connection (HANDOFF-2026-07-31 §1 ops traps).

Usage (from backend/):
  python scripts/backfill_geometry_reject_reasons.py --dry-run          # census, zero network
  python scripts/backfill_geometry_reject_reasons.py --limit 12         # offline buckets + 12 fits
  python scripts/backfill_geometry_reject_reasons.py --limit 0          # offline buckets only
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.weather_pipeline.spot_geometry_db import (  # noqa: E402
    geometry_row_from_resolution, needs_geometry_refresh)

NOT_COASTAL_REASON = "not_coastal_placement"

_GEO_SELECT = ("id,name,latitude,longitude,geometry_resolved_at,geometry_reject_reason,"
               "geometry_lat,geometry_lng")


def _fetch_rows(session, url, svc):
    """Every active spot with its geometry state. Paginated — Supabase REST caps at 1000 rows and
    truncates SILENTLY on a 200 (this bit four separate sessions; never trust one page)."""
    from scripts.local_size_gonogo import _get_json
    rows, offset = [], 0
    while True:
        page = _get_json(session, f"{url}/rest/v1/surf_spots?select={_GEO_SELECT}"
                                  f"&is_active=eq.true&latitude=not.is.null"
                                  f"&order=id&offset={offset}&limit=1000", svc, "spots page")
        rows.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    return rows


def _sql_quote(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def _guarded_update(spot_id, assignments) -> str:
    """An idempotent UPDATE: only fires while the row is still unresolved AND unreasoned, so a
    concurrent fit (or a re-applied artifact) can never be stomped."""
    sets = ", ".join(f"{k} = {_sql_quote(v)}" for k, v in assignments.items())
    return (f"UPDATE surf_spots SET {sets} WHERE id = {_sql_quote(spot_id)} "
            f"AND geometry_resolved_at IS NULL AND geometry_reject_reason IS NULL;")


def main():
    ap = argparse.ArgumentParser(
        description="Backfill geometry_reject_reason (and any newly-resolvable geometry rows) "
                    "for the never_resolved reconcile queue. Emits SQL; writes nothing itself.")
    ap.add_argument("--dry-run", action="store_true", help="census only, zero network fitting")
    ap.add_argument("--limit", type=int, default=12,
                    help="max ERDDAP fits this run (~22 s each; 0 = offline buckets only)")
    ap.add_argument("--out", default=None, help="artifact basename (default: alongside script)")
    args = ap.parse_args()

    import requests
    from scripts.local_size_gonogo import _prod_credentials
    from services.weather_pipeline import resolve_spot_geometry as R
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    from services.weather_pipeline.shore_normal_asset import shore_normal_at as asset_normal_at

    session = requests.Session()
    url, svc, _env = _prod_credentials(session)
    rows = _fetch_rows(session, url, svc)
    queue = [r for r in rows if needs_geometry_refresh(r) == "never_resolved"]
    moved = [r for r in rows if needs_geometry_refresh(r) == "moved"]
    already_reasoned = sum(1 for r in rows if r.get("geometry_reject_reason"))
    print(f"active spots {len(rows)} | never_resolved {len(queue)} | moved {len(moved)} | "
          f"already reasoned {already_reasoned}")

    # ── The offline pass: what does the PRODUCT already know about each queued coordinate? ──
    now = datetime.now(timezone.utc)
    seedable, not_coastal, needs_fit, odd = [], [], [], []
    for s in queue:
        lat, lng = float(s["latitude"]), float(s["longitude"])
        try:
            geo = resolve_surf_geometry(lat, lng)
        except Exception:
            odd.append((s, "resolve_error"))
            continue
        src = geo.shore_normal_src or "none"
        if src == "etopo" or str(src).startswith("override"):
            spread = None
            if src == "etopo":
                try:
                    _n, spread = asset_normal_at(lat, lng)
                except Exception:
                    spread = None
            row = geometry_row_from_resolution(lat, lng, geo.shore_normal_deg, src, spread,
                                               geo.break_depth_m, now=now)
            if row is not None:
                seedable.append((s, row))
                continue
        if not geo.coastal:
            not_coastal.append(s)
        else:
            needs_fit.append(s)

    print(f"offline buckets  : seedable {len(seedable)} | not_coastal {len(not_coastal)} | "
          f"needs_fit {len(needs_fit)} | odd {len(odd)}")
    if args.dry_run:
        print(f"DRY RUN — nothing fitted, nothing emitted. Clearing needs_fit sequentially "
              f"costs ~{len(needs_fit) * 22 / 60:.0f} min of ERDDAP across future bounded runs.")
        return 0

    statements, results_log = [], []
    for s, row in seedable:
        statements.append(_guarded_update(s["id"], row))
        results_log.append({"id": s["id"], "name": s.get("name"), "action": "seed_row",
                            "source": row["geometry_source"]})
    for s in not_coastal:
        statements.append(_guarded_update(s["id"], {"geometry_reject_reason": NOT_COASTAL_REASON}))
        results_log.append({"id": s["id"], "name": s.get("name"), "action": "reason",
                            "reason": NOT_COASTAL_REASON})

    # ── The paid pass: the SAME gate the asset build uses, bounded and resumable. ──
    fitted = {"published": 0, "depth_only": 0, "rejected": 0, "failed": 0, "skipped": 0}
    if args.limit > 0 and needs_fit:
        t0 = time.time()
        out = R.resolve_many(
            needs_fit, limit=args.limit,
            on_result=lambda r: print(f"   {(r['name'] or '?')[:34]:34s} {r['status']:10s} "
                                      f"{r['reason'] or ''}"))
        fitted = out["counts"]
        for r in out["results"]:
            sid = r.get("id")
            if sid is None:
                continue
            if r["status"] == "published":
                row = geometry_row_from_resolution(float(r["lat"]), float(r["lng"]), r["normal"],
                                                   "etopo", r["spread"], r["break_depth_m"],
                                                   now=now)
                if row is not None:
                    statements.append(_guarded_update(sid, row))
            elif r["status"] == "depth_only":
                assignments = {"geometry_reject_reason": r["reason"]}
                if r.get("break_depth_m") is not None:
                    assignments["break_depth_m"] = round(float(r["break_depth_m"]), 2)
                statements.append(_guarded_update(sid, assignments))
            elif r["status"] == "rejected":
                statements.append(_guarded_update(sid, {"geometry_reject_reason": r["reason"]}))
            # failed -> retryable, stays in the queue; skipped -> readiness says a fit won't help
            results_log.append({"id": sid, "name": r.get("name"), "action": r["status"],
                                "reason": r.get("reason")})
        print(f"fit counts       : {json.dumps(fitted)}  in {time.time() - t0:.0f}s")
        if out.get("reasons"):
            print(f"rejection reasons: {json.dumps(out['reasons'])}")
        if fitted.get("published") or fitted.get("depth_only"):
            n = R.persist_overlay()
            print(f"overlay persisted: {n} entries (a CACHE — the DB row + committed asset are "
                  f"the durable stores)")

    base = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "geometry_backfill")
    sql_path, log_path = base + ".sql", base + ".json"
    with open(sql_path, "w", encoding="utf-8") as fh:
        fh.write(f"-- geometry_reject_reason backfill, generated {now.isoformat()}\n"
                 f"-- every UPDATE is guarded on (geometry_resolved_at IS NULL AND\n"
                 f"-- geometry_reject_reason IS NULL): idempotent, never stomps a concurrent fit.\n")
        fh.write("\n".join(statements) + "\n")
    with open(log_path, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": now.isoformat(),
                   "queue": len(queue), "moved": len(moved),
                   "buckets": {"seedable": len(seedable), "not_coastal": len(not_coastal),
                               "needs_fit": len(needs_fit), "odd": len(odd)},
                   "fitted": fitted, "results": results_log}, fh, indent=1)
    print(f"\n{len(statements)} guarded UPDATEs -> {sql_path}")
    print(f"log -> {log_path}")
    print("Apply through the direct-SQL lane (Supabase MCP execute_sql); REST PATCH is 403 and "
          "local libpq is hijacked by PGHOSTADDR.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
