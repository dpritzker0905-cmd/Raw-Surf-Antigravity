"""A synthetic world in the export's schema, for tests and the positive control. Never mixed with real exports
(every row_key starts with "syn-")."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import numpy as np

from .prep import FT


def world(*, seed: int = 7, spots: int = 4, days: int = 12, anchors: dict = None, observers: dict = None,
          p_true: float = 0.6, noise: float = 0.12, reports_per_cell: int = 4) -> list[dict]:
    """Rows with known truth. `anchors`/`observers`: observer_key -> log bias (anchors should average 0)."""
    rng = np.random.default_rng(seed)
    anchors = anchors or {"A1": 0.05, "A2": -0.05, "A3": 0.10, "A4": -0.10}
    observers = observers or {"S1": 0.0, "S2": -0.1, "S3": 0.1, "SPLUS": math.log(1.3)}
    everyone = [(k, b, True) for k, b in anchors.items()] + [(k, b, False) for k, b in observers.items()]
    start = datetime(2026, 12, 1, tzinfo=timezone.utc)
    rows, n = [], 0
    for s in range(spots):
        for d in range(days):
            log_t = math.log(1.0 + 0.8 * rng.random())
            for hour in (7, 10, 13, 16):
                log_t += rng.normal(0, 0.1)
                picks = rng.choice(len(everyone), size=reports_per_cell, replace=False)
                for p in picks:
                    key, b, anchor = everyone[p]
                    y = math.exp(log_t + math.log(p_true) + b + rng.normal(0, noise))
                    n += 1
                    rows.append({
                        "row_key": f"syn-{n}", "observer_key": key, "device_key": f"dev-{key}",
                        "observer_role": "anchor" if anchor else "surfer",
                        "anchor_status_at_obs": "active" if anchor else None, "flow": "blind_v1",
                        "surface": "checkin", "entry_screen": "checkin_modal", "spot_id": f"spot{s}",
                        "spot_lat": 29.0, "spot_lon": 0.0, "spot_country": "X", "spot_region": "Y",
                        "received_at": (start + timedelta(days=d, hours=hour, minutes=int(rng.integers(0, 50)))).isoformat(),
                        "height_value": round(y / FT, 1), "height_unit": "ft", "height_bucket": None,
                        "height_scale": "face", "set_or_avg": "sets", "scale_default": "face",
                        "scale_overridden": False, "normalization_version": "norm_v1", "input_kind": "value",
                        "forecast_shown_before": False, "gps_check": "ok", "gps_distance_m": 50.0,
                        "exif_check": "none", "exif_distance_m": None, "exif_age_s": None, "flags": [],
                        "quality_ok": True, "xp_status": "granted", "corroborated": True, "client_build": "syn",
                    })
    return rows
