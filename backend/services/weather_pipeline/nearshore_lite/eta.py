"""LITE_ETA input: the tide level eta (m, mean-sea-level frame) from OUR OWN table, read-only (gate section 1a, arm `LITE_ETA`).

Source (director ruling 2026-11-22; nothing new is fetched): `tide_own.py`'s weather-bucket object `tide_own/series.json.gz`,
schema "raw-surf/tide-own/2", series `am` = FES2022b ocean tide + long-period equilibrium + the 2016-2025 altimetry mean level,
in a MEAN-SEA-LEVEL frame, hourly, 0.1-degree keys (`tide._round_key`). The `cmems` series sits above the geoid, a different frame, and is
never used here. The table ROLLS (about 3 days back to 45 ahead), so eta for each TEST init must be read AT that init and hashed
into the forward archive: `eta_for_init` returns the slice and the sha256 of exactly what was read.

PURE: the caller supplies the decoded table (`tide_own.validate(doc)`); the CI job does the bucket read with its secrets.
`LITE_ETA` adds eta to the target depth for SHOALING only (rays stay on the MSL surface); that arithmetic is the scorer's.
"""
import hashlib
import json
from datetime import timedelta

SOURCE = "am"
MAX_LEAD_H = 72


class EtaUnavailable(RuntimeError):
    """The table is missing, too old, or has no `am` series for the key. Never substituted from another source."""


def round_key(lat, lon):
    """tide._round_key, restated so this module has no import-time dependency on the serving tide code."""
    return (round(float(lat), 1), round(float(lon), 1))


def eta_for_init(table, lat, lon, init, leads_h=range(0, MAX_LEAD_H + 1)):
    """Hourly eta (m) at `init + lead` for each lead, from the `am` series only.
    Returns dict(key, source, generated_at, times, eta_m (None where the series has no value), missing, slice_sha256).
    Raises EtaUnavailable when the table or key has no `am` series (honest: no tide, never another source)."""
    from services.weather_pipeline import tide_own
    s = tide_own.series_from_table(table, round_key(lat, lon), forecast_days=5, now=init, prefer_cmems=False)
    if s is None or s.get("source") != SOURCE:
        raise EtaUnavailable(f"no `{SOURCE}` tide series for key {round_key(lat, lon)} at {init.isoformat()}")
    by_time = dict(zip(s["time"], s["level"]))
    times, eta = [], []
    for h in leads_h:
        t = (init + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00")
        times.append(t)
        v = by_time.get(t)
        eta.append(None if v is None else round(float(v), 4))
    body = {"key": list(round_key(lat, lon)), "source": SOURCE, "times": times, "eta_m": eta}
    sha = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"key": list(round_key(lat, lon)), "source": SOURCE, "frame": "mean sea level",
            "generated_at": table["generated_at"].isoformat(), "times": times, "eta_m": eta,
            "missing": sum(v is None for v in eta), "slice_sha256": sha}
