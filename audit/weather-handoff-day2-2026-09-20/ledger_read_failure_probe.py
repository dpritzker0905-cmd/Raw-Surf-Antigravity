"""Offline actual-ledger reproduction of read-failure/empty-archive conflation.

All HTTP GETs are fake; upload_calibration_l2 serializes into a captured in-memory
store. Nothing calls Supabase or modifies source/tests. Run from backend.
"""
import asyncio
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timezone
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
import requests
from services.weather_pipeline import buoy_calibration as bc, forecast_skill as fs

BASELINE = "d82032f5cd5978967622721b8c9638da36a87f7d"
PINNED_SOURCES = {}
# Load the exact original modules into this disposable offline process. No
# checkout/source file is changed, and repaired working-tree functions are not
# accidentally substituted into the saved baseline experiment.
for module, relative in ((bc, "backend/services/weather_pipeline/buoy_calibration.py"),
                         (fs, "backend/services/weather_pipeline/forecast_skill.py")):
    source = subprocess.check_output(["git", "show", f"{BASELINE}:{relative}"], cwd=ROOT)
    PINNED_SOURCES[relative] = hashlib.sha256(source).hexdigest()
    exec(compile(source.decode("utf-8"), f"{BASELINE}:{relative}", "exec"), module.__dict__)

NOW = datetime(2026, 9, 20, 12, tzinfo=timezone.utc)
MONTH = fs.SKILL_SCORED_PREFIX + "2026-09.json"
PENDING = fs.SKILL_PENDING_L2_KEY


def row(day, buoy):
    return {"source": fs.SOURCE_OURS, "buoy_id": buoy,
            "target_time": f"2026-09-{day:02}T12:00:00Z", "lead_h": 24,
            "hs_m": 1.6, "tp_s": 12., "obs_time": f"2026-09-{day:02}T12:00:00Z",
            "obs_hs_m": 1.5, "err_m": .1}


async def exercise(mode, failed_key=MONTH):
    archive = [row(1, "old-a"), row(2, "old-b")]
    pending = {k: v for k, v in row(20, "new").items() if k not in ("obs_time", "obs_hs_m", "err_m")}
    objects = {MONTH: deepcopy(archive), PENDING: [pending]}
    if mode == "true_404":
        objects.pop(failed_key)
    before = deepcopy(objects)
    writes, reads = [], []

    def get(url, **kwargs):
        assert url.startswith("https://offline-probe.invalid/"), "unexpected HTTP target"
        key = next(k for k in (MONTH, PENDING) if url.endswith(k))
        fail = key == failed_key
        reads.append({"key": key, "mode": mode if fail else "healthy"})
        if fail and mode == "timeout":
            raise requests.Timeout("synthetic read timeout")
        status = 503 if fail and mode == "http_503" else (404 if key not in objects else 200)

        def decoded():
            if fail and mode == "bad_json":
                raise ValueError("synthetic invalid JSON")
            return deepcopy(objects.get(key))

        return SimpleNamespace(status_code=status, json=decoded)

    def captured_upload(key, data):
        payload = json.loads(data)
        writes.append({"key": key, "row_count": len(payload),
                       "buoys": [r["buoy_id"] for r in payload]})
        objects[key] = payload  # The actual store uses x-upsert:true for this object key.

    report = {"spots": [{"buoy_id": "new", "buoy_time": NOW.isoformat(),
                          "residual": {"buoy_wvht_m": 1.5, "buoy_dpd_s": 12.}}]}
    with ExitStack() as stack:
        # Dummy-only child-process settings; no real credential is read, emitted or used.
        stack.enter_context(patch.dict(os.environ, {"SUPABASE_URL": "https://offline-probe.invalid",
                                                    "SUPABASE_SERVICE_ROLE_KEY": "offline-placeholder"}))
        stack.enter_context(patch("requests.get", side_effect=get))
        stack.enter_context(patch.object(bc, "calibrate_spots", AsyncMock(return_value={})))
        stack.enter_context(patch.object(bc, "fetch_ndbc_station_coords", AsyncMock(return_value={})))
        stack.enter_context(patch.object(fs, "fetch_om_forecast_rows", return_value=[]))
        stack.enter_context(patch.object(fs, "persistence_rows_from_report", return_value=[]))
        # Neither the real load helper nor real serializer is replaced.
        result = await fs.run_skill_ledger(SimpleNamespace(_upload_to_supabase=captured_upload),
                                          None, [], "GFS", report, now=NOW)
    return {"mode": mode, "failed_key": failed_key, "reads": reads, "captured_writes": writes,
            "month_rows_before": len(before.get(MONTH, [])), "month_rows_after": len(objects.get(MONTH, [])),
            "old_month_buoys_retained": [r["buoy_id"] for r in objects.get(MONTH, []) if r["buoy_id"].startswith("old")],
            "pending_rows_before": len(before.get(PENDING, [])), "pending_rows_after": len(objects.get(PENDING, [])),
            "ledger_result": result}


async def main():
    cases = [await exercise(mode) for mode in ("healthy", "true_404", "http_503", "timeout", "bad_json")]
    cases.append(await exercise("timeout", failed_key=PENDING))
    assert cases[0]["month_rows_after"] == 3 and len(cases[0]["old_month_buoys_retained"]) == 2
    assert all(c["month_rows_after"] == 1 and not c["old_month_buoys_retained"] for c in cases[2:5])
    assert cases[-1]["pending_rows_before"] == 1 and cases[-1]["pending_rows_after"] == 0
    out = {"source_sha": BASELINE, "pinned_source_sha256": PINNED_SOURCES,
           "working_tree_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
           "scope": "actual loader, ledger and upload serializer; all HTTP mocked; upsert captured in memory; no production incident attribution",
           "cases": cases}
    destination = Path(__file__).with_name("ledger-read-failure-replay.json")
    destination.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(destination)
    for case in cases:
        print(case["mode"], case["failed_key"], "month", case["month_rows_before"], "->", case["month_rows_after"],
              "pending", case["pending_rows_before"], "->", case["pending_rows_after"])


if __name__ == "__main__":
    asyncio.run(main())
