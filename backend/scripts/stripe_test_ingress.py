"""Account-scoped DEV Stripe snapshot intake. Run with a WSGI server, independently of the app."""
import hmac
import json
import os
import re
import time
from contextlib import closing
from pathlib import Path

import psycopg2
import stripe


PATH = "/api/webhook/stripe"
HOST = "rawsurf-webhook-dev-1274.onrender.com"
POOLER = "aws-0-us-west-2.pooler.supabase.com"
PROJECT = "weewaulkwfwlbhqemxma"
ROLE = "rawsurf_1274_ingress"
CA = Path(__file__).with_name("dev-supabase-ca.crt")
CHECKOUT = {"checkout.session.completed", "checkout.session.async_payment_succeeded"}
MAX_BODY = 256 * 1024


def configured():
    env = os.environ
    return (env.get("RENDER_EXTERNAL_HOSTNAME") == HOST
            and bool(re.fullmatch("[0-9a-f]{40}", env.get("RENDER_GIT_COMMIT", "")))
            and env["RENDER_GIT_COMMIT"] == env.get("INGRESS_EXPECTED_COMMIT")
            and env.get("RENDER_SERVICE_ID") == env.get("INGRESS_EXPECTED_SERVICE")
            and bool(env.get("INGRESS_EXPECTED_SERVICE"))
            and env.get("INGRESS_SIGNING_SECRET", "").startswith("whsec_")
            and bool(env.get("INGRESS_DB_PASSWORD")) and CA.is_file()
            and not any(k.startswith(("PG", "STRIPE_", "DATABASE_", "DB_", "SUPABASE_")) for k in env))


def persist(event_id, kind, object_id):
    # The login can insert these three columns only. The unique event ID covers retries.
    with closing(psycopg2.connect(
        host=POOLER, port=5432, dbname="postgres", user=f"{ROLE}.{PROJECT}",
        password=os.environ["INGRESS_DB_PASSWORD"], sslmode="verify-full", sslrootcert=str(CA),
        application_name="rawsurf_1274_ingress", connect_timeout=5,
    )) as db, db, db.cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = '5s'")
        cur.execute("SET LOCAL search_path = pg_catalog")
        cur.execute("""
            INSERT INTO rawsurf_1274_ingress.receipts(event_id,event_type,object_id)
            VALUES (%s,%s,%s) ON CONFLICT DO NOTHING
        """, (event_id, kind, object_id))


def receive(body, signature, secret, canary, save):
    try:
        event = stripe.Webhook.construct_event(body, signature, secret, tolerance=300)
        timestamps = [int(p[2:]) for p in signature.split(",") if p.startswith("t=")]
        if len(timestamps) != 1 or abs(time.time() - timestamps[0]) > 300:
            return 400, "invalid"
        if (event.get("object") != "event" or event.get("livemode") is not False
                or event.get("account") or event.get("context")):
            return 400, "invalid"
        event_id, kind = event["id"], event["type"]
        obj = event["data"]["object"]
        if not re.fullmatch(r"evt_[A-Za-z0-9_]{1,240}", event_id) or obj.get("livemode") is not False:
            return 400, "invalid"
        obj_id = obj["id"]
        if kind == "test_helpers.test_clock.created":
            tag = obj.get("name") or ""
            if not canary or not hmac.compare_digest(canary, tag):
                return 204, "ignored"
            if obj.get("object") != "test_helpers.test_clock" or obj.get("status") != "ready" or not re.fullmatch(r"clock_[A-Za-z0-9_]{1,240}", obj_id):
                return 400, "invalid"
        elif kind in CHECKOUT:
            if obj.get("object") != "checkout.session" or not re.fullmatch(r"cs_test_[A-Za-z0-9_]{1,230}", obj_id):
                return 400, "invalid"
            if (obj.get("metadata") or {}).get("type") != "live_session_join":
                return 204, "ignored"
        else:
            return 204, "ignored"
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, stripe.error.SignatureVerificationError):
        return 400, "invalid"
    try:
        save(event_id, kind, obj_id)
    except psycopg2.Error:
        return 503, "retry"
    print(f"stripe_test_receipt event={event_id} type={kind} verified=true status=200", flush=True)
    return 200, "received"


def application(environ, start_response):
    path, method = environ["PATH_INFO"], environ["REQUEST_METHOD"]
    if path == "/health" and method in ("GET", "HEAD"):
        code, result = 200, {"mode": "test-webhook-intake", "configured": bool(configured()),
                             "commit": os.environ.get("RENDER_GIT_COMMIT")}
    elif path != PATH:
        code, result = 404, "unknown path"
    elif method != "POST":
        code, result = 405, "method"
    elif not configured():
        code, result = 503, "unconfigured"
    elif environ.get("CONTENT_TYPE", "").split(";")[0].strip().lower() != "application/json":
        code, result = 415, "content type"
    else:
        length = environ.get("CONTENT_LENGTH", "")
        if not re.fullmatch(r"[0-9]{1,8}", length) or not 0 < int(length) <= MAX_BODY:
            code, result = 413, "size"
        else:
            body = environ["wsgi.input"].read(int(length))
            if len(body) != int(length):
                code, result = 400, "incomplete"
            else:
                code, result = receive(body, environ.get("HTTP_STRIPE_SIGNATURE", ""),
                                       os.environ["INGRESS_SIGNING_SECRET"],
                                       os.environ.get("INGRESS_CANARY_TAG", ""), persist)
    reasons = {200:"OK", 204:"No Content", 400:"Bad Request", 404:"Not Found", 405:"Method Not Allowed",
               413:"Payload Too Large", 415:"Unsupported Media Type", 503:"Service Unavailable"}
    payload = b"" if code == 204 else json.dumps(result).encode()
    start_response(f"{code} {reasons[code]}", [("Content-Type","application/json"), ("Cache-Control","no-store"),
                                              ("Content-Length",str(len(payload)))])
    return [b"" if method == "HEAD" else payload]
