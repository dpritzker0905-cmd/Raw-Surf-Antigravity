"""Real fixture teardown contracts for pooled SQLite engines."""
import ast
import asyncio
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from tests.sqlite_lifecycle import assert_fixture_engines_closed
from tests.sqlite_client_fixture import FixtureSessions, async_client_context, dispose_fixture_engine


CONTROLS = [
    ('test_blocks_enforced_on_surfaces', 'client', 'test_a_user_with_no_block_is_unaffected_on_every_action'),
    ('test_guardian_level_gates', 'env', 'test_one_day_short_of_13_is_still_refused_and_the_13th_birthday_is_allowed'),
    ('test_guardian_links', 'env', 'test_a_self_flagged_adult_cannot_link_an_unlinked_child'),
    ('test_parental_controls_enforced', 'client', 'test_the_grom_with_comments_on_succeeds'),
    ('test_signup_role_allowlist', 'client', 'test_a_refused_attempt_does_not_block_a_real_sign_up_with_the_same_email'),
    ('test_sec02_crew_chat_socket', 'client', 'test_a_valid_user_who_is_not_in_the_booking_is_denied'),
    ('test_ws_admin_events_internal_token', 'client', 'test_a_signed_in_non_admin_is_refused'),
    ('test_ws_lineup_membership', 'client', 'test_a_signed_in_user_who_is_not_on_the_lineup_is_refused'),
]


@pytest.mark.parametrize('name,fixture,control', CONTROLS, ids=[row[0] for row in CONTROLS])
def test_fixture_closes_real_sqlite_connections_and_workers(tmp_path, monkeypatch, name, fixture, control):
    # Reuse the collected module under either pytest import mode, avoiding duplicate module side effects.
    module = sys.modules.get(name) or sys.modules.get('tests.' + name)
    if module is None:
        module = importlib.import_module('tests.' + name)
    with assert_fixture_engines_closed(monkeypatch, module):
        with getattr(module, '_' + fixture + '_context')(tmp_path, monkeypatch) as client:
            # This existing functional scenario must really query SQLite. The independent
            # observer then verifies connection, engine and worker lifetime after teardown.
            getattr(module, control)(client)


def _owned_nodes(function):
    """Exclude nested functions, whose resources have a different owner."""
    def visit(node):
        if node is not function and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            return
        yield node
        for child in ast.iter_child_nodes(node):
            yield from visit(child)
    return list(visit(function))


def test_engine_yielding_harnesses_declare_owned_async_disposal():
    # A fast recurrence guard for this exact footgun. Runtime census also covers
    # aliases, helper-created engines and module resources that this syntax cannot prove.
    missing = []
    for path in Path(__file__).parent.glob('test_*.py'):
        for function in ast.walk(ast.parse(path.read_text(encoding='utf-8-sig'))):
            if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            nodes = _owned_nodes(function)
            creates = [n for n in nodes if isinstance(n, ast.Call)
                       and isinstance(n.func, ast.Name) and n.func.id == 'create_async_engine']
            # Returning a session from an inline anonymous engine hides its pool owner.
            if any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                   and n.func.id == 'async_sessionmaker'
                   and (any(arg in creates for arg in n.args) or any(k.value in creates for k in n.keywords)) for n in nodes):
                missing.append(path.name + ':' + str(function.lineno) + ' anonymous session engine')
            if not creates or not any(isinstance(n, (ast.Yield, ast.YieldFrom)) for n in nodes):
                continue
            names = {target.id for node in nodes if isinstance(node, ast.Assign) and node.value in creates
                     for target in node.targets if isinstance(target, ast.Name)}
            disposed = {n.value.id for n in ast.walk(function) if isinstance(n, ast.Attribute)
                        and n.attr == 'dispose' and isinstance(n.value, ast.Name)}
            disposed |= {n.args[0].id for n in ast.walk(function) if isinstance(n, ast.Call)
                         and isinstance(n.func, ast.Name) and n.func.id == 'dispose_fixture_engine'
                         and n.args and isinstance(n.args[0], ast.Name)}
            disposed |= {n.args[1].id for n in ast.walk(function) if isinstance(n, ast.Call)
                         and isinstance(n.func, ast.Attribute) and n.func.attr == 'call' and len(n.args) >= 2
                         and isinstance(n.args[0], ast.Name) and n.args[0].id == 'dispose_fixture_engine'
                         and isinstance(n.args[1], ast.Name)}
            if not names or not names.issubset(disposed):
                missing.append(path.name + ':' + str(function.lineno) + ' ' + function.name)
    assert not missing, 'Async engine owners lack disposal: ' + ', '.join(missing)


@pytest.mark.parametrize('scenario', ['unclosed', 'closed', 'late-unraisable', 'late-thread'])
def test_census_and_strict_warning_exit_gates(tmp_path, scenario):
    # Real child processes prove both resource lifetime and late exception handling.
    # Keep a renamed worker so the census must not rely on its default thread name.
    dispose = scenario != 'unclosed'
    late = scenario.startswith('late-')
    probe = tmp_path / 'test_census_probe.py'
    code = (
        'import asyncio, gc, threading\nfrom sqlalchemy import text\n'
        'from sqlalchemy.ext.asyncio import create_async_engine\n'
        + ('gc.disable()\n' if late else '')
        + 'engine = create_async_engine("sqlite+aiosqlite:///:memory:")\n'
        'def test_real_database():\n'
        '    async def exercise():\n'
        '        async with engine.connect() as connection:\n'
        '            await connection.execute(text("select 1"))\n'
        '            raw = await connection.get_raw_connection()\n'
        '            raw.driver_connection._thread.name = "census-owned-worker"\n'
        + ('        await engine.dispose()\n' if dispose else '')
        + '    asyncio.run(exercise())\n')
    if late:
        finalizer = (
            '            raise RuntimeError("intentional late-finalizer probe")\n'
            if scenario == 'late-unraisable' else
            '            def fail():\n'
            '                raise RuntimeError("intentional late-thread probe")\n'
            '            worker = threading.Thread(target=fail, name="late-warning-probe")\n'
            '            worker.start()\n'
            '            worker.join()\n')
        code += ('    class Late:\n        def __del__(self):\n' + finalizer
                 + '    resource = Late()\n    resource.cycle = resource\n')
    probe.write_text(code, encoding='utf-8')
    config = tmp_path / 'pytest.ini'
    config.write_text('[pytest]\n', encoding='utf-8')
    report = tmp_path / 'lifetime.json'
    env = os.environ.copy()
    env['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
    env.pop('PYTEST_ADDOPTS', None)
    env['PYTHONPATH'] = str(Path(__file__).resolve().parents[1])
    result = subprocess.run(
        [sys.executable, '-m', 'pytest', str(probe), '-q', '-c', str(config),
         '--confcutdir', str(tmp_path), '-p', 'tests.sqlite_lifecycle_census',
         '--sqlite-lifetime-report=' + str(report),
         '-W', 'error::pytest.PytestUnhandledThreadExceptionWarning',
         '-W', 'error::pytest.PytestUnraisableExceptionWarning'],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=45)
    if scenario == 'closed':
        assert result.returncode == 0, result.stdout + result.stderr
    else:
        assert result.returncode != 0, result.stdout + result.stderr
    census = json.loads(report.read_text(encoding='utf-8'))
    assert census['connections'] == 1
    assert census['closed'] == int(dispose)
    assert census['live_workers'] == int(not dispose)
    assert census['unclosed_connections'] == int(not dispose)
    if late:
        category = ('PytestUnraisableExceptionWarning' if scenario == 'late-unraisable'
                    else 'PytestUnhandledThreadExceptionWarning')
        assert category in result.stdout + result.stderr


@pytest.mark.parametrize('initialization_fails', [False, True, 'skip'])
def test_async_client_disposes_startup_pool_on_its_loop(tmp_path, initialization_fails):
    from fastapi import FastAPI
    from sqlalchemy import event, text
    from sqlalchemy.ext.asyncio import create_async_engine
    engine = create_async_engine('sqlite+aiosqlite:///' + (tmp_path / 'client.sqlite').as_posix())
    opened, closed, disposed, workers, loops = [], [], [], [], []

    def connected(dbapi, _):
        opened.append(id(dbapi))
        driver = dbapi.driver_connection
        workers.append(getattr(driver, '_thread', driver))
        loops.append(id(asyncio.get_running_loop()))

    event.listen(engine.sync_engine, 'connect', connected)
    event.listen(engine.sync_engine, 'close', lambda dbapi, _: closed.append(id(dbapi)))
    event.listen(engine.sync_engine, 'engine_disposed', lambda _: disposed.append(id(asyncio.get_running_loop())))
    app = FastAPI()

    async def initialize():
        async with engine.connect() as connection:
            assert await connection.scalar(text('select 1')) == 1
        if initialization_fails == 'skip':
            pytest.skip('intentional startup skip')
        if initialization_fails:
            raise RuntimeError('intentional startup failure')

    @app.get('/')
    async def read():
        async with engine.connect() as connection:
            return {'value':await connection.scalar(text('select 1'))}

    async def exercise():
        try:
            if initialization_fails:
                expected = pytest.skip.Exception if initialization_fails == 'skip' else RuntimeError
                with pytest.raises(expected, match='intentional startup'):
                    async with async_client_context(app, initialize, engine):
                        pytest.fail('Failed initialization must not yield a client')
            else:
                async with async_client_context(app, initialize, engine) as client:
                    response = await client.get('/')
                    assert response.json() == {'value':1}
            assert opened and closed == opened, 'Startup pool connections outlived the async client'
            assert disposed == [id(asyncio.get_running_loop())]
            assert set(loops) == set(disposed), 'Startup and disposal must use the fixture loop'
            for worker in workers:
                worker.join(timeout=1)
            assert workers and not any(worker.is_alive() for worker in workers)
        finally:
            # Keep a failing regression from contaminating the next case.
            await engine.dispose()

    asyncio.run(exercise())


def test_fixture_disposal_refuses_checked_out_connection(tmp_path):
    from sqlalchemy import event, text
    from sqlalchemy.ext.asyncio import create_async_engine

    async def exercise():
        engine = create_async_engine('sqlite+aiosqlite:///' + (tmp_path / 'checked-out.sqlite').as_posix())
        opened, closed, disposed = [], [], []
        event.listen(engine.sync_engine, 'connect', lambda dbapi, _: opened.append(id(dbapi)))
        event.listen(engine.sync_engine, 'close', lambda dbapi, _: closed.append(id(dbapi)))
        event.listen(engine.sync_engine, 'engine_disposed', lambda _: disposed.append(True))
        connection = await engine.connect()
        try:
            assert await connection.scalar(text('select 1')) == 1
            idle = await engine.connect()
            await idle.close()
            assert len(opened) == 2 and not closed
            with pytest.raises(AssertionError, match='checked-out SQLite connections'):
                await dispose_fixture_engine(engine)
            assert closed == [opened[1]], 'The idle pool must close even when checkout accounting fails'
            assert disposed == [True]
        finally:
            await connection.invalidate()
            await connection.close()
            await engine.dispose()

    asyncio.run(exercise())


def test_socket_session_finalization_finishes_before_pool_teardown(tmp_path):
    import anyio
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    async def exercise():
        engine = create_async_engine('sqlite+aiosqlite:///' + (tmp_path / 'cancelled.sqlite').as_posix())
        sessions = FixtureSessions(async_sessionmaker(engine))

        async def lookup(*, task_status=anyio.TASK_STATUS_IGNORED):
            with anyio.CancelScope() as scope:
                async with sessions() as session:
                    assert await session.scalar(text('select 1')) == 1
                    task_status.started(scope)
                    await anyio.sleep_forever()

        try:
            async with anyio.create_task_group() as tasks:
                scope = await tasks.start(lookup)
                assert engine.pool.checkedout() == 1
                scope.cancel()
                await dispose_fixture_engine(engine, sessions)
                assert sessions.finished and all(done.is_set() for done in sessions.finished)
                assert not sessions.errors
                assert engine.pool.checkedout() == 0
        finally:
            await engine.dispose()

    asyncio.run(exercise())


def test_socket_fixture_reports_late_session_without_opening_a_pool():
    async def exercise():
        def forbidden():
            pytest.fail('A session must not be created after teardown starts')

        sessions = FixtureSessions(forbidden)
        await sessions.aclose()
        with pytest.raises(RuntimeError, match='after teardown began') as refused:
            async with sessions():
                pytest.fail('A closed fixture must not yield a session')
        assert sessions.errors == [refused.value]
        with pytest.raises(RuntimeError, match='Fixture session cleanup failed') as reported:
            await sessions.aclose()
        assert reported.value.__cause__ is refused.value

    asyncio.run(exercise())


def test_socket_fixture_surfaces_close_failure_and_still_disposes_idle_pool(tmp_path, monkeypatch):
    from sqlalchemy import event, text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    async def exercise():
        engine = create_async_engine('sqlite+aiosqlite:///' + (tmp_path / 'close-failure.sqlite').as_posix())
        opened, closed, disposed = [], [], []
        event.listen(engine.sync_engine, 'connect', lambda dbapi, _: opened.append(id(dbapi)))
        event.listen(engine.sync_engine, 'close', lambda dbapi, _: closed.append(id(dbapi)))
        event.listen(engine.sync_engine, 'engine_disposed', lambda _: disposed.append(True))
        session = async_sessionmaker(engine)()
        real_close = session.close

        async def failing_close():
            await real_close()
            raise RuntimeError('intentional fixture close failure')

        monkeypatch.setattr(session, 'close', failing_close)
        sessions = FixtureSessions(lambda: session)
        try:
            with pytest.raises(RuntimeError, match='intentional fixture close failure') as primary:
                async with sessions() as db:
                    assert await db.scalar(text('select 1')) == 1
            with pytest.raises(RuntimeError, match='Fixture session cleanup failed') as reported:
                await dispose_fixture_engine(engine, sessions)
            assert reported.value.__cause__ is primary.value
            assert opened and closed == opened
            assert disposed == [True]
        finally:
            await real_close()
            await engine.dispose()

    asyncio.run(exercise())
