"""MISSION 1 stage 1 -- fetch real production data for the height-flip validation.

The question 11.2 left open: `679da3d9` flips `__RAW_NEARSHORE_RENORM__` ON, changing the DEFAULT
map display by a median 3.00x. It is proven internally consistent. It is NOT proven accurate --
no buoy scores the tile sampler.

The lane that IS scored is the backend point lane (`raw_surf` height MAE 0.202 m at +24 h, paired,
against real buoys). It samples the SAME offshore wave-height field the tile sampler reads, from
the same regional product, with NO land decay and NO renormalisation -- it just interpolates the
product grid.

So: at identical coordinates, which flag state puts the tile sampler CLOSER to the scored lane?

  ON  closer  => the flip moves the tile lane toward the validated one; keep it.
  OFF closer  => the flip moves it away; revert with one flag.

This stage writes a JSON fixture (grid + spots + point-lane values). Stage 2 drives the REAL
`sampleValueFromDecodedTiles` over it under jest, both flag states.

Read-only. One grid fetch + one point fetch per spot.
"""
import datetime as dt
import json
import os
import urllib.parse
import urllib.request

B = "https://raw-surf-antigravity.onrender.com"
BBOX = "-85,24,-79,31"                      # Florida east coast — their own A/B region
OUT = os.path.join(os.path.dirname(__file__), "M1_fixture.json")


def get(path):
    with urllib.request.urlopen(B + path, timeout=180) as r:
        return json.loads(r.read().decode())


def main():
    vt = (dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
          + dt.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    print("valid_time:", vt)

    grid = get(f"/api/weather/grid?model=GFS&domain=marine&layer=waves"
               f"&valid_time={vt}&bbox={urllib.parse.quote(BBOX)}")
    g = grid["grid"]
    b = g["bounds"]
    print(f"  grid {g['cols']}x{g['rows']}  bounds W{b['west']} S{b['south']} E{b['east']} N{b['north']}")
    print(f"  product_id {grid.get('product_id')}  coverage {grid.get('coverage_status','-')}")

    vec = g["vectors"]
    assert len(vec) == g["cols"] * g["rows"], "grid is not a full rectangle"
    land = sum(1 for v in vec if not v.get("is_valid") or not v.get("speed"))
    print(f"  cells {len(vec)}   land/zero {land} ({land/len(vec):.0%})")

    spots = get("/api/surf-spots")
    if isinstance(spots, dict):
        spots = spots.get("spots") or spots.get("items") or []
    w, s, e, n = [float(x) for x in BBOX.split(",")]
    inside = [sp for sp in spots
              if sp.get("latitude") is not None and sp.get("longitude") is not None
              and w <= float(sp["longitude"]) <= e and s <= float(sp["latitude"]) <= n]
    print(f"  spots inside the bbox: {len(inside)} of {len(spots)}")

    # The SCORED lane, per spot. point.speed is the offshore Hs at that coordinate -- the same
    # quantity the tile sampler produces. (CLAUDE.md: never render this AS the surf height; here it
    # is used only as the like-for-like reference for the sampler, which reads the same field.)
    pts = []
    for i, sp in enumerate(inside):
        la, ln = float(sp["latitude"]), float(sp["longitude"])
        try:
            d = get(f"/api/weather/point?model=GFS&domain=marine&layer=waves"
                    f"&valid_time={vt}&lat={la}&lng={ln}")
            p = d.get("point") or {}
            pts.append({"name": sp.get("name"), "lat": la, "lng": ln,
                        "point_speed": p.get("speed"),
                        "sampled_lat": p.get("sampled_lat"), "sampled_lng": p.get("sampled_lng"),
                        "product_id": d.get("product_id"),
                        "coverage_status": d.get("coverage_status")})
        except Exception as ex:
            pts.append({"name": sp.get("name"), "lat": la, "lng": ln,
                        "point_speed": None, "error": f"{type(ex).__name__}"})
        if (i + 1) % 20 == 0:
            print(f"    point lane {i+1}/{len(inside)}")

    ok = [p for p in pts if isinstance(p.get("point_speed"), (int, float))]
    print(f"  point lane answered for {len(ok)}/{len(pts)} spots")

    fixture = {
        "valid_time": vt,
        "grid": {"cols": g["cols"], "rows": g["rows"],
                 "bounds": [b["west"], b["south"], b["east"], b["north"]],
                 # vectors are ordered SOUTH->NORTH by the normalizer; stage 2 must account for
                 # the sampler's NORTH-first row indexing. The orientation control there is what
                 # proves it was handled.
                 "speeds": [(v.get("speed") if v.get("is_valid") else 0.0) or 0.0 for v in vec]},
        "product_id": grid.get("product_id"),
        "spots": pts,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fixture, fh)
    print("wrote", OUT, f"({os.path.getsize(OUT)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
