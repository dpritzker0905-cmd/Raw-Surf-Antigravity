"""spot_duplicates.py — is this the same break written twice? ONE implementation.

WHY THIS IS A SERVICE AND NOT A SCRIPT
--------------------------------------
The name matcher lived in `scripts/find_missing_spots.py` and the tier classifier in
`scripts/triage_duplicate_spots.py`, so the only way to see the catalogue's duplicates was to run a
script and read a terminal. That put a human in the loop for something the product should show, and
it meant the admin UI and the tooling could drift into two different definitions of "duplicate" —
the same split that let `weather_sim_mcp` and production disagree about a spot's coordinates.

Scripts now import FROM here. Services are the library; scripts and routes are consumers.

THE TIERS, and why the middle one exists
----------------------------------------
  IDENTICAL       same name after normalisation           -> safe to merge
  VARIANT         one name contains the other             -> A HUMAN MUST LOOK
  WEAK            partial token overlap                   -> a human must look
  DISTINCT_PEAKS  the names differ by POSITION            -> never merge

★ The discriminator is not "do these names overlap" — it is WHAT THE DIFFERENCE MEANS. Calibrated
2026-07-28 against pairs a human had already adjudicated, which REJECTED a first draft that treated
feature nouns (`main`, `peak`, `bowl`, `reef`, `inlet`) as positional: that classified three known
duplicates (`Uluwatu` / `Uluwatu - The Peak`, `Margaret River` / `Main Break Margaret River`,
`Ala Moana Beach` / `Ala Moana Bowls`) as distinct peaks. A surf name's feature noun is decoration;
only its POSITION separates two peaks on one feature.
"""
import math
import unicodedata
from typing import Any, Dict, List, Optional

# Beyond simple proximity, a NAME match up to this distance is still the same break in a different
# place — measured: four false "missing" headline breaks sat 2.42-5.13 km from their catalogue row.
SAME_BREAK_KM = 8.0

# Non-discriminating tokens. Two names sharing ONLY these denote nothing in common.
# ⚠️ The articles/prepositions were added 2026-07-28 after a measured false positive: replaying the
# EEA import rejected `MADALENA DO MAR` as a duplicate of `Jardim do Mar` — two distinct Madeira
# villages — because `{do, mar}` is two shared tokens. Iberian and French coastal names are largely
# built from these.
# ★ Adding here makes the matcher STRICTER. Never add a token that could BE a spot name.
DROP_TOKENS = {
    "the", "beach", "point", "bay", "surf", "break", "spot", "praia", "playa", "plage",
    "do", "da", "dos", "das", "de", "del", "la", "el", "los", "las", "le", "les",
    "du", "des", "di", "al",
    "mar", "sea", "ocean", "plaja", "strand",
}

# Tokens meaning "a DIFFERENT peak on the same feature". Every one was learned from a pair a human
# adjudicated as REAL AND DISTINCT. Feature nouns are deliberately absent — see the module docstring.
POSITIONAL = {
    "north", "south", "east", "west", "n", "s", "e", "w", "ne", "nw", "se", "sw",
    "upper", "lower", "middle", "inner", "outer", "left", "right",
    "first", "second", "third",
    "jetty", "pier", "groyne",
}

TIER_ORDER = {"IDENTICAL": 0, "VARIANT": 1, "WEAK": 2, "DISTINCT_PEAKS": 3}


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def normalise_name(s: Optional[str]) -> set:
    """Lowercase alphanumeric tokens, minus decoration that differs between sources.

    'Jaws (Peahi)' vs 'Jaws', 'Guincho Beach' vs 'Guincho', 'El Médano' vs 'El Medano'."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    # Apostrophes and the Hawaiian okina are INTERNAL to a word, not separators — splitting on them
    # turns "Pe'ahi" into {pe, ahi}, which matches nothing and would drop every Hawaiian break
    # (Pe'ahi, Ho'okipa, Ka'ena) out of the duplicate gate.
    for ch in ("'", "‘", "’", "ʻ", "`"):
        s = s.replace(ch, "")
    return {t for t in "".join(c if c.isalnum() else " " for c in s).split()
            if t and t not in DROP_TOKENS}


def names_match(a: Optional[str], b: Optional[str]) -> bool:
    """True when two spot names plausibly denote the same break.

    ⚠️ Deliberately LOOSE — this is the duplicate GATE, where a false reject costs one candidate and
    a false accept costs a permanent split of reports and search across two rows. A coordinate
    CORRECTION needs the strict matcher instead (propose_spot_corrections.strict_names_match)."""
    ta, tb = normalise_name(a), normalise_name(b)
    if not ta or not tb:
        return False
    return bool(ta & tb) and (ta <= tb or tb <= ta or len(ta & tb) >= 2)


def _positional(tokens) -> set:
    return {t for t in tokens if t in POSITIONAL or any(c.isdigit() for c in t)}


def classify(name_a: str, name_b: str) -> tuple:
    """(tier, why) for a candidate pair — see the module docstring for what each tier means."""
    ta, tb = normalise_name(name_a), normalise_name(name_b)
    diff = ta ^ tb
    positional = _positional(diff)
    if positional:
        return "DISTINCT_PEAKS", f"differ by position: {', '.join(sorted(positional))}"
    if ta == tb:
        return "IDENTICAL", "identical after normalisation"
    if ta <= tb or tb <= ta:
        return "VARIANT", f"one name contains the other; extra: {', '.join(sorted(diff))}"
    return "WEAK", (f"partial overlap: shared {', '.join(sorted(ta & tb))}; "
                    f"differ {', '.join(sorted(diff))}")


def find_pairs(spots: List[Dict[str, Any]], max_km: float = SAME_BREAK_KM) -> List[Dict[str, Any]]:
    """Every pair within `max_km` whose names match, classified and sorted worst-first.

    `spots` are dicts with id/name/latitude/longitude (region optional). Sorted by latitude so the
    inner loop can break out — the catalogue is ~1800 rows and this runs on a serve box."""
    usable = [s for s in spots or []
              if s.get("latitude") is not None and s.get("longitude") is not None and s.get("name")]
    box = max_km / 111.0 + 0.01
    by_lat = sorted(usable, key=lambda s: s["latitude"])
    pairs = []
    for i, a in enumerate(by_lat):
        for b in by_lat[i + 1:]:
            if b["latitude"] - a["latitude"] > box:
                break
            if abs(b["longitude"] - a["longitude"]) > box * 1.3:
                continue
            if not names_match(a["name"], b["name"]):
                continue
            km = haversine_km(a["latitude"], a["longitude"], b["latitude"], b["longitude"])
            if km > max_km:
                continue
            tier, why = classify(a["name"], b["name"])
            pairs.append({
                "tier": tier, "km": round(km, 3), "why": why,
                "a": {"id": a.get("id"), "name": a["name"], "region": a.get("region"),
                      "latitude": a["latitude"], "longitude": a["longitude"],
                      "accuracy_flag": a.get("accuracy_flag"),
                      "is_verified_peak": a.get("is_verified_peak")},
                "b": {"id": b.get("id"), "name": b["name"], "region": b.get("region"),
                      "latitude": b["latitude"], "longitude": b["longitude"],
                      "accuracy_flag": b.get("accuracy_flag"),
                      "is_verified_peak": b.get("is_verified_peak")},
            })
    pairs.sort(key=lambda p: (TIER_ORDER[p["tier"]], p["km"]))
    return pairs


def summarise(pairs: List[Dict[str, Any]]) -> Dict[str, int]:
    """Counts per tier — every tier present even at zero, so a missing tier is never mistaken for
    'no problem'."""
    counts = {t: 0 for t in TIER_ORDER}
    for p in pairs:
        counts[p["tier"]] += 1
    return counts
