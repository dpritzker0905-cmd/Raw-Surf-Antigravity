"""Static frames for the GFS WIND world field (2026-10-22, the wind instant scrub; frame_set.py runs the set).

WHY. Toggling to wind and scrubbing waited on the 1-CPU box: every hour asked /grid (the 2-degree world base and the viewport
clip of the same product) or a /grid_series page (~10-25 s of the box, then a thinned 46 x 21 picture). The marine world sets
already come from the CDN (frame_set.SETS); this is the wind set beside them: GFS wind global_mid, written by the PILOTS lane
("GFS Wind Global Mid": NOAA-direct, 3-hourly f000-f336, 181 x 83), so its products are on the same runner disk.

WHAT /grid SERVES, AND SO WHAT A FRAME HOLDS. /grid runs `wind_lane.apply_wind_lane` on every GFS wind grid it serves (D-017:
HRRR inside its CONUS domain and its 48 h horizon, feathered and tapered; GFS elsewhere). A frame of the STORED product would
differ from /grid there, so each frame is the stored product WITH THE LANE APPLIED, by the same function, with the lane the
serve box loads (L2 wind_lane/index.json -> its cycle object). The blend runs at the product's own valid time (served_valid_time
is stamped before the lane), so one frame per product equals /grid for every hour that picks it. Parity is checked against that
blend node by node (frame_binary.parity, wind tolerances), and the frame carries:
  - fields speed_kt + direction (frame_binary.WIND_FIELDS), and lane_weight when the lane touched any node (so a CROP of the
    frame rebuilds the lane stamp /grid puts on the clip: hrrr+gfs inside the touched nodes, outside_hrrr_domain otherwise);
  - in its index meta, the `wind_lane` stamp /grid puts on the world response;
  - in the index, `wind_lane`: the lane's identity (key, cycle, horizon, feather_km, taper_hours, source), and the lane key is
    part of every frame's source identity, so a new lane rebuilds the set (frames the lane does not touch keep their bytes and
    path; only the stamps move).
THE CLIENT CHECK. The box re-reads the lane index every 300 s, the core lane publishes a new HRRR cycle ~4 times a day and this
set is republished by the pilots lane, so the frames' lane and the box's can differ for hours. `write_lane_pointer` keeps a tiny
no-cache `v1/wind_lane.json` in the frames bucket naming the lane L2 holds; the client serves a frame inside either lane's window
only when that pointer names the frames' own lane (frontend windStaticFrames.js), and /grid otherwise.
"""
from __future__ import annotations

import copy
import json
import logging
import os
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

WIND_TARGET = {"model": "GFS", "domain": "wind", "layer": "wind", "region_id": "global_mid"}
LANE_POINTER = "v1/wind_lane.json"
FRAME_BUCKET = "weather-frames"


def is_wind(target):
    return (target or {}).get("domain") == "wind"


class PublishLane:
    """The HRRR lane a publish run applies: the wind_lane.Lane, its L2 key, and the parameters /grid blends with."""

    def __init__(self, lane, key):
        from services.weather_pipeline import wind_lane as wl
        self.lane, self.key = lane, key
        self.feather_km, self.taper_hours, self.source = wl.feather_km(), wl.taper_hours(), wl.SOURCE

    def identity(self):
        from services.weather_pipeline import wind_lane as wl
        return {"key": self.key, "cycle": wl._iso(self.lane.cycle), "horizon": wl._iso(self.lane.horizon),
                "feather_km": self.feather_km, "taper_hours": self.taper_hours, "source": self.source}


def load_publish_lane(log=print):
    """The lane the serve box loads, or None (no lane published, no credentials, the lane switched off, or unreadable: the frames
    then carry the GFS field and an index `wind_lane` of null, and the client serves only frames outside the box's lane window).
    Offline: FRAME_WIND_LANE_FILE = a lane object JSON (FRAME_WIND_LANE_KEY names it; default its cycle key)."""
    from services.weather_pipeline import wind_lane as wl
    if not wl.enabled():
        log("[frames] wind: WIND_HRRR_LANE=0, frames carry the GFS field (as /grid does)")
        return None
    try:
        path = os.environ.get("FRAME_WIND_LANE_FILE")
        if path:
            with open(path, encoding="utf-8") as fh:
                obj = json.load(fh)
            from services.weather_pipeline.wind_lane_ingest import cycle_key
            key = os.environ.get("FRAME_WIND_LANE_KEY") or cycle_key(obj["cycle"])
        else:
            index = wl._l2_get(wl.INDEX_KEY)
            if not index or not index.get("key"):
                log("[frames] wind: no HRRR lane index in L2; frames carry the GFS field")
                return None
            key = index["key"]
            obj = wl._l2_get(key)
            if not obj:
                log(f"[frames] wind: lane {key} unreadable; frames carry the GFS field")
                return None
        lane = PublishLane(wl.Lane(obj, key=key), key)
        log(f"[frames] wind: lane {key} (cycle {lane.identity()['cycle']}, horizon {lane.identity()['horizon']})")
        return lane
    except Exception as e:  # never fail the publish over the lane: the client refuses lane hours it cannot match
        log(f"[frames] wind: lane load failed ({type(e).__name__}: {e}); frames carry the GFS field")
        return None


def lane_applied(product_dict, plane):
    """(product dict as /grid serves it, the wind_lane stamp, touched-node count) for one stored GFS wind product.

    The stored dict goes through the SAME apply_wind_lane /grid runs (a pydantic round trip); each vector the lane's `use` mask
    covers gets `_lane_w` (its weight) for the lane_weight plane. With no lane the product is unchanged (as /grid with none)."""
    from services.weather_pipeline import wind_lane as wl
    from services.weather_pipeline.schemas import NormalizedProduct
    if plane is None:
        return product_dict, None, 0
    p = NormalizedProduct.model_validate(product_dict)
    out = wl.apply_wind_lane(p, "GFS", "wind", "wind", lane=plane.lane)
    stamp = copy.deepcopy(getattr(out, "wind_lane", None))
    served = dict(product_dict)
    if out is p or out.grid is p.grid:
        served["wind_lane"] = stamp
        return served, stamp, 0
    vectors = [v.model_dump() for v in out.grid.vectors]
    touched = 0
    valid = wl._data_time(out)
    found = wl.lane_use(out.grid.vectors, plane.lane, valid, plane.lane.time_weight(valid)) if valid else None
    if found is not None:
        idx, w, _hu, _hv, use = found
        for k, i in enumerate(idx):
            if bool(use[k]):
                vectors[int(i)]["_lane_w"] = float(w[k])
                touched += 1
    served["grid"] = dict(served["grid"], vectors=vectors)
    served["wind_lane"] = stamp
    return served, stamp, touched


def strip_private(product_dict):
    """The product without the encoder's private `_lane_w` keys (what a parity report or a test compares against)."""
    out = dict(product_dict)
    out["grid"] = dict(product_dict["grid"], vectors=[{k: v for k, v in vec.items() if k != "_lane_w"}
                                                     for vec in product_dict["grid"]["vectors"]])
    return out


# ───────────────────────────── the client's lane check: v1/wind_lane.json ─────────────────────────────
def pointer_record(lane_index, previous=None, writer="local"):
    """The pointer for an L2 lane index ({key, cycle, horizon, hours, ...}). `written_at` is when THIS key first appeared (kept
    when the pointer already names it), because the client counts the serve box's 300 s re-read from it."""
    from services.weather_pipeline import wind_lane as wl
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    same = bool(previous and previous.get("key") == lane_index.get("key"))
    return {"version": 1, "key": lane_index.get("key"), "cycle": lane_index.get("cycle"), "horizon": lane_index.get("horizon"),
            "hours": lane_index.get("hours"), "feather_km": wl.feather_km(), "taper_hours": wl.taper_hours(), "source": wl.SOURCE,
            "written_at": previous.get("written_at") if same else now, "checked_at": now, "writer": writer}


def write_lane_pointer(lane_index, log=print):
    """Keep the frames bucket's `v1/wind_lane.json` naming the lane L2 holds. Never raises (a missing pointer only makes the
    client ask /grid for the hours inside the lane window). Needs SUPABASE_URL + a service key; a no-op without them."""
    if not lane_index or not lane_index.get("key"):
        return None
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not secret:
        return None
    try:
        import requests
        auth = {"Authorization": f"Bearer {secret}", "apikey": secret}
        url = f"{base}/storage/v1/object/{FRAME_BUCKET}/{LANE_POINTER}"
        prev = None
        resp = requests.get(f"{url}?cb={int(time.time() * 1000)}", headers=auth, timeout=30)
        if resp.status_code == 200:
            try:
                prev = resp.json()
            except ValueError:
                prev = None
        if prev and prev.get("key") == lane_index.get("key"):
            return prev                    # unchanged: keep written_at (the client's settle clock)
        writer = f"gh-run-{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID") else "local"
        rec = pointer_record(lane_index, prev, writer)
        put = requests.post(url, headers=dict(auth, **{"Content-Type": "application/json", "x-upsert": "true",
                                                        "cache-control": "no-cache"}),
                            data=json.dumps(rec, indent=1).encode("utf-8"), timeout=30)
        if put.status_code not in (200, 201):
            log(f"[wind-lane pointer] upload failed: HTTP {put.status_code}")
            return None
        log(f"[wind-lane pointer] {LANE_POINTER} -> {rec['key']}")
        return rec
    except Exception as e:  # pragma: no cover - network
        log(f"[wind-lane pointer] failed: {type(e).__name__}: {e}")
        return None
