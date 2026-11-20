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
(also written to the step summary) and exit 0, because the validation's own result must not depend on this.

A LOST RUN IS SILENT TO THE VALIDATION AND MUST NOT BE SILENT TO THE GATE: whatever reads these rows back must count
the stored runs against the graded runs in its window and print the gap. Each object says whether its run was
`graded`, so a reader never mixes a refused run's rows with a graded one's."""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def _supabase_headers(key):
    """Supabase API-key headers. sb_ keys are not JWTs and are rejected as Bearer, so the Bearer copy is
    sent only for a legacy JWT key (inline copy of core.supabase_auth: this script runs by path)."""
    return {"apikey": key, **({"Authorization": "Bearer " + key} if str(key).startswith("eyJ") else {})}


# STANDARD LIBRARY ONLY, on purpose (advisor's condition, 2026-11-16): this is the one process in the job that holds
# the Storage service-role key, which bypasses row security on the whole project. It imports no project module and no
# third-party package, so nothing installed by pip earlier in the job runs beside the key. A test pins it.
BUCKET = "weather-products"
PREFIX = "calibration/nearshore/rows/"


def rows_key(generated_at) -> str:
    """One object per run under its day. The same rule as nearshore_validation.private_rows_key (parity-tested)."""
    stamp = re.sub(r"[^0-9]", "", str(generated_at or ""))[:14]
    if len(stamp) < 14:
        raise ValueError("generated_at has no usable timestamp")
    return "%s%s-%s-%s/%s.json" % (PREFIX, stamp[:4], stamp[4:6], stamp[6:8], stamp)


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
        name = rows_key(obj.get("generated_at"))
    except ValueError:
        return "PRIVATE_ROWS status=no_timestamp n=%d" % len(rows)
    parts = urllib.parse.urlparse(base)
    if parts.scheme != "https" or not parts.hostname:
        return "PRIVATE_ROWS status=bad_url n=%d" % len(rows)
    req = urllib.request.Request(
        "%s/storage/v1/object/%s/%s" % (base, BUCKET, name), data=json.dumps(obj, separators=(",", ":")).encode("utf-8"),
        method="POST", headers={**_supabase_headers(key), "Content-Type": "application/json",
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
    line = store(argv[0] if argv else "nearshore_rows_private.json")
    print(line)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")       # a lost run must be visible, not only in a log tail
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as f:
                f.write("`%s`\n" % line)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
