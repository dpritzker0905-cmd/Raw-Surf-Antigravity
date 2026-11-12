"""weather_account_rate_limit.py: per-ACCOUNT request limits on forecast reads and frame signing (#782/#783, 2026-11-12).

WHY. Owner, 2026-11-12: "a per-account limit on signing requests". With accounts only, every forecast read and every
`/frame-urls` call is tied to a verified user id, so one account (a script, a leaked token, a runaway tab) can be bounded
without touching anyone else. ONE 1-CPU box serves production and dev, so a single account must not be able to starve it.

WHERE. Only where an identity is already resolved, so it adds NO I/O: the tier clamp middleware (weather_tier_clamp.py,
the clamped reads) and the `/frame-urls` route. Both are held OFF behind WEATHER_TIER_CLAMP / FRAME_ENTITLEMENT, so this is
inert until they flip. Signed-out callers never reach it (they get 401 first).

THE LIMITS: a token bucket per (lane, user id): `capacity` requests at once, refilled at `per_s`. Over -> 429 with
Retry-After (whole seconds until one token is back). Numbers, from what the map actually asks:
  frame-urls  capacity 60, 0.1/s (6/min sustained, 360/h). A map load pins 1-3 indexes, each asked ONCE per run (the
              signer caches per index; runs move every few hours). Switching through every model and layer is ~20 sets.
              60 at once is 20x a normal load and 3x a full tour; 6/min sustained is far above one new index a minute.
  reads       capacity 600, 2/s (120/min sustained). A cold map load is ~10-30 weather reads (three 48-frame /grid_series
              pages, /capabilities, /spot-ratings, /point on taps); panning adds /grid crops at well under 1/s. 600 at once
              is ~20 cold loads back to back; 2/s sustained is several times a user panning continuously.
MEMORY. An OrderedDict LRU of at most MAX_KEYS (10,000) buckets per lane, each a (tokens, stamp) pair: under ~2 MB in
all. The least recently seen account is evicted first; an evicted account simply starts again with a full bucket.
CAVEAT (multi-worker). The buckets live in THIS process. Render runs one uvicorn process today; with N workers (or N
instances) each holds its own buckets, so an account's effective limit is N times the numbers above. A shared limit
needs a shared store (Redis), which would add I/O to every read: not done here.
Kill switch: GUARDED WEATHER_ACCOUNT_RATE_LIMIT = '1' (it acts only once a switch above is on); '0' = no limit.
"""
import math
import threading
import time
from collections import OrderedDict
from typing import Callable, Dict, Optional, Tuple

from services import runtime_flags as _rf

FLAG = "WEATHER_ACCOUNT_RATE_LIMIT"
MAX_KEYS = 10_000
LANES: Dict[str, Tuple[float, float]] = {           # lane -> (capacity, refill per second)
    "frame-urls": (60.0, 0.1),
    "reads": (600.0, 2.0),
}


def enabled() -> bool:
    return _rf.flag(FLAG, _rf.GUARDED.get(FLAG, "1")) == "1"


class AccountLimiter:
    """Token buckets per (lane, user id), bounded LRU, thread-safe. `check` is O(1), no I/O."""

    def __init__(self, lanes: Dict[str, Tuple[float, float]] = None, max_keys: int = MAX_KEYS,
                 clock: Callable[[], float] = time.monotonic):
        self.lanes = dict(lanes or LANES)
        self.max_keys = max_keys
        self.clock = clock
        self._buckets: Dict[str, "OrderedDict[str, Tuple[float, float]]"] = {k: OrderedDict() for k in self.lanes}
        self._lock = threading.Lock()

    def check(self, lane: str, user_id: Optional[str]) -> Optional[int]:
        """None when the request may proceed (one token taken); else the Retry-After seconds (>= 1)."""
        if not user_id or lane not in self.lanes:
            return None
        cap, rate = self.lanes[lane]
        now = self.clock()
        with self._lock:
            b = self._buckets[lane]
            tokens, at = b.pop(user_id, (cap, now))
            tokens = min(cap, tokens + (now - at) * rate)
            if tokens >= 1.0:
                b[user_id] = (tokens - 1.0, now)
                wait = None
            else:
                b[user_id] = (tokens, now)
                wait = max(1, int(math.ceil((1.0 - tokens) / rate)))
            while len(b) > self.max_keys:
                b.popitem(last=False)
        return wait

    def size(self, lane: str) -> int:
        return len(self._buckets.get(lane, ()))


LIMITER = AccountLimiter()


def retry_after(lane: str, user_id: Optional[str], limiter: AccountLimiter = None) -> Optional[int]:
    """The gate both callers use: None to proceed, else Retry-After seconds. Off (kill switch) = always proceed."""
    if not enabled():
        return None
    return (limiter or LIMITER).check(lane, user_id)


RATE_LIMITED = "rate_limited"   # X-Raw-Tier-Clamp on the 429: the client's too-many-requests notice keys on it


def too_many_body(retry_after_s: int) -> bytes:
    """The 429 body. The wait is in the body too: a cross-origin reader that cannot see Retry-After still has it."""
    return ('{"detail":"%s","retry_after_s":%d}' % (RATE_LIMITED, int(retry_after_s))).encode()
