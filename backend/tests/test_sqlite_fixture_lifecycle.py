"""Real fixture teardown contracts for pooled SQLite engines."""
import ast
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from tests.sqlite_lifecycle import assert_fixture_engines_closed


CONTROLS = [
    ('test_blocks_enforced_on_surfaces', 'client', 'test_a_user_with_no_block_is_unaffected_on_every_action'),
    ('test_guardian_level_gates', 'env', 'test_one_day_short_of_13_is_still_refused_and_the_13th_birthday_is_allowed'),
    ('test_guardian_links', 'env', 'test_a_self_flagged_adult_cannot_link_an_unlinked_child'),
    ('test_parental_controls_enforced', 'client', 'test_the_grom_with_comments_on_succeeds'),
    ('test_signup_role_allowlist', 'client', 'test_a_refused_attempt_does_not_block_a_real_sign_up_with_the_same_email'),
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
            if not creates or not any(isinstance(n, (ast.Yield, ast.YieldFrom)) for n in nodes):
                continue
            names = {target.id for node in nodes if isinstance(node, ast.Assign) and node.value in creates
                     for target in node.targets if isinstance(target, ast.Name)}
            disposed = {n.value.id for n in ast.walk(function) if isinstance(n, ast.Attribute)
                        and n.attr == 'dispose' and isinstance(n.value, ast.Name)}
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
