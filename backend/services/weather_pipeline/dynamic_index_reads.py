"""Request-local dynamic index snapshots, refreshed whenever the file changes.

Cached rows are private, read-only inputs to selection/pruning. Public results
must be copied by DynamicProductIndex. No process TTL or forecast cache is added.
"""
import json
import os
from contextlib import contextmanager
from contextvars import ContextVar


_READ_SCOPE = ContextVar("dynamic_index_read_scope", default=None)


@contextmanager
def dynamic_index_read_scope():
    state = {"active": True, "files": {}}
    token = _READ_SCOPE.set(state)
    try:
        yield
    finally:
        # Child tasks may inherit this context; it must stop caching after exit.
        state["active"] = False
        state["files"].clear()
        _READ_SCOPE.reset(token)


def _signature(stat):
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def invalidate_index(path):
    state = _READ_SCOPE.get()
    if state is not None:
        state["files"].pop(path, None)


def read_index(path):
    """Return private rows; never cache a missing, failed or concurrently changed read."""
    try:
        signature = _signature(path.stat())
    except FileNotFoundError:
        invalidate_index(path)
        return []
    state = _READ_SCOPE.get()
    scoped = state is not None and state["active"]
    cached = state["files"].get(path) if scoped else None
    if cached is not None and cached[0] == signature:
        return cached[1]
    if scoped:
        state["files"].pop(path, None)
    with open(path, "r") as stream:
        # On Windows stat(path).ctime is creation time while fstat may expose
        # metadata-change time. Compare descriptor identity/size/mtime instead.
        opened = _signature(os.fstat(stream.fileno()))[:4]
        rows = json.load(stream)
        finished = _signature(os.fstat(stream.fileno()))[:4]
    if scoped and signature[:4] == opened == finished:
        try:
            current = _signature(path.stat())
        except OSError:
            current = None
        if signature == current:
            state["files"][path] = (signature, rows)
    return rows
