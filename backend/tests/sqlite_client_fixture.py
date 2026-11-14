"""Explicit async-client fixture ownership; no automatic or observer-side cleanup."""
from contextlib import asynccontextmanager

import anyio

from httpx import AsyncClient, ASGITransport


async def dispose_fixture_engine(engine, sessions=None):
    """Fail on checked-out sessions while still disposing every idle connection."""
    try:
        if sessions is not None:
            await sessions.aclose()
        assert engine.pool.checkedout() == 0, 'Fixture ended with checked-out SQLite connections'
    finally:
        await engine.dispose()


@asynccontextmanager
async def async_client_context(app, initialize, engine):
    """Pair manually invoked startup with pool teardown on the same event loop."""
    try:
        await initialize()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            yield client
    finally:
        await dispose_fixture_engine(engine)


class FixtureSessions:
    """Own websocket lookup sessions until their cancellation-safe close finishes."""
    def __init__(self, maker):
        self.maker = maker
        self.finished = []
        self.errors = []
        self.closing = False

    @asynccontextmanager
    async def __call__(self):
        if self.closing:
            error = RuntimeError('A fixture session started after teardown began')
            self.errors.append(error)
            raise error
        session = self.maker()
        done = anyio.Event()
        self.finished.append(done)
        try:
            yield session
        finally:
            try:
                # TestClient can cancel a handler immediately after its close frame.
                # Finalization must survive that scope and finish before pool teardown.
                with anyio.CancelScope(shield=True):
                    await session.close()
            except BaseException as exc:
                self.errors.append(exc)
                raise
            finally:
                done.set()

    async def aclose(self):
        self.closing = True
        with anyio.fail_after(5):
            for done in self.finished:
                await done.wait()
        if self.errors:
            raise RuntimeError('Fixture session cleanup failed') from self.errors[0]
