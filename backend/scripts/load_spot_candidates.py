#!/usr/bin/env python3
"""Load surf-spot CANDIDATES into the holding table (`surf_spot_candidates`). DRY RUN unless `--commit`.

This script cannot add, move, hide or delete a surf spot. It reads `surf_spots` (id, name, coordinate) to tier each
candidate against the catalogue, and with `--commit` it INSERTs rows into the holding table only. A record already in
the holding table (same source and source record id) is left exactly as it is, so a reload never undoes a review.

A committed load on production is a data write: it needs the owner's word in the session that runs it.

Input: a JSON list of records, each `[record_id, name, latitude, longitude, country, labels]` (the shape of the
Foursquare Open Source Places pull) or an object with those keys.

    python scripts/load_spot_candidates.py pull.json --source foursquare_os_places \\
        --licence "<licence name>" --attribution "<attribution line>" --batch-id fsq-2026-11-18 \\
        [--catalogue-json spots.json] [--shoreline-json distance_km.json] [--max-shoreline-km 1.0] [--commit]

`--catalogue-json` tiers against a file instead of the database (dry run only; a commit always tiers against the
database it writes to).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import Counter
from typing import Any, Dict, Iterable, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spot_candidates import SpotIndex, classify, is_business, valid_coordinate  # noqa: E402

_KEYS = ("record_id", "name", "latitude", "longitude", "country", "labels")
_CHUNK = 500


def _record(raw: Any) -> Optional[Dict[str, Any]]:
    if isinstance(raw, dict):
        record = {key: raw.get(key) for key in _KEYS}
    elif isinstance(raw, (list, tuple)) and len(raw) >= 4:
        record = dict(zip(_KEYS, list(raw) + [None] * (len(_KEYS) - len(raw))))
    else:
        return None
    if not record["record_id"] or not str(record["name"] or "").strip():
        return None
    if not valid_coordinate(record["latitude"], record["longitude"]):
        return None
    return record


def _shoreline(value: Any):
    """(km, (latitude, longitude) or None) from a shoreline file entry.

    Two shapes are read: a bare distance in km (the first filter's file), and `[km, latitude, longitude]` from
    `spot_candidate_shoreline.py`, which also carries the nearest shoreline POINT, the placement suggestion."""
    if isinstance(value, bool) or value is None:
        return None, None
    if isinstance(value, (int, float)):
        return float(value), None
    if isinstance(value, (list, tuple)) and len(value) == 3 and valid_coordinate(value[1], value[2]) \
            and isinstance(value[0], (int, float)) and not isinstance(value[0], bool):
        return float(value[0]), (float(value[1]), float(value[2]))
    return None, None


def plan(records: Iterable[Any], spots: Iterable[Dict[str, Any]], *, source: str, licence: str, attribution: str,
         batch_id: str, shoreline_km: Optional[Dict[str, Any]] = None,
         max_shoreline_km: Optional[float] = None) -> Dict[str, Any]:
    """The holding-table rows a load would write, and what was left out and why. Pure: touches no database."""
    index = SpotIndex(spots)
    rows: List[Dict[str, Any]] = []
    skipped: Counter = Counter()
    seen = set()
    for raw in records:
        record = _record(raw)
        if record is None:
            skipped["unusable (no id, no name or bad coordinate)"] += 1
            continue
        record_id = str(record["record_id"])
        if record_id in seen:
            skipped["repeated in the file"] += 1
            continue
        seen.add(record_id)
        if is_business(record["name"], record["labels"]):
            skipped["business (school, shop, hotel)"] += 1
            continue
        distance, suggestion = _shoreline((shoreline_km or {}).get(record_id))
        if max_shoreline_km is not None:
            if distance is None:
                skipped["no shoreline distance"] += 1
                continue
            if distance > max_shoreline_km:
                skipped[f"more than {max_shoreline_km:g} km from an ocean shoreline"] += 1
                continue
        latitude, longitude = float(record["latitude"]), float(record["longitude"])
        rows.append({
            "source": source, "source_record_id": record_id, "source_licence": licence,
            "source_attribution": attribution, "batch_id": batch_id,
            "name": str(record["name"]).strip()[:255], "latitude": latitude, "longitude": longitude,
            "country": (str(record["country"])[:100] if record["country"] else None),
            "source_labels": list(record["labels"]) if record["labels"] else None,
            "shoreline_km": distance, "status": "pending",
            "suggested_latitude": suggestion[0] if suggestion else None,
            "suggested_longitude": suggestion[1] if suggestion else None,
            "suggested_method": "nearest_shoreline" if suggestion else None,
            **classify(record["name"], latitude, longitude, index),
        })
    return {"rows": rows, "skipped": dict(skipped), "tiers": dict(Counter(row["tier"] for row in rows)),
            "catalogue_rows": index.size}


async def read_catalogue(session) -> List[Dict[str, Any]]:
    """Every catalogue row, hidden ones included. Read only."""
    from sqlalchemy import select
    from models import SurfSpot
    result = await session.execute(select(SurfSpot.id, SurfSpot.name, SurfSpot.latitude, SurfSpot.longitude))
    return [{"id": r.id, "name": r.name, "latitude": r.latitude, "longitude": r.longitude} for r in result.all()]


async def commit(session, rows: List[Dict[str, Any]]) -> Dict[str, int]:
    """INSERT the rows that are not in the holding table yet. Existing candidates are never touched."""
    from sqlalchemy import insert, select
    from models import SurfSpotCandidate
    from models.base import generate_uuid

    inserted = already = 0
    by_source: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        by_source.setdefault(row["source"], []).append(row)
    for source, source_rows in by_source.items():
        existing = set((await session.execute(
            select(SurfSpotCandidate.source_record_id).where(SurfSpotCandidate.source == source))).scalars().all())
        fresh = [row for row in source_rows if row["source_record_id"] not in existing]
        already += len(source_rows) - len(fresh)
        for start in range(0, len(fresh), _CHUNK):
            chunk = [{"id": generate_uuid(), **row} for row in fresh[start:start + _CHUNK]]
            await session.execute(insert(SurfSpotCandidate), chunk)
            inserted += len(chunk)
    await session.commit()
    return {"inserted": inserted, "already_present": already}


def _load_json(path: str) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


async def _main(args) -> int:
    records = _load_json(args.pull)
    shoreline = _load_json(args.shoreline_json) if args.shoreline_json else None
    if args.max_shoreline_km is not None and shoreline is None:
        print("--max-shoreline-km needs --shoreline-json", file=sys.stderr)
        return 2
    if args.commit and args.catalogue_json:
        print("--commit tiers against the database it writes to; drop --catalogue-json", file=sys.stderr)
        return 2

    if args.catalogue_json:
        spots, session_maker = _load_json(args.catalogue_json), None
    else:
        from database import AsyncSessionLocal as session_maker
        async with session_maker() as session:
            spots = await read_catalogue(session)

    result = plan(records, spots, source=args.source, licence=args.licence, attribution=args.attribution,
                  batch_id=args.batch_id, shoreline_km=shoreline, max_shoreline_km=args.max_shoreline_km)
    print(f"records in the file: {len(records)} | catalogue rows compared against: {result['catalogue_rows']}")
    for reason, count in sorted(result["skipped"].items()):
        print(f"  left out {count:>6}  {reason}")
    print(f"candidates: {len(result['rows'])}")
    for tier in sorted(result["tiers"]):
        print(f"  tier {tier}: {result['tiers'][tier]:>6}")

    if not args.commit:
        print("DRY RUN: nothing written. Pass --commit to insert into the holding table.")
        return 0
    async with session_maker() as session:
        written = await commit(session, result["rows"])
    print(f"holding table: inserted {written['inserted']}, already present {written['already_present']}. "
          "surf_spots was only read.")
    return 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pull")
    parser.add_argument("--source", required=True)
    parser.add_argument("--licence", required=True)
    parser.add_argument("--attribution", required=True)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--catalogue-json")
    parser.add_argument("--shoreline-json")
    parser.add_argument("--max-shoreline-km", type=float)
    parser.add_argument("--commit", action="store_true")
    return asyncio.run(_main(parser.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
