"""Render DEV-only live-seat queue worker. Run from backend with python -m scripts.live_seat_readonly_worker."""
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from sqlalchemy import DateTime, String, column, create_engine, func, select, table, text
from sqlalchemy.engine import URL

from services.live_seat_queue import pending_seat_ids

SERVICE = "srv-dc2vr35g1s2s73bbs2o0"
PROJECT = "weewaulkwfwlbhqemxma"
POOLER = "aws-0-us-west-2.pooler.supabase.com"
ROLE = "rawsurf_1274_worker"
CA_FILE = "/etc/secrets/dev-1274-ca.crt"
INTERVAL = 300
PAYMENTS = table(
    "payment_transactions", column("id", String), column("status", String),
    column("payment_status", String), column("transaction_metadata", String),
    column("updated_at", DateTime(timezone=True)), column("created_at", DateTime(timezone=True)),
    schema="public",
)


def dev_engine(env, nonce):
    commit = env.get("RAW_SURF_DEV_WORKER_COMMIT", "")
    if (not re.fullmatch("[0-9a-f]{40}", commit) or env.get("RENDER_GIT_COMMIT") != commit
            or env.get("RENDER_SERVICE_ID") != SERVICE or env.get("RAW_SURF_DEV_POOLER_HOST") != POOLER
            or any(k.startswith(("STRIPE_", "DATABASE_", "DB_", "POSTGRES_", "PG", "SUPABASE_")) for k in env)):
        raise ValueError("Unexpected worker deployment or database configuration")
    if not Path(CA_FILE).is_file() or not env.get("RAW_SURF_DEV_WORKER_PASSWORD"):
        raise ValueError("Missing DEV worker configuration")
    return create_engine(
        URL.create("postgresql+psycopg2", username=f"{ROLE}.{PROJECT}",
                   password=env["RAW_SURF_DEV_WORKER_PASSWORD"], host=POOLER, port=5432, database="postgres"),
        connect_args={"sslmode": "verify-full", "sslrootcert": CA_FILE, "connect_timeout": 8,
                      "application_name": nonce},
        pool_size=1, max_overflow=0, pool_pre_ping=True, hide_parameters=True,
    )


def waiting_count(connection):
    stale = datetime.now(timezone.utc) - timedelta(minutes=5)
    queue = pending_seat_ids(PAYMENTS.c, stale).subquery()
    return connection.scalar(select(func.count()).select_from(queue))


def scan(connection, nonce):
    connection.exec_driver_sql("SET TRANSACTION READ ONLY")
    connection.exec_driver_sql("SET LOCAL statement_timeout = '10s'")
    connection.exec_driver_sql("SET LOCAL search_path = pg_catalog")
    connection.execute(text("SELECT set_config('application_name', :nonce, false)"), {"nonce": nonce})
    identity = connection.execute(text("""
        SELECT pg_backend_pid() FROM pg_roles r
        WHERE rolname = current_user AND current_user = :role AND session_user = current_user
          AND current_database() = 'postgres' AND current_setting('transaction_read_only') = 'on'
          AND NOT (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
          AND rolconnlimit = 1 AND 'default_transaction_read_only=on' = ANY(rolconfig)
          AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member=r.oid)
          AND NOT has_schema_privilege(r.oid, 'public', 'CREATE')
          AND NOT has_any_column_privilege(r.oid, 'public.payment_transactions', 'INSERT,UPDATE,REFERENCES')
          AND NOT has_table_privilege(r.oid, 'public.payment_transactions', 'DELETE,TRUNCATE,TRIGGER')
    """), {"role": ROLE}).scalar_one()
    return identity, waiting_count(connection)


def main():
    nonce = "rs1274w_" + secrets.token_hex(12)
    engine = dev_engine(os.environ, nonce)
    last_success = 0.0

    class Health(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path not in ("/", "/health"):
                self.send_error(404)
                return
            ok = bool(last_success and time.monotonic() - last_success < 2 * INTERVAL)
            data = json.dumps({"mode": "read-only-seat-worker", "ready": ok,
                               "commit": os.environ["RENDER_GIT_COMMIT"]}).encode()
            self.send_response(200 if ok else 503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    def work():
        nonlocal last_success
        while True:
            try:
                with engine.begin() as connection:
                    pid, waiting = scan(connection, nonce)
                last_success = time.monotonic()
                print(f"seat_worker_scan {nonce} pid={pid} eligible={waiting} mode=read-only", flush=True)
            except Exception as exc:
                last_success = 0.0
                logging.error("DEV seat scan failed (%s)", type(exc).__name__)
                engine.dispose()
            time.sleep(INTERVAL)

    threading.Thread(target=work, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ["PORT"])), Health).serve_forever()


if __name__ == "__main__":
    main()
