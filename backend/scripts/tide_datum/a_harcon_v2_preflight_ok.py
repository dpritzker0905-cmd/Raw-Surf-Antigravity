"""Refuse the v2 run unless the committed pre-flight PASSED (gates/tide-a-harcon-v2.md §6, §7).

Reads research/tide-a-harcon-v2-preflight-result.json (committed BEFORE any v2 tag, from the pre-flight's artifact).
Exit 0 only if it exists, is complete, carries verdict.status == "PASS", and its verdict recomputes from its own
records (a_harcon_v2.preflight_verdict), so an edited status cannot pass. Otherwise exit 2: no v2 run.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import a_harcon_v2 as V2  # noqa: E402

RESULT = HERE.parents[2] / "docs" / "weather-program" / "research" / "tide-a-harcon-v2-preflight-result.json"


def check(path=RESULT):
    """(ok, why)."""
    p = Path(path)
    if not p.exists():
        return False, f"no committed pre-flight result at {p.name}"
    doc = json.loads(p.read_text(encoding="utf-8"))
    if not doc.get("complete"):
        return False, "the pre-flight result is not complete"
    again = V2.preflight_verdict(doc.get("records") or {})
    if (doc.get("verdict") or {}).get("status") != "PASS" or again["status"] != "PASS":
        return False, f"the pre-flight did not PASS (stored {(doc.get('verdict') or {}).get('status')}, recomputed {again['status']})"
    return True, f"pre-flight PASS: {again['tested']} tested"


def main():
    ok, why = check()
    print(("OK: " if ok else "REFUSED: ") + why)
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
