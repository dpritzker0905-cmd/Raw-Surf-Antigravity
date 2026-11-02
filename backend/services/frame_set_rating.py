"""RATED static frame sets: the Surf Rating band as /grid?surf=1 serves it, published as CDN frames (2026-11-01, item 10, DARK).

Why: turning the band ON asks the 1-CPU box for `/grid?surf=1` (4.4 s live; one burst took it to 1,056 MB) because the rating is
a serve-time transform of the stored product. The transform is PER CELL (surf_rating.rating_transform_grid: each cell reads only
its own height, period and direction, plus lat/lng lookups: bathymetry, the chain's shore normal, the wind sampler, the local size
reference and the observation gate), so rating the stored 2-deg world product once and cropping it is exactly rating the crop the
mid tier serves. This module does that rating IN CI, through the served function itself (grid_resolver_surf.apply_surf_overlay,
never a re-typed copy: ONE FORECAST COMPOSITION), and hands the publisher a product whose vectors carry a rating code.

One set per world set it rates: key `<model>/marine/<layer>/global_mid_rated`, the same products as `global_mid`
(frame_set.select_entries drops the variant). Each frame = the STORED product's four planes (height, direction, period,
confidence; byte-identical to the plain set's frame) + frame_binary.RATING, a u32 code per node:
  0 untouched (the rating left it as stored), 1 masked open ocean (is_valid false, phys_speed = height),
  k + 2 rated (speed = k / 10000, phys_speed = height).
The client (staticFrameCodec.buildVectors) rebuilds exactly the rated vectors /grid serves from those planes.

EXACTNESS, by construction and then checked:
  - apply_surf_overlay skips a span >= 350 deg (a world box keeps the honest field), so the world product is rated as TWO halves,
    each a real sub-350 extent, and merged back node by node. Per-cell, so the halves are exactly the world rated once.
  - every node's rated (speed, is_valid, phys_speed) must be representable from the stored planes + its code, or the frame is
    refused (`unbuilt`, /grid serves that hour); u, v, direction, period and confidence must be untouched.
  - the rating reads the ASK time twice (the wind products within 3 h, per cell the finest covering one; the gate's confirmed
    spots within 3 h). A frame is rated at its own valid time, and `ask_offsets_h` lists the ask offsets (-3..+3 h) whose wind
    choice and confirmed spots are IDENTICAL to that build's, so the rated values are the same for those asks. The client serves
    the frame only for those asks; any other ask goes to /grid.
  - a wind product the sampler needs that is not on this runner's disk refuses the frame (the sampler would silently drop the
    wind term /grid uses).
INPUT FRESHNESS (the owner's call, why the client path is DARK): the gate (spot-ratings L2 blob, Render TTL 300 s) and the local
size climatology (600 s) are read ONCE per publish and their identities recorded in the index (`rating_chain`), with every env
value the chain reads (CHAIN_ENV). A CDN band lags the box by up to one republish. ON by default (D-057); kill FRAME_RATING_SETS=0.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone

VARIANT = "rated"
# The world sets the band can be asked of (frame_set.SETS' marine global_mid sets); waves first: the band's default layer.
RATED_LAYERS = (("GFS", "waves"), ("ICON", "waves"), ("EURO", "waves"), ("GFS", "swell_1"), ("GFS", "swell_2"),
                ("GFS", "wind_waves"), ("ICON", "swell_1"), ("ICON", "wind_waves"))
RATED_SETS = tuple({"model": m, "domain": "marine", "layer": lyr, "region_id": "global_mid", "variant": VARIANT}
                   for m, lyr in RATED_LAYERS)
ASK_OFFSETS_H = tuple(range(-3, 4))


def rated_regional_sets():
    """The RATED twins of the GFS regional bundle sets (frame_set_bundle.REGIONAL_SETS: every pilot box x waves, swell_1, swell_2,
    wind_waves), key <model>/marine/<layer>/<region>_rated. These are what PAINT: the client holds the band on any rating grid with
    cells of 1.0 deg or more (marineRatingBandRes.js), so a 2-deg world set gives the rating mode at once but the band waits for a
    0.25-deg tile. Off with FRAME_RATING_REGIONAL=0. The client reads them only while /capabilities reports
    regional_tile_first_surf (MARINE_REGIONAL_TILE_FIRST_SURF=1: /grid?surf=1 rates the same stored tile)."""
    if os.environ.get("FRAME_RATING_REGIONAL", "1") == "0":
        return ()
    from services import frame_set_bundle as fsb
    return tuple(dict(t, variant=VARIANT) for t in fsb.selected_regional_sets())


def rated_publish_sets():
    """The rated step's sets in publish order (the budget stagger drops the tail first): the regional waves bundles (they paint),
    the GFS world waves set, the other regional layers, then the other world sets."""
    regional = rated_regional_sets()
    waves = [t for t in regional if t["layer"] == "waves"]
    return tuple(waves) + RATED_SETS[:1] + tuple(t for t in regional if t["layer"] != "waves") + RATED_SETS[1:]
SPLIT_LNG = 0.0   # the two halves: lng < 0 and lng >= 0 (each well under the overlay's 350-deg skip)
# Every env value the rating chain reads (grid_resolver_surf, surf_rating, surf_transform, surf_point, bathymetry, shore normal,
# the point selection the wind sampler uses). Recorded in the index; a value that differs from Render's is a different band.
CHAIN_ENV = ("SURF_TRANSFORM", "SURF_RATING", "MARINE_MID_RES_RATING", "RATING_LOCAL_SIZE", "RATING_OBS_GATE",
             "RATING_OVERSIZE", "RATING_PERIOD_GATE", "RATING_WIND_GATE", "SHORE_NORMAL_ASSET", "SHORE_NORMAL_BEARING_RADIUS_KM",
             "SHORE_NORMAL_OVERLAY", "SHORE_NORMAL_OVERLAY_PATH", "SURF_BREAK_DEPTH", "SURF_CAP_SEAM_MONOTONE",
             "SURF_COASTAL_FROM_LAND_BIT", "SURF_COASTAL_FROM_SHORE_NORMAL", "SURF_EXPOSURE_RECONCILED",
             "SURF_GAMMA_FIELD_CEILING", "SURF_HEIGHT_H110", "SURF_REFRACTION_KR", "SURF_SHELF_CF_SCALE",
             "SURF_SHELF_KF_FLOOR", "SURF_TIDE_DEPTH", "SURF_V3_JACK_MAX", "SURF_V3_NORMAL_OVERRIDES", "SURF_V3_SLOPE_GAMMA",
             "COPERNICUS_ISLAND_SERVE", "POINT_RES_TIEBREAK")
UNTOUCHED, MASKED, RATED_BASE = 0, 1, 2
UNCHANGED_FIELDS = ("u", "v", "direction", "period", "dir_confidence", "lat", "lng")


def enabled():
    """The rated step publishes (ON by default since D-057, the owner 2026-11-01 22:10 EST); FRAME_RATING_SETS=0 is the kill switch."""
    return os.environ.get("FRAME_RATING_SETS", "1") != "0"


def is_rated(target):
    return (target or {}).get("variant") == VARIANT


def _iso_dt(ts):
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(timezone.utc)


class LocalStore:
    """The ProductStore surface apply_surf_overlay reads (`load_product`), over the publisher's source (local disk only). Every
    filename it could not load is recorded in `misses`: a miss means the band would differ from /grid, so the frame is refused."""

    def __init__(self, source):
        self.source = source
        self.misses = set()
        self._cache = {}

    def load_product(self, filename, stride=None):
        from services.weather_pipeline.schemas import NormalizedProduct
        if filename in self._cache:
            return self._cache[filename]
        raw = self.source.product_bytes(filename)
        if raw is None:
            self.misses.add(filename)
            return None
        p = NormalizedProduct.model_validate_json(raw)
        self._cache[filename] = p
        return p


class ChainInputs:
    """What one publish run rates with: the manifest model, the gate blob and the climatology blob, each read once."""

    def __init__(self, source, log=print):
        from services.weather_pipeline.schemas import PipelineManifest
        self.manifest = PipelineManifest.model_validate(source.manifest())
        self.store = LocalStore(source)
        # ONE event loop for the run: asyncio.run per half tore down its thread pool each time (~0.6 s a call, profiled).
        self.loop = asyncio.new_event_loop()
        self.gate_blob = None
        self.clim_id = None
        if os.environ.get("RATING_OBS_GATE", "0") == "1":
            try:
                from services.weather_pipeline.spot_ratings_precompute import load_spot_ratings_l2_cached
                self.gate_blob = load_spot_ratings_l2_cached()
            except Exception as e:   # the box falls back to cap-everything too; recorded, never hidden
                log(f"[frames] rated: spot-ratings blob unavailable ({type(e).__name__}: {e})")
        if os.environ.get("RATING_LOCAL_SIZE", "0") == "1":
            try:
                from services.weather_pipeline.grid_size_climatology import load_grid_size_climatology_l2_cached
                clim = load_grid_size_climatology_l2_cached()
                self.clim_id = _digest(clim) if clim else None
            except Exception as e:
                log(f"[frames] rated: size climatology unavailable ({type(e).__name__}: {e})")

    def identity(self):
        """The set-level `rating_chain` record: env values, blob identities, the chain's code + data hash."""
        blob = self.gate_blob or {}
        return {**self.chain(),
                "gate_blob": {"generated_at": blob.get("generated_at"), "sha12": _digest(blob)[:12] if blob else None},
                "revision": os.environ.get("GITHUB_SHA") or None}

    def chain(self):
        """What every frame of a run shares: env, the climatology, the chain's code and data. The gate is per hour (ask_key)."""
        return {"env": {k: os.environ.get(k) for k in CHAIN_ENV}, "local_size_sha12": (self.clim_id or "")[:12] or None,
                "code_sha12": _code_sha12()}

    def ask_key(self, model, valid_dt):
        """A frame's rating inputs at EVERY ask offset it could answer: equal keys = equal rated values and ask_offsets_h,
        so the publisher may carry the frame over."""
        return _digest([self.ask_signature(model, valid_dt + timedelta(hours=h)) for h in ASK_OFFSETS_H])[:16]

    def ask_signature(self, model, target_dt):
        """Everything the rating reads from the ask time: the wind candidates in the order the per-cell choice walks them
        (with which side of the estimate preference each falls), and the gate's confirmed spots. Equal signatures = equal
        rated values for every cell (manifest_point_selection.choose_for_point; grid_resolver_surf.confirmed_spots)."""
        from services.weather_pipeline.grid_resolver_surf import confirmed_spots
        from services.weather_pipeline.manifest_point_selection import EST_PREFERENCE_S, point_candidates
        try:
            auth, est = point_candidates(self.manifest, model, "wind", "wind", target_dt)
            # The 30-min estimate preference is read only where a cell has BOTH kinds, so a flag counts only then.
            wind = (tuple((p.filename, bool(est) and d > EST_PREFERENCE_S) for p, d, _ in _can_win(auth)),
                    tuple((p.filename, bool(auth) and d <= EST_PREFERENCE_S) for p, d, _ in _can_win(est)))
        except Exception:
            wind = None
        # The gate tests "any epic / any good within the radius": order and repeats do not change it.
        gate = tuple(sorted(set(confirmed_spots(target_dt, blob=self.gate_blob)))) if self.gate_blob is not None else None
        return wind, gate


def _inside(a, b):
    """Rectangle `a` lies inside rectangle `b` (neither wrapping the antimeridian; else False, which keeps `a`). PURE."""
    if a.west > a.east or b.west > b.east:
        return False
    return b.west <= a.west and a.east <= b.east and b.south <= a.south and a.north <= b.north


def _can_win(entries):
    """The candidates choose_for_point can answer some cell from: it takes the FIRST entry whose bounds contain the cell, so an
    entry inside an earlier entry's bounds never answers. Dropping those is exact; the rest, in order, decide every cell."""
    kept = []
    for e in entries:
        if not any(_inside(e[2], k[2]) for k in kept):
            kept.append(e)
    return kept


def _digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode("utf-8")).hexdigest()


# The rating chain's source and bundled data: a change to any of them is a different band, so every rated frame rebuilds.
_PIPE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weather_pipeline")
CHAIN_FILES = tuple(os.path.join(_PIPE, f) for f in (
    "surf_rating.py", "surf_transform.py", "surf_point.py", "grid_resolver_surf.py", "bathymetry.py", "rating_confirmation.py",
    "grid_size_climatology.py", "manifest_point_selection.py", "shore_normal_asset.py", "schemas.py")) + (
    os.path.abspath(__file__), os.path.join(os.path.dirname(os.path.abspath(__file__)), "frame_binary.py"))
_code_sha = None


def _code_sha12():
    global _code_sha
    if _code_sha is None:
        h = hashlib.sha256()
        data = os.path.join(_PIPE, "data")
        names = list(CHAIN_FILES) + sorted(os.path.join(data, n) for n in (os.listdir(data) if os.path.isdir(data) else []))
        for path in names:
            h.update(os.path.basename(path).encode("utf-8"))
            try:
                with open(path, "rb") as fh:
                    h.update(fh.read())
            except OSError:
                h.update(b"<missing>")
        _code_sha = h.hexdigest()[:12]
    return _code_sha


def _half(product, keep):
    """A shallow copy of the stored product holding the vectors `keep` selects, with bounds of its own cells; None when it holds
    none (a regional tile lies on one side of the split)."""
    from services.weather_pipeline.schemas import CoverageBounds
    p = product.model_copy()
    p.grid = product.grid.model_copy()
    p.grid.vectors = [v for v in product.grid.vectors if keep(v)]
    if not p.grid.vectors:
        return None
    lats = [v.lat for v in p.grid.vectors]
    lngs = [v.lng for v in p.grid.vectors]
    p.grid.bounds = CoverageBounds(west=min(lngs), south=min(lats), east=max(lngs), north=max(lats))
    p.grid.diagnostics = dict(product.grid.diagnostics or {})
    return p


def rate_vectors(product_dict, model, layer, inputs):
    """(rated vector dicts in the stored order, the overlay's tags) for one stored product, through apply_surf_overlay on its two
    halves at the product's own valid time. Raises ValueError when the overlay did not rate (skipped or failed) or a wind product
    it needed is not on this disk."""
    from services.weather_pipeline.grid_resolver_surf import apply_surf_overlay
    from services.weather_pipeline.schemas import NormalizedProduct
    product = NormalizedProduct.model_validate(product_dict)
    target_dt = _iso_dt(product_dict.get("valid_time"))
    inputs.store.misses.clear()
    rated, tags = {}, []
    for keep in (lambda v: v.lng < SPLIT_LNG, lambda v: v.lng >= SPLIT_LNG):
        half = _half(product, keep)
        if half is None:
            continue
        out = inputs.loop.run_until_complete(apply_surf_overlay(
            half, store=inputs.store, manifest=inputs.manifest, model=model, domain="marine", layer=layer, surf=True,
            target_dt=target_dt))
        tag = (out.grid.diagnostics or {}).get("surf_transform") or {}
        if "rated" not in tag:
            raise ValueError(f"the overlay did not rate this half: {tag or (out.grid.diagnostics or {}).get('surf_skip_reason')}")
        tags.append(tag)
        for v in out.grid.vectors:   # only the fields the code reads (a model_dump per node cost ~0.25 s a frame)
            rated[(v.lat, v.lng)] = {k: getattr(v, k) for k in UNCHANGED_FIELDS + WRITTEN}
    if inputs.store.misses:
        raise ValueError(f"wind product(s) not on this disk: {sorted(inputs.store.misses)[:3]}")
    return [rated[(v["lat"], v["lng"])] for v in product_dict["grid"]["vectors"]], tags


def rating_code(stored, rated):
    """The RATING code that rebuilds `rated` from `stored` (staticFrameCodec.buildVectors' rule), or ValueError."""
    for k in UNCHANGED_FIELDS:
        if stored.get(k) != rated.get(k):
            raise ValueError(f"the rating changed {k} at ({stored.get('lat')}, {stored.get('lng')})")
    sp, valid = stored.get("speed"), bool(stored.get("is_valid", True))
    phys = rated.get("phys_speed")
    if rated.get("speed") == sp and bool(rated.get("is_valid", True)) == valid and phys is None:
        return UNTOUCHED
    if phys != sp or not valid:
        raise ValueError(f"node ({stored.get('lat')}, {stored.get('lng')}) is not representable: stored speed {sp!r} "
                         f"valid {valid}, rated phys_speed {phys!r}")
    if not rated.get("is_valid", True):
        if rated.get("speed") != sp:
            raise ValueError(f"masked node ({stored.get('lat')}, {stored.get('lng')}) changed its speed")
        return MASKED
    k = int(round(float(rated["speed"]) * 10000))
    if k < 0 or k / 10000 != rated["speed"]:
        raise ValueError(f"rated speed {rated['speed']!r} is not a 4-dp value")
    return RATED_BASE + k


def rebuild(stored, code):
    """The rated vector a client rebuilds from a stored vector and its code: the Python twin of buildVectors' rating step."""
    out = dict(stored)
    if code == UNTOUCHED:
        return out
    out["phys_speed"] = stored.get("speed")
    if code == MASKED:
        out["is_valid"] = False
    else:
        out["speed"] = (code - RATED_BASE) / 10000
    return out


WRITTEN = ("speed", "is_valid", "phys_speed")   # the only vector fields rating_transform_grid writes


def _written(vec, k):
    """A written field with the schema's default when absent (is_valid True, phys_speed None)."""
    return bool(vec.get("is_valid", True)) if k == "is_valid" else vec.get(k)


def rated_product(product_dict, model, layer, inputs):
    """(product dict whose vectors carry `_rating_code`, the rated product's meta overrides, ask offsets, rating stats).

    Raises ValueError when any node cannot be represented, so the publisher lists the hour unbuilt and /grid serves it."""
    rated, tags = rate_vectors(product_dict, model, layer, inputs)
    vectors, counts = [], {"rated": 0, "masked": 0, "untouched": 0}
    for stored, r in zip(product_dict["grid"]["vectors"], rated):
        code = rating_code(stored, r)
        got = rebuild(stored, code)
        if any(_written(got, k) != _written(r, k) for k in WRITTEN):
            raise ValueError(f"rebuild mismatch at ({stored.get('lat')}, {stored.get('lng')})")
        counts["rated" if code >= RATED_BASE else "masked" if code == MASKED else "untouched"] += 1
        vectors.append({**stored, "_rating_code": code})
    out = dict(product_dict, grid=dict(product_dict["grid"], vectors=vectors))
    target_dt = _iso_dt(product_dict.get("valid_time"))
    base = inputs.ask_signature(model, target_dt)
    offsets = [h for h in ASK_OFFSETS_H if inputs.ask_signature(model, target_dt + timedelta(hours=h)) == base]
    # The product-level fields the overlay sets on a rated grid (grid_resolver_surf): the tag's constant part (the counts are per
    # served box, and the client recounts them from the codes it crops).
    t0 = tags[0]
    tag = {k: t0[k] for k in ("value_kind", "wind", "local_size", "obs_gate") if k in t0}
    if any({k: t[k] for k in tag if k in t} != tag for t in tags[1:]):
        raise ValueError(f"the halves disagree on the overlay tag: {tags}")
    return out, {"is_estimated": True, "surf_transform": tag}, offsets, counts
