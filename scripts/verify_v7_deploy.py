#!/usr/bin/env python3
"""verify_v7_deploy.py — the post-deploy proof for audit v7 (2026-08-03).

ONE COMMAND:  python3 scripts/verify_v7_deploy.py

Two commits shipped on 2026-08-03 and neither was verified live:
  1f5a796f  the antimeridian cliff + the coverage test + the series VECTOR BUDGET
  6da4c16e  the rating DECOMPOSITION (`limiter` = which of nine factors removed the most)

This script is resumable by design: it holds no state, re-reads the live system every run, and
REFUSES to report a result whose precondition is not met. Run it as many times as you like — before
the deploy it says NOT-DEPLOYED (which is its own negative control, exercised 2026-08-03), after the
deploy it says PASS or FAIL against the baselines measured that day.

★ THREE DEPLOY GATES, NOT ONE. The recorded rule is "(a) is the code deployed? (b) has the ARTIFACT
  been rebuilt by it? (c) does it change the specific thing being looked at?" Those are different
  questions here and they land at different times:
    D1 frontend  — Netlify, minutes.  Read from service-worker.js BUILD_VERSION.
    D2 backend   — Render, minutes.   FEATURE-DETECTED (`vectors_total`), not version-guessed.
    D3 precompute— cron, HOURS.       `limiter` is written by the precompute into the L2 blob, so
                                      it appears only after the next cycle FOLLOWING the deploy.
  Feature detection beats a version string: it answers "is the code that matters running?" directly.

⚠️ WHAT THIS CANNOT DO. The frontend fix stops the CLIENT emitting `|lng| > 180`. Proving that
   behaviourally needs a browser (load the map, rapid zoom out, read the bbox off the requests).
   D1 proves the code is deployed; the behavioural half is the one manual step, printed at the end.
"""
import json
import re
import subprocess
import sys
import time
import urllib.request

API = "https://raw-surf-antigravity.onrender.com/api"
WEB = "https://dev--rawsurf.netlify.app"
ORIGIN = {"Origin": WEB}

# Commits whose effects this script checks.
SHA_FRONTEND = "1f5a796f"
SHA_BACKEND = "6da4c16e"

# ── BASELINES measured live 2026-08-03, BEFORE the fix (docs/research/AUDIT-2026-08-03-v7-…) ──
BASE_ILLEGAL_BYTES = 42_589_599     # bbox west=-180.5, 48 frames
BASE_ILLEGAL_SECS = 28.4
BASE_ILLEGAL_VECTORS = 104 * 54 * 48        # 269,568
BASE_LEGAL_BYTES = 1_300_516        # bbox west=-180.0, 48 frames — the HIT cohort
VECTOR_BUDGET = 80_000              # SERIES_VECTOR_BUDGET default

H48 = ",".join(str(h) for h in range(0, 144, 3))
ILLEGAL_BBOX = "-180.5,-27.5277,2.83,53.3496"
LEGAL_REGIONAL_BBOX = "-86.8623,25.9723,-77.0946,30.8398"

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results = []


def log(tag, name, detail=""):
    mark = {PASS: "[PASS]", FAIL: "[FAIL]", SKIP: "[SKIP]"}[tag]
    print(f"  {mark} {name}" + (f"\n         {detail}" if detail else ""))
    results.append((tag, name))


def get(url, headers=None, timeout=180):
    req = urllib.request.Request(url, headers=headers or {})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    return body, time.time() - t0


def series(bbox, hours=H48, timeout=180):
    url = f"{API}/weather/grid_series?model=GFS&domain=marine&layer=waves&bbox={bbox}&hours={hours}"
    body, secs = get(url, ORIGIN, timeout)
    return json.loads(body.decode("utf-8")), len(body), secs


def is_ancestor(sha, of):
    try:
        return subprocess.run(["git", "merge-base", "--is-ancestor", sha, of],
                              capture_output=True).returncode == 0
    except Exception:
        return None


# ══ DEPLOY GATES ══════════════════════════════════════════════════════════════════════════════
print("\n=== DEPLOY GATES ===")
frontend_ok = backend_ok = precompute_ok = False

try:
    sw, _ = get(f"{WEB}/service-worker.js")
    m = re.search(r"BUILD_VERSION\s*=\s*'([0-9a-f]+)'", sw.decode("utf-8", "replace"))
    deployed = m.group(1) if m else None
    if not deployed:
        log(FAIL, "D1 frontend", "service-worker.js carries no BUILD_VERSION — cannot tell what is live")
    else:
        anc = is_ancestor(SHA_FRONTEND, deployed)
        frontend_ok = anc is True
        log(PASS if frontend_ok else FAIL, "D1 frontend deployed",
            f"BUILD_VERSION={deployed}; {SHA_FRONTEND} is "
            f"{'an ancestor' if anc else 'NOT an ancestor (or git unavailable)'}")
except Exception as e:
    log(FAIL, "D1 frontend", f"{type(e).__name__}: {e}")

try:
    j, _b, _s = series(LEGAL_REGIONAL_BBOX, hours="0", timeout=90)
    backend_ok = "vectors_total" in j
    log(PASS if backend_ok else SKIP, "D2 backend deployed",
        "`vectors_total` present — the budget code is live" if backend_ok
        else f"`vectors_total` ABSENT — Render has not picked up {SHA_BACKEND} yet. Re-run later.")
except Exception as e:
    log(FAIL, "D2 backend", f"{type(e).__name__}: {e}")

try:
    body, _ = get(f"{API}/weather/spot-ratings?bbox=-180,-80,180,85"
                  f"&valid_time={time.strftime('%Y-%m-%dT%H:00:00Z', time.gmtime())}&limit=5", timeout=90)
    sr = json.loads(body.decode("utf-8"))
    spots = sr.get("spots") or []
    precompute_ok = bool(spots) and "limiter" in spots[0]
    log(PASS if precompute_ok else SKIP, "D3 precompute rebuilt",
        "`limiter` present on served spots" if precompute_ok
        else f"`limiter` ABSENT (source={sr.get('source')}) — the L2 blob predates the deploy. "
             "The cron must run once AFTER it; this is HOURS, not minutes.")
except Exception as e:
    log(FAIL, "D3 precompute", f"{type(e).__name__}: {e}")


# ══ CHECK A — the vector budget bounds the miss ═══════════════════════════════════════════════
print("\n=== A. THE VECTOR BUDGET (needs D2) ===")
if not backend_ok:
    log(SKIP, "A1/A2 budget", "backend not deployed — refusing to report a result")
else:
    try:
        j, nbytes, secs = series(ILLEGAL_BBOX)
        vt, stride = j.get("vectors_total"), j.get("decimated_stride")
        frames = len(j.get("frames") or [])
        detail = (f"bytes {nbytes:,} (was {BASE_ILLEGAL_BYTES:,}, "
                  f"{BASE_ILLEGAL_BYTES/max(nbytes,1):.1f}x smaller) | {secs:.1f}s (was {BASE_ILLEGAL_SECS}s) | "
                  f"vectors_total={vt:,} (was ~{BASE_ILLEGAL_VECTORS:,}) | stride={stride} | "
                  f"frames={frames}")
        ok = (vt is not None and vt <= VECTOR_BUDGET and (stride or 0) > 1
              and nbytes < BASE_ILLEGAL_BYTES / 2)
        log(PASS if ok else FAIL, "A1 an out-of-range bbox is now BOUNDED", detail)
    except Exception as e:
        log(FAIL, "A1", f"{type(e).__name__}: {e}")

    try:  # KNOWN-PRESENT CONTROL: the budget must NOT fire on a hit.
        j, nbytes, secs = series(LEGAL_REGIONAL_BBOX)
        vt, stride = j.get("vectors_total"), j.get("decimated_stride")
        # The budget must not fire on a normal regional page. `coverage` is deliberately NOT
        # asserted: that field was removed the day it shipped — bounds cannot tell a clip from a
        # dynamic build (this very control proved it). See series_vector_budget.py.
        ok = stride is None and (vt or 0) <= VECTOR_BUDGET
        log(PASS if ok else FAIL, "A2 CONTROL: a normal regional request is untouched",
            f"bytes {nbytes:,} | {secs:.1f}s | vectors_total={vt} | stride={stride} "
            f"(stride must be None — the budget may only bind on an oversized page)")
    except Exception as e:
        log(FAIL, "A2", f"{type(e).__name__}: {e}")


# ══ CHECK C — the limiter histogram: the payoff ═══════════════════════════════════════════════
print("\n=== C. THE LIMITER HISTOGRAM (needs D3) — this chooses the next month of work ===")
if not precompute_ok:
    log(SKIP, "C1 limiter histogram",
        "precompute has not rebuilt — refusing to report a distribution that does not exist yet")
else:
    try:
        body, _ = get(f"{API}/weather/spot-ratings?bbox=-180,-80,180,85"
                      f"&valid_time={time.strftime('%Y-%m-%dT%H:00:00Z', time.gmtime())}&limit=200",
                      timeout=90)
        spots = json.loads(body.decode("utf-8"))["spots"]
        hist, scores = {}, []
        for s in spots:
            if s.get("limiter"):
                hist[s["limiter"]] = hist.get(s["limiter"], 0) + 1
            if isinstance(s.get("score"), (int, float)):
                scores.append(s["score"])
        total = sum(hist.values())
        lines = [f"n={total} spots with a limiter; scores max={max(scores):.1f} "
                 f"(2026-08-03 baseline: max 68.8, ZERO 'good')"]
        for k, v in sorted(hist.items(), key=lambda kv: -kv[1]):
            lines.append(f"           {v:4d}  ({100*v/max(total,1):5.1f}%)  {k}")
        lines.append("         => the dominant limiter names the next fix: "
                     "size_gate=local size curve · swell_exposure=GEOMETRY (not the rating) · "
                     "tide_fit/sea_clean=a different story")
        log(PASS if total else FAIL, "C1 limiter histogram", "\n         ".join(lines))
    except Exception as e:
        log(FAIL, "C1", f"{type(e).__name__}: {e}")


# ══ VERDICT ═══════════════════════════════════════════════════════════════════════════════════
n_pass = sum(1 for t, _ in results if t == PASS)
n_fail = sum(1 for t, _ in results if t == FAIL)
n_skip = sum(1 for t, _ in results if t == SKIP)
print(f"\n=== VERDICT: {n_pass} pass, {n_fail} fail, {n_skip} skipped (precondition unmet) ===")
if n_skip:
    print("  Re-run when the skipped gate lands. Nothing here caches; the script is safe to repeat.")
print("""
  STILL MANUAL — the behavioural half of the frontend fix (needs a browser):
    1. open https://dev--rawsurf.netlify.app/map, let the marine layer load
    2. rapid zoom OUT to world, then zoom in and out again
    3. in DevTools Network, filter `grid_series` and read the bbox= of every request
    PASS = no request carries a longitude outside [-180, 180]  (before the fix the client
           emitted bbox=-199.3617,... and paid 43 MB for it)
""")
sys.exit(1 if n_fail else 0)
