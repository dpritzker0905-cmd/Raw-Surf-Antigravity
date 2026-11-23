"""Vertical datum: every source depth is converted to MSL before ray tracing (gate section 1a).

Convention: depth is positive DOWN from the source's native datum. `msl_above_native_m` is how far MSL sits ABOVE
that native datum (positive when the datum is below MSL, as MLLW and LAT are). A seabed that is d below the datum is
then d + msl_above_native below MSL:

    depth_msl = depth_native + msl_above_native_m

The offsets themselves (NOAA VDatum per CUDEM tile, per-volume CRM datums, the EMODnet MSL variant) come from an
OFFLINE CI step and are passed in with their provenance; this module applies them and records what was done. A source
whose datum cannot be established is tagged DATUM_1M (its own reported stratum), never silently treated as MSL.
MLLW (chart datum) is display-only and never enters the ray computation.
"""
from dataclasses import asdict, dataclass, field
from typing import Optional

import numpy as np

# gate table, "Native vertical reference" column -> how the offset is obtained
NATIVE = {
    "CUDEM": "NAVD88",
    "CRM": "per-volume (EGM2008 | MLLW | MLW | MHW | MSL)",
    "EMODNET": "LAT (the MSL variant is preferred)",
    "GEBCO": "nominal MSL (NOT verified)",
}
# datums whose offset is a NOAA/EMODnet product and must therefore be supplied
OFFSET_REQUIRED = {"NAVD88", "MLLW", "MLW", "MHW", "LAT"}
IDENTITY = {"MSL", "LMSL", "EGM2008"}      # EGM2008 is treated as MSL (gate table)
# stratum tags
DATUM_1M = "DATUM_1M"
COARSE = "COARSE"


@dataclass
class DatumConversion:
    source: str                       # CUDEM | CRM | EMODNET | GEBCO
    volume_or_tile: str               # tile id / CRM volume / "GEBCO_2024"
    native_datum: str                 # NAVD88 | MLLW | MLW | MHW | LAT | EGM2008 | MSL ...
    method: str                       # vdatum | co-ops-datums | emodnet-msl-variant | emodnet-tide-model | identity | none
    msl_above_native_m: Optional[float]
    version: str = ""                 # VDatum grid version / CO-OPS station / EMODnet release (recorded)
    tags: list = field(default_factory=list)

    def as_dict(self):
        return asdict(self)


def resolve(source, volume_or_tile, native_datum, offset_m=None, method=None, version=""):
    """Build the conversion record. A datum that needs an offset and has none is tagged DATUM_1M, offset None."""
    nd = (native_datum or "").upper()
    if nd in IDENTITY:
        return DatumConversion(source, volume_or_tile, nd, method or "identity", 0.0, version)
    if nd in OFFSET_REQUIRED and offset_m is not None and np.isfinite(offset_m):
        return DatumConversion(source, volume_or_tile, nd, method or "vdatum", float(offset_m), version)
    return DatumConversion(source, volume_or_tile, nd or "UNKNOWN", "none", None, version, [DATUM_1M])


def to_msl(depth_native, conv):
    """Depth below MSL. An unresolved conversion (DATUM_1M) passes the depth through UNCHANGED and the tag stays."""
    d = np.asarray(depth_native, dtype=float)
    if conv.msl_above_native_m is None:
        return d
    return d + conv.msl_above_native_m
