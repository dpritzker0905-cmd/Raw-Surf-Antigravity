"""The admin's switch board (GET /admin/surf-forecast/switches, P0-3 2026-11-23): EVERY switch, with its TRUE effective
state and where that state comes from. READ-ONLY.

The list is not hand-kept: `switch_scan.build_registry` scans this deployment's code and workflows once per process
(~1 s, off the event loop, only when an admin asks), so a new switch is listed the day it lands
(tests/test_switch_scan_parity.py fails when a read the scan cannot see appears).

For each switch, three places can hold a value, and each row names them separately instead of guessing one:
  * server   what THIS process reads at call time: an explicit env value, else (GUARDED flags only) the runtime
             manifest control/flags.json, else the code default (runtime_flags.resolve).
  * lanes    what each workflow runs with: a literal ('1' in the file), a repository variable (its value from the ops
             snapshot, else the file's fallback when the variable is unset), or "set in CI" when no snapshot has
             been read (the server cannot see repository variables itself).
  * summary  'on' / 'off' / 'mixed' / 'setting' over the places that answer, and `differs_from_default` when any
             answer is not the code default (the "Changed from default" filter reads this, so a lane ON shows).

NEVER A SECRET: names with credential words are never listed (switch_scan.is_secret_name) and every value passes
switch_scan.safe_value (0/1, numbers, boolean words; default-deny); anything else is shown as null.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Dict, Optional

from services import runtime_flags as _rf
from services import switch_scan

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_lock = threading.Lock()
_registry: Dict[str, object] = {"reg": None, "built_at": 0.0, "error": None}


def registry(registered: Optional[dict] = None) -> dict:
    """The scanned registry, built once per process (a deploy is the only thing that changes the code it scans)."""
    with _lock:
        if _registry["reg"] is not None:
            return _registry["reg"]
    reg = switch_scan.build_registry(REPO_ROOT, _rf.GUARDED, {k: v[0] for k, v in (registered or {}).items()})
    with _lock:
        _registry.update(reg=reg, built_at=time.time())
    return reg


def _reset_for_tests():
    with _lock:
        _registry.update(reg=None, built_at=0.0, error=None)


def server_value(name: str, defaults: list) -> dict:
    default = defaults[0] if len(defaults) == 1 else None
    if name in _rf.GUARDED:
        r = _rf.resolve(name, _rf.GUARDED[name])
        return {"value": switch_scan.safe_value(r["value"]), "source": r["source"], "entry": r["entry"]}
    v = os.environ.get(name)
    if v is not None and v != "":
        return {"value": switch_scan.safe_value(v), "source": "env", "entry": None}
    return {"value": default, "source": "default" if default is not None else "unknown", "entry": None}


def lane_value(lane: dict, repo_vars: Optional[dict]) -> dict:
    """{workflow, form, value, source, var?}; value None when the server cannot know it."""
    out = {"workflow": lane["workflow"], "form": lane["form"]}
    if lane["form"] == "literal":
        return dict(out, value=lane.get("value"), source="workflow file")
    if lane["form"] in ("var", "gate"):
        var = lane["var"]
        out["var"] = var
        if repo_vars is None:
            return dict(out, value=None, source="set in CI (no snapshot read)", fallback=lane.get("fallback"))
        if var in repo_vars:
            gate = " (gates the job: it runs only when this holds)" if lane["form"] == "gate" else ""
            shown = repo_vars[var]
            return dict(out, value=shown, source=f"repo variable {var}" + ("" if shown is not None else ", set (value not shown)")
                        + gate)
        if lane["form"] == "gate":
            return dict(out, value=None, source=f"repo variable {var} unset")
        return dict(out, value=lane.get("fallback", ""), source=f"workflow fallback (repo variable {var} unset)")
    return dict(out, value=None, source="set in CI (expression)", vars=lane.get("vars", []))


def summarize(kind: str, defaults: list, server: dict, lanes: list) -> dict:
    values = [lv["value"] for lv in lanes if lv["value"] not in (None, "")]
    if server.get("source") in ("env", "manifest") or not lanes:
        values.append(server.get("value"))
    known = [v for v in values if v is not None]
    default = defaults[0] if len(defaults) == 1 else None
    if kind == "switch":
        states = {("off" if v == "0" else "on") for v in known}
        state = states.pop() if len(states) == 1 else ("mixed" if states else "unknown")
    else:
        state = "setting"
    unknown_lanes = sum(1 for lv in lanes if lv["value"] is None)
    return {"state": state, "differs_from_default": any(v != default for v in known) if default is not None else False,
            "lanes_unknown": unknown_lanes}


def board(repo_vars: Optional[dict], registered: Optional[dict] = None, coverage=None) -> dict:
    """{switches: [...], repo_vars: [...], counts}. `repo_vars` None = no snapshot (lanes read "set in CI")."""
    registered = registered or {}
    reg = registry(registered)
    rows = []
    for name, e in reg.items():
        srv = server_value(name, e["defaults"])
        lanes = [lane_value(x, repo_vars) for x in e["lanes"]]
        kind = e["kind"]
        if kind == "switch" and any(v not in (None, "", "0", "1") for v in [srv["value"]] + [lv["value"] for lv in lanes]):
            kind = "setting"          # an hours margin defaulting to 0 is not an on/off switch (MARINE_EXT_CEILING_MARGIN_H=12)
        e = dict(e, kind=kind)
        r = {"name": name, "kind": e["kind"], "defaults": e["defaults"], "server": srv, "lanes": lanes,
             "repo_vars": e["repo_vars"], "files": e["files"], "file_count": e["file_count"],
             "guarded": e["guarded"], "registered": e["registered"]}
        r.update(summarize(e["kind"], e["defaults"], srv, lanes))
        if name in registered:
            r["controls"], r["where"] = registered[name][1], registered[name][2]
        if e["guarded"]:
            r["fix_version"] = _rf.FIX_VERSION.get(name)
            if coverage is not None:
                r["coverage"] = coverage.get(name)
        rows.append(r)
    readers: Dict[str, list] = {}
    for r in rows:
        for v in r["repo_vars"]:
            readers.setdefault(v, []).append(r["name"])
    names = set(readers) | set(repo_vars or {})
    vars_rows = [{"name": v, "value": (repo_vars or {}).get(v), "set": v in (repo_vars or {}),
                  "read_by": sorted(readers.get(v, []))} for v in sorted(names)]
    counts = {"switches": sum(1 for r in rows if r["kind"] == "switch"),
              "settings": sum(1 for r in rows if r["kind"] != "switch"),
              "registered": sum(1 for r in rows if r["registered"]),
              "unregistered": sum(1 for r in rows if not r["registered"]),
              "differs_from_default": sum(1 for r in rows if r["differs_from_default"]),
              "repo_vars_set": len(repo_vars or {}), "repo_vars_referenced": len(readers)}
    return {"switches": rows, "repo_vars": vars_rows, "counts": counts, "repo_vars_known": repo_vars is not None}
