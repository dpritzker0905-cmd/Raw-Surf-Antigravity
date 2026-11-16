"""store_nearshore_rows.py: put one nearshore-validation run's FULL matched rows into PRIVATE Storage.

WHY (owner's word 2026-11-15 21:10 EST, "Yes, add the key"). The S0 ablation gate needs rows with the hour and the
forecast heights (to join the buoy's period for the wind-sea / swell split). Those are our served forecasts at named
stations and times, so they do not go into this PUBLIC repository's artifact: the public file is a ratio and a day
(`factor_rows`). The full rows go to the same private bucket as the scored forecast ledger, under
`calibration/nearshore/rows/<day>/<stamp>.json`, and are read back only by jobs that print aggregates.

WHAT IT DOES: reads the local file the runner wrote, POSTs it once, create-only (`x-upsert: false`), to the Storage
REST API of the project named by SUPABASE_URL, and prints ONE status line. It runs in its OWN workflow step, so the
grading step never sees a Storage credential and its behaviour cannot change.

WHAT IT CANNOT DO: it sends to no host but SUPABASE_URL's; it never prints the URL, the key, or a row; it never
overwrites; and it NEVER fails the job: an unconfigured key, a refused write or a network error is a status line
and exit 0, because the validation's own result must not depend on this."""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

BUCKET = "weather-products"


def store(path: str, env=None, opener=urllib.request.urlopen) -> str:
    """Returns the status line. Never raises."""
    env = os.environ if env is None else env
    try:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
    except (OSError, ValueError):
        return "PRIVATE_ROWS status=no_file"
    rows = obj.get("rows") if isinstance(obj, dict) else None
    if not rows:
        return "PRIVATE_ROWS status=no_rows n=0"
    base = (env.get("SUPABASE_URL") or "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not base or not key:
        return "PRIVATE_ROWS status=not_configured n=%d" % len(rows)
    try:
        from services.weather_pipeline.nearshore_validation import private_rows_key
        name = private_rows_key(obj.get("generated_at"))
    except Exception:
        return "PRIVATE_ROWS status=no_timestamp n=%d" % len(rows)
    parts = urllib.parse.urlparse(base)
    if parts.scheme != "https" or not parts.hostname:
        return "PRIVATE_ROWS status=bad_url n=%d" % len(rows)
    req = urllib.request.Request(
        "%s/storage/v1/object/%s/%s" % (base, BUCKET, name), data=json.dumps(obj, separators=(",", ":")).encode("utf-8"),
        method="POST", headers={"Authorization": "Bearer " + key, "apikey": key, "Content-Type": "application/json",
                                "x-upsert": "false"})
    try:
        with opener(req, timeout=60) as resp:
            code = getattr(resp, "status", 200)
    except urllib.error.HTTPError as e:
        return "PRIVATE_ROWS status=refused_%s n=%d key=%s" % (e.code, len(rows), name)
    except Exception as e:
        return "PRIVATE_ROWS status=failed_%s n=%d" % (type(e).__name__, len(rows))
    return "PRIVATE_ROWS status=%s n=%d key=%s" % ("stored" if 200 <= code < 300 else "refused_%s" % code, len(rows), name)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    print(store(argv[0] if argv else "nearshore_rows_private.json"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
