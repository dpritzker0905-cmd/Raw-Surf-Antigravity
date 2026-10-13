"""Unique, acknowledged manifest publication and bounded, reader-safe retention."""
import logging
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

logger = logging.getLogger(__name__)
PRUNE_SCAN_LIMIT = 100
PRUNE_DELETE_LIMIT = 20
READER_GRACE_SECONDS = 3600  # existing immutable CDN cache lifetime
_COPY_NAME = re.compile(r'manifest-g(\d{12})(?:-[0-9a-f]{32})?\.json')


def publish_immutable(manifest_bytes, upload_fn):
    try:
        from services.weather_pipeline import manifest_pointer as pointer
        from services.weather_pipeline.store import _l2_writer_identity, _l2_pipeline_writes_allowed
        if not _l2_pipeline_writes_allowed():
            return None
        current = pointer.read_pointer()
        if current is None:
            if not pointer.pointer_enabled():
                return None
            generation = 1
        else:
            previous = current.get('generation')
            if type(previous) is not int or not 1 <= previous < 999999999999:
                return None
            generation = previous + 1
        key = f'manifests/manifest-g{generation:012d}-{uuid4().hex}.json'
        # No CAS after missing/ambiguous upload acknowledgment. Reusing an object name
        # must fail at storage, even in the extraordinarily unlikely UUID collision.
        if upload_fn(key, manifest_bytes, strict=True, overwrite=False) is not True:
            return None
        run_id, writer = os.environ.get('GITHUB_RUN_ID'), _l2_writer_identity()
        won = (pointer._insert_initial(key, run_id, writer) if current is None else
               pointer.cas_advance(previous, key, run_id, writer))
        if not won:
            # False also covers a lost HTTP acknowledgment AFTER a successful CAS.
            # Never delete this candidate immediately: it may be the committed winner.
            return None
        prune_immutable_copies(generation)
        logger.info('[Manifest Pointer] unique immutable copy committed at generation %s', generation)
        return key
    except Exception as error:
        logger.warning('[Manifest Pointer] immutable publish failed; legacy fallback retained: %s', error)
        return None


def prune_immutable_copies(generation, *, now=None):
    """At most one bounded listing and one batch delete, only after an acknowledged win.

    Keep five generations AND a full CDN/read grace period. Unacknowledged candidates
    age out only after their generation is obsolete; they cannot win a later CAS.
    Fail closed on unknown paths/timestamps/metadata. No table migration is needed.
    """
    try:
        from services.weather_pipeline import manifest_pointer as pointer
        from services.weather_pipeline.store import _l2_pipeline_writes_allowed, WEATHER_BUCKET
        cutoff = generation - pointer.KEEP_RUN_KEYED
        if cutoff < 1 or not _l2_pipeline_writes_allowed():
            return
        base, headers = pointer._rest_base_and_headers()
        if not base:
            return
        import requests
        response = requests.post(f'{base}/storage/v1/object/list/{WEATHER_BUCKET}', headers=headers,
                                 json={'prefix': 'manifests', 'search': 'manifest-g', 'limit': PRUNE_SCAN_LIMIT,
                                       'offset': 0, 'sortBy': {'column': 'name', 'order': 'asc'}}, timeout=5)
        if response.status_code != 200:
            return
        rows = response.json()
        if not isinstance(rows, list):
            return
        now = now or datetime.now(timezone.utc)
        obsolete = []
        for row in rows[:PRUNE_SCAN_LIMIT]:
            if not isinstance(row, dict) or not isinstance(row.get('name'), str):
                continue
            match = _COPY_NAME.fullmatch(row['name'])
            if not match or not 1 <= int(match[1]) <= cutoff:
                continue
            try:
                created = datetime.fromisoformat(row['created_at'].replace('Z', '+00:00'))
                updated = datetime.fromisoformat(row.get('updated_at', row['created_at']).replace('Z', '+00:00'))
                if created.tzinfo is None or updated.tzinfo is None:
                    continue
                if (now - max(created, updated)).total_seconds() < READER_GRACE_SECONDS:
                    continue
            except (KeyError, TypeError, ValueError, AttributeError):
                continue
            key = 'manifests/' + row['name']
            if key not in obsolete:
                obsolete.append(key)
            if len(obsolete) == PRUNE_DELETE_LIMIT:
                break
        if obsolete:
            response = requests.delete(f'{base}/storage/v1/object/{WEATHER_BUCKET}', headers=headers,
                                       json={'prefixes': obsolete}, timeout=5)
            if response.status_code not in (200, 204):
                logger.warning('[Manifest Pointer] immutable retention delete not acknowledged')
    except Exception as error:
        logger.warning('[Manifest Pointer] immutable retention deferred: %s', error)
