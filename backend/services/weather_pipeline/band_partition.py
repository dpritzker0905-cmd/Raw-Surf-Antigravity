"""Over a PARTITION layer the map shows that partition's own height, never a surf rating (bug hunt 2026-11-22 item D).

The band used to grade swell_1 / swell_2 / wind_waves as if each were the whole sea, disagreeing with the glyph beside it, which
rates the total sea. The overnight research consensus the owner delegated (option B: SubQ, Reflection and LongCat agreeing)
keeps the 0-100 rating where it means something: the total `waves` layer, the spot pages, the glyphs and the infobox, all
through the one chain. A partition layer shows its own height. The client asks the plain flavour for it (frontend
partitionHeightOnly.js); this module is the server's half: the overlay skips the rating there, and the CI rated publisher stops
baking partition sets. Guarded flag BAND_PARTITION_HEIGHT_ONLY (runtime_flags), ON; kill '0' = the old per-layer rating.
"""
from services import runtime_flags as _rf

PARTITIONS = ("swell_1", "swell_2", "wind_waves")


def height_only(layer) -> bool:
    return str(layer or "").lower() in PARTITIONS and _rf.flag("BAND_PARTITION_HEIGHT_ONLY") != "0"
