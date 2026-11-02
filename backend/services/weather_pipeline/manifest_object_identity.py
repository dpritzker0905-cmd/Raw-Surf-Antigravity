"""MANIFEST_ONE_ENTRY_PER_OBJECT (dark, 2026-10-26): one storage object, one manifest registration.

WHY. A manifest entry's slice key carries the PROVIDER, the storage filename does not (store_helpers._build_product_filename).
Two writers of the same model/layer/region/hour with different providers therefore write ONE object and register TWO entries.
Measured live 2026-10-25 (forecast-ingest run 40224293278): the EURO native job's GFS-ext fallback (19:45, 9-hourly lattice
from day 9.5) and the EURO extended-estimate job (19:51) both wrote euro_marine_*_global_coarse_<t>_estimated.json; at 19:54
the cycle-end duplicate sweep (keyed WITHOUT the provider) kept one entry and deleted the other entry's object, which is the
object the kept entry names. 51-54 EURO global_coarse estimated objects per cycle (all four marine layers) stayed listed but
absent until the next cycle rewrote them, so /grid answered 404 no_copernicus_coverage (Render, 20:55:39Z, ask 11-08T20Z).
The kept entry also described the FIRST writer while the bytes were the SECOND writer's: a label that lies about its data.

THE RULE. When a save registers filename F under slice key K, every other registration naming F is dropped: the object holds
the latest write, so the latest writer is its only registrant. Prunes then never see two entries for one object.
The prune-side guard INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS (WI-04) stops the delete; this stops the duplicate.
"""
import logging
import os

logger = logging.getLogger(__name__)

FLAG = "MANIFEST_ONE_ENTRY_PER_OBJECT"


def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def filename_index(by_slice) -> dict:
    """filename -> set of slice keys registering it (several when a collision is already in the manifest)."""
    index = {}
    for key, item in by_slice.items():
        index.setdefault(item.filename, set()).add(key)
    return index


def register(by_slice, index, key, item) -> int:
    """Put `item` at `key` and drop every other registration of item.filename. Returns how many were dropped."""
    previous = by_slice.get(key)
    if previous is not None and previous.filename != item.filename:
        index.get(previous.filename, set()).discard(key)
    others = index.get(item.filename, set()) - {key}
    for other in others:
        by_slice.pop(other, None)
    index[item.filename] = {key}
    by_slice[key] = item
    return len(others)


def log_dropped(dropped: int) -> None:
    if dropped:
        logger.info("[Product Store] One entry per object: dropped %d older registration(s) of objects just rewritten", dropped)
