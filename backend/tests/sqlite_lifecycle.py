"""Real request-engine lifetime checks for the pinned aiosqlite test driver."""
import asyncio
from collections import Counter
from contextlib import contextmanager
import threading

from sqlalchemy import event


def _sqlite_workers():
    # 0.22 uses a Thread target; earlier aiosqlite releases subclassed Thread.
    return {thread for thread in threading.enumerate()
            if type(thread).__module__.startswith('aiosqlite')
            or '(_connection_worker_thread)' in thread.name}


@contextmanager
def assert_request_engines_closed(client, monkeypatch, module):
    """Check request cleanup while its owning TestClient portal is still live."""
    with _assert_engines_closed(monkeypatch, module,
                                lambda engine: client.portal.call(engine.dispose), ordered=True):
        yield


@contextmanager
def assert_fixture_engines_closed(monkeypatch, module):
    """Check a complete fixture scope; bound red-run cleanup on a fresh loop."""
    def cleanup(engine):
        asyncio.run(asyncio.wait_for(engine.dispose(), timeout=5))

    with _assert_engines_closed(monkeypatch, module, cleanup, ordered=False):
        yield


@contextmanager
def _assert_engines_closed(monkeypatch, module, cleanup_engine, *, ordered):
    """Observe real connections and wait for their workers; do not fake database cleanup."""
    original = module.create_async_engine
    before = _sqlite_workers()
    engines, opened, closed, disposed, workers = [], [], [], set(), set()

    def observed_engine(*args, **kwargs):
        engine = original(*args, **kwargs)
        engines.append(engine)

        def connected(dbapi, _):
            opened.append(id(dbapi))
            workers.update(_sqlite_workers() - before)

        event.listen(engine.sync_engine, 'connect', connected)
        event.listen(engine.sync_engine, 'close', lambda dbapi, _: closed.append(id(dbapi)))
        event.listen(engine.sync_engine, 'engine_disposed', lambda _: disposed.add(id(engine)))
        return engine

    monkeypatch.setattr(module, 'create_async_engine', observed_engine)
    try:
        yield
        assert engines and opened and workers, 'The control must open real SQLite connections and workers'
        assert (closed == opened if ordered else Counter(closed) == Counter(opened)), 'Scope ended with live SQLite connections'
        assert disposed == {id(engine) for engine in engines}, 'Scope ended without disposing its engine'
        for worker in workers:
            worker.join(timeout=1)
        assert not any(worker.is_alive() for worker in workers), 'SQLite workers survived request cleanup'
    except BaseException as primary:
        # Preserve the primary failure if bounded cleanup also fails.
        for engine in engines:
            if id(engine) not in disposed:
                try:
                    cleanup_engine(engine)
                except Exception as cleanup:
                    primary.add_note(f'Additional engine cleanup failed: {type(cleanup).__name__}')
        raise
