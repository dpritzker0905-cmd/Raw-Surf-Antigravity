"""Private, pseudonymized export of blind surf observations for the offline truth model (T1 P4).

WHAT LEAVES THE DATABASE, and only into PRIVATE storage (`weather-products`, not public; the same bucket #948's
private nearshore rows use), under `surf-truth/exports/<YYYY-MM-DD>/<run_id>.jsonl` plus a `.manifest.json`:
- per row: the RAW entry (value + unit or bucket, scale, typical/sets), the server's scale default and override,
  normalization version, entry screen, forecast_shown_before, the quality flags, distances AS BANDS (never exact
  metres: see DISTANCE_BANDS, California precise geolocation) and the photo's age, quality/XP
  status, the observer ROLE and the anchor status AT `received_at` (read from the append-only event log, not today's
  row), the spot (a public catalogue id plus its public coordinates and region, needed for local time and class),
  and `received_at` ROUNDED DOWN TO THE MINUTE (the model needs 3-hour cells; seconds would only aid re-linking).
- identities only as HMAC-SHA256 pseudonyms (`observer_key`, `device_key`, `row_key`) under the key in the
  environment variable SURF_TRUTH_EXPORT_KEY. The key never enters the repo or the export; without it the export
  refuses to run (fail closed), so a missing key can never produce raw ids.
NEVER exported: names, profile ids, device or photo positions, exact distances or the 500 m gps_check (only distance
bands of 1 km and wider), photo URLs, the converted `face_m`
(the model fits from the raw entry), and any row the model's own outputs produced (there are none: outputs are not
observations).

PSEUDONYMOUS IS NOT ANONYMOUS. Each row keeps a spot, a minute and a stable observer key, so anyone holding the
database can re-identify rows by joining on spot and time, and a regular at one break is recognisable from the pattern.
The export is PERSONAL DATA in private storage and is handled as such: private bucket only, service-role access only,
never published, never copied into the repo or an artifact. RETENTION (owner, 2026-11-18): the 3 newest exports are
kept; after an account deletion a fresh export replaces every older one within 7 days (services/surf_truth_retention,
a daily job). CONSENT: only rows whose observer opted in, then and now (services/surf_truth_consent).
KEY ROTATION: a new SURF_TRUTH_EXPORT_KEY gives every observer a new key, so b_j does not carry across the change.
A rotation therefore means a FULL re-export, and fits never mix exports made under different keys (the manifest
records a key fingerprint for exactly that check).
ORPHANS: the data object is written first, then the manifest, then the admin log line. A failure in between leaves a
data object with no manifest (or no log line). The fit reads ONLY exports that have a manifest, so an orphan is ignored
and harmless; it is removed by the retention rule.

Pure functions build the rows; `write_export` does the one create-only upload. The caller (an admin route) logs it.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional
from urllib.parse import quote

import httpx
from sqlalchemy import select

from models import SurfObservation, SurfSpot, SurfTruthAnchorEvent
from services import surf_truth_consent

SCHEMA = "raw-surf/surf-truth-export/2"   # 2 (2026-11-18): distances only as bands; gps_check dropped
KEY_ENV = "SURF_TRUTH_EXPORT_KEY"
BUCKET = "weather-products"
PREFIX = "surf-truth/exports"
MIN_KEY_BYTES = 32
FIELDS = (
    "row_key", "observer_key", "device_key", "observer_role", "anchor_status_at_obs", "flow", "surface",
    "entry_screen", "spot_id", "spot_lat", "spot_lon", "spot_country", "spot_region", "received_at",
    "height_value", "height_unit", "height_bucket", "height_scale", "set_or_avg", "scale_default",
    "scale_overridden", "normalization_version", "input_kind", "forecast_shown_before",
    "gps_distance_band", "exif_check", "exif_distance_band", "exif_age_s", "flags", "quality_ok", "xp_status",
    "corroborated", "client_build",
)

# DISTANCE BANDS (schema 2, legal research 2026-11-18). California treats data that locates a person within a circle
# of radius 1,850 ft (~564 m) as PRECISE GEOLOCATION, which is sensitive personal information (Civ. Code
# 1798.140(w), (ae)(1)(C)). The spot is a published point and received_at is to the minute, so an exact distance
# (or a check meaning "within 500 m") would place the person precisely. Exported distances are therefore bands whose
# narrowest is a 1 km radius: wider than 564 m even when the sea removes half the disc (pi*1000^2/2 > pi*564^2).
# The edges are the thresholds the code already uses, so nothing the model needs is lost:
#   1 km  = the observation route's EXIF_OK_M (the photo "ok" radius; exif_check stays, its "ok" IS "<1 km");
#   2 km  = the pre-registered fit's exclusion (#989: drop rows with GPS > 2 km; edges inclusive so ">2000" survives
#           exactly: a band of "1-2 km" holds 1000..2000 m, "2-10 km" starts above 2000 m);
#   10 km = the route's GPS_NEAR_M ("far" beyond it, also carried by the gps_far flag).
# gps_check is not exported: its "ok" means within 500 m (GPS_OK_M), a circle smaller than California's, and every
# other value is carried by the band (None = no position) and the gps_missing / gps_far flags.
DISTANCE_BANDS = ((1000.0, "<1 km"), (2000.0, "1-2 km"), (10000.0, "2-10 km"))
FAR_BAND = ">10 km"


def distance_band(metres: Optional[float]) -> Optional[str]:
    """Exact metres -> the export's band label (None stays None). 1000 m is '1-2 km'; 2000 m is '1-2 km' (inclusive
    upper edge, matching the fit's '> 2000 m' exclusion); 10000 m is '2-10 km'."""
    if metres is None:
        return None
    if metres < DISTANCE_BANDS[0][0]:
        return DISTANCE_BANDS[0][1]
    for edge, label in DISTANCE_BANDS[1:]:
        if metres <= edge:
            return label
    return FAR_BAND


class ExportUnavailable(RuntimeError):
    """The export cannot run safely (no pseudonym key, or no private storage). The route answers 503."""


def export_key() -> bytes:
    raw = os.environ.get(KEY_ENV, "")
    if len(raw.encode()) < MIN_KEY_BYTES:
        raise ExportUnavailable(f"{KEY_ENV} is not set (or shorter than {MIN_KEY_BYTES} bytes); export refused")
    return raw.encode()


def pseudonym(key: bytes, kind: str, value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return hmac.new(key, f"{kind}:{value}".encode(), hashlib.sha256).hexdigest()[:24]


def _aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def index_events(events: Iterable[SurfTruthAnchorEvent]) -> dict:
    """profile_id -> [(at, to_status)] in time order, so a lookup costs one profile's events, not all of them."""
    by_profile: dict = {}
    for e in events:
        by_profile.setdefault(e.profile_id, []).append((_aware(e.at), e.to_status))
    for history in by_profile.values():
        history.sort(key=lambda t: t[0])
    return by_profile


def anchor_status_at(index: dict, profile_id: str, when: datetime) -> Optional[str]:
    """The anchor's status in force at `when` (the last event at or before it), or None if never an anchor then."""
    status = None
    for at, to_status in index.get(profile_id, ()):
        if at > when:
            break
        status = to_status
    return status


def key_fingerprint(key: bytes) -> str:
    """A short, non-reversible id of the pseudonym key, so a fit can refuse to mix exports made under two keys."""
    return hmac.new(key, b"fingerprint", hashlib.sha256).hexdigest()[:12]


def export_row(key: bytes, obs: SurfObservation, spot: Optional[SurfSpot], anchor_status: Optional[str]) -> dict:
    received = _aware(obs.received_at).replace(second=0, microsecond=0)
    row = {
        "row_key": pseudonym(key, "row", obs.id),
        "observer_key": pseudonym(key, "observer", obs.user_id),
        "device_key": pseudonym(key, "device", obs.device_hash),
        "observer_role": obs.observer_role,
        "anchor_status_at_obs": anchor_status,
        "flow": obs.flow, "surface": obs.surface, "entry_screen": obs.entry_screen, "spot_id": obs.spot_id,
        "spot_lat": spot.latitude if spot else None, "spot_lon": spot.longitude if spot else None,
        "spot_country": spot.country if spot else None, "spot_region": spot.state_province if spot else None,
        "received_at": received.isoformat(),
        "height_value": obs.height_value, "height_unit": obs.height_unit, "height_bucket": obs.height_bucket,
        "height_scale": obs.height_scale, "set_or_avg": obs.set_or_avg, "scale_default": obs.scale_default,
        "scale_overridden": obs.scale_overridden, "normalization_version": obs.normalization_version,
        "input_kind": obs.input_kind, "forecast_shown_before": obs.forecast_shown_before,
        "gps_distance_band": distance_band(obs.gps_distance_m), "exif_check": obs.exif_check,
        "exif_distance_band": distance_band(obs.exif_distance_m), "exif_age_s": obs.exif_age_s,
        "flags": [f for f in (obs.flags or "").split(",") if f], "quality_ok": obs.quality_ok,
        "xp_status": obs.xp_status, "corroborated": obs.corroborated, "client_build": obs.client_build,
    }
    assert tuple(row) == FIELDS  # the schema is the contract with the fit; nothing extra can slip in
    return row


async def build_export(db, key: bytes, since: Optional[datetime] = None) -> tuple[list[dict], dict]:
    # cut_at is taken BEFORE the rows are read (advisor hold on #1034): a deletion or withdrawal that commits while the
    # query runs is then later than cut_at, so retention still sees this export as needing replacement.
    cut_at = datetime.now(timezone.utc)
    q = select(SurfObservation).where(SurfObservation.flow == "blind_v1").order_by(SurfObservation.received_at)
    if since is not None:
        q = q.where(SurfObservation.received_at >= since)
    candidates = (await db.execute(q)).scalars().all()
    # P3 consent: a row leaves only if the person had opted in when it was made AND is still opted in now, so a
    # withdrawal stops every later export from using any of their rows. No choice recorded means no (opt-in).
    consenting = await surf_truth_consent.granted_now(db, {r.user_id for r in candidates if r.consent_training})
    rows = [r for r in candidates if r.consent_training and r.user_id in consenting]
    spots ={s.id: s for s in (await db.execute(select(SurfSpot).where(
        SurfSpot.id.in_({r.spot_id for r in rows if r.spot_id})))).scalars().all()} if rows else {}
    users = {r.user_id for r in rows}
    events = index_events((await db.execute(select(SurfTruthAnchorEvent).where(
        SurfTruthAnchorEvent.profile_id.in_(users)))).scalars().all()) if users else {}
    out = []
    for r in rows:
        out.append(export_row(key, r, spots.get(r.spot_id), anchor_status_at(events, r.user_id, _aware(r.received_at))))
    manifest = {
        "schema": SCHEMA, "rows": len(out), "since": since.isoformat() if since else None,
        "cut_at": cut_at.isoformat(), "fields": list(FIELDS),
        "observers": len({o["observer_key"] for o in out}), "spots": len({o["spot_id"] for o in out}),
        "pseudonyms": "HMAC-SHA256 under " + KEY_ENV + " (key not in the export)",
        "key_fingerprint": key_fingerprint(key), "received_at_resolution": "minute",
        "distance_bands": [label for _e, label in DISTANCE_BANDS] + [FAR_BAND],
        "consent_rule": "opted in when received AND opted in at export (services/surf_truth_consent)",
        "excluded_no_consent": len(candidates) - len(rows),
    }
    return out, manifest


def object_names(now: datetime, run_id: str) -> tuple[str, str]:
    base = f"{PREFIX}/{now.strftime('%Y-%m-%d')}/{run_id}"
    return f"{base}.jsonl", f"{base}.manifest.json"


async def write_export(rows: list[dict], manifest: dict, now: Optional[datetime] = None) -> dict:
    """Create-only upload of the rows and the manifest to PRIVATE storage. Returns the object names."""
    from services.private_media import _storage_auth_headers, _storage_settings
    base, service_key = _storage_settings()
    if not base or not service_key:
        raise ExportUnavailable("private storage is not configured; export refused")
    now = now or datetime.now(timezone.utc)
    run_id = uuid.uuid4().hex[:12]
    data_name, manifest_name = object_names(now, run_id)
    manifest = {**manifest, "run_id": run_id, "data_object": data_name}
    body = "".join(json.dumps(r, separators=(",", ":"), sort_keys=True) + "\n" for r in rows).encode()
    async with httpx.AsyncClient(timeout=60.0) as client:
        for name, content, ctype in ((data_name, body, "application/x-ndjson"),
                                     (manifest_name, json.dumps(manifest, indent=1).encode(), "application/json")):
            r = await client.post(f"{base}/storage/v1/object/{BUCKET}/{quote(name, safe='/')}",
                                  headers={**_storage_auth_headers(service_key), "Content-Type": ctype,
                                           "x-upsert": "false"}, content=content)
            if r.status_code not in (200, 201):
                raise ExportUnavailable(f"private storage refused the upload (status {r.status_code})")
    return {"run_id": run_id, "data_object": data_name, "manifest_object": manifest_name, "rows": len(rows)}
