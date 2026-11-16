"""Where a post's session conditions came from: the server's word, never the client's (check-in truth program, P0).

WHY (2026-11-16): `conditions_source` was laundered. The feed route stored `data.conditions_source or 'manual'`, the
schema defaulted it to 'manual', and the collaboration route stored whatever string the client sent. So a post with no
claim at all, or with any claim, read back as a surfer's own observation ('manual'), and nothing downstream could tell
"a surfer measured this" from "nobody said".

The rule:
- Only values the composer can honestly produce pass through: 'auto' and 'auto_current' (a forecast prefill) and
  'edited' (a prefill the surfer then changed).
- Everything else, including 'manual', 'observed', an empty string or an unknown word, is stored as 'unverified'.
  The server never stores 'manual' on a client's say-so.
- 'observed' is the server's to set, from its own check-in evidence (P1). No client value can reach it.
- No conditions at all means None: there is nothing to have a source.
"""
from typing import Optional

CLIENT_SOURCES = frozenset({"auto", "auto_current", "edited"})
UNVERIFIED = "unverified"


def server_conditions_source(hint: Optional[str], has_conditions: bool) -> Optional[str]:
    """The conditions_source to store, from the client's `hint` and whether the post carries any condition value."""
    if not has_conditions:
        return None
    value = (hint or "").strip().lower()
    return value if value in CLIENT_SOURCES else UNVERIFIED


CONDITION_FIELDS = ("wave_height_ft", "wave_period_sec", "wave_direction", "wave_direction_degrees",
                    "wind_speed_mph", "wind_direction", "tide_status", "tide_height_ft")


def has_condition_values(obj) -> bool:
    """True when `obj` (a request model or a Post) carries at least one condition value."""
    for name in CONDITION_FIELDS:
        v = getattr(obj, name, None)
        if v is not None and v != "":
            return True
    return False
