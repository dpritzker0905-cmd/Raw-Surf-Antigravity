"""T-CAP-03 -- the control that decides whether T-CAP-01's +156.7 MB is MY REQUEST.

T-CAP-01 measured +156.7 MB RSS across one global grid_series at HEAD, against the
`0d9149b7` commit message's post-fix claim of +0.0 MB. Two explanations survive:

  (H1) THE REQUEST  -- the build-time bound caps RETENTION but not ALLOCATION, so a
                       global-bbox series still churns ~450k GridVector models through
                       the allocator and the arena high-water rises.
  (H2) BACKGROUND   -- ingestion / prefetch / another client moved RSS during my window
                       and the request is innocent.

DISCRIMINATOR: request size. A SMALL-bbox series over the identical hour list does the
same routing, caching, serialization and response assembly, and differs only in grid
cell count. Under H1 the delta scales with cells; under H2 both deltas look alike.

  small  = Florida-ish box, ~5 deg square
  global = -180,-85,180,85  (T-CAP-01's exact request)

Ordering is small-FIRST so any warm-cache advantage accrues to the GLOBAL call --
i.e. the test is biased AGAINST H1, and an H1 result is therefore conservative.

Read-only. Two requests. Not load testing.
"""

import json
import time
import urllib.request

B = "https://raw-surf-antigravity.onrender.com"
HOURS = ",".join(str(h) for h in range(0, 142, 3))


def series_url(bbox):
    return (B + "/api/weather/grid_series?model=GFS&domain=marine&layer=waves"
            "&bbox=" + bbox + "&hours=" + HOURS)


def health():
    d = json.loads(urllib.request.urlopen(B + "/api/health", timeout=90).read().decode())
    m = d["memory"]
    return m["rss_mb"], m["peak_rss_mb"], d["uptime_seconds"]


def settle(label, n=4, gap=25, tol=6.0):
    """Poll until RSS is flat, so the treatment is read against a real plateau."""
    last = None
    for i in range(n):
        rss, peak, up = health()
        print(f"  {label}[{i}] rss={rss} peak={peak} up={up:.0f}s")
        if last is not None and abs(rss - last) <= tol:
            return rss, peak, up
        last = rss
        if i < n - 1:
            time.sleep(gap)
    return last, peak, up


def call(bbox, tag):
    t0 = time.time()
    req = urllib.request.Request(series_url(bbox), headers={"Accept-Encoding": "identity"})
    body = urllib.request.urlopen(req, timeout=300).read()
    wall = time.time() - t0
    d = json.loads(body.decode())
    cells = (d.get("cols") or 0) * (d.get("rows") or 0)
    print(f"  [{tag}] wall={wall:.1f}s wire={len(body)/1048576:.2f}MB "
          f"frames={len(d.get('frames', []))} cells/frame={cells} "
          f"before={d.get('vectors_before_bound')} after={d.get('vectors_total')} "
          f"bounded_at={d.get('bounded_at')}")
    return {"tag": tag, "wall_s": round(wall, 1), "wire_mb": round(len(body) / 1048576, 2),
            "frames": len(d.get("frames", [])), "cells_per_frame": cells,
            "vectors_before_bound": d.get("vectors_before_bound"),
            "vectors_total": d.get("vectors_total"),
            "bounded_at": d.get("bounded_at"), "run_census": d.get("run_census")}


def main():
    out = {}
    print("=== WAIT FOR PLATEAU (boot warm must finish or the reading is worthless) ===")
    b0 = settle("pre", n=8, gap=40)
    print(f"  plateau established at rss={b0[0]} peak={b0[1]} uptime={b0[2]:.0f}s")

    print("\n=== ARM A: SMALL bbox (Florida ~5 deg), identical 48 hours ===")
    out["small"] = call("-84,24,-79,31", "small")
    time.sleep(20)
    a1 = health()
    print(f"  after small: rss={a1[0]} peak={a1[1]}")
    out["small"]["rss_delta"] = round(a1[0] - b0[0], 1)
    out["small"]["peak_delta"] = round(a1[1] - b0[1], 1)

    print("\n=== settle again before ARM B ===")
    b1 = settle("mid", n=5, gap=30)

    print("\n=== ARM B: GLOBAL bbox (T-CAP-01's exact request) ===")
    out["global"] = call("-180,-85,180,85", "global")
    time.sleep(20)
    a2 = health()
    print(f"  after global: rss={a2[0]} peak={a2[1]}")
    out["global"]["rss_delta"] = round(a2[0] - b1[0], 1)
    out["global"]["peak_delta"] = round(a2[1] - b1[1], 1)

    print("\n=== VERDICT ===")
    s, g = out["small"], out["global"]
    print(f"  small : cells/frame={s['cells_per_frame']:>6}  RSS {s['rss_delta']:+.1f} MB  "
          f"peak {s['peak_delta']:+.1f} MB")
    print(f"  global: cells/frame={g['cells_per_frame']:>6}  RSS {g['rss_delta']:+.1f} MB  "
          f"peak {g['peak_delta']:+.1f} MB")
    print("  H1 (the request) if global >> small; H2 (background) if they are alike.")
    print("\nJSON:", json.dumps(out))


if __name__ == "__main__":
    main()
