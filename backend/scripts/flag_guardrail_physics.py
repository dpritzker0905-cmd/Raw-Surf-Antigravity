"""The PHYSICS guard of flag_guardrail (Plan 4, 2026-11-24; split out of flag_guardrail.py at its 800-line cap).

A PHYSICS-covered flag is judged on the publish-time frame physics check (services/frame_physics_check.py) of the frames its
own ingest published, never on the replay. flag_guardrail imports and re-exports every name here, so callers and tests keep
using flag_guardrail.<name>. Fetched as a sibling of flag_guardrail (scripts/ on sys.path).
"""
from __future__ import annotations

import os

from services.weather_pipeline import guardrail_stats as gs

# PHYSICS (2026-11-24, Plan 4): judged on the publish-time physics check (services/frame_physics_check.py) of the frames the
# flag's own ingest published, not on the replay. Rails pre-registered BEFORE the flag shipped (plan amendment 2026-11-24,
# SubQ / Reflection), far above the measured fixed rate (2-deg R2 1.05 %, R1 0.00 %) and the native rate (R2 1.1-1.3 %):
#   above `worse`  -> WORSE (the usual 2 strikes over >= 24 h disable);   above `breach` -> a sanity breach, disabled at once
#   (back near the unfixed 22 % / 2.5 %). Frames registered before the flag was first seen ON are never judged.
PHYSICS = "physics"
PHYSICS_RAILS = {
    "GFS_PARTITION_MASKED_AS_ZERO": {"model": "GFS", "worse": {"energy_closure": 0.05, "partition_le_total": 0.005},
                                     "breach": {"energy_closure": 0.15, "partition_le_total": 0.02}},
}
PHYSICS_ON_KEY = "__physics_on_since__"   # in the watch cache: when each PHYSICS flag was first seen effectively ON
# GUARD-BLIND (advisor hold on #1267): consecutive guardrail runs a PHYSICS flag was ON but UNTESTABLE (outage, no cells, every
# layer stale). At PHYSICS_BLIND_RUNS (~24 h at 6 h) the run writes a GUARD-BLIND line and guard-blind.txt, and the workflow
# opens ONE issue, closed on the next judged run (guard-judged.txt). It only REPORTS: blindness never disables a flag.
PHYSICS_BLIND_KEY = "__physics_untestable_runs__"
PHYSICS_BLIND_RUNS = 4


def untestable_keeps_strikes(result: dict, breach: list) -> bool:
    """A PHYSICS flag judged UNTESTABLE (no breach): decide() must neither strike nor clear."""
    return result.get("coverage") == PHYSICS and result.get("verdict") == gs.UNTESTABLE and not breach


def untestable_decision(flag: str, result: dict, manifest: dict) -> dict:
    """No evidence either way: KEEP the strike counter and first_worse_at (advisor hold on #1267), so WORSE, UNTESTABLE, WORSE
    still disables (next_watch keeps `keep_watch`). Only a judged NOT_WORSE clears it. Never a disable on its own."""
    kept = ((manifest.get("watch") or {}).get(flag)) or None
    return {"action": "none", "keep_watch": kept,
            "reason": (f"UNTESTABLE (strikes kept: {(kept or {}).get('strikes', 0)}): "
                       f"{'; '.join(result.get('reasons') or [])}")[:400]}


def physics_result(flag: str, report: dict, on_since: str) -> dict:
    """The guardrail result for a PHYSICS flag from one physics-check report (frame_physics_report.run_check). Pure.
    UNTESTABLE when the report failed, holds no cells, or any of the model's frames was registered before `on_since`."""
    rails = PHYSICS_RAILS[flag]
    model = rails["model"]
    if not report or report.get("error"):
        return {"verdict": gs.UNTESTABLE, "reasons": [f"physics check unavailable: {(report or {}).get('error')}"],
                "sanity": [], "coverage": PHYSICS}
    times = [t for k, t in (report.get("index_run_times") or {}).items() if k.startswith(model + "/")]
    skipped = sorted(k for k in (report.get("stale_skipped") or {}) if k.startswith(model + "/"))
    note = [f"skipped (registered before the flag was first seen ON, {on_since}): {', '.join(skipped)}"] if skipped else []
    if not times or not on_since or any((t or "") < on_since for t in times):
        return {"verdict": gs.UNTESTABLE, "sanity": [], "coverage": PHYSICS, "skipped": skipped,
                "reasons": [f"no {model} layer registered after the flag was first seen ON ({on_since}): not judged"] + note}
    m = (report.get("summary") or {}).get(model) or {}
    got = {rule: (m.get(rule) or {}).get("rate") for rule in rails["worse"]}
    cells = (m.get("energy_closure") or {}).get("cells") or 0
    if not cells or any(v is None for v in got.values()):
        return {"verdict": gs.UNTESTABLE, "reasons": [f"no {model} partition cells checked"], "sanity": [], "coverage": PHYSICS}
    line = ", ".join(f"{r} {got[r]:.2%}" for r in sorted(got))
    breach = [f"physics breach: {r} {got[r]:.2%} > {rails['breach'][r]:.2%} ({cells:,} cells, {report.get('frames_read')} frames)"
              for r in sorted(got) if got[r] > rails["breach"][r]]
    worse = [r for r in got if got[r] > rails["worse"][r]]
    verdict = gs.WORSE if worse else gs.NOT_WORSE
    return {"verdict": verdict, "sanity": breach, "coverage": PHYSICS, "physics": got, "skipped": skipped,
            "reasons": [f"physics {line} (rails WORSE {rails['worse']}, breach {rails['breach']})"] + note}


def physics_read(fresh_since=None) -> dict:
    """One physics-check read of the PUBLIC frames bucket (anonymous GETs; the guardrail's own SUPABASE_URL). Layers registered
    before `fresh_since` are skipped and named (frame_physics_report.run_check), so the fresh ones are judged."""
    import frame_physics_report as fpr
    base = os.environ.get("SUPABASE_URL", "").rstrip("/") + "/storage/v1/object/public/weather-frames"
    models = sorted({r["model"] for r in PHYSICS_RAILS.values()})
    return fpr.run_check(fpr.Reader(fpr._public_reader(base), 120), models=tuple(models), fresh_since=fresh_since)


def track_on_since(watch: dict, on_flags: list, now_iso: str):
    """(watch, on_since): when each PHYSICS flag was first seen effectively ON; a flag not ON now loses its stamp, so frames
    built before a re-enable are never judged as the fix's."""
    on_since = dict(watch.get(PHYSICS_ON_KEY) or {})
    for f in PHYSICS_RAILS:
        if f in on_flags:
            on_since.setdefault(f, now_iso)
        else:
            on_since.pop(f, None)
    return dict(watch, **{PHYSICS_ON_KEY: on_since}), on_since


def physics_pass(results: dict, watch: dict, on_since: dict, physics=None):
    """Judge every PHYSICS flag in `results` on one physics-check read each, and count consecutive UNTESTABLE runs
    (GUARD-BLIND at PHYSICS_BLIND_RUNS). Returns (results, watch, guard_blind lines, judged flags). Report only: blindness
    never disables a flag (decide() keeps the strike counter through an UNTESTABLE)."""
    phys = [f for f in results if f in PHYSICS_RAILS]
    blind_runs, guard_blind, guard_judged = dict(watch.get(PHYSICS_BLIND_KEY) or {}), [], []
    for f in phys:
        try:
            preport = (physics or physics_read)(on_since.get(f))
        except Exception as e:                                   # noqa: BLE001 - an outage is UNTESTABLE, never a breach
            preport = {"error": f"{type(e).__name__}: {e}"[:300]}
        results[f] = dict(results[f], **physics_result(f, preport, on_since.get(f)))
        if results[f]["verdict"] == gs.UNTESTABLE and not results[f].get("sanity"):
            blind_runs[f] = int(blind_runs.get(f) or 0) + 1
            if blind_runs[f] >= PHYSICS_BLIND_RUNS:
                guard_blind.append((f"GUARD-BLIND: {f} is ON and its physics guard has judged nothing for {blind_runs[f]} "
                                    f"consecutive runs ({'; '.join(results[f].get('reasons') or [])})")[:600])
        else:
            blind_runs.pop(f, None)
            guard_judged.append(f)
    for f in list(blind_runs):
        if f not in phys:                     # the flag is not ON (or not watched) this run: nothing to be blind about
            blind_runs.pop(f)
    watch = dict(watch, **{PHYSICS_BLIND_KEY: blind_runs})
    return results, watch, guard_blind, guard_judged


def write_guard_files(out: str, report: dict) -> None:
    """guard-blind.txt (non-empty -> the workflow opens ONE GUARD-BLIND issue) and guard-judged.txt (non-empty and no blind line
    -> it closes that issue). Both always written, so a stale file from an earlier step never speaks for this run."""
    for name, rows in (("guard-blind.txt", report.get("guard_blind") or []),
                       ("guard-judged.txt", report.get("guard_judged") or [])):
        with open(os.path.join(out, name), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(rows))
    for line in report.get("guard_blind") or []:
        print(f"::warning title=Flag guardrail GUARD-BLIND::{line[:300]}")
