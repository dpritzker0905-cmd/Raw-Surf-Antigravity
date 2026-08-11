"""T-CAP-02 -- does the +156.7 MB from T-CAP-01 RELEASE, and does it COMPOUND?

T-CAP-01 measured +156.7 MB RSS across ONE global grid_series at HEAD (8be9dd56),
against the AUDIT-2026-08-10 post-fix claim of +0.0 MB at 0d9149b7. Before calling
that a regression, two alternative explanations must be killed:

  (A) TRANSIENT  -- the delta is in-flight arena that returns within a few minutes.
                    Falsified by: idle polling showing no decay.
  (B) ONE-SHOT   -- the first call warms a cache; a second identical call costs ~0.
                    Falsified by: a second call adding a comparable delta.

The OOM arithmetic the fix was meant to close is "3 pages per client settle x delta
> headroom". Only if BOTH (A) and (B) are false does that arithmetic still hold.

Read-only. Two requests total -- the same two a single client settle would make.
"""

import json
import time
import urllib.request

BASE = "https://raw-surf-antigravity.onrender.com"
HEALTH = BASE + "/api/health"
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
    return m.get("rss_mb"), m.get("peak_rss_mb"), d.get("uptime_seconds")


def poll(label, n, gap):
    rows = []
    for i in range(n):
        rss, peak, up = health()
        rows.append({"t": round(up), "rss": rss, "peak": peak})
        print(f"  {label}[{i}] rss={rss} peak={peak} uptime={up:.0f}s")
        if i < n - 1:
            time.sleep(gap)
    return rows


def call_series(tag):
    t0 = time.time()
    req = urllib.request.Request(SERIES, headers={"Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read()
    wall = time.time() - t0
    doc = json.loads(body.decode())
    print(f"  [{tag}] wall={wall:.1f}s wire={len(body)/1048576:.2f}MB "
          f"frames={len(doc.get('frames', []))} bounded_at={doc.get('bounded_at')} "
          f"before={doc.get('vectors_before_bound')} after={doc.get('vectors_total')}")
    return {"tag": tag, "wall_s": round(wall, 1),
            "wire_mb": round(len(body) / 1048576, 2),
            "frames": len(doc.get("frames", [])),
            "bounded_at": doc.get("bounded_at"),
            "run_census": doc.get("run_census"),
            "vectors_before_bound": doc.get("vectors_before_bound"),
            "vectors_total": doc.get("vectors_total")}


def main():
    out = {}
    print("=== A) DECAY TEST: 5 idle polls over 200 s after T-CAP-01's call ===")
    out["decay"] = poll("idle", 5, 50)
    d = out["decay"]
    print(f"  decay over {d[-1]['t'] - d[0]['t']} s idle: "
          f"{d[-1]['rss'] - d[0]['rss']:+.1f} MB")

    print("\n=== B) COMPOUNDING TEST: a SECOND identical global series ===")
    before = out["decay"][-1]
    out["call2"] = call_series("second")
    time.sleep(15)
    rss, peak, up = health()
    out["after2"] = {"rss": rss, "peak": peak, "t": round(up)}
    print(f"  after 2nd call: rss={rss} peak={peak}")
    print(f"  2nd-call RSS delta: {rss - before['rss']:+.1f} MB")
    print(f"  2nd-call PEAK delta: {peak - before['peak']:+.1f} MB")

    print("\n=== C) SECOND DECAY TEST: 4 idle polls over 150 s ===")
    out["decay2"] = poll("idle2", 4, 50)
    d2 = out["decay2"]
    print(f"  decay over {d2[-1]['t'] - d2[0]['t']} s idle: "
          f"{d2[-1]['rss'] - d2[0]['rss']:+.1f} MB")

    print("\nJSON:", json.dumps(out))


if __name__ == "__main__":
    main()
