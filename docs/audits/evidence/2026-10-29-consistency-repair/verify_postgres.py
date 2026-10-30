"""Disposable PostgreSQL verification; no application startup or inherited configuration.

Supply --pg-bin and --scratch-dir (a private directory outside the repository).
Only synthetic rows and sanitized results are emitted. Target-table foreign keys
are omitted: this verifies real PostgreSQL query/transaction behavior, not the
unrelated application schema or its relationship constraints.
"""
import argparse
from datetime import date, datetime, timedelta, timezone
import errno
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import types
import uuid


ROOT = Path(__file__).resolve().parents[4]
ENV_PREFIX = "RAW_CONSISTENCY_PG_"


def load_route(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def worker():
    from sqlalchemy import create_engine, delete
    from sqlalchemy.engine import URL
    from sqlalchemy.orm import Session, declarative_base
    from sqlalchemy.schema import CreateTable, CreateIndex

    host = os.environ[ENV_PREFIX + "HOST"]
    database_name = os.environ[ENV_PREFIX + "DATABASE"]
    assert host == "127.0.0.1" and database_name.startswith("consistency_")
    database = types.ModuleType("database")
    database.Base = declarative_base()
    database.get_db = lambda: None
    sys.modules["database"] = database
    security = types.ModuleType("core.security")
    security.get_current_user_id = lambda: "fixture-owner"
    sys.modules["core.security"] = security
    sys.path.insert(0, str(ROOT / "backend"))
    from models import Notification, SurfLogEntry

    notifications = load_route("consistency_notifications", "backend/routes/notifications/notifications.py")
    surf_log = load_route("consistency_surf_log", "backend/routes/surf_data/surf_log.py")
    url = URL.create(
        "postgresql+psycopg2", username=os.environ[ENV_PREFIX + "USER"],
        password=os.environ[ENV_PREFIX + "PASSWORD"], host=host,
        port=int(os.environ[ENV_PREFIX + "PORT"]), database=database_name,
    )
    engine = create_engine(url, connect_args={"connect_timeout": 5})

    class AsyncSessionAdapter:
        def __init__(self, session):
            self.session = session

        async def execute(self, query):
            return self.session.execute(query)

        async def commit(self):
            self.session.commit()

    def drive(coroutine):
        try:
            coroutine.send(None)
        except StopIteration as completed:
            return completed.value
        raise AssertionError("Fixture unexpectedly awaited external asynchronous I/O")

    checks = []

    def check(name, condition):
        checks.append({"case": name, "passed": bool(condition)})

    try:
        with engine.begin() as connection:
            identity = connection.exec_driver_sql(
                "SELECT current_database(), inet_server_addr()::text, version()"
            ).one()
            assert identity[0] == database_name, "Connected database identity differs from this fixture"
            assert identity[1].split("/")[0] == "127.0.0.1", "Database server is not the owned loopback listener"
            for table in [Notification.__table__, SurfLogEntry.__table__]:
                connection.execute(CreateTable(table, include_foreign_key_constraints=[]))
                for index in table.indexes:
                    connection.execute(CreateIndex(index))

        stamp = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
        with Session(engine) as session:
            session.add_all([
                Notification(id=f"n-{i:03}", user_id="fixture-owner", type="social", title="Synthetic notification",
                             is_read=i != 4, created_at=stamp) for i in range(55)
            ])
            session.add(Notification(id="older-unread", user_id="fixture-owner", type="social", title="Older synthetic notification",
                                     is_read=False, created_at=stamp - timedelta(days=1)))
            session.add(Notification(id="other-owner", user_id="other-fixture-owner", type="social", title="Synthetic control",
                                     is_read=False, created_at=stamp))
            session.commit()

        def page(limit=50, cursor=None):
            with Session(engine) as session:
                return drive(notifications.get_notifications(
                    user_id="fixture-owner", limit=limit,
                    before_created_at=cursor[0] if cursor else None,
                    before_id=cursor[1] if cursor else None, db=AsyncSessionAdapter(session),
                ))

        def unread(owner="fixture-owner"):
            with Session(engine) as session:
                return drive(notifications.get_unread_notification_count(owner, AsyncSessionAdapter(session)))["unread_count"]

        first = page()
        check("notification_first_page_50_read_but_2_unread_total", len(first) == 50 and all(n.is_read for n in first) and unread() == 2)
        check("notification_tied_timestamp_order", [n.id for n in first] == [f"n-{i:03}" for i in range(54, 4, -1)])
        cursor = (first[-1].created_at, first[-1].id)
        expected_tail = [f"n-{i:03}" for i in range(4, -1, -1)] + ["older-unread"]
        before_insert = page(cursor=cursor)
        check("notification_older_unread_reachable", [n.id for n in before_insert] == expected_tail and sum(not n.is_read for n in before_insert) == 2)

        with Session(engine) as session:
            session.add_all([
                Notification(id="newer-insert", user_id="fixture-owner", type="social", title="Newer synthetic insert",
                             is_read=False, created_at=stamp + timedelta(seconds=1)),
                Notification(id="z-tied-insert", user_id="fixture-owner", type="social", title="Tied synthetic insert",
                             is_read=False, created_at=stamp),
            ])
            session.commit()
        second = page(cursor=cursor)
        check("notification_new_inserts_do_not_shift_older_page", [n.id for n in second] == expected_tail)
        check("notification_no_duplicate_or_skipped_snapshot_rows", len({n.id for n in first + second}) == 56 and len(first + second) == 56)
        check("notification_refresh_sees_new_inserts", [n.id for n in page(limit=2)] == ["newer-insert", "z-tied-insert"])
        shifted_cursor = (cursor[0].astimezone(timezone(timedelta(hours=5, minutes=30))), cursor[1])
        check("notification_offset_timezone_cursor_same_instant", [n.id for n in page(cursor=shifted_cursor)] == expected_tail)
        check("notification_end_of_history", page(cursor=(second[-1].created_at, second[-1].id)) == [])

        with Session(engine) as session:
            session.execute(delete(Notification).where(Notification.id == cursor[1]))
            session.commit()
        check("notification_deleted_cursor_still_pages", [n.id for n in page(cursor=cursor)] == expected_tail)
        with Session(engine) as session:
            drive(notifications.mark_all_notifications_read("fixture-owner", "fixture-owner", AsyncSessionAdapter(session)))
        check("notification_mark_all_covers_older_and_new_rows", unread() == 0 and unread("other-fixture-owner") == 1)

        fixtures = [
            ("one", "fixture-owner", date(2026, 10, 26), "stoked", "spot-one"),
            ("two", "fixture-owner", date(2026, 10, 25), "mellow", "spot-two"),
            ("three", "fixture-owner", date(2026, 9, 24), "stoked", "spot-two"),
            ("four", "fixture-owner", date(2025, 10, 23), "mellow", "spot-one"),
            ("other", "other-fixture-owner", date(2026, 10, 27), "stoked", "spot-one"),
        ]
        with Session(engine) as session:
            session.add_all(SurfLogEntry(id=i, user_id=u, session_date=d, mood=m, spot_id=s) for i, u, d, m, s in fixtures)
            session.commit()
        cases = [
            ("unfiltered", {}, ["one", "two", "three", "four"], 4),
            ("mood", {"mood": "stoked"}, ["one", "three"], 2),
            ("year", {"year": 2026}, ["one", "two", "three"], 3),
            ("month", {"month": 10}, ["one", "two", "four"], 3),
            ("spot", {"spot_id": "spot-one"}, ["one", "four"], 2),
            ("combined", {"year": 2026, "month": 10, "mood": "stoked", "spot_id": "spot-one"}, ["one"], 1),
            ("empty", {"mood": "happy"}, [], 0),
            ("paginated", {"mood": "stoked", "limit": 1, "offset": 1}, ["three"], 2),
            ("past-end", {"year": 2026, "offset": 10}, [], 3),
        ]
        for name, params, ids, total in cases:
            with Session(engine) as session:
                args = dict(user_id="fixture-owner", current_user_id="fixture-owner", db=AsyncSessionAdapter(session),
                            limit=50, offset=0, year=None, month=None, spot_id=None, mood=None)
                args.update(params)
                result = drive(surf_log.get_surf_log(**args))
                check("surf_log_" + name, [row["id"] for row in result["entries"]] == ids and result["total"] == total)

        return {"postgresql_version": identity[2].split(",")[0], "verified_owned_loopback_database": True,
                "passed": sum(c["passed"] for c in checks), "total": len(checks), "checks": checks,
                "limits": "Actual PostgreSQL target tables and route functions; no foreign-key, ASGI/auth, provider, deployed or full-app qualification."}
    finally:
        engine.dispose()


def launch(args):
    import psycopg2
    from psycopg2 import sql

    scratch = Path(args.scratch_dir).resolve()
    assert not scratch.is_relative_to(ROOT), "Private fixture state must remain outside the public repository"
    binaries = Path(args.pg_bin).resolve()
    assert all((binaries / name).is_file() for name in ["postgres.exe", "pg_ctl.exe", "initdb.exe"])
    work = scratch / ("consistency-pg-" + uuid.uuid4().hex)
    work.mkdir(parents=True, exist_ok=False)
    cluster = work / "cluster"
    credential_file = work / "temporary-init-credential"
    credential = secrets.token_urlsafe(32)
    credential_file.write_text(credential, encoding="utf-8")
    database_name = "consistency_" + uuid.uuid4().hex
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    started = False
    report = {"started": False, "server_stopped": False, "port_closed": False}

    def control(executable, command):
        with (work / "control.log").open("ab") as output:
            return subprocess.run([str(binaries / executable), *command], stdout=output, stderr=subprocess.STDOUT,
                                  check=True, timeout=60, creationflags=flags)

    try:
        control("initdb.exe", ["-D", str(cluster), "-U", "fixture_owner", "--pwfile", str(credential_file),
                                "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--locale=C"])
        credential_file.unlink()
        with (cluster / "postgresql.conf").open("a", encoding="utf-8") as output:
            output.write("\nlisten_addresses='127.0.0.1'\nport=" + str(port) + "\nshared_preload_libraries=''\n")
        control("pg_ctl.exe", ["-D", str(cluster), "-l", str(work / "postgres.log"), "-w", "start"])
        started = True
        report["started"] = True
        connection = psycopg2.connect(host="127.0.0.1", port=port, user="fixture_owner", password=credential,
                                      dbname="postgres", connect_timeout=5)
        try:
            connection.autocommit = True
            with connection.cursor() as cursor:
                cursor.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(database_name)))
        finally:
            connection.close()
        environment = {k: v for k, v in os.environ.items() if not any(word in k.upper() for word in
                       ["DATABASE", "SUPABASE", "STRIPE", "LOGFIRE", "SENTRY", "PGHOST", "PGPORT", "PGUSER", "PGPASS", "PGSERVICE"])}
        for key, value in {"HOST": "127.0.0.1", "PORT": str(port), "USER": "fixture_owner", "PASSWORD": credential,
                           "DATABASE": database_name}.items():
            environment[ENV_PREFIX + key] = value
        result = subprocess.run([sys.executable, "-B", str(Path(__file__).resolve()), "--worker"], cwd=ROOT,
                                env=environment, capture_output=True, text=True, encoding="utf-8", timeout=180, creationflags=flags)
        report["worker_exit"] = result.returncode
        if result.stdout.strip():
            report.update(json.loads(result.stdout))
        else:
            report["error_class"] = "WorkerProducedNoSanitizedReport"
    except Exception as error:
        report["error_class"] = type(error).__name__
        report["error_detail"] = str(error).replace(credential, "<redacted>")[:1000]
    finally:
        if started or (cluster / "postmaster.pid").exists():
            try:
                control("pg_ctl.exe", ["-D", str(cluster), "-m", "fast", "-w", "stop"])
                report["server_stopped"] = True
            except Exception as error:
                report["cleanup_error_class"] = type(error).__name__
        if credential_file.exists():
            credential_file.unlink()
        with socket.socket() as probe:
            probe.settimeout(2)
            report["port_check_code"] = probe.connect_ex(("127.0.0.1", port))
            report["port_closed"] = report["port_check_code"] in {errno.ECONNREFUSED, 10061}
        # Python's timed socket probe can return WSAEWOULDBLOCK on Windows. Read
        # the OS listener table as well; a generic connection error is not proof.
        listeners = subprocess.run(["netstat.exe", "-ano", "-p", "tcp"], capture_output=True, text=True,
                                   timeout=10, creationflags=flags)
        owned_listeners = [line for line in listeners.stdout.splitlines()
                           if len(line.split()) >= 4 and line.split()[1] == f"127.0.0.1:{port}"
                           and line.split()[3].upper() == "LISTENING"]
        report["listener_table_read"] = listeners.returncode == 0
        report["owned_listener_count_after_stop"] = len(owned_listeners) if listeners.returncode == 0 else None
        report["port_closed"] = report["server_stopped"] and listeners.returncode == 0 and not owned_listeners
        report["temporary_credential_file_removed"] = not credential_file.exists()
        report["private_fixture_directory"] = str(work)
        (work / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2))
    return report.get("worker_exit") == 0 and report["server_stopped"] and report["port_closed"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--pg-bin")
    parser.add_argument("--scratch-dir")
    arguments = parser.parse_args()
    if arguments.worker:
        try:
            summary = worker()
            print(json.dumps(summary))
            sys.exit(0 if summary["passed"] == summary["total"] else 1)
        except Exception as error:
            import traceback
            failure = traceback.extract_tb(error.__traceback__)[-1]
            print(json.dumps({"error_class": type(error).__name__, "failure_file": Path(failure.filename).name,
                              "failure_line": failure.lineno}))
            sys.exit(1)
    if not arguments.pg_bin or not arguments.scratch_dir:
        parser.error("--pg-bin and --scratch-dir are required")
    sys.exit(0 if launch(arguments) else 1)
