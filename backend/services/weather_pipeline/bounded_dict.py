"""bounded_dict.py — a dict that cannot grow without limit (audit SRV-1, 2026-11-10).

`ProductStore._download_locks` (one Lock per filename) and `_l2_negative_cache` (one timestamp per failed filename) were
plain dicts keyed by a CLIENT-CHOSEN filename and never pruned: every distinct `/point?grid_product_id=` added an entry
for the life of the process. BoundedDict evicts the least recently used entry past `max_size`.

Callers keep their own locks around it (ProductStore already does). `evictable` lets a caller veto an eviction: a held
threading.Lock must never be dropped, or two threads could end up with different locks for one file.
"""
from collections import OrderedDict
from typing import Callable, Optional


class BoundedDict(OrderedDict):
    def __init__(self, max_size: int, evictable: Optional[Callable[[object], bool]] = None):
        super().__init__()
        self.max_size = max(1, int(max_size))
        self._evictable = evictable

    def __getitem__(self, key):
        value = super().__getitem__(key)
        self.move_to_end(key)
        return value

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self.move_to_end(key)
        while len(self) > self.max_size:
            victim = next((k for k, v in self.items()
                           if k != key and (self._evictable is None or self._evictable(v))), None)
            if victim is None:      # everything older is protected: stay over the cap rather than drop a held lock
                break
            super().__delitem__(victim)
