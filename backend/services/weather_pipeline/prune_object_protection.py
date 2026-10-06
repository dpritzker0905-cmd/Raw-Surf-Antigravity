"""Dark WI-04 guard: manifest registrations and storage objects have different lifetimes."""
import logging
import os

logger = logging.getLogger(__name__)


def retained_prune_references(products):
    """Snapshot all retained lanes, not merely the lane whose registrations are pruned."""
    if os.environ.get('INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS', '0') != '1':
        return set(), set()
    return (
        {p.filename for p in products},
        {p.product_id or p.filename for p in products},
    )


def delete_pruned_object(store, product, protected_filenames):
    """A removed alias does not own deletion while a retained registration names its object.

    This protects the local prune snapshot; it is not a cross-process publication/CAS protocol.
    """
    if product.filename in protected_filenames:
        logger.info('[Product Store] Retained referenced object during prune: %s', product.filename)
        return
    from services.weather_pipeline.store import _upload_executor
    filepath = store.cache_dir / product.filename
    if filepath.exists():
        try:
            os.remove(filepath)
            logger.info('[Product Store] Pruned unreferenced product file: %s', product.filename)
        except Exception as exc:
            logger.warning('[Product Store] Failed to delete pruned file %s: %s', product.filename, exc)
    _upload_executor.submit(store._delete_from_supabase, product.filename)
