"""The rows of the admin Surf Forecast flag board (GET /admin/surf-forecast/status), built from `_RATING_FLAGS`.

One row per registered flag, saying what the SERVE BOX sees and how much that says:
- `value` is the effective string (D-065 precedence for GUARDED flags: env > runtime manifest > code default), and
  `kind` says how to read it: 'switch' for 0/1 flags, 'setting' for numbers or words (a refraction coefficient, a
  radius), which an on/off badge would misreport.
- `source` (env / manifest / default) and, for a manifest value, the guardrail's own entry (state, reason, set_by,
  set_at, evidence): an automatic OFF is shown WITH its reason, never as an anonymous "overridden".
- `fix_version` for GUARDED flags: a guardrail OFF is cleared by a new fix version or the owner's word.
- `serve_box_value` is False when the flag is read only by a workflow lane (its `where` names no Render env and no
  manifest): the value shown is this server's copy, which says nothing about the lane's.
"""
from __future__ import annotations

import os

from services import runtime_flags as _rf

_SWITCH_VALUES = {"0", "1"}


def _entry(entry):
    if not isinstance(entry, dict):
        return None
    return {k: entry.get(k) for k in _rf.ENTRY_KEYS}


def serve_box_reads(where: str, guarded: bool) -> bool:
    w = (where or "").lower()
    if guarded or "manifest" in w:
        return True
    return "render" in w and "not render" not in w


def flag_row(name: str, default: str, controls: str, where: str) -> dict:
    guarded = name in _rf.GUARDED
    r = (_rf.resolve(name, default) if guarded
         else {"value": os.environ.get(name, default), "source": "env" if name in os.environ else "default",
               "entry": None})
    value = r["value"]
    kind = "switch" if value in _SWITCH_VALUES and str(default) in _SWITCH_VALUES else "setting"
    return {"name": name, "value": value, "default": default, "kind": kind,
            "active": value != "0",               # kept for older clients; meaningful only when kind == 'switch'
            "differs_from_default": value != default, "source": r["source"], "manifest_entry": _entry(r["entry"]),
            "guarded": guarded, "fix_version": _rf.FIX_VERSION.get(name) if guarded else None,
            "serve_box_value": serve_box_reads(where, guarded), "controls": controls, "where": where}


def flag_rows(registry: dict) -> list:
    return [flag_row(name, default, controls, where) for name, (default, controls, where) in registry.items()]
