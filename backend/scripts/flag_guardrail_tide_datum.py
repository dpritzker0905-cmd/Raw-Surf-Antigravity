"""The TIDE_DATUM family of flag_guardrail (gates/tide-mllw-tester-v1.md s5, s10-s12): how the datum-only tester's per-build
record for SURF_TIDE_MLLW_US becomes a decide() result.

The tester itself runs in its own workflow (tide-mllw-tester.yml: it needs pyTMD for NOAA's MF / MM, which this job does
not install) and records one result per new tide build. This module only maps that record:
  WORSE        -> a strike (two builds >= 24 h apart disable, decide()'s STRIKES / STRIKE_SPAN_H)
  b1 b2 b3, FLEET BREACH -> `sanity`: decide() disables at once
  UNTESTABLE, CACHED -> keeps_strikes(): neither strike nor reset
REPORT-ONLY until the repo variable TIDE_DATUM_GUARD_RELEASED='1' (after a human read of a real run with T4 passing).
While the flag is OFF (its code default "0") nothing is decided at all: the tester only PROPOSES (D-087).
"""
from __future__ import annotations

import os

TIDE_DATUM = "tide_datum"
FLAG = "SURF_TIDE_MLLW_US"
CACHED = "CACHED"
RELEASE_ENV = "TIDE_DATUM_GUARD_RELEASED"
UNTESTABLE, WORSE = "UNTESTABLE", "WORSE"


def released() -> bool:
    return os.environ.get(RELEASE_ENV, "") == "1"


def result_from(record: dict, cached: bool = False) -> dict:
    """The decide() result for one tester record ({verdict, sanity, reasons, build})."""
    r = {"verdict": record.get("verdict", UNTESTABLE), "sanity": list(record.get("sanity") or []),
         "reasons": list(record.get("reasons") or []), "coverage": TIDE_DATUM, "build": record.get("build")}
    if cached and r["verdict"] != UNTESTABLE:
        r.update(verdict=CACHED, cached_verdict=record.get("verdict"), sanity=[],
                 reasons=[f"build {record.get('build')} already judged {record.get('verdict')}: no new strike"])
    return r


def report_only(r: dict) -> dict:
    """Before release: a WORSE or a breach is printed, never a strike or a disable (gate s5)."""
    if released() or not (r.get("verdict") == WORSE or r.get("sanity")):
        return r
    held = ([f"WORSE ({'; '.join(r.get('reasons') or [])})"] if r.get("verdict") == WORSE else []) + list(r["sanity"])
    return dict(r, verdict=UNTESTABLE, sanity=[], report_only=held,
                reasons=list(r.get("reasons") or []) + [f"REPORT-ONLY until {RELEASE_ENV}=1: {'; '.join(held)}"[:600]])


def keeps_strikes(result: dict, breach: list) -> bool:
    """A TIDE_DATUM UNTESTABLE or CACHED cycle (no breach): decide() must neither strike nor clear."""
    return result.get("coverage") == TIDE_DATUM and result.get("verdict") in (UNTESTABLE, CACHED) and not breach
