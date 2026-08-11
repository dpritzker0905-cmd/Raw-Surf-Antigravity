"""T-CAP-01 -- controlled RSS-delta measurement across ONE global grid_series call.

Audit-only probe. Read-only against the live production backend. Reproduces the
protocol of AUDIT-2026-08-10 sec.1 exactly (control -> treatment -> control), so the
post-fix number at HEAD is comparable to:

    pre-fix  e32342a7 : RSS delta +170.3 MB, wire 6.67 MB, 26 frames, 29.3 s
    post-fix 0d9149b7 : RSS delta   +0.0 MB, wire 5.09 MB, 35 frames, 26.3 s

Protocol notes carried from that audit (the errors it recorded):
  * establish a STABLE plateau before reading the treatment (a reading at 78 s uptime
    measured the boot warm, not the request);
  * RSS here is a monotonic high-water mark -- read peak_rss_mb as well as rss_mb;
  * "+0.0" means below the ~1 MB poll-to-poll noise floor, not literally zero.

Usage: python T-CAP-01_grid_series_rss_delta.py
"""

import json
import time
import urllib.request

BASE = "https://raw-surf-antigravity.onrender.com"
HEALTH = BASE + "/api/health"

# The exact first page the client fires on a settle (owner console log, 08-10):
# hours 0..141 at stride 3. Global bbox = the worst case the OOM was measured on.
HOURS = ",".join(str(h) for h in range(0, 142, 3))
SERIES = (
    BASE + "/api/weather/grid_series"
    "?model=GFS&domain=marine&layer=waves"
    "&bbox=-180,-85,180,85"
    "&hours=" + HOURS
)


def health():
    with urllib.request.urlopen(HEALTH, timeout=90) as r:
        d = json.loads(r.read().decode())
    m = d.get("memory", {})
    return {
        "rss_mb": m.get("rss_mb"),
        "peak_rss_mb": m.get("peak_rss_mb"),
        "limit_mb": m.get("limit_mb"),
        "peak_pct": m.get("peak_pct_of_limit"),
        "uptime_s": d.get("uptime_seconds"),
        "version": d.get("version", "")[-40:],
    }


def main():
    print("=== CONTROL: three polls, 20 s apart, to establish the plateau ===")
    ctrl = []
    for i in range(3):
        h = health()
        ctrl.append(h)
        print(f"  c{i}: rss={h['rss_mb']} peak={h['peak_rss_mb']} "
              f"limit={h['limit_mb']} uptime={h['uptime_s']:.0f}s")
        if i < 2:
            time.sleep(20)

    drift = max(c["rss_mb"] for c in ctrl) - min(c["rss_mb"] for c in ctrl)
    print(f"  control drift over 40 s: {drift:.1f} MB  (noise floor)")

    before = ctrl[-1]
    print("\n=== TREATMENT: ONE global grid_series (48 frames requested) ===")
    t0 = time.time()
    req = urllib.request.Request(SERIES, headers={"Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read()
    wall = time.time() - t0
    doc = json.loads(body.decode())
    frames = doc.get("frames") or doc.get("series") or []
    print(f"  wall={wall:.1f}s  wire={len(body)/1048576:.2f} MB  frames={len(frames)}")
    for k in ("vectors_total", "vectors_before_bound", "bounded_at", "stride",
              "run_census", "cols", "rows"):
        if k in doc:
            print(f"  {k} = {doc[k]}")

    time.sleep(10)
    after = health()
    print(f"  after: rss={after['rss_mb']} peak={after['peak_rss_mb']} "
          f"uptime={after['uptime_s']:.0f}s")

    print("\n=== RESULT ===")
    print(f"  RSS  delta: {after['rss_mb'] - before['rss_mb']:+.1f} MB")
    print(f"  PEAK delta: {after['peak_rss_mb'] - before['peak_rss_mb']:+.1f} MB")
    print(f"  peak pct of limit: {before['peak_pct']} -> {after['peak_pct']}")
    print(f"  version: {after['version']}")

    out = {"control": ctrl, "before": before, "after": after,
           "wall_s": round(wall, 1), "wire_mb": round(len(body) / 1048576, 2),
           "frames": len(frames),
           "doc_keys": sorted(k for k in doc.keys() if k != "frames"),
           "rss_delta_mb": round(after["rss_mb"] - before["rss_mb"], 1),
           "peak_delta_mb": round(after["peak_rss_mb"] - before["peak_rss_mb"], 1)}
    for k in ("vectors_total", "vectors_before_bound", "bounded_at", "stride"):
        if k in doc:
            out[k] = doc[k]
    print("\nJSON:", json.dumps(out))


if __name__ == "__main__":
    main()
