"""Dark WI01 L1 refresh using manifest registration evidence, never inferred model cycles.

No ETag/content digest exists in the legacy manifest: identical-metadata byte rewrites
cannot be detected here. Unknown/ambiguous registrations never certify freshness.
Locks and per-store memo tables are bounded; a stable manifest is indexed once.
"""
import json
import logging
import math
import os
import tempfile
import threading
import time
from collections import OrderedDict
from datetime import timezone

from services.weather_pipeline.schemas import GridVector, NormalizedGrid, NormalizedProduct

logger = logging.getLogger(__name__)
_LOCKS = tuple(threading.RLock() for _ in range(64))
_LIMIT = 256
_INDEX_LIMIT = 50000
_REFUSAL_SECONDS = 5
UNVERIFIED = 'product_revision_unverified'
REFUSED = 'product_revision_refresh_refused'


def _clock(value):
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('revision clock must be timezone-qualified')
    return value.astimezone(timezone.utc)


def registration(product):
    """Exact storage metadata, with the legacy receipt clock kept distinct from cycle."""
    try:
        cycle = _clock(product.model_run_time)
        if (product.model_run_time_status == 'known') != (cycle is not None):
            return None
        bounds = product.coverage
        valid = getattr(product, 'valid_time_start', None) or getattr(product, 'valid_time', None)
        end = getattr(product, 'valid_time_end', None) or valid
        if valid != end:
            return None  # The loader stores single-frame objects only.
        return (product.model.lower(), product.provider.lower(), product.domain.lower(), product.layer.lower(),
                _clock(valid), _clock(product.run_time), _clock(product.ingested_at),
                cycle, product.model_run_time_status, product.is_forecast_authoritative, product.is_estimated,
                (bounds.west, bounds.south, bounds.east, bounds.north), product.region_id,
                product.source_dataset, product.upstream_provider, product.upstream_model)
    except (AttributeError, TypeError, ValueError):
        return None


def _stamp(path):
    stat = path.stat()
    return stat.st_mtime_ns, stat.st_size, stat.st_ino


def _expected(store, filename):
    from services.weather_pipeline.store import ProductStore
    with ProductStore._manifest_lock:
        manifest = store.get_manifest()
        stamp = (id(manifest), _stamp(store.manifest_path))
        saved = getattr(store, '_revision_index', None)
        if saved is None or saved[0] != stamp:
            index = {}
            if len(manifest.products) <= _INDEX_LIMIT:
                for item in manifest.products:
                    signature = registration(item)
                    if item.filename in index and index[item.filename] != signature:
                        signature = None  # Same physical key has conflicting registrations.
                    index[item.filename] = signature
            store._revision_index = stamp, index
        return store._revision_index[1].get(filename)


def _remember(table, key, value):
    table[key] = value
    table.move_to_end(key)
    while len(table) > _LIMIT:
        table.popitem(last=False)


def _metadata(data):
    return NormalizedProduct.model_validate({**data, 'grid': None})


def _format(product):
    return (product.value_kind, product.value_unit, product.display_unit_hint,
            tuple(product.source_variables), json.dumps(product.units, sort_keys=True))


def _replacement_allowed(actual, expected):
    if actual is None or actual[:5] != expected[:5] or actual[9:] != expected[9:]:
        return False  # Provider, frame, coverage or source migration needs separate evidence.
    if actual[7] is not None:
        if expected[7] is None or expected[7] < actual[7]:
            return False
        if expected[7] > actual[7]:
            return True  # Verified newer cycle outranks the legacy receipt clock.
    return expected[5] >= actual[5] and (actual[6] is None or (expected[6] is not None and expected[6] >= actual[6]))


def _validated(data, expected, format_identity):
    product = _metadata(data)
    if registration(product) != expected or _format(product) != format_identity:
        raise ValueError('download does not match manifest registration')
    raw = data.get('grid')
    if not isinstance(raw, dict):
        raise ValueError('missing grid')
    grid = NormalizedGrid.model_validate({**raw, 'vectors': []})
    cells = raw.get('vectors')
    if (grid.cols <= 0 or grid.rows <= 0 or not isinstance(cells, list)
            or len(cells) != grid.cols * grid.rows or grid.bounds != product.coverage):
        raise ValueError('invalid grid dimensions/coverage')
    usable = False
    # Validate one cell at a time: do not retain a full unstrided Pydantic vector list.
    for raw_cell in cells:
        cell = GridVector.model_validate(raw_cell)
        if not math.isfinite(cell.lat) or not math.isfinite(cell.lng):
            raise ValueError('invalid grid coordinates')
        if cell.is_valid:
            if ('speed' not in raw_cell or not math.isfinite(cell.speed)
                    or (product.domain.lower() == 'marine' and cell.speed < 0)
                    or any(value is not None and not math.isfinite(value)
                           for value in (cell.value, cell.direction, cell.u, cell.v, cell.period, cell.gust))):
                raise ValueError('invalid measured cell')
            usable = True
    if not usable:
        raise ValueError('no measured cells')


def _evict(filename):
    from services.weather_pipeline.store import ProductStore
    with ProductStore._product_cache_lock:
        for key in list(ProductStore._product_cache):
            if key == filename or key.startswith(filename + '#s'):
                ProductStore._product_cache.pop(key, None)
                ProductStore._product_cache_vectors.pop(key, None)


def refresh_revision(store, filename):
    """Return expected registration and refusal reason; retain actual local provenance.

    Per-process serialization and manifest recheck are not cross-process object CAS.
    Missing local files retain the established download path; no registration is invented.
    """
    from services.weather_pipeline import store as module
    path = store.cache_dir / filename
    # Bound locks across fresh ProductStore instances created for different requests.
    with _LOCKS[hash(str(path.absolute())) % len(_LOCKS)]:
        try:
            expected = _expected(store, filename)
        except Exception:
            return None, UNVERIFIED
        if expected is None:
            return None, UNVERIFIED
        if not path.exists():
            return expected, UNVERIFIED  # Legacy miss remains distinct from certified replacement.
        memo = getattr(store, '_revision_disk', None)
        if memo is None:
            store._revision_disk = memo = OrderedDict()
            store._revision_refusals = OrderedDict()
        failures = store._revision_refusals
        try:
            stamp = _stamp(path)
            previous = memo.get(filename)
            if previous is None or previous[0] != stamp:
                metadata = _metadata(json.loads(path.read_bytes()))
                actual, format_identity = registration(metadata), _format(metadata)
                _remember(memo, filename, (stamp, actual, format_identity))
            else:
                actual, format_identity = previous[1:]
            if actual == expected:
                failures.pop(filename, None)
                return expected, None
            last = failures.get(filename)
            if last and last[0] == expected and time.monotonic() - last[1] < _REFUSAL_SECONDS:
                return expected, REFUSED
            if not _replacement_allowed(actual, expected):
                raise ValueError('replacement would regress or migrate stored identity')
            client = module._get_supabase_storage()
            if client is None:
                raise RuntimeError('storage unavailable')
            from services.weather_pipeline.l2_retry import read_with_retry
            content = read_with_retry(lambda: client.storage.from_(module.WEATHER_BUCKET).download(filename), filename)
            data = json.loads(content)
            _validated(data, expected, format_identity)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=store.cache_dir, prefix='revision-', suffix='.tmp', delete=False) as file:
                    temporary = file.name
                    file.write(content)
                # Readers see either complete old bytes or complete validated new bytes.
                with module.ProductStore._manifest_lock:
                    if _expected(store, filename) != expected or _stamp(path) != stamp:
                        raise ValueError('publication/local object changed during refresh')
                    os.replace(temporary, path)
                    temporary = None
                _evict(filename)
                _remember(memo, filename, (_stamp(path), expected, format_identity))
                failures.pop(filename, None)
                return expected, None
            finally:
                if temporary is not None:
                    os.unlink(temporary)
        except Exception as exc:
            _remember(failures, filename, (expected, time.monotonic()))
            logger.warning('[Product Store] Revision refresh refused for %s: %s', filename, type(exc).__name__)
            return expected, REFUSED


def mark_revision_refusal(product, reason):
    if reason:
        product.stale = True
        product.staleReason = reason
    return product


def point_revision_provenance(product):
    if os.environ.get('PRODUCT_REVISION_REFRESH', '0') == '1':
        return {'stale': product.stale, 'staleReason': product.staleReason}
    return {}
