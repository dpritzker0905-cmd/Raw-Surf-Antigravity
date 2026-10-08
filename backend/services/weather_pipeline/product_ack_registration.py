"""Register acknowledged product bytes; preserve local-only saves on non-writer boxes."""
import logging
import os
from collections import deque
from datetime import datetime, timezone

from services.weather_pipeline.product_upload_progress import submit_product_upload

logger = logging.getLogger(__name__)


def _timeout():
    try:
        return min(300.0, max(1.0, float(os.environ.get('PRODUCT_UPLOAD_ACK_TIMEOUT_SEC', '180'))))
    except ValueError:
        return 180.0


def save_prepared_products(store, prepared):
    """Queue uploads in parallel, then commit only explicit acknowledgments to L1/manifest.

    No worker waits for another job on its own executor. A rejected/absent/timed-out
    acknowledgment leaves the prior registration and local bytes intact. Late success
    can leave an unregistered L2 object, but can never mint a fresh registration here.
    """
    from services.weather_pipeline.store import (
        ProductStore, _upload_executor, _manifest_executor, _l2_pipeline_writes_allowed,
        dump_manifest_for_l2, reconcile_manifest_products_for_upload,
    )
    from services.weather_pipeline.store_helpers import _write_product_to_disk
    pending, saved = deque(), []
    writer = _l2_pipeline_writes_allowed()
    timed_out = False

    def finish_one():
        nonlocal timed_out
        item, data, future = pending.popleft()
        try:
            if future is not None and future.result(timeout=_timeout()) is not True:
                raise RuntimeError('Product upload did not acknowledge bytes')
            if _write_product_to_disk(store.cache_dir / item.filename, data):
                saved.append(item)
        except TimeoutError:
            timed_out = True
            future.cancel()
            logger.error('[Product Store] Product ACK deadline expired for %s', item.filename)
        except Exception as exc:
            logger.error('[Product Store] Product not registered for %s: %s', item.filename, type(exc).__name__)

    for item, data in prepared:
        try:
            future = None
            if not item.is_test_fixture:
                future = submit_product_upload(_upload_executor, store, item.filename, data, require_ack=writer)
            pending.append((item, data, future if writer and not item.is_test_fixture else None))
            # Bound serialized payload retention while keeping the existing upload workers busy.
            if len(pending) >= 4:
                finish_one()
                if timed_out:
                    break  # Do not keep adding payloads behind stalled workers.
        except Exception as exc:
            logger.error('[Product Store] Product upload submit refused for %s: %s', item.filename, type(exc).__name__)
    while pending:
        finish_one()
    if not saved:
        if timed_out:
            raise TimeoutError('Product ACK deadline expired; remaining batch not submitted')
        return 0

    def key(p):
        return ((p.model or '').upper(), (p.provider or '').lower(), (p.domain or '').lower(),
                (p.layer or '').lower(), p.valid_time_start, p.region_id)

    # Read the current registration set after the ACK barrier, not before queued uploads.
    with ProductStore._manifest_lock:
        manifest = store.get_manifest()
        products = {key(p): p for p in manifest.products}
        products.update({key(p): p for p in saved})
        manifest.products = list(products.values())
        manifest.last_manifest_update = datetime.now(timezone.utc)
        store._save_manifest(manifest)
        if any(not p.is_test_fixture for p in saved):
            try:
                reconcile_manifest_products_for_upload(manifest)
                data = dump_manifest_for_l2(manifest)
                _manifest_executor.submit(store._upload_to_supabase, 'manifest.json', data)
            except Exception as exc:
                logger.warning('[Product Store] Manifest upload submit failed: %s', type(exc).__name__)
    with ProductStore._product_cache_lock:
        for item in saved:
            ProductStore._product_cache.pop(item.filename, None)
    if timed_out:
        raise TimeoutError('Product ACK deadline expired; only acknowledged subset registered')
    return len(saved)
