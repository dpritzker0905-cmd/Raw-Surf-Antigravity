"""Invocation-scoped product acknowledgments for the decoupled ingestion CLI.

Metadata and restore writes never enter this collector. Outside a CLI collection,
product saves retain their existing asynchronous upload behavior.
"""
from contextlib import contextmanager
import threading

_active = None
_active_lock = threading.Lock()


class ProductUploadProgress:
    def __init__(self):
        self._condition = threading.Condition()
        self._pending = set()
        self._submitted = self._acknowledged = self._failed = 0

    def submit(self, executor, store, filename, data):
        with self._condition:
            self._submitted += 1
        try:
            future = executor.submit(store._upload_to_supabase, filename, data, strict=True)
        except Exception:
            with self._condition:
                self._failed += 1
            raise
        with self._condition:
            self._pending.add(future)
        # Register outside the lock: completed Futures invoke callbacks immediately.
        future.add_done_callback(self._complete)
        return future

    def _complete(self, future):
        try:
            acknowledged = future.result() is True
        except Exception:
            acknowledged = False
        with self._condition:
            self._pending.remove(future)
            if acknowledged:
                self._acknowledged += 1
            else:
                self._failed += 1
            self._condition.notify_all()

    def wait(self, timeout):
        """Bounded drain; a timeout is explicit, without shutting down shared executors."""
        with self._condition:
            self._condition.wait_for(lambda: not self._pending, timeout=max(0, timeout))
            return {'submitted': self._submitted, 'acknowledged': self._acknowledged,
                    'failed': self._failed, 'pending': len(self._pending)}


@contextmanager
def collect_product_uploads():
    global _active
    receipt = ProductUploadProgress()
    with _active_lock:
        if _active is not None:
            raise RuntimeError('An ingestion product-upload collection is already active')
        _active = receipt
    try:
        yield receipt
    finally:
        with _active_lock:
            _active = None


def submit_product_upload(executor, store, filename, data, *, require_ack=False):
    with _active_lock:
        receipt = _active
    if receipt is None:
        if require_ack:
            return executor.submit(store._upload_to_supabase, filename, data, strict=True)
        return executor.submit(store._upload_to_supabase, filename, data)
    return receipt.submit(executor, store, filename, data)
