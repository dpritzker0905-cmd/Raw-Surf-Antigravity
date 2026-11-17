# 2026-11-16 - lever A 4G re-run (#928), the arms registered in 2026-11-15-opus-gusts-currents.md §10 / §12

New log file for this session's re-run (one log per session; §12-§12d of the 2026-11-15 log hold the registration and the code).
Instrument: scratch gate4g.js + g4sum.py, unchanged from §10b. Offline only: production build of branch head 5d91b7a1e +
the log commit (lever A + dev merged), synthetic backend, local frames CDN (+150 ms per request; the throttled arms add the
CDP link), phone 390x844 dpr 2 with 4x CPU throttle, 5 toggles + 10 scrub steps per set, first-frame-first ON.
Frames: the one-byte band sets from the same cycles as §12d (GFS / EURO / ICON gusts 2026-11-16 12Z, currents 00Z).
The registered line: Fast 4G step p50 <= 1.5x the same set's unthrottled step p50, 0 unlabelled steps.

| set | unthrottled step p50 | Fast 4G step p50 (p95) | ratio | verdict | §10b Fast 4G ratio | first paint Fast 4G (§10b) | KB / step (§10b) |
|---|---|---|---|---|---|---|---|
| gusts GFS | 238 | 234 (317) | 0.98 | PASS | 1.74 FAIL | 2.3 s (3.8 s) | 476 (881) |
| gusts EURO (n=3 steps) | 207 | 224 (224) | 1.08 | PASS | 1.03 | 2.0 s (4.6 s) | 527 (1042) |
| gusts ICON | 232 | 220 (245) | 0.95 | PASS | 4.9 FAIL | 1.4 s (5.1 s) | 562 (1240) |
| currents | 224 | 175 (250) | 0.78 | PASS | 1.0 | 1.6 s (5.9 s) | 417 (1728) |

- Labels: 0 unlabelled and 0 timeouts in every arm (unthrottled, Fast 4G, Fast 4G metered, Slow 4G).
- Fast 4G metered (prefetch 1 ahead): steps 156-190 ms p50, first paint 1.3-1.6 s.
- Slow 4G (not gated, recorded): first paint 5.1-6.8 s (was 19-26 s); step p50 GFS 435, ICON 786, currents 310 ms, but the
  tails are long (p95 6.8-8.6 s; EURO p50 4.4 s on n=3). Slow 4G is still not instant; the step label stays honest there.
- The unthrottled step p50 moved 188 -> 238 ms (GFS) between runs on the same machine; the ratio is the registered measure,
  and the Fast 4G absolute steps also fell (GFS 328 -> 234, ICON 873 -> 220 ms).
- Result: lever A passes the registered gate for every set. B (the 0.5-degree tier) stays parked.
