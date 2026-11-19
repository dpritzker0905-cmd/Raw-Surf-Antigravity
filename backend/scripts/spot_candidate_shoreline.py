#!/usr/bin/env python3
"""The nearest OCEAN SHORELINE point for each surf-spot candidate. Offline; reads two files, writes one.

Owner, 2026-11-18: "we should create a helper tool that helps us place them at least in the nearest known location
first, before we confirm them." A source's coordinate for a surf spot is often a car park or a town centre. The one
place we can always name without anyone's map is the nearest ocean shoreline, so that is what the placement helper
suggests; a person then confirms it or drags the pin to the break.

Source: NOAA GSHHG, full resolution, level 1 (the boundary between land and ocean; lakes and their islands are other
levels and are ignored). Public domain. The file (`gshhs_f.b`, about 180 MB) is NOT in the repository:
download the GSHHG binary archive from NOAA NCEI and pass its path.

    python scripts/spot_candidate_shoreline.py pull.json gshhs_f.b shoreline.json [--reach-km 3]

`shoreline.json` maps each record id to `[km, latitude, longitude]` of the nearest shoreline point, or `null` when
none lies within the reach. `load_spot_candidates.py --shoreline-json` reads it. Nothing here touches a database.

Before it writes anything it checks controls (known breaks must be within 1 km, known inland points must not be).
If a control fails the run is VOID: it says so and exits non-zero without writing.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Iterable, Iterator, List, Optional, Sequence, Tuple

import numpy as np

CELL = 0.05                       # degrees
NX = int(round(360 / CELL))
KM_PER_DEGREE = 111.2
DENSIFY_KM = 0.2                  # shoreline segments are filled in to at most this spacing
HEADER_WORDS = 11                 # a GSHHG polygon header is 11 big-endian int32

# Known surf breaks (must be within 1 km of an ocean shoreline) and known inland points (must not be).
MUST_PASS = {"Pipeline": (21.6650, -158.0500), "Unstad": (68.267, 13.585), "Carcavelos": (38.679, -9.335)}
MUST_FAIL = {"Kuala Lumpur": (3.0710, 101.7577), "Kansas": (38.5, -98.0), "Chicago lakefront": (41.90, -87.62)}


def _cell(latitude: float, longitude: float) -> Tuple[int, int]:
    return int(math.floor((latitude + 90) / CELL)), int(math.floor(((longitude + 180) % 360) / CELL))


def _spans(latitude: float, reach_km: float) -> Tuple[int, int]:
    rows = int(reach_km / (KM_PER_DEGREE * CELL)) + 1
    columns = int(reach_km / (KM_PER_DEGREE * CELL * max(0.05, math.cos(math.radians(latitude))))) + 1
    return rows, columns


def read_level1(path: str) -> Iterator[Tuple[np.ndarray, np.ndarray]]:
    """(longitudes, latitudes) in degrees for every level-1 polygon in a GSHHG binary file."""
    words = np.fromfile(path, dtype=">i4")
    position = 0
    while position < len(words):
        count, flag = int(words[position + 1]), int(words[position + 2])
        points = words[position + HEADER_WORDS: position + HEADER_WORDS + 2 * count].reshape(count, 2)
        position += HEADER_WORDS + 2 * count
        if flag & 255 == 1:
            yield points[:, 0].astype(np.float64) * 1e-6, points[:, 1].astype(np.float64) * 1e-6


class ShorelineIndex:
    """Shoreline points near a set of query points, on a 0.05-degree grid.

    Only the grid cells within `reach_km` of some query point are kept, so the full-resolution file (tens of millions
    of points) fits in memory. Longitudes wrap at the antimeridian."""

    def __init__(self, polygons: Iterable[Tuple[np.ndarray, np.ndarray]], queries: Sequence[Tuple[float, float]],
                 reach_km: float = 3.0):
        self.reach_km = float(reach_km)
        wanted = set()
        for latitude, longitude in queries:
            row, column = _cell(latitude, longitude)
            rows, columns = _spans(latitude, self.reach_km)
            for a in range(row - rows, row + rows + 1):
                for b in range(column - columns, column + columns + 1):
                    wanted.add(a * NX + (b % NX))
        wanted_keys = np.array(sorted(wanted), dtype=np.int64)
        lats: List[np.ndarray] = []
        lons: List[np.ndarray] = []
        keys: List[np.ndarray] = []
        self.polygons = 0
        for x, y in polygons:
            self.polygons += 1
            if len(x) < 2 or not len(wanted_keys):
                continue
            dx = (np.diff(x) + 180) % 360 - 180
            dy = np.diff(y)
            length = KM_PER_DEGREE * np.hypot(dx * np.cos(np.radians((y[:-1] + y[1:]) / 2)), dy)
            pieces = np.minimum(np.maximum(1, np.ceil(length / DENSIFY_KM).astype(np.int64)), 2000)
            segment = np.repeat(np.arange(len(pieces)), pieces)
            start = np.cumsum(pieces) - pieces
            fraction = (np.arange(len(segment)) - start[segment]) / pieces[segment]
            px = x[:-1][segment] + dx[segment] * fraction
            py = y[:-1][segment] + dy[segment] * fraction
            key = (np.floor((py + 90) / CELL).astype(np.int64) * NX
                   + (np.floor(((px + 180) % 360) / CELL).astype(np.int64) % NX))
            at = np.minimum(np.searchsorted(wanted_keys, key), len(wanted_keys) - 1)
            keep = wanted_keys[at] == key
            if keep.any():
                lats.append(py[keep])
                lons.append(((px[keep] + 180) % 360) - 180)
                keys.append(key[keep])
        if keys:
            lat, lon, key = np.concatenate(lats), np.concatenate(lons), np.concatenate(keys)
            order = np.argsort(key, kind="stable")
            self._lat, self._lon, self._key = lat[order], lon[order], key[order]
        else:
            self._lat = self._lon = np.empty(0)
            self._key = np.empty(0, dtype=np.int64)
        self.points = len(self._key)

    def nearest(self, latitude: float, longitude: float) -> Optional[Tuple[float, float, float]]:
        """(km, latitude, longitude) of the nearest shoreline point within the reach, or None."""
        row, column = _cell(latitude, longitude)
        rows, columns = _spans(latitude, self.reach_km)
        cosine = math.cos(math.radians(latitude))
        best: Optional[Tuple[float, float, float]] = None
        for a in range(row - rows, row + rows + 1):
            for b in range(column - columns, column + columns + 1):
                key = a * NX + (b % NX)
                low, high = np.searchsorted(self._key, key, "left"), np.searchsorted(self._key, key, "right")
                if high <= low:
                    continue
                dx = (self._lon[low:high] - longitude + 180) % 360 - 180
                km = KM_PER_DEGREE * np.sqrt((dx * cosine) ** 2 + (self._lat[low:high] - latitude) ** 2)
                at = int(np.argmin(km))
                if best is None or float(km[at]) < best[0]:
                    best = (float(km[at]), float(self._lat[low + at]), float(self._lon[low + at]))
        if best is None or best[0] > self.reach_km:
            return None
        return best


def check_controls(index: ShorelineIndex, limit_km: float = 1.0) -> List[str]:
    """Problems with the controls (empty when the index can be trusted)."""
    problems = []
    for name, point in MUST_PASS.items():
        found = index.nearest(*point)
        if found is None or found[0] > limit_km:
            problems.append(f"{name} is a known break but is not within {limit_km:g} km of a shoreline")
    for name, point in MUST_FAIL.items():
        found = index.nearest(*point)
        if found is not None and found[0] <= limit_km:
            problems.append(f"{name} is inland but reads {found[0]:.2f} km from an ocean shoreline")
    return problems


def _records(raw: Iterable) -> List[Tuple[str, float, float]]:
    out = []
    for item in raw:
        if isinstance(item, dict):
            record_id, latitude, longitude = item.get("record_id"), item.get("latitude"), item.get("longitude")
        elif isinstance(item, (list, tuple)) and len(item) >= 4:
            record_id, latitude, longitude = item[0], item[2], item[3]
        else:
            continue
        if (record_id and isinstance(latitude, (int, float)) and isinstance(longitude, (int, float))
                and not isinstance(latitude, bool) and -90 <= latitude <= 90 and -180 <= longitude <= 180):
            out.append((str(record_id), float(latitude), float(longitude)))
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pull")
    parser.add_argument("gshhs")
    parser.add_argument("out")
    parser.add_argument("--reach-km", type=float, default=3.0)
    args = parser.parse_args()

    with open(args.pull, encoding="utf-8") as handle:
        records = _records(json.load(handle))
    controls = list(MUST_PASS.values()) + list(MUST_FAIL.values())
    index = ShorelineIndex(read_level1(args.gshhs), controls + [(lat, lon) for _id, lat, lon in records],
                           reach_km=args.reach_km)
    print(f"records: {len(records)} | level-1 polygons read: {index.polygons} | shoreline points kept: {index.points}")
    problems = check_controls(index)
    if problems:
        for problem in problems:
            print("CONTROL FAILED:", problem)
        print("VOID: nothing written.")
        return 1
    print(f"controls passed ({len(MUST_PASS)} known breaks within 1 km, {len(MUST_FAIL)} inland points not).")

    result, within = {}, {0.5: 0, 1.0: 0, 2.0: 0}
    for record_id, latitude, longitude in records:
        found = index.nearest(latitude, longitude)
        result[record_id] = None if found is None else [round(found[0], 3), round(found[1], 6), round(found[2], 6)]
        for limit in within:
            within[limit] += found is not None and found[0] <= limit
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    none = sum(1 for value in result.values() if value is None)
    print(f"within 0.5 km: {within[0.5]} | within 1 km: {within[1.0]} | within 2 km: {within[2.0]} | "
          f"none within {args.reach_km:g} km: {none}")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
