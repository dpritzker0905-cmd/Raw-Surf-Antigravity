"""Start/stop only an owned disposable loopback PostgreSQL cluster; no app environment."""
import json
import os
import socket
import subprocess
import sys
import uuid
from pathlib import Path

from sqlalchemy.engine import URL

OUT = Path(__file__).resolve().parent
BINS = Path("C:/Users/David/.codex/worktrees/cddb/raw-surf/scratch/payment-postgres/pgsql/bin")
baseline = "--baseline" in sys.argv
label = "baseline" if baseline else "final"
work = OUT / ".postgres" / (label + "-" + uuid.uuid4().hex[:12])
work.mkdir(parents=True)
cluster = work / "cluster"
started = False
result = {"ownedNewCluster": True, "loopbackOnly": True, "database": "support_numbering_fixture", "label": label}
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]


def control(executable, args):
    with (work / "control.log").open("ab") as log:
        return subprocess.run([str(BINS / executable), *args], stdout=log, stderr=subprocess.STDOUT,
                              check=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)


try:
    result["version"] = subprocess.check_output([str(BINS / "postgres.exe"), "--version"], text=True).strip()
    control("initdb.exe", ["-D", str(cluster), "-U", "fixture_owner", "--auth-host=trust", "--auth-local=trust", "--encoding=UTF8", "--locale=C"])
    with (cluster / "postgresql.conf").open("a", encoding="utf-8") as config:
        config.write("\nlisten_addresses='127.0.0.1'\nport=" + str(port) + "\nshared_preload_libraries=''\n")
    control("pg_ctl.exe", ["-D", str(cluster), "-l", str(work / "postgres.log"), "-w", "start"])
    started = True
    # No credentials are needed for this disposable loopback-only fixture cluster.
    import psycopg2
    connection = psycopg2.connect(host="127.0.0.1", port=port, user="fixture_owner", dbname="postgres")
    try:
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute("CREATE DATABASE support_numbering_fixture TEMPLATE template0")
    finally:
        connection.close()
    env = os.environ.copy()
    env["RAW_SUPPORT_FIXTURE_DATABASE_URL"] = URL.create("postgresql+asyncpg", username="fixture_owner", host="127.0.0.1", port=port, database="support_numbering_fixture").render_as_string(hide_password=False)
    command = [sys.executable, "-B", str(OUT / "verify-delivery.py"), "--pg"] + (["--baseline"] if baseline else [])
    run = subprocess.run(command, env=env, capture_output=True, text=True, encoding="utf-8", timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
    (work / "private-output.log").write_text(run.stdout + run.stderr, encoding="utf-8")
    result["fixtureExitCode"] = run.returncode
    cases = json.loads((OUT / ("delivery-postgresql.json")).read_text())
    result.update(passed=cases["passed"], total=cases["total"])
    result["expectationsMet"] = (run.returncode == 1 and cases["passed"] == 0) if baseline else (run.returncode == 0 and cases["passed"] == cases["total"])
except Exception as error:
    result["error_class"] = type(error).__name__
finally:
    if started:
        control("pg_ctl.exe", ["-D", str(cluster), "-m", "fast", "-w", "stop"])
    state = subprocess.run([str(BINS / "pg_ctl.exe"), "-D", str(cluster), "status"], capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    result["pgStatusStopped"] = state.returncode == 3
    net = subprocess.run(["netstat.exe", "-ano", "-p", "tcp"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
    result["osListenerAbsent"] = net.returncode == 0 and not any(len(parts := line.split()) >= 4 and parts[1].rsplit(":", 1)[-1] == str(port) and parts[3].upper() == "LISTENING" for line in net.stdout.splitlines())
    (OUT / (label + "-postgres-control.json")).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result), flush=True)
raise SystemExit(0 if result.get("expectationsMet") and result["pgStatusStopped"] and result["osListenerAbsent"] else 1)
