"""Run-keyed series page memo. Dark: GRID_SERIES_MEMO_RUN_KEYS=1, read only while GRID_SERIES_PAGE_MEMO=1.

WHY (2026-10-20 scrub-lag diagnosis; live memo hit rate 8.5%). The W-4 memo (series_page_memo.py) keyed a page on its
anchor hour, which rolls every UTC hour; every manifest write cleared every page; a page lived 180 s; and a regional
page served from the 2-deg mid grid was never kept. On a low-traffic site few requests repeat a key within 180 s of the
same hour, so nearly every page was rebuilt: 2-5 s of CPU offline, 9-19 s wall live, on the one CPU everything shares.

WHAT, with the flag on:
  1. VALID-TIME KEYS. A page is keyed on its absolute valid times (anchor + each hour), not on (anchor, hours). The
     per-hour loop hands the resolver an absolute valid_time and never the anchor (grid_series_helper._build_one), so
     the frames depend on the valid times alone. Three labels carry the anchor: the top-level `base_time` and
     `base_time_source`, and each frame's `hour_offset`. A page kept under one anchor is RELABELLED for another
     (`relabel`, off the loop, once; the result replaces the kept page). The relabelled bytes equal a fresh encode at
     the new anchor (pinned in tests/test_series_memo_run_keys.py). A body whose labels are not exactly where expected
     is refused and rebuilt.
  2. DURABLE PAGES. A page whose every frame is a STORED manifest product or a FRESH dynamic-viewport index hit under
     the page's own cache key (no upstream fetch, no preview, no partial regional frame, no live Open-Meteo attempt, no
     failed file read, no warm sharpen refused for a full queue, and not a surf page: the surf chain reads rating and
     tide inputs outside the manifest) lives GRID_SERIES_PAGE_MEMO_RUN_TTL_S (3600 s), not 180 s. A manifest
     change drops it only when the change touched a model the page read: its own model, the model of every file its
     build loaded, and GFS for an EURO/ICON marine page (the gulf fill's donor). A change to any model outside
     GFS/ICON/EURO drops every page. Regional pages built from the 2-deg mid grid are now kept: what made them unsafe
     (a finer viewport tile landing later) is checked directly, see 3.
  3. EVERY OTHER INPUT A BUILD READS IS CHECKED ON EACH HIT, never assumed unchanged:
     * the dynamic-viewport index entries under this page's exact Step 1&2 cache keys (viewport_helper.dynamic_lookup_box):
       any added or replaced entry drops the page, and so does an entry reaching its expiry OR the 30-min age at which
       the lookup marks it stale and schedules its refresh (DYNAMIC_STALE_S) - so a kept page never suppresses a refresh
       a rebuild would have started;
     * the hour-rounded clock at the EURO 240 h / ICON 168 h viewport limits (viewport_helper.is_viewport_enabled_helper);
     * the UTC date, for ICON wind (grid_resolver_selection: the 5-day dynamic boundary);
     * the in-memory HRRR cycle, for GFS wind (wind_lane, D-017).
     A page that is not durable keeps the W-4 rules: 180 s, and any manifest write clears it.

Kill: unset the flag (the W-4 memo is unchanged). GRID_SERIES_PAGE_MEMO_MAX_MB / _MAX_ENTRIES still bound memory
(defaults 64 MB / 192 entries while this flag is on).
"""
import contextvars
import gzip
import json
import os
import re
from datetime import datetime, timedelta, timezone

from services.weather_pipeline.config_env import env_float, env_int

FLAG = "GRID_SERIES_MEMO_RUN_KEYS"
SCOPED_MODELS = frozenset({"GFS", "ICON", "EURO"})
_ISO = "%Y-%m-%dT%H:%M:%SZ"
_HORIZON_LIMIT_H = {"EURO": 240, "ICON": 168}     # is_viewport_enabled_helper's marine limits
# get_cached_dynamic_product_helper: an index hit older than this is served stale and its refresh is scheduled
# (`age_sec > 1800`; tests/test_series_memo_run_keys.py pins the two equal).
DYNAMIC_STALE_S = 1800.0

# What a build reports back. series_page_memo._lead sets each BEFORE the build task exists (the task copies the
# context; asyncio.to_thread copies it again into the store's worker threads). Unset => nothing is recorded.
SERIES_FRAME_FACTS = contextvars.ContextVar("series_frame_facts", default=None)    # [(pid, dynamic, scope, cache_hit)]
SERIES_BUILD_NOTES = contextvars.ContextVar("series_build_notes", default=None)    # {name: True}: ANY note = not durable
SERIES_LOADS = contextvars.ContextVar("series_loads", default=None)                # {filename, ...} the store read


def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def durable_ttl_s() -> float:
    return env_float("GRID_SERIES_PAGE_MEMO_RUN_TTL_S", 3600.0, lo=1.0, hi=3 * 3600.0)


def memo_caps():
    """(max bytes, max entries) while this flag is on; the W-4 env names win when set."""
    return (env_float("GRID_SERIES_PAGE_MEMO_MAX_MB", 64.0, lo=0.0, hi=256.0) * 1024 * 1024,
            env_int("GRID_SERIES_PAGE_MEMO_MAX_ENTRIES", 192, lo=1, hi=1024))


# ── what the build reports ────────────────────────────────────────────────────────────────────────────────────
def note_load(filename):
    """store_helpers.load_product_helper: one file a series build read (any thread)."""
    loads = SERIES_LOADS.get()
    if loads is not None:
        loads.add(str(filename))


def note_build(name):
    notes = SERIES_BUILD_NOTES.get()
    if notes is not None:
        notes[name] = True


def note_frame(product):
    """grid_series_helper: one served frame's identity, which the response does not carry."""
    facts = SERIES_FRAME_FACTS.get()
    if facts is not None:
        facts.append((str(getattr(product, "product_id", None) or ""),
                      bool(getattr(product, "is_dynamic_viewport_product", False)),
                      str(getattr(product, "coverage_scope", None) or ""),
                      str(getattr(product, "cache_hit", None) or "")))


# ── 1. valid-time keys and relabelling ────────────────────────────────────────────────────────────────────────
def valid_times(anchor, hour_key):
    return tuple((anchor + timedelta(hours=h)).strftime(_ISO) for h in hour_key)


_HOUR = re.compile(rb'"hour_offset":(-?\d+)')


def relabel(raw: bytes, frames: int, old_anchor, old_source, new_anchor, new_source):
    """The page's bytes as a build at `new_anchor` would encode them, or None when the labels are not exactly where
    a series page puts them (then the caller rebuilds). Only the three anchor labels change."""
    old_bt = b'"base_time":"' + old_anchor.strftime(_ISO).encode() + b'"'
    old_src = b'"base_time_source":"' + str(old_source).encode() + b'"'
    if raw.count(old_bt) != 1 or raw.count(old_src) != 1 or len(_HOUR.findall(raw)) != frames:
        return None
    delta = int((old_anchor - new_anchor).total_seconds()) // 3600
    out = raw
    if delta:
        out = _HOUR.sub(lambda m: b'"hour_offset":' + str(int(m.group(1)) + delta).encode(), out)
    out = out.replace(old_bt, b'"base_time":"' + new_anchor.strftime(_ISO).encode() + b'"')
    return out.replace(old_src, b'"base_time_source":"' + str(new_source).encode() + b'"')


def relabel_body(body: bytes, gzipped: bool, frames: int, old_anchor, old_source, new_anchor, new_source, level):
    """relabel() on a kept body (worker thread): (body, gzipped, raw_len) or None."""
    raw = gzip.decompress(body) if gzipped else body
    out = relabel(raw, frames, old_anchor, old_source, new_anchor, new_source)
    if out is None:
        return None
    if len(out) >= 500:
        return gzip.compress(out, compresslevel=level), True, len(out)
    return out, False, len(out)


# ── 2. manifest snapshot, diff and dependencies ───────────────────────────────────────────────────────────────
def manifest_snapshot(manifest):
    """{filename: (MODEL, signature)} over every registration field a build can read."""
    snap = {}
    for p in getattr(manifest, "products", None) or ():
        c = p.coverage
        sig = hash((p.model, p.provider, p.domain, p.layer, p.run_time, p.model_run_time, p.model_run_time_status,
                    p.ingested_at, p.valid_time_start, p.valid_time_end, p.resolution, p.freshness_sec,
                    p.is_forecast_authoritative, c.west, c.south, c.east, c.north, p.is_test_fixture, p.is_estimated,
                    repr(p.estimate_basis), p.source_dataset, p.upstream_provider, p.upstream_model, p.region_id,
                    p.coverage_mode, p.tile_id, p.product_id))
        model = (p.model or "").upper()
        prev = snap.get(p.filename)
        snap[p.filename] = (model, sig if prev is None else hash((prev[1], sig)))
    return snap


def manifest_diff(old, new):
    """(models, files) that differ between two snapshots: added, removed or re-registered (a new run re-registers
    the SAME filename, store_helpers._build_product_filename carries no run)."""
    models, files = set(), set()
    for fn in old.keys() | new.keys():
        a, b = old.get(fn), new.get(fn)
        if a != b:
            files.add(fn)
            models.update(m[0] for m in (a, b) if m is not None)
    return models, files


def keeps_through(deps, changed_models, changed_files) -> bool:
    """A kept page survives a manifest change only when it is durable and the change touched nothing it read."""
    if deps is None or not deps.durable:
        return False
    if any(m not in SCOPED_MODELS for m in changed_models):
        return False
    return not (deps.models & changed_models) and not (deps.files & changed_files)


def page_models(model, domain, layer, files, snapshot):
    models = {model.upper()} | {snapshot[f][0] for f in files if f in snapshot}
    from services.weather_pipeline.coarse_gulf_fill import _FILLABLE_LAYERS, _RECIPIENT_MODELS
    if domain.lower() == "marine" and model.upper() in _RECIPIENT_MODELS and layer.lower() in _FILLABLE_LAYERS:
        models.add("GFS")
    return frozenset(models)


def is_durable(facts, notes, n_frames, snapshot, dynamic_ids=frozenset()) -> bool:
    """Every frame reproducible from tracked inputs: a manifest file, or a fresh index hit on an entry the page's
    dependency rows already held when the build started (`dynamic_ids`)."""
    # Any note refuses: live_attempted (the live Open-Meteo lane ran), load_failed (a file the build asked for was not
    # read, so a tier answered in its place: a rebuild seconds later may read it), warm_sharpen_refused (the queue was
    # full: a rebuild may start the sharpen this page would otherwise suppress).
    if len(facts) != n_frames or notes or snapshot is None:
        return False
    for pid, dynamic, scope, cache_hit in facts:
        if not pid or scope == "regional_partial":
            return False
        if dynamic and not (cache_hit == "cache_hit" and pid in dynamic_ids):
            return False
        if not dynamic and pid not in snapshot:
            return False
    return True


def dynamic_ids(rows):
    """The product ids of the index entries a page's build saw under its keys."""
    return frozenset(pid for _, entries in rows or () for pid, _, _ in entries)


# ── 3. the other inputs a build reads ─────────────────────────────────────────────────────────────────────────
def index_path(viewport_service):
    try:
        return str(viewport_service.dynamic_index.index_path)
    except Exception:
        return None


def index_stat(path):
    if not path:
        return None
    try:
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


_INDEX = {"v": (None, {})}      # ONE tuple ((path, stat), by_key), swapped whole: worker threads read it in one load


def index_by_key(path, stat):
    """{cache_key: ((product_id, created_at, expires_at), ...)} of the dynamic-viewport index, parsed once per file
    version (worker thread). A missing or unreadable index is empty, as DynamicProductIndex._load_index reads it."""
    held_key, held = _INDEX["v"]
    if stat is not None and held_key == (path, stat):
        return held
    by_key = {}
    if stat is not None:
        try:
            with open(path, "r") as f:
                items = json.load(f)
        except Exception:
            items = []
        for it in items if isinstance(items, list) else ():
            if isinstance(it, dict):
                by_key.setdefault(it.get("cache_key"), []).append(
                    (str(it.get("product_id")), str(it.get("created_at")), str(it.get("expires_at"))))
    by_key = {k: tuple(sorted(v)) for k, v in by_key.items()}
    _INDEX["v"] = ((path, stat), by_key)
    return by_key


def dynamic_keys(model, domain, layer, snapped, vts):
    """The exact cache keys get_cached_dynamic_product_helper looks up for each frame of this page."""
    from services.weather_pipeline.route_helpers import build_dynamic_cache_key
    from services.weather_pipeline.viewport_helper import dynamic_lookup_box
    w, s, e, n = dynamic_lookup_box(model, snapped)[:4]
    return tuple(build_dynamic_cache_key(model, domain, layer, _dt(vt), w, s, e, n) for vt in vts)


def dynamic_signature(by_key, keys):
    """(entries under the page's keys, the epoch at which the first of them expires or turns stale, or None)."""
    rows = tuple((k, by_key[k]) for k in keys if k in by_key)
    expiries = []
    for _, entries in rows:
        for _, created, exp in entries:
            try:
                expiries.append(min(_dt(exp).timestamp(), _dt(created).timestamp() + DYNAMIC_STALE_S))
            except Exception:
                expiries.append(0.0)       # an unreadable time: treat as already expired (never trust it)
    return rows, (min(expiries) if expiries else None)


def _dt(value):
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def _round_hour(now):
    return datetime.fromtimestamp(round(now.timestamp() / 3600.0) * 3600.0, tz=timezone.utc)


def lane_key(model, domain, layer):
    """The HRRR cycle a GFS wind frame would blend now (None: no lane or not GFS wind). Never raises."""
    if (model.upper(), domain.lower(), layer.lower()) != ("GFS", "wind", "wind"):
        return None
    try:
        from services.weather_pipeline import wind_lane
        if not wind_lane.enabled() or wind_lane.request_mode.get() == "gfs":
            return None
        lane = wind_lane.current_lane()
        return getattr(lane, "key", None) if lane is not None else None
    except Exception:
        return "lane-unreadable"


def request_mode():
    try:
        from services.weather_pipeline.wind_lane import request_mode as mode
        return mode.get()
    except Exception:
        return None


class PageDeps:
    """What one kept page's build read, beyond its key. `anchor`/`source` are the labels its body carries."""
    __slots__ = ("anchor", "source", "frames", "durable", "files", "models", "vts", "model", "domain", "layer", "dyn_keys",
                 "dyn_path", "dyn_stat", "dyn_rows", "dyn_expiry", "lane", "round_hour", "utc_date")

    def __init__(self, **kw):
        for name in self.__slots__:
            setattr(self, name, kw.get(name))


def build_start_state(model, domain, layer, snapped, vts, viewport_service, by_key, stat, path, now):
    """The inputs a build is about to read, captured BEFORE it starts (a change during the build then reads as a
    change at the first hit, never as a page silently filed under the newer state)."""
    keys = dynamic_keys(model, domain, layer, snapped, vts)
    rows, expiry = dynamic_signature(by_key, keys)
    return dict(vts=vts, model=model.upper(), domain=domain.lower(), layer=layer.lower(), dyn_keys=keys, dyn_path=path, dyn_stat=stat,
                dyn_rows=rows, dyn_expiry=expiry, lane=lane_key(model, domain, layer), round_hour=_round_hour(now),
                utc_date=now.date())


def clock_still_valid(deps, now) -> bool:
    """False when the clock has moved across a boundary the resolver reads for one of this page's valid times."""
    limit = _HORIZON_LIMIT_H.get(deps.model) if deps.domain == "marine" else None
    if limit is not None:
        r0, r1 = deps.round_hour, _round_hour(now)
        if r1 != r0:
            for vt in deps.vts:
                t = _dt(vt)
                if (t - r0) > timedelta(hours=limit) >= (t - r1):
                    return False
    if (deps.model, deps.domain) == ("ICON", "wind") and now.date() != deps.utc_date:
        return False
    return True
