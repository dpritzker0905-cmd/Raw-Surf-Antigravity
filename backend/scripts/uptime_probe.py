"""EXTERNAL uptime probe -- the instrument every other instrument's value is gated by.

WHY THIS EXISTS, AND WHY IT MUST NOT BE A GITHUB WORKFLOW (WS-CAN-0025, ranked P0 by Report 11.0
and unstarted through three audits). Every scheduled check in this repo is delivered by GitHub
cron, and GitHub cron delivery has been MEASURED at 5-32% of nominal (keep-warm 4.9-5.4%). So the
question "did the monitor run?" cannot be answered by another monitor on the same delivery channel
-- a green cron history proves nothing, and a SILENT one is indistinguishable from a healthy one.
This probe is designed to run ANYWHERE ELSE: a laptop cron, a free scheduler, a spare box.

⭐ THE DEAD-MAN'S-SWITCH INVERSION. `--ping-url` turns "did anything run?" from a question nobody
can answer into one an external service answers for free: this probe pings a URL on success, and
the EXTERNAL service alerts when the pings stop. That way the alerting does not depend on this
probe, this repo, this machine, or GitHub -- which is the entire point. Owner action is one free
URL (healthchecks.io / cronitor / Better Stack heartbeat), not a monitoring deployment.

TIMEOUTS ARE MEASURED, NOT GUESSED -- and the naive value is WRONG. Production telemetry,
2026-08-12: `GET /api/health` n=113, p50 1.0 s, **p99 30.4 s**, 9 of 113 over 10 s; direct samples
the same minute ran 0.46-2.3 s. A 30 s timeout would page on the platform's own p99 rather than on
an outage -- the cry-wolf failure this repo has already paid for once (data-health's threshold sat
2% above the largest legitimate gap). So:
    LIVENESS  timeout 60 s  = ~2x the measured p99. Pages only on unreachable / non-200 / unhealthy.
    LATENCY   warn at 10 s  = the telemetry's own >10s bucket boundary. WARNS, never pages.
Separating them is what lets slowness stay visible without training red-blindness.

⛔ HTTP 200 IS NOT HEALTH. This repo's signature defect is a check that cannot tell "not sampled"
from "fine" (a parity gate blind for 10 weeks; three status endpoints serving hardcoded numbers).
So the probe grades the BODY: status, database, product count, and the freshness of the
calibration lane -- which is what actually dies when a cron stops being delivered.

exit 0 = measured healthy (warnings allowed)   exit 1 = RED, a gate fired on a measurement
exit 3 = REFUSED, the probe is BLIND (unreachable / unparseable) -- never green-when-blind.

Usage:
  python scripts/uptime_probe.py
  python scripts/uptime_probe.py --ping-url https://hc-ping.com/<uuid>   # dead-man's switch
  python scripts/uptime_probe.py --json probe.jsonl                     # append a record
Stdlib only, ASCII output only (cp1252 Windows consoles).
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

OK, RED, REFUSED = 0, 1, 3

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
# Basis stated beside the value, the same contract the accuracy monitor uses.
TIMEOUT_S = 60.0          # ~2x the measured p99 of 30.4 s (n=113, 2026-08-12)
WARN_LATENCY_MS = 10000   # the request_telemetry >10s bucket boundary
MAX_CAL_AGE_H = 8.0       # the calibration lane's own cadence + margin


def _get(url, timeout):
    """⛔ HTTPError MUST BE CAUGHT SEPARATELY OR THE RED PATH IS UNREACHABLE (found 2026-08-12 by
    pointing the probe at a live host that is not this API). `urlopen` RAISES on 4xx/5xx, so a
    caller that catches Exception broadly turns every "503 Service Unavailable" into "unreachable"
    -- and the probe would answer REFUSED (blind) for the single most important thing it exists to
    detect: a service that is up enough to say it is down. `grade_health(503, ...)` was tested and
    green the whole time; nothing could ever call it with a 503. The unit test proved the
    assertion, not the reachability."""
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-uptime-probe"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, body, (time.time() - t0) * 1000.0
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        return e.code, body, (time.time() - t0) * 1000.0


def _parse_iso(v):
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def grade_health(status_code, body, elapsed_ms, cfg):
    """Grade one /api/health response. PURE -- no network, so both paths are testable."""
    lines, code = [], OK
    if status_code is None:
        return REFUSED, ["::error::UPTIME PROBE IS BLIND -- %s unreachable within %.0f s. This is "
                         "refusal, not health: the service may be down or the probe's own network "
                         "may be. Distinguish with a second vantage point before paging anyone."
                         % (cfg["base"], cfg["timeout_s"])], {}
    if status_code != 200:
        return RED, ["::error::SERVICE DOWN -- HTTP %s from %s/api/health" % (status_code, cfg["base"])], {}
    try:
        d = json.loads(body)
    except Exception:
        return REFUSED, ["::error::UPTIME PROBE IS BLIND -- /api/health returned 200 with an "
                         "unparseable body (%d bytes). 200-with-garbage is not health." % len(body)], {}

    sha = str(d.get("version") or "").split("-")[-1][:8]
    facts = {"sha": sha, "elapsed_ms": round(elapsed_ms, 1), "status": d.get("status")}
    lines.append("health %s | build %s | %.0f ms | uptime %.0f s"
                 % (d.get("status"), sha or "?", elapsed_ms, d.get("uptime_seconds") or 0))

    if d.get("status") != "healthy":
        code = RED
        lines.append("::error::SERVICE UNHEALTHY -- /api/health reports status=%r. The process is "
                     "up and answering; something it depends on is not." % d.get("status"))

    db = (d.get("database") or {})
    if isinstance(db, dict) and db.get("status") not in (None, "healthy", "connected", True):
        code = RED
        lines.append("::error::DATABASE UNHEALTHY -- %r" % db.get("status"))

    wr = d.get("weather_readiness") or {}
    n_products = wr.get("product_count")
    facts["product_count"] = n_products
    if isinstance(n_products, int):
        lines.append("weather_readiness: %d products, restore %s" % (n_products, wr.get("restore_status")))
        if n_products <= 0:
            code = RED
            lines.append("::error::ZERO PRODUCTS -- the service is up and serving nothing. Every "
                         "forecast surface is empty; HTTP 200 would hide this completely.")
    else:
        lines.append("::warning::weather_readiness.product_count absent -- cannot confirm the "
                     "service has anything to serve.")

    mem = d.get("memory") or {}
    pct = mem.get("peak_pct_of_limit")
    if isinstance(pct, (int, float)):
        facts["peak_pct"] = pct
        if pct >= 95:
            lines.append("::warning::memory peak %.1f%% of the cgroup limit -- OOM headroom is "
                         "nearly gone (kills were attributed and closed 2026-08-11; HEADROOM was "
                         "not)." % pct)

    if elapsed_ms > cfg["warn_latency_ms"]:
        lines.append("::warning::SLOW -- %.0f ms exceeds the %.0f ms warn band (measured p99 is "
                     "30.4 s, so this WARNS and never pages; a timeout set at the p99 would "
                     "cry wolf on the platform's own tail)." % (elapsed_ms, cfg["warn_latency_ms"]))
    return code, lines, facts


def grade_calibration(status_code, body, now, cfg):
    """Freshness of the calibration lane -- what actually dies when cron delivery stops. PURE."""
    if status_code is None or status_code != 200:
        return REFUSED, ["::error::PIPELINE FRESHNESS UNKNOWN -- calibration report unreachable "
                         "(HTTP %s). Refusal, not health." % status_code], {}
    try:
        d = json.loads(body)
    except Exception:
        return REFUSED, ["::error::PIPELINE FRESHNESS UNKNOWN -- unparseable calibration body."], {}
    gen = _parse_iso(d.get("generated_at"))
    if gen is None:
        return REFUSED, ["::error::PIPELINE FRESHNESS UNKNOWN -- no parseable generated_at."], {}
    age_h = (now - gen).total_seconds() / 3600.0
    if age_h > cfg["max_cal_age_h"]:
        return RED, ["::error::PIPELINE STALLED -- the calibration report is %.1f h old (bound "
                     "%.1f h). THIS is the failure a GitHub-delivered monitor cannot report on "
                     "itself: if cron stopped, the monitor stopped too, and its history stays "
                     "green by going silent." % (age_h, cfg["max_cal_age_h"])], {"cal_age_h": round(age_h, 2)}
    return OK, ["calibration report age %.1f h (bound %.1f h)" % (age_h, cfg["max_cal_age_h"])], \
        {"cal_age_h": round(age_h, 2)}


def combine(a, b):
    """RED outranks REFUSED outranks OK -- a measured breach beats blindness beats green."""
    if RED in (a, b):
        return RED
    if REFUSED in (a, b):
        return REFUSED
    return OK


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--timeout", type=float, default=TIMEOUT_S)
    ap.add_argument("--warn-latency-ms", type=float, default=WARN_LATENCY_MS)
    ap.add_argument("--max-cal-age-h", type=float, default=MAX_CAL_AGE_H)
    ap.add_argument("--ping-url", default=None,
                    help="Dead-man's-switch URL pinged ONLY on exit 0 (healthchecks.io style). "
                         "The external service alerts when the pings stop -- which is how the "
                         "alerting stops depending on this probe.")
    ap.add_argument("--json", default=None, help="APPEND one JSON line per run")
    a = ap.parse_args()
    cfg = {"base": a.base.rstrip("/"), "timeout_s": a.timeout,
           "warn_latency_ms": a.warn_latency_ms, "max_cal_age_h": a.max_cal_age_h}
    now = datetime.now(timezone.utc)

    try:
        sc, body, ms = _get(cfg["base"] + "/api/health", a.timeout)
    except Exception as e:
        sc, body, ms = None, str(e), 0.0
    code, lines, facts = grade_health(sc, body, ms, cfg)

    try:
        sc2, body2, _ = _get(cfg["base"] + "/api/weather/buoy-calibration", a.timeout)
    except Exception:
        sc2, body2 = None, ""
    c2, l2, f2 = grade_calibration(sc2, body2, now, cfg)
    code, lines, facts = combine(code, c2), lines + l2, {**facts, **f2}

    print("\n".join(lines))
    verdict = {OK: "OK", RED: "RED", REFUSED: "REFUSED (blind, not healthy)"}[code]
    print("verdict: %s" % verdict)

    if a.json:
        rec = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "verdict": verdict, "exit": code, **facts}
        with open(a.json, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")

    # ⛔ PING ONLY ON A CLEAN RUN. Pinging on RED would tell the dead-man's switch that everything
    # is fine during an outage -- the switch's whole value is that silence means trouble.
    if a.ping_url and code == OK:
        try:
            _get(a.ping_url, 10)
            print("dead-man's switch pinged")
        except Exception as e:
            print("::warning::ping failed (%s) -- the external switch will alert on the silence, "
                  "which is the correct behaviour, but this run WAS healthy." % str(e)[:60])
    return code


if __name__ == "__main__":
    sys.exit(main())
