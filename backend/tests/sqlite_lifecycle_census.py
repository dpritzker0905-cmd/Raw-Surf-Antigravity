"""Opt-in pytest observer: fail when SQLite resources outlive all fixture teardown.

Uses SQLAlchemy events and real driver workers. It never closes a resource for a
fixture. Reports contain the test active at connection and opening frames when available
(greenlets can omit those frames), never connection URLs,
SQL, credentials, object reprs or environment values.
"""
import asyncio
import gc
import json
from pathlib import Path
import threading
import time
import traceback

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine


_ROOT = Path(__file__).resolve().parents[1]
_records = []
_active = {}
_current_test = '<collection>'


def _workers():
    return {t for t in threading.enumerate()
            if type(t).__module__.startswith('aiosqlite')
            or '(_connection_worker_thread)' in t.name}


def _connected(dbapi, _):
    driver = getattr(dbapi, 'driver_connection', None)
    if not type(driver).__module__.startswith('aiosqlite'):
        return
    locations = []
    for frame in traceback.extract_stack():
        path = Path(frame.filename).resolve()
        if path.is_relative_to(_ROOT) and path.suffix == '.py' and path.is_file() and path != Path(__file__).resolve():
            locations.append({'file':path.relative_to(_ROOT).as_posix(),
                              'line':frame.lineno, 'function':frame.name})
    try:
        loop = id(asyncio.get_running_loop())
    except RuntimeError:
        loop = None
    record = {'test':_current_test, 'opened_at':locations[-12:], 'closed':False,
              'loop':loop, 'thread':threading.get_ident(),
              'worker':getattr(driver, '_thread', None)}
    _records.append(record)
    _active[id(dbapi)] = record


def _closed(dbapi, *_):
    if not type(getattr(dbapi, 'driver_connection', None)).__module__.startswith('aiosqlite'):
        return
    record = _active.pop(id(dbapi), None)
    if record is not None:
        record['closed'] = True


# Install before test collection, including module-level and helper-created engines.
event.listen(Engine, 'connect', _connected)
event.listen(Engine, 'close', _closed)
event.listen(Engine, 'close_detached', _closed)


def pytest_addoption(parser):
    group = parser.getgroup('SQLite lifetime')
    group.addoption('--sqlite-lifetime-report', default=None,
                    help='Write the resource census JSON to this path.')
    group.addoption('--sqlite-lifetime-gc-stress', action='store_true', default=False,
                    help='Force GC after every test instead of each module.')


def pytest_configure(config):
    if getattr(config.option, 'numprocesses', None):
        raise pytest.UsageError('SQLite lifetime census requires a serial pytest process; worker aggregation is not implemented')


def _live_workers():
    recorded = {r['worker'] for r in _records
                if isinstance(r['worker'], threading.Thread) and r['worker'].is_alive()}
    return _workers() | recorded


def pytest_runtest_setup(item):
    global _current_test
    _current_test = item.nodeid.split('[', 1)[0]


@pytest.hookimpl(hookwrapper=True, trylast=True)
def pytest_runtest_teardown(item, nextitem):
    yield
    if (item.config.getoption('--sqlite-lifetime-gc-stress') or nextitem is None
            or getattr(item, 'module', None) is not getattr(nextitem, 'module', None)):
        gc.collect()


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session, exitstatus):
    # All test, module and session fixture finalizers have completed. Wait only;
    # disposing orphan engines here would hide the ownership defect.
    gc.collect()
    deadline = time.monotonic() + 5
    for worker in _live_workers():
        worker.join(timeout=max(0, min(1, deadline - time.monotonic())))
    live = _live_workers()
    unclosed = [r for r in _records if not r['closed']]
    report = {'connections':len(_records), 'closed':sum(r['closed'] for r in _records),
              'live_workers':len(live), 'unclosed_connections':len(unclosed),
              'live_worker_names':sorted(t.name for t in live),
              'connection_loop_threads':sorted({(r['loop'], r['thread']) for r in _records if r['loop'] is not None}),
              'unclosed_sites':[{k:v for k,v in r.items() if k != 'worker'} for r in unclosed]}
    path = session.config.getoption('--sqlite-lifetime-report')
    if path:
        Path(path).write_text(json.dumps(report, indent=2), encoding='utf-8')
    terminal = session.config.pluginmanager.getplugin('terminalreporter')
    message = ('SQLite lifetime census: '+str(report['connections'])+' connections, '
               +str(report['unclosed_connections'])+' unclosed, '
               +str(report['live_workers'])+' live workers')
    if terminal:
        terminal.write_line(message)
    if not _records or unclosed or live:
        if terminal:
            terminal.write_line('::error::SQLite resources outlived fixture teardown or the census observed no connections')
        if session.exitstatus == 0:
            session.exitstatus = 1
