"""Real request-engine lifetime checks for the pinned aiosqlite test driver."""
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
        assert closed == opened, 'Request returned with live SQLite connections'
        assert disposed == {id(engine) for engine in engines}, 'Request returned without disposing its engine'
        for worker in workers:
            worker.join(timeout=1)
        assert not any(worker.is_alive() for worker in workers), 'SQLite workers survived request cleanup'
    except BaseException as primary:
        # The TestClient context is still open. Preserve the primary failure if cleanup also fails.
        for engine in engines:
            if id(engine) not in disposed:
                try:
                    client.portal.call(engine.dispose)
                except Exception as cleanup:
                    primary.add_note(f'Additional engine cleanup failed: {type(cleanup).__name__}')
        raise
