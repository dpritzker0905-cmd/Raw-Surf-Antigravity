"""manifest_tombstones.py - a pruned entry stays pruned across lanes (Fable audit ING-1, 2026-11-10).

THE DEFECT. `store.reconcile_manifest_products_for_upload` merges a head into our snapshot by ADD and REFRESH only. Core and
pilots each restore the full manifest at start and run for hours. When core prunes X (deleting X's object) and publishes a head
without X, pilots still holds X in the snapshot it restored earlier, and its next publish folds X straight back: a manifest entry
whose object is gone (a 404 for every reader until retention drops it). Product filenames carry no run key, so nothing in the
entry tells pilots that the object was deleted. Measured 2026-11-11 01:11Z (one read of `/api/weather/products` against a listing
of the `weather-products` bucket): 593 of 18,466 live entries named an object that did not exist, all GFS past hours of the day.

THE FIX. A prune leaves a TOMBSTONE in the manifest it publishes: `pruned[name] = when` (UTC ISO). Every merge unions the
tombstones of both sides (newest stamp per name) and drops any entry whose name is tombstoned at or after the entry's own stamp
(`ingested_at`, else `run_time`). A product ingested again AFTER the prune carries a newer stamp and is kept: the tombstone is a
statement about one object, not a ban on the name. Tombstones expire after `MANIFEST_TOMBSTONE_TTL_HOURS` (default 12): a stale
snapshot lives at most one ingest job (165-200 min) plus its queue, and every lane restores from the head, which already lacks X.

Every prune site already hands its deleted ids to `manifest_publish_step.submit_manifest_publish(exclude_keys=...)`, so that is
the one place a tombstone is written; the merge function is the one place it is applied.

FLAG: MANIFEST_PRUNE_TOMBSTONES, code default ON (D-065), read through `runtime_flags.flag`. Off: no tombstone is written or
applied, and a manifest with no `pruned` map serializes byte for byte as before (the field is left out while it is None).
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

FLAG = "MANIFEST_PRUNE_TOMBSTONES"
CODE_DEFAULT = "1"
TTL_ENV = "MANIFEST_TOMBSTONE_TTL_HOURS"
DEFAULT_TTL_HOURS = 12.0


def _now() -> datetime:
    """The tombstone clock (one seam, so an offline harness with a fixed timeline can pin it)."""
    return datetime.now(timezone.utc)


def enabled() -> bool:
    """D-065 guarded (env > runtime manifest > code default '1'); '0' is the kill switch. Never raises."""
    try:
        from services.runtime_flags import flag
        return flag(FLAG) == "1"
    except Exception:
        return CODE_DEFAULT == "1"


def ttl() -> timedelta:
    try:
        hours = float(os.environ.get(TTL_ENV, DEFAULT_TTL_HOURS))
    except ValueError:
        hours = DEFAULT_TTL_HOURS
    return timedelta(hours=max(hours, 0.0))


def _parse(value) -> Optional[datetime]:
    """A tombstone or entry stamp as an aware UTC datetime; None when it cannot be read (never raises)."""
    try:
        if isinstance(value, datetime):
            dt = value
        elif isinstance(value, str) and value:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            return None
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def stamp(manifest, names: Iterable[str], now: Optional[datetime] = None) -> int:
    """Record that the objects behind `names` were deleted (now). Returns how many tombstones were written.

    A name the publishing manifest STILL lists is not tombstoned: the caller removed what it pruned before submitting, so an
    entry it still holds is a live registration of that name (written after, or in place of, the deleted object), and the
    exclusion only keeps the head's older copy out, exactly as before."""
    names = [n for n in (names or ()) if isinstance(n, str) and n]
    if not names or not enabled():
        return 0
    held = {k for p in manifest.products for k in (p.product_id, p.filename) if k}
    names = [n for n in names if n not in held]
    if not names:
        return 0
    when = _iso(now or _now())
    pruned = dict(manifest.pruned or {})
    for name in names:
        pruned[name] = when
    manifest.pruned = pruned
    return len(names)


def _entry_stamp(product) -> Optional[datetime]:
    """When this copy of the entry was registered: `ingested_at`, else `run_time` (the ingest wall clock)."""
    get = product.get if isinstance(product, dict) else lambda k: getattr(product, k, None)
    return _parse(get("ingested_at")) or _parse(get("run_time"))


def _union(ours: Optional[dict], theirs: Optional[dict], cutoff: datetime) -> dict:
    out = {}
    for side in (ours or {}, theirs or {}):
        if not isinstance(side, dict):
            continue
        for name, value in side.items():
            when = _parse(value)
            if not isinstance(name, str) or when is None or when < cutoff:
                continue                                    # unreadable or expired: dropped
            prior = out.get(name)
            if prior is None or when > prior:
                out[name] = when
    return out


def apply(manifest, remote_pruned=None, now: Optional[datetime] = None) -> int:
    """Union `remote_pruned` (the head's tombstones) into `manifest.pruned`, expire old ones, and drop every product whose
    name is tombstoned at or after its own stamp. Returns the count of products dropped. A no-op with the flag off."""
    if not enabled():
        return 0
    now = now or _now()
    merged = _union(manifest.pruned, remote_pruned, now - ttl())
    manifest.pruned = {name: _iso(when) for name, when in sorted(merged.items())} or None
    if not merged:
        return 0
    kept, dropped = [], []
    for p in manifest.products:
        name = p.product_id or p.filename
        tomb = merged.get(name) if name else None
        if tomb is None and p.filename and p.filename != name:
            tomb = merged.get(p.filename)
        entry = _entry_stamp(p)
        if tomb is not None and (entry is None or entry <= tomb):
            dropped.append(name)
        else:
            kept.append(p)
    if dropped:
        manifest.products = kept
        logger.info(f"[Manifest Tombstones] dropped {len(dropped)} entries whose objects a prune deleted "
                    f"(e.g. {dropped[0]}); {len(merged)} tombstones held")
    return len(dropped)


def pruned_of(doc) -> Optional[dict]:
    """The `pruned` map of a raw manifest document, or None."""
    value = doc.get("pruned") if isinstance(doc, dict) else None
    return value if isinstance(value, dict) else None


class ProductList(list):
    """A head's raw product list that also carries the head's tombstones, so every existing caller that passes
    `remote_products` around carries them with no new parameter. A plain list means 'no tombstones known'."""
    pruned = None

    @classmethod
    def of(cls, products, pruned):
        out = cls(products)
        out.pruned = pruned
        return out
