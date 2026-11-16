"""Where a post's session conditions came from: the server decides which client claims are admissible (check-in truth
program, P0).

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

LIMITS (advisor, 2026-11-16):
- 'auto' and 'auto_current' are still the CLIENT'S word. The server does not compare the values with a forecast, so a
  client can type values and claim 'auto'. That is the harmless direction for a truth stream: it hides a claim, it
  cannot forge an observation. No client value can become 'manual' or 'observed'.
- A label is recomputed only when a condition VALUE in the request differs from the stored one
  (`condition_values_differ`). A bare hint never relabels a post, so it can never erase a server-set 'observed'.

⚠️ READING STORED ROWS: every 'manual' written before this change was laundered by the old default
(`data.conditions_source or 'manual'`), so it carries no claim. Read a stored 'manual' as 'unverified'
(`read_conditions_source`). Rows are not rewritten in place: that is a production data write and the owner's call.
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


def read_conditions_source(stored: Optional[str]) -> Optional[str]:
    """How a STORED label is to be read. A legacy 'manual' reads as 'unverified': only the old default and the old
    composer's edit flip ever wrote it, neither of them a verified claim, and this module never writes it. Every other
    value reads as itself."""
    return UNVERIFIED if stored == "manual" else stored


def condition_values_differ(request, stored) -> bool:
    """True when the request sets at least one condition value that differs from the stored post's."""
    for name in CONDITION_FIELDS:
        v = getattr(request, name, None)
        if v is not None and v != "" and v != getattr(stored, name, None):
            return True
    return False


def has_condition_values(obj) -> bool:
    """True when `obj` (a request model or a Post) carries at least one condition value."""
    for name in CONDITION_FIELDS:
        v = getattr(obj, name, None)
        if v is not None and v != "":
            return True
    return False
