"""Dark WI06: delete only proven duplicates of the same coverage/source class.

No lane-wide receipt-clock cutoff: cancelled runs and estimated tails keep unique
valid hours. Unknown cycles retain their registrations; they are not silently aged.
"""
import logging
import json

from datetime import datetime, timezone
from services.weather_pipeline.selection_identity import selection_identity
from services.weather_pipeline.prune_object_protection import delete_pruned_object

logger = logging.getLogger(__name__)


def _slot(product):
    bounds = product.coverage
    return (product.model.upper(), product.domain.lower(), product.layer.lower(), product.provider.lower(),
            product.region_id, product.coverage_mode, product.resolution,
            (bounds.west, bounds.south, bounds.east, bounds.north),
            product.valid_time_start, product.valid_time_end,
            product.is_forecast_authoritative, product.is_estimated,
            product.source_dataset, product.upstream_provider, product.upstream_model,
            product.tile_id, product.is_test_fixture, json.dumps(product.estimate_basis, sort_keys=True, default=str))


def newer_collision(raw, current):
    """Upload reconciliation must not undo pruning by preferring a late older cycle."""
    from services.weather_pipeline.schemas import ManifestProduct
    try:
        incoming = ManifestProduct.model_validate(raw)
        left, right = selection_identity(incoming), selection_identity(current)
        if left[0] or right[0] or _slot(incoming) != _slot(current):
            return False
        if left[1] != right[1]:
            return left[1] < right[1]
        return incoming.run_time > current.run_time  # Same verified cycle, storage receipt only.
    except (TypeError, ValueError):
        return False


def prune_verified_cycles(store, lane=None):
    from services.weather_pipeline.store import (
        _manifest_executor, dump_manifest_for_l2, reconcile_manifest_products_for_upload,
    )
    manifest = store.get_manifest()
    winners, keep = {}, set()
    for product in manifest.products:
        identity = selection_identity(product)
        if identity[0] or (lane is not None and not lane(product)):
            keep.add(id(product))
            continue
        slot = _slot(product)
        current = winners.get(slot)
        if current is None or identity < selection_identity(current):
            winners[slot] = product
    keep.update(id(product) for product in winners.values())
    retained = [product for product in manifest.products if id(product) in keep]
    removed = [product for product in manifest.products if id(product) not in keep]
    if not removed:
        return 0
    # Required even if the independent WI04 flag is off: aliases never own a retained object.
    protected_files = {product.filename for product in retained}
    protected_ids = {product.product_id or product.filename for product in retained}
    removed_ids = {product.product_id or product.filename for product in removed} - protected_ids
    for product in removed:
        delete_pruned_object(store, product, protected_files)
    manifest.products = retained
    manifest.last_manifest_update = datetime.now(timezone.utc)
    store._save_manifest(manifest)
    try:
        reconcile_manifest_products_for_upload(manifest, exclude_keys=removed_ids)
        _manifest_executor.submit(store._upload_to_supabase, 'manifest.json', dump_manifest_for_l2(manifest))
    except Exception as exc:
        logger.warning('[Product Store] Verified-cycle prune publication failed: %s', type(exc).__name__)
    return len(removed)
