"""M2 -- does a REPEAT identical grid_series cost the same? The design hinges on it.

Mission 2 proposes bounding the series BEFORE GridVector materialisation. That is only worth
doing if the vectors are actually CONSTRUCTED per request. Two competing mechanisms:

  (H-COLD)  every hour is deserialised/rebuilt on each request -> ~721k Pydantic models
            constructed per global call. Avoiding the construction is the whole win.
  (H-WARM)  products are served from the in-memory product cache, so `vectors_before_bound`
            counts SHARED references, not allocations. Then Mission 2 saves nothing on a warm
            box and the +157 MB has a different cause entirely.

DISCRIMINATOR: issue the SAME request twice on the SAME process, plateau-verified between.
  H-COLD predicts the second call costs about as much as the first.
  H-WARM predicts the second call is far cheaper.

Audit 11.1 never ran this: T-CAP-01's call and T-CAP-02's call landed on DIFFERENT processes
(uptime 14,488 s vs 88 s), so neither was a same-process repeat. The mechanism was inferred.
A mechanism that has not been discriminated is a hypothesis.

Read-only. Two requests -- fewer than one client settle makes.
"""
import json
import time
import urllib.request

B = "https://raw-surf-antigravity.onrender.com"
HOURS = ",".join(str(h) for h in range(0, 142, 3))
URL = (B + "/api/weather/grid_series?model=GFS&domain=marine&layer=waves"
       "&bbox=-180,-85,180,85&hours=" + HOURS)


def health():
    d = json.loads(urllib.request.urlopen(B + "/api/health", timeout=90).read().decode())
    m = d["memory"]
    return m["rss_mb"], m["peak_rss_mb"], d["uptime_seconds"]


def settle(label, n=6, gap=30, tol=4.0):
    prev = None
    for i in range(n):
        rss, peak, up = health()
        flat = prev is not None and abs(rss - prev) <= tol
        print(f"  {label}[{i}] rss={rss:8.1f} peak={peak:8.1f} up={up:6.0f}s"
              f"{'  <- FLAT' if flat else ''}")
        if flat:
            return rss, peak, up
        prev = rss
        if i < n - 1:
            time.sleep(gap)
    return prev, peak, up


def call(tag):
    t0 = time.time()
    req = urllib.request.Request(URL, headers={"Accept-Encoding": "identity"})
    body = urllib.request.urlopen(req, timeout=300).read()
    wall = time.time() - t0
    d = json.loads(body.decode())
    print(f"  [{tag}] wall={wall:5.1f}s wire={len(body)/1048576:.2f}MB frames={len(d.get('frames',[]))} "
          f"before={d.get('vectors_before_bound')} after={d.get('vectors_total')} "
          f"bounded_at={d.get('bounded_at')}")
    return {"wall_s": round(wall, 1), "wire_mb": round(len(body) / 1048576, 2),
            "frames": len(d.get("frames", [])),
            "before": d.get("vectors_before_bound"), "after": d.get("vectors_total")}


def main():
    print("=== settle to a plateau (a reading taken during boot warm is worthless) ===")
    b0 = settle("pre")

    print("\n=== CALL 1 (cold for this bbox/hours on this process) ===")
    c1 = call("first")
    time.sleep(20)
    a1 = health()
    d1 = a1[0] - b0[0]
    print(f"  after call 1: rss={a1[0]:.1f} peak={a1[1]:.1f}   RSS delta {d1:+.1f} MB")

    print("\n=== settle again ===")
    b1 = settle("mid", n=5, gap=30)

    print("\n=== CALL 2 (byte-identical request, same process) ===")
    c2 = call("second")
    time.sleep(20)
    a2 = health()
    d2 = a2[0] - b1[0]
    print(f"  after call 2: rss={a2[0]:.1f} peak={a2[1]:.1f}   RSS delta {d2:+.1f} MB")

    print("\n=== VERDICT ===")
    print(f"  call 1 RSS delta {d1:+.1f} MB   (wall {c1['wall_s']}s)")
    print(f"  call 2 RSS delta {d2:+.1f} MB   (wall {c2['wall_s']}s)")
    if d1 > 20:
        print(f"  ratio call2/call1 = {d2 / d1:.2f}")
        if d2 > 0.5 * d1:
            print("  => H-COLD: the repeat costs about the same. Vectors are CONSTRUCTED per")
            print("     request, so bounding before materialisation is correctly targeted.")
        else:
            print("  => H-WARM: the repeat is far cheaper. The cost is cold construction only;")
            print("     `vectors_before_bound` counts shared references on a warm box and")
            print("     Mission 2 as framed would save little. RECONSIDER THE DESIGN.")
    else:
        print("  => INCONCLUSIVE: call 1 did not move RSS enough to discriminate. Do not")
        print("     conclude from this run; the box may already be at its high-water mark.")
    print("\nJSON:", json.dumps({"call1": c1, "call2": c2,
                                 "rss_delta_1": round(d1, 1), "rss_delta_2": round(d2, 1)}))


if __name__ == "__main__":
    main()
