"""T-CAP-04 (ASCII-only stdout: this box encodes cp1252) -- did the load-time stride actually work IN PRODUCTION?

Run after the 79abe4ed deploy. Reproduces the T-CAP-01 protocol exactly so the number is
comparable to the three pre-change replicates:

    T-CAP-01  plateau 1,563.6 MB (flat 40 s)   vectors_before_bound 450,690   RSS +156.7 MB
    T-CAP-02  plateau 1,418.4 MB (flat 213 s)  vectors_before_bound 540,828   RSS +201.6 MB
    T-CAP-03  plateau   677.3 MB (flat 30 s)   vectors_before_bound 525,805   RSS +812.8 MB

TWO INDEPENDENT READINGS, and the first is the one to trust:

  (1) `vectors_before_bound` ON THE WIRE. Deterministic, no allocator, no noise. If the stride is
      reaching production it must fall from ~525k to ~60k (hour 0 full + 47 strided). This is the
      direct evidence that the change is LIVE, and it is separable from whether it saved memory.

  (2) RSS delta across the call. The quantity that OOM-kills the box -- but noisy, and meaningless
      unless the process is at a settled plateau AND below its own peak_rss_mb. A delta measured
      against a saturated high-water mark reads zero by construction; that is what made the
      original "+0.0 MB" wrong, and this probe refuses rather than repeat it.

!! EXPECTED NULL RESULT: the fix covers the DURABLE-PRODUCT lanes only. If this request resolves
through the dynamic-viewport fast path, `vectors_before_bound` will NOT fall and that is correct
behaviour, not a failure. The probe reports which happened rather than assuming.

Read-only. One series request.
"""
import json
import time
import urllib.request

B = "https://raw-surf-antigravity.onrender.com"
HOURS = ",".join(str(h) for h in range(0, 142, 3))
URL = (B + "/api/weather/grid_series?model=GFS&domain=marine&layer=waves"
       "&bbox=-180,-85,180,85&hours=" + HOURS)

PRE_CHANGE_BEFORE = [450690, 540828, 525805]
PRE_CHANGE_RSS = [156.7, 201.6, 812.8]


def health():
    d = json.loads(urllib.request.urlopen(B + "/api/health", timeout=90).read().decode())
    m = d["memory"]
    return m["rss_mb"], m["peak_rss_mb"], d["uptime_seconds"], d.get("version", "")[-8:]


def main():
    print("=== WAIT FOR PLATEAU: uptime > 12 min AND RSS flat over 3 polls ===")
    prev, flat = None, 0
    while True:
        rss, peak, up, ver = health()
        is_flat = prev is not None and abs(rss - prev) <= 5.0
        flat = flat + 1 if is_flat else 0
        print(f"  rss={rss:8.1f} peak={peak:8.1f} up={up:6.0f}s ver={ver} "
              f"flat_streak={flat}")
        if up > 720 and flat >= 2:
            break
        prev = rss
        time.sleep(45)

    headroom_below_peak = peak - rss
    print(f"\n  plateau rss={rss} peak={peak} -> {headroom_below_peak:.1f} MB below own peak")
    if headroom_below_peak < 50:
        print("  !! REFUSING TO REPORT AN RSS DELTA: the process is at/near its own high-water")
        print("     mark, where a rise of any size cannot show. This is the exact condition that")
        print("     produced the original '+0.0 MB'. The wire reading below still stands.")
        rss_trustworthy = False
    else:
        rss_trustworthy = True

    before_rss = rss
    print("\n=== ONE GLOBAL grid_series ===")
    t0 = time.time()
    req = urllib.request.Request(URL, headers={"Accept-Encoding": "identity"})
    body = urllib.request.urlopen(req, timeout=300).read()
    wall = time.time() - t0
    d = json.loads(body.decode())
    vb = d.get("vectors_before_bound")
    vt = d.get("vectors_total")
    print(f"  wall={wall:.1f}s wire={len(body)/1048576:.2f}MB frames={len(d.get('frames',[]))}")
    print(f"  vectors_before_bound = {vb}")
    print(f"  vectors_total        = {vt}")
    print(f"  bounded_at           = {d.get('bounded_at')}  stride={d.get('decimated_stride')}")
    print(f"  cols x rows          = {d.get('cols')} x {d.get('rows')}")

    time.sleep(20)
    after_rss, after_peak, _u, _v = health()

    print("\n=== (1) THE WIRE READING -- deterministic ===")
    if vb is None:
        print("  vectors_before_bound ABSENT -> this response was never build-bounded (it fit the")
        print("  budget, or it came from a fast path). NOT a verdict on the fix.")
    else:
        ratio = vb / max(1, vt or 1)
        print(f"  pre-change: {PRE_CHANGE_BEFORE}  ->  now: {vb}")
        print(f"  materialisation ratio: {ratio:.2f}x")
        if vb < 150000:
            print("  OK: THE STRIDE IS LIVE: the build asked for a fraction of what it used to.")
        else:
            print("  !! UNCHANGED: this request resolved through a lane the fix does not cover")
            print("     (dynamic viewport), or the stride was not forwarded. Not yet a failure -")
            print("     check which lane served it before concluding.")

    print("\n=== (2) THE RSS READING ===")
    if rss_trustworthy:
        print(f"  pre-change: +{PRE_CHANGE_RSS[0]} / +{PRE_CHANGE_RSS[1]} / +{PRE_CHANGE_RSS[2]} MB")
        print(f"  now:        {after_rss - before_rss:+.1f} MB   "
              f"(peak {after_peak - peak:+.1f} MB)")
    else:
        print("  WITHHELD -- see the refusal above.")

    print("\nJSON:", json.dumps({
        "version_tail": _v, "wall_s": round(wall, 1),
        "wire_mb": round(len(body) / 1048576, 2), "frames": len(d.get("frames", [])),
        "vectors_before_bound": vb, "vectors_total": vt,
        "bounded_at": d.get("bounded_at"), "stride": d.get("decimated_stride"),
        "rss_before": before_rss, "rss_after": after_rss,
        "rss_delta": round(after_rss - before_rss, 1) if rss_trustworthy else None,
        "rss_trustworthy": rss_trustworthy}))


if __name__ == "__main__":
    main()
