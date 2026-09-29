"""Is the Render backend READY for E2E: serving THIS commit AND finished with its first L2 restore?

WHY (2026-09-29). The E2E job already waits until /api/health reports the pushed commit, because the push starts the
tests and the Render redeploy together (e2e-tests.yml, and the forensics in e2e/booking-flow.spec.js). "Serving the
commit" is only half of ready: a freshly booted instance then downloads the ~12-16 MB L2 manifest before it can
answer a spot hub, and `weather_readiness.restore_status` reads "pending" until that first restore finishes
(`_restored_count` is set only at the END of a restore). Run 36505096034 found the new commit at 00:55:39Z, started
the tests at once, and failed its first spot-hub load at 00:56-00:57Z while the box was still restoring (memory
365 -> 915 MB from 00:54 to 00:58Z); the re-run on a restored box passed in 10 s. So wait for both.

stdlib only, so the E2E runner needs no backend install. Exit 0 ready; 1 never ready (the reason says which half).
Usage: python3 backend/scripts/e2e_backend_ready.py <40-hex sha> <api base> [attempts] [wait seconds]
"""
import json
import re
import sys
import time
import urllib.request

_SHA = re.compile(r"-([0-9a-f]{40})$")


def readiness(health, sha: str):
    """(ready, reason) from one /api/health payload. PURE."""
    version = str((health or {}).get("version") or "")
    m = _SHA.search(version)
    got = m.group(1) if m else None
    if got != sha:
        return False, f"backend serving {got[:8] if got else '<unknown version>'}, not {sha[:8]}"
    wr = (health or {}).get("weather_readiness") or {}
    status = wr.get("restore_status")
    if status != "complete":
        return False, (f"backend serving {sha[:8]} but its L2 restore is "
                       f"{status or ('failing: ' + str(wr.get('error'))[:80] if wr.get('error') else 'unreported')}")
    return True, f"backend serving {sha[:8]}, L2 restore complete ({wr.get('product_count')} products)"


def main(argv=None, fetch=None, sleep=time.sleep) -> int:
    argv = sys.argv[1:] if argv is None else argv
    sha, api = argv[0], argv[1].rstrip("/")
    attempts = int(argv[2]) if len(argv) > 2 else 60
    wait_s = float(argv[3]) if len(argv) > 3 else 15.0
    if fetch is None:
        def fetch(url):
            req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-e2e-readiness"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
    reason = "never asked"
    for i in range(1, attempts + 1):
        try:
            ready, reason = readiness(fetch(f"{api}/api/health"), sha)
        except Exception as e:                                          # noqa: BLE001 — unreachable is a reason
            ready, reason = False, f"backend unreachable ({type(e).__name__})"
        if ready:
            print(f"ready after ~{int((i - 1) * wait_s)}s: {reason}")
            return 0
        print(f"  attempt {i}: {reason}")
        if i < attempts:
            sleep(wait_s)
    print(f"::error::{api} was not ready after {int(attempts * wait_s / 60)} min: {reason}")
    print("::error::E2E is NOT run against a backend that is still deploying or restoring.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
