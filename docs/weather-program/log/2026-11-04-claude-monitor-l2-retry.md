# 2026-11-04 · claude · Forecast Accuracy Monitor: retry a busy Storage read

**Why:** run 41906117768 (20:30Z, dev 8686ddc) left the paired skill UNMEASURED. ONE GET of
`calibration/skill/scored-2026-11-03.json` returned HTTP 429 at 20:30:39Z, during an ingest burst of about 766 req/min that
had 17 other Storage 429s. No Retry-After header was sent. `_fetch_l2` (scripts/forecast_accuracy_monitor.py) made a single
attempt with no retry.

**Change:**
- A 429 or a 5xx is retried, up to 3 attempts in total, with capped exponential backoff: 1 s, 2 s, then 4 s, plus 0–0.5 s
  of jitter. Each wait is capped at 8 s; a Retry-After header, when sent, is honoured up to 30 s.
- Absence (NoSuchKey) and auth/bucket errors are never retried; they behave exactly as before.
- Kill switch: `L2_FETCH_RETRIES=1` gives a single attempt (the old behaviour).
- No served number moves. Monitor-only.

**Tests:** 2 new cases in tests/test_forecast_accuracy_monitor.py (guards lane):
- a busy read is retried, then read;
- absence is not retried, and the kill switch gives one attempt.
The existing absent-vs-unreadable test now stubs the sleep. Locally 89 passed. The guards floor was re-derived with
`rederive_floor.py --lane guards --add 2`: the PR must read 3509.
