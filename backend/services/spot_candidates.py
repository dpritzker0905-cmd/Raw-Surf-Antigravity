"""Duplicate tiers for surf-spot CANDIDATES (the holding table, `models/spot_candidates.py`).

A candidate is compared with EVERY catalogue row, hidden ones included, and put in exactly one tier, the first that
applies. Nothing is added or dropped by distance alone: real, distinct breaks sit 62 m apart (Backdoor / Pipeline) and
real duplicates sit 3 km apart under the same name (Stinson Beach, 3.24 km). The tier only sorts the review queue.

    A  within 100 m of an existing spot                         probable duplicate
    B  name matches an existing spot within 2 km                probable duplicate
    C  100-500 m from an existing spot, name differs            near neighbour
    D  0.5-2 km from an existing spot, name differs             near neighbour
    E  name matches an existing spot 2-8 km away                probable duplicate (bad coordinate on one side)
    F  more than 2 km from every spot, no name match in 8 km    no existing spot nearby

Measured on 26,308 Foursquare "Surf Spot" records against the catalogue, 2026-11-18: A 49, B 444, C 357, D 1,460,
E 266, F 23,732. The name rule is the shared matcher (`spot_duplicates.names_match`); there is no second one.

Pure arithmetic: no database, no network. Nothing here can write a spot.
"""
import math
import unicodedata
from collections import defaultdict
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

try:
    from services.spot_duplicates import SAME_BREAK_KM, haversine_km, names_match
except ImportError:  # run by path from backend/scripts
    from spot_duplicates import SAME_BREAK_KM, haversine_km, names_match

SAME_PIN_KM = 0.1        # tier A
CLOSE_KM = 0.5           # tier C upper edge
NEIGHBOUR_KM = 2.0       # tiers B and D upper edge; the importer's DEDUPE_KM
NAME_MATCH_KM = SAME_BREAK_KM   # tier E upper edge (8 km)

PROBABLE_DUPLICATE_TIERS = ("A", "B", "E")
NEAR_NEIGHBOUR_TIERS = ("C", "D")

# A source's "Surf Spot" category also holds surf schools, shops and hotels. These are dropped before tiering.
BUSINESS_WORDS = ("school", "shop", "store", "rental", "hire", "camp", "club", "lesson", "academy", "hostel", "hotel",
                  "lodge", "resort", "tour", "cafe", "bar", "restaurant", "escuela", "ecole", "schule", "scuola",
                  "escola", "company", " inc", " ltd")
BUSINESS_TOP_LABELS = ("retail", "dining and drinking", "travel and transportation",
                       "business and professional services")

_CELL = 0.05                       # degrees; about 5.5 km of latitude
_COLUMNS = int(round(360 / _CELL))


def _fold(text: Optional[str]) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in text if not unicodedata.combining(c)).lower().strip()


def is_business(name: Optional[str], labels: Optional[Iterable[str]] = None) -> bool:
    """True when the record reads as a business (surf school, shop, hotel) and not a place in the water."""
    folded = _fold(name)
    if any(word in folded for word in BUSINESS_WORDS):
        return True
    return any(_fold(str(label).split(" > ")[0]) in BUSINESS_TOP_LABELS for label in (labels or ()))


def valid_coordinate(latitude: Any, longitude: Any) -> bool:
    if isinstance(latitude, bool) or isinstance(longitude, bool):
        return False
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return False
    if not (math.isfinite(latitude) and math.isfinite(longitude)):
        return False
    return -90 <= latitude <= 90 and -180 <= longitude <= 180


class SpotIndex:
    """The catalogue on a 0.05-degree grid, so 26,000 candidates do not each scan every spot.

    `spots` are dicts with id / name / latitude / longitude. Pass EVERY row, hidden ones too: a hidden spot is still
    a row a new one would duplicate."""

    def __init__(self, spots: Iterable[Dict[str, Any]]):
        self._cells: Dict[Tuple[int, int], List[Tuple[float, float, Dict[str, Any]]]] = defaultdict(list)
        self.size = 0
        for spot in spots or ():
            latitude, longitude = spot.get("latitude"), spot.get("longitude")
            if not valid_coordinate(latitude, longitude):
                continue
            self._cells[self._key(latitude, longitude)].append((float(latitude), float(longitude), spot))
            self.size += 1

    @staticmethod
    def _key(latitude: float, longitude: float) -> Tuple[int, int]:
        return int(math.floor(latitude / _CELL)), int(math.floor((longitude + 180.0) / _CELL)) % _COLUMNS

    def near(self, latitude: float, longitude: float, radius_km: float) -> Iterator[Tuple[float, Dict[str, Any]]]:
        """(km, spot) for every spot within `radius_km`. Columns wrap at the antimeridian."""
        row, column = self._key(latitude, longitude)
        rows = int(radius_km / 5.5) + 1
        columns = int(radius_km / (5.5 * max(0.05, math.cos(math.radians(latitude))))) + 1
        if 2 * columns + 1 >= _COLUMNS:
            column_range: Iterable[int] = range(_COLUMNS)
        else:
            column_range = sorted({(column + d) % _COLUMNS for d in range(-columns, columns + 1)})
        for r in range(row - rows, row + rows + 1):
            for c in column_range:
                for spot_latitude, spot_longitude, spot in self._cells.get((r, c), ()):
                    km = haversine_km(latitude, longitude, spot_latitude, spot_longitude)
                    if km <= radius_km:
                        yield km, spot


def classify(name: Optional[str], latitude: float, longitude: float, index: SpotIndex) -> Dict[str, Any]:
    """The tier of one candidate against the catalogue, with the spots that decided it.

    Returns tier, nearest_spot_id / _name / _km (nearest spot within 8 km, any name) and name_match_spot_id /
    _name / _km (nearest NAME-MATCHING spot within 8 km). Missing ones are None."""
    near = sorted(index.near(latitude, longitude, NAME_MATCH_KM), key=lambda pair: pair[0])
    nearest = near[0] if near else None
    match = next(((km, spot) for km, spot in near if names_match(name, spot.get("name"))), None)
    nearest_km = nearest[0] if nearest else None

    if nearest_km is not None and nearest_km <= SAME_PIN_KM:
        tier = "A"
    elif match is not None and match[0] <= NEIGHBOUR_KM:
        tier = "B"
    elif nearest_km is not None and nearest_km <= CLOSE_KM:
        tier = "C"
    elif nearest_km is not None and nearest_km <= NEIGHBOUR_KM:
        tier = "D"
    elif match is not None:
        tier = "E"
    else:
        tier = "F"

    def _spot(pair, prefix, distance_key):
        if pair is None:
            return {f"{prefix}_id": None, f"{prefix}_name": None, distance_key: None}
        return {f"{prefix}_id": pair[1].get("id"), f"{prefix}_name": pair[1].get("name"),
                distance_key: round(pair[0], 3)}

    return {"tier": tier,
            **_spot(nearest, "nearest_spot", "nearest_spot_km"),
            **_spot(match, "name_match_spot", "name_match_km")}
