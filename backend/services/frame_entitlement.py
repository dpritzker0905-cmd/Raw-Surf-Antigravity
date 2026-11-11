"""frame_entitlement.py: tier entitlement for the static weather frames (O6, 2026-11-11). HELD OFF.

WHY. #782 clamps the API to the caller's tier, but the static frames sit in the PUBLIC bucket `weather-frames` and every
run index lists every frame: anyone holding an index URL can fetch EURO/ICON and the 14-day tail from the CDN. Measured
2026-11-11 on the live latest.json: 152 sets, 12,732 frames, 8,332 (65%) beyond 72 h; every EURO/ICON frame is paid
content at every hour (guest/free = GFS only).

DESIGN (docs/design/O6-static-frame-entitlement.md has the options and the costs). Three classes per frame, from the
model and the forecast LEAD (valid - run), mirrored from forecast_tier_window (the resolver's pinned echo; no new ladder):
  public   GFS (guest models), lead <= guest days * 24 + RUN_MARGIN_H     -> the public bucket, exactly as today
  basic    basic models,      lead <= basic days * 24 + RUN_MARGIN_H     -> the PRIVATE bucket `weather-frames-paid`
  premium  everything else (to the locked 14-day horizon)                -> the private bucket
RUN_MARGIN_H: the class is fixed at publish (content-addressed, carried over across runs), while the tier window rolls
from NOW. A run is up to ~a day old when served, so the margin keeps the public set covering now + 72 h; the cost is
that a guest can read up to RUN_MARGIN_H past 72 h of GFS straight from the CDN (the API clamp and the UI still gate it).
No storage copy is ever needed when time passes.

THE PUBLISHER IS UNTOUCHED: `EntitledSink` wraps its sink. Per-frame files route by the class their PATH names (run and
valid stamps); each index is written twice: the FULL copy to the private bucket (the signer and the next run's carry-over
read it) and a PUBLIC copy whose paid entries keep their valid_time but lose `path`/`offset` and gain `paid: <class>`.
An entry with no path is what today's client already treats as unbuilt: it asks /grid for that hour, and #782's clamp
answers it at the caller's tier. A regional BUNDLE is re-cut into one bundle per class (public bytes stay public).

SIGNING: `routes/weather_frame_urls.py` returns signed URLs for the classes the caller's JWT tier allows, signed ONCE
per (index, class) and shared by every entitled user, so the Smart CDN keeps one cache entry per frame per signing
(Supabase: each token is its own cache key). Kill / hold: GUARDED FRAME_ENTITLEMENT = '0'.
"""
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from services import forecast_tier_window as FTW
from services import runtime_flags as _rf

FLAG = "FRAME_ENTITLEMENT"
PUBLIC_BUCKET = "weather-frames"
PAID_BUCKET = "weather-frames-paid"
RUN_MARGIN_H = 24
CLASSES = ("public", "basic", "premium")
# A class's requirement = (days, models) of the tier the resolver names for it.
_CLASS_TIER = {"public": "guest", "basic": "basic", "premium": "premium"}
_FRAME_RE = re.compile(r"^v1/(?P<model>[a-z]+)/[a-z_]+/[a-z0-9_]+/[a-z0-9_]+/(?P<run>\d{8}T\d{6}Z)/"
                       r"(?P<valid>\d{8}T\d{6}Z)-[0-9a-f]{12}\.bin$")
INDEX_RE = re.compile(r"^v1/[a-z]+/[a-z_]+/[a-z0-9_]+/[a-z0-9_]+/index/\d{8}T\d{6}Z-[0-9a-f]{12}\.json$")


def enabled() -> bool:
    return _rf.flag(FLAG, _rf.GUARDED.get(FLAG, "0")) == "1"


def _parse(ts) -> Optional[datetime]:
    if not ts:
        return None
    s = str(ts)
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z", s)
    if m:
        return datetime(*map(int, m.groups()), tzinfo=timezone.utc)
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)


def class_for(model: str, run, valid) -> str:
    """The class of one frame. Unparseable times are PREMIUM (fail closed: an unknown frame is never made public)."""
    r, v = _parse(run), _parse(valid)
    if r is None or v is None:
        return "premium"
    lead_h = (v - r).total_seconds() / 3600.0
    m = str(model or "").upper()
    for cls in ("public", "basic"):
        tier = _CLASS_TIER[cls]
        if m in FTW.TIER_MODELS[tier] and lead_h <= FTW.TIER_FORECAST_DAYS[tier] * 24 + RUN_MARGIN_H:
            return cls
    return "premium"


def class_for_path(path: str) -> Optional[str]:
    """The class a per-frame object path names, or None when the path is not a per-frame object (index, bundle, latest)."""
    m = _FRAME_RE.match(path or "")
    return class_for(m.group("model"), m.group("run"), m.group("valid")) if m else None


def allowed_classes(tier) -> Tuple[str, ...]:
    """The classes a tier may read: those whose required days AND models the tier's own resolver entry covers."""
    t = FTW.canonical_tier(tier)
    days, models = FTW.TIER_FORECAST_DAYS[t], set(FTW.TIER_MODELS[t])
    return tuple(c for c in CLASSES
                 if FTW.TIER_FORECAST_DAYS[_CLASS_TIER[c]] <= days and set(FTW.TIER_MODELS[_CLASS_TIER[c]]) <= models)


def _sha12(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


def split_index(full: dict, bundle_bytes: Optional[bytes] = None) -> Tuple[dict, dict, Dict[str, bytes]]:
    """PURE. (public index, full index for the private bucket, {object path: bytes} of re-cut class bundles).

    Per-frame index: each paid entry loses `path` in the public copy and gains `paid`. Bundle index: the bundle's bytes
    are re-cut into one bundle per class; the public copy points at the public bundle (or none) with re-based offsets."""
    model, run = full.get("model"), full.get("run")
    frames = full.get("frames") or []
    public = {k: v for k, v in full.items() if k not in ("frames", "bundle")}
    private = dict(full)
    out_bundles: Dict[str, bytes] = {}
    pub_frames, priv_frames = [], []
    bundle = full.get("bundle") if isinstance(full.get("bundle"), dict) else None
    blobs = {c: bytearray() for c in CLASSES}
    for f in frames:
        cls = class_for(model, run, f.get("valid_time"))
        g, p = dict(f), dict(f, entitlement=cls)
        if bundle is not None and f.get("offset") is not None and bundle_bytes is not None:
            seg = bundle_bytes[f["offset"]:f["offset"] + f["length"]]
            off = len(blobs[cls])
            blobs[cls] += seg
            p.update(offset=off, length=len(seg), bundle_class=cls)
            if cls == "public":
                g["offset"] = off
        if cls != "public":
            g.pop("path", None)
            g.update(paid=cls)
            if bundle is not None:
                g.update(offset=None, length=None, sha12=None)
        pub_frames.append(g)
        priv_frames.append(p)
    public["frames"], private["frames"] = pub_frames, priv_frames
    if bundle is not None:
        stem = bundle["path"].rsplit("/", 1)[0]
        class_bundles = {}
        for cls, blob in blobs.items():
            if not blob:
                continue
            b = bytes(blob)
            name = f"bundle-{_sha12(b)}.bin" if cls == "public" else f"bundle-{cls}-{_sha12(b)}.bin"
            class_bundles[cls] = {"path": f"{stem}/{name}", "bytes": len(b), "sha12": _sha12(b)}
            out_bundles[class_bundles[cls]["path"]] = b
        public["bundle"] = class_bundles.get("public")
        private["bundle"], private["bundles"] = bundle, class_bundles
    return public, private, out_bundles


def class_bundle_paths(index: Optional[dict]) -> set:
    return {b["path"] for b in ((index or {}).get("bundles") or {}).values() if b and b.get("path")}


class EntitledSink:
    """Wraps the publisher's sink (write/read/list/delete) and routes every object to the bucket its class allows."""

    def __init__(self, public_sink, paid_sink):
        import threading
        self.public, self.paid = public_sink, paid_sink
        self._bundles: Dict[str, bytes] = {}
        self._keep: set = set()          # re-cut bundles written or named this run: never retention-deleted
        self._lock = threading.Lock()    # the publisher's uploader writes frames from a thread pool

    def ensure_bucket(self):
        self.public.ensure_bucket()
        self.paid.ensure_bucket()

    def write(self, path, data, ctype, cache):
        if path.endswith(".bin") and "/bundle-" in path:
            with self._lock:
                self._bundles[path] = data   # the full bundle: written re-cut, with its index
            return None
        cls = class_for_path(path)
        if cls is not None:
            return (self.public if cls == "public" else self.paid).write(path, data, ctype, cache)
        if INDEX_RE.match(path):
            full = json.loads(data)
            bundle = (full.get("bundle") or {}).get("path") if isinstance(full.get("bundle"), dict) else None
            public, private, recut = split_index(full, self._bundles.pop(bundle, None) if bundle else None)
            for bpath, blob in recut.items():
                (self.public if bpath == (public.get("bundle") or {}).get("path") else self.paid).write(
                    bpath, blob, "application/octet-stream", cache)
                with self._lock:
                    self._keep.add(bpath)
            self.paid.write(path, json.dumps(private, sort_keys=True, separators=(",", ":")).encode(), ctype, cache)
            return self.public.write(path, json.dumps(public, sort_keys=True, separators=(",", ":")).encode(), ctype, cache)
        return self.public.write(path, data, ctype, cache)

    def read(self, path):
        if INDEX_RE.match(path or ""):
            raw = self.paid.read(path)
            if raw:
                try:
                    self._keep |= class_bundle_paths(json.loads(raw))
                except ValueError:
                    pass
                return raw
        return self.public.read(path)

    def list(self, prefix):
        return sorted(set(self.public.list(prefix) or []) | set(self.paid.list(prefix) or []))

    def delete(self, paths: Iterable[str]):
        gone = [p for p in paths if p not in self._keep]
        if gone:
            self.public.delete(gone)
            self.paid.delete(gone)


def paid_items(full: dict, classes: Iterable[str]) -> List[dict]:
    """The entries of a FULL index a caller entitled to `classes` may fetch, with the object each lives in."""
    want = set(classes) - {"public"}
    bundles = full.get("bundles") or {}
    out = []
    for f in full.get("frames") or []:
        cls = f.get("entitlement")
        if cls not in want:
            continue
        if f.get("bundle_class"):
            b = bundles.get(f["bundle_class"]) or {}
            if b.get("path") and f.get("offset") is not None:
                out.append({"valid_time": f.get("valid_time"), "is_estimated": f.get("is_estimated"), "class": cls,
                            "object": b["path"], "bundle_bytes": b.get("bytes"), "offset": f["offset"],
                            "length": f["length"], "sha12": f.get("sha12")})
        elif f.get("path"):
            out.append({"valid_time": f.get("valid_time"), "is_estimated": f.get("is_estimated"), "class": cls,
                        "object": f["path"]})
    return out
