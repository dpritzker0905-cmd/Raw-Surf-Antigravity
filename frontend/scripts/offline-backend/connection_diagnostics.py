"""Opt-in synthetic-runner connection observations; never imported by backend.

Uses Uvicorn's selected protocol class, without changing its transport, parser,
timeouts or retries. These callbacks observe Python's view, not packets or the
peer that caused a reset. No payloads, raw URLs or exception text are retained.
"""
from datetime import datetime, timezone
import errno
import json
import os
import re
import sys
import time
import uuid

HEADER = b"x-rawsurf-synthetic-request-id"
VALID_ID = re.compile(rb"[A-Za-z0-9_-]{8,96}")
KNOWN_ERRNOS = {errno.ECONNRESET: "connection_reset", errno.EPIPE: "broken_pipe",
                errno.ECONNABORTED: "connection_aborted", errno.ETIMEDOUT: "timed_out"}


def _stdout(row):
    print("[SYNTHETIC CONNECTION] " + json.dumps(row, separators=(",", ":")),
          file=sys.stdout, flush=True)


def diagnostic_protocol(base=None, emit=None):
    """Decorate the same HTTP implementation Uvicorn would select with http=auto."""
    if base is None:
        from uvicorn.protocols.http.auto import AutoHTTPProtocol
        base = AutoHTTPProtocol
    sink = emit if emit is not None else _stdout

    class ObservedProtocol(base):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._diag_id = uuid.uuid4().hex
            self._diag_start = time.monotonic_ns()
            self._diag_received = 0
            self._diag_sequence = 0
            app = self.app

            async def observed_app(scope, receive, send):
                if scope["type"] == "http":
                    self._diag_sequence += 1
                    # Duplicate or invalid values are ambiguous; never log their contents.
                    ids = [v for k, v in scope.get("headers", ()) if k == HEADER]
                    rid = ids[0].decode("ascii") if len(ids) == 1 and VALID_ID.fullmatch(ids[0]) else None
                    self._observe("request", request_sequence=self._diag_sequence,
                                  request_id=rid, correlation_valid=rid is not None)
                return await app(scope, receive, send)

            self.app = observed_app

        def _observe(self, event, **fields):
            try:
                now = time.monotonic_ns()
                sink({"schema": 1, "event": event, "connection_id": self._diag_id,
                      "pid": os.getpid(), "at": datetime.now(timezone.utc).isoformat(),
                      "monotonic_ns": now, "connection_elapsed_ms": (now - self._diag_start) / 1e6,
                      "received_bytes": self._diag_received, **fields})
            except Exception:
                # Observation failure must never alter native protocol outcomes.
                pass

        def connection_made(self, transport):
            super().connection_made(transport)
            # Ports identify loopback exchanges without retaining arbitrary IP values.
            self._observe("open", client_port=_port(self.client), server_port=_port(self.server),
                          protocol=base.__name__)

        def data_received(self, data):
            self._diag_received += len(data)
            return super().data_received(data)

        def eof_received(self):
            self._observe("eof")
            return super().eof_received()

        def connection_lost(self, exc):
            # This reports a callback's errno, not a finding about the reset's actor.
            number = getattr(exc, "errno", None) if isinstance(exc, OSError) else None
            kind = "connection_reset" if isinstance(exc, ConnectionResetError) else KNOWN_ERRNOS.get(number, "other_error" if exc else "none")
            self._observe("lost", error_kind=kind,
                          requests_observed=self._diag_sequence)
            return super().connection_lost(exc)

        def shutdown(self):
            self._observe("shutdown_called")
            return super().shutdown()

        def timeout_keep_alive_handler(self):
            self._observe("keepalive_callback")
            return super().timeout_keep_alive_handler()

    return ObservedProtocol


def _port(address):
    if isinstance(address, tuple) and len(address) >= 2 and isinstance(address[1], int):
        return address[1]
    return None
