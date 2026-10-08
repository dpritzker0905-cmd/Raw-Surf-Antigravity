"""Bounded, process-shared remote listing diagnostics; never a full registry count."""
from datetime import datetime, timezone
import threading
import time


class PersistenceListingProbe:
    TTL_SEC = 30.

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self._lock = threading.Lock()
        self._snapshot = None
        self._completed_at = None

    def get(self, get_client, bucket):
        # Health requests construct new stores and run in worker threads. Share one probe,
        # including failures and client initialization, rather than issuing one read per poll.
        with self._lock:
            now = self.clock()
            cached = self._snapshot is not None and 0 <= now - self._completed_at < self.TTL_SEC
            if not cached:
                connected, count, status = False, None, 'unavailable'
                try:
                    client = get_client()
                    connected = client is not None
                    if connected:
                        objects = client.storage.from_(bucket).list()
                        if not isinstance(objects, list):
                            raise ValueError('Storage listing was not a list')
                        names = [o.get('name', '') if isinstance(o, dict) else getattr(o, 'name', '') for o in objects]
                        count = sum(name.endswith('.json') and name != 'manifest.json' for name in names)
                        status = 'ok'
                except Exception:
                    count, status = -1, 'error'
                self._completed_at = self.clock()
                self._snapshot = {
                    'supabase_connected': connected,
                    'supabase_product_count': count,
                    'status': status,
                    'checked_at': datetime.now(timezone.utc).isoformat(),
                }
            snapshot = self._snapshot
            return {
                'supabase_connected': snapshot['supabase_connected'],
                'supabase_product_count': snapshot['supabase_product_count'],
                'supabase_listing': {
                    'status': snapshot['status'], 'scope': 'first_page',
                    'checked_at': snapshot['checked_at'],
                    'age_sec': round(max(0., self.clock() - self._completed_at), 3),
                    'ttl_sec': self.TTL_SEC, 'cached': cached,
                },
            }
