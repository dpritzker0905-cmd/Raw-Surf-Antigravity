"""Observed surf height -> one physical quantity (breaking FACE height, metres). Pure functions, no I/O.

T1 crowd truth, P1 (blind observation). The surf chain computes ONE physical quantity, breaking face height; a
surfer's report is in THEIR scale, so an unlabelled "4 ft" is ambiguous by about a factor of two (research lead's
log 2026-11-15, 00:55Z and 01:04Z). Every observation therefore carries its scale, and the server, never the client,
converts it to face metres before anything scores it.

Conventions (`SCALE_VERSION`):
- face: the height of the wave face, trough to crest. Factor 1.
- hawaiian: Hawaiian scale. Face = 2 x Hawaiian, within 10-20% (Caldwell 2007, UHSLC: peak face = 2 x Hawaiian
  over 0-40 ft, about 15% uncertainty). The "two-thirds" variant would give 1.5; that spread is the uncertainty, and
  is why the raw value and scale are stored beside the converted number so it can be re-derived.
- Region default: Hawaiian in Hawaii, face everywhere else, the user may change it. Unconfirmed regions stay on face
  (owner decision, proposed defaults in the same log). South Africa is NOT defaulted to Hawaiian until confirmed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

SCALE_VERSION = "norm_v1"  # stored as surf_observations.normalization_version
SCALES = ("face", "hawaiian")
UNITS = ("ft", "m")
SET_OR_AVG = ("typical", "sets")
FT_TO_M = 0.3048
FACE_FACTOR = {"face": 1.0, "hawaiian": 2.0}

# Plausibility bounds on the ENTERED number, in its own unit. Above these the row is refused (a typo or a troll);
# the largest ridden faces are about 26 m (86 ft).
MAX_RAW = {"ft": 100.0, "m": 30.0}

# Hawaii: the main islands plus margin. State name is checked first; the box catches spots with no state field.
_HAWAII_BOX = (18.5, 22.6, -160.8, -154.4)  # lat_min, lat_max, lon_min, lon_max

# The check-in's legacy buckets, kept as a fallback for a surfer who will not commit to a number.
# Each is a range IN THE CHOSEN SCALE, feet. None as the upper end means open-ended.
BUCKETS_FT = {
    "Flat": (0.0, 0.5),
    "1-2ft": (1.0, 2.0),
    "2-3ft": (2.0, 3.0),
    "3-4ft": (3.0, 4.0),
    "4-6ft": (4.0, 6.0),
    "6-8ft": (6.0, 8.0),
    "8ft+": (8.0, None),
}


class ObservationError(ValueError):
    """The entered observation cannot be normalised; the route answers 422 with this message."""


def region_default_scale(latitude: Optional[float], longitude: Optional[float],
                         state_province: Optional[str] = None, country: Optional[str] = None) -> str:
    """The scale a surfer at this spot is most likely to mean. Hawaiian in Hawaii, face elsewhere."""
    if state_province and state_province.strip().lower() in ("hawaii", "hawai'i", "hawaiʻi", "hi"):
        return "hawaiian"
    if latitude is not None and longitude is not None:
        lat_min, lat_max, lon_min, lon_max = _HAWAII_BOX
        if lat_min <= latitude <= lat_max and lon_min <= longitude <= lon_max:
            return "hawaiian"
    return "face"


@dataclass(frozen=True)
class FaceHeight:
    face_m: float                 # the point value scored (bucket: geometric centre of the range; open end: its floor)
    face_m_low: float
    face_m_high: Optional[float]  # None for an open-ended bucket ("8ft+")
    input_kind: str               # 'value' | 'bucket'


def _to_m(value: float, unit: str) -> float:
    return value * FT_TO_M if unit == "ft" else value


def normalise(*, scale: str, unit: Optional[str] = None, value: Optional[float] = None,
              bucket: Optional[str] = None) -> FaceHeight:
    """Raw entry -> face metres. Exactly one of `value` or `bucket` must be given."""
    if scale not in SCALES:
        raise ObservationError(f"height_scale must be one of {SCALES}")
    factor = FACE_FACTOR[scale]
    if (value is None) == (bucket is None):
        raise ObservationError("give either a height value or a range, not both or neither")
    if value is not None:
        if unit not in UNITS:
            raise ObservationError(f"height_unit must be one of {UNITS}")
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ObservationError("height_value must be a number")
        if value < 0 or value > MAX_RAW[unit]:
            raise ObservationError(f"height_value must be between 0 and {MAX_RAW[unit]:g} {unit}")
        face = round(_to_m(float(value), unit) * factor, 3)
        return FaceHeight(face_m=face, face_m_low=face, face_m_high=face, input_kind="value")
    if bucket not in BUCKETS_FT:
        raise ObservationError(f"height_bucket must be one of {tuple(BUCKETS_FT)}")
    low_ft, high_ft = BUCKETS_FT[bucket]
    low = round(low_ft * FT_TO_M * factor, 3)
    high = None if high_ft is None else round(high_ft * FT_TO_M * factor, 3)
    if high is None:
        point = low
    elif low <= 0:
        point = round(high / 2.0, 3)
    else:
        point = round(math.sqrt(low * high), 3)
    return FaceHeight(face_m=point, face_m_low=low, face_m_high=high, input_kind="bucket")


def display_label(*, scale: str, unit: Optional[str], value: Optional[float], bucket: Optional[str],
                  set_or_avg: str) -> str:
    """The short string kept in the legacy `wave_height` column, always naming the scale."""
    size = bucket if bucket is not None else f"{value:g}{unit}"
    return f"{size} {scale}, {set_or_avg}"
