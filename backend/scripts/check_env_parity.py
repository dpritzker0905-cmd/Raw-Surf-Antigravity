#!/usr/bin/env python3
"""
Is THIS interpreter the environment the repo declares?

⚠️ WHY THIS EXISTS. "It passes locally" has been mistaken for evidence about CI three times in one
stretch (see requirements-dev.txt's own header, and standing rule 29): an undeclared pytest-timeout,
two files that passed here and failed on the runner, and a MIN_PASSED floor set from a local count.
Measured 2026-08-06 on the workstation those happened on: of 34 `==` pins in requirements.txt,
**3 matched**. 27 differed, 4 were absent, and the interpreter was Python 3.14 against CI's 3.11.
`stripe` 8.11 -> 15.1, `uvicorn` 0.25 -> 0.47, `bcrypt` 4.1.3 -> 3.2.2 (a DOWNGRADE).

★ THE ROOT IS NOT THE PINS, IT IS THE PROVENANCE. That machine has no project virtualenv at all --
  `sys.prefix == sys.base_prefix` and the packages live in a user-global site-packages. Nothing
  there reads requirements.txt, so no pin could have changed what got imported. Pinning is worth
  doing for CI and production reproducibility; it is NOT the fix for a local/CI gap, and believing
  otherwise is how the gap survives.

⇒ So this is an INSTRUMENT, not a gate. When a class keeps recurring the missing thing is usually
  an instrument (standing rule 13). It runs at pytest session start and says nothing when the
  environment matches, so it stays readable and does not join the diagnostics nobody reads.

REFUSAL (standing rule 27): a check that cannot tell "not sampled" from "broken" must refuse. If the
requirements files or the CI workflow cannot be read, this reports UNKNOWN and exits 2. It never
reports parity it did not verify.
"""
from __future__ import annotations

import argparse
import re
import sys
from importlib import metadata
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
REQ_FILES = ("requirements.txt", "requirements-dev.txt")
# The CI workflow is the SOURCE OF TRUTH for the interpreter, so read it rather than keeping a
# second copy here that can drift. A duplicate declaration is the very defect this script reports.
CI_WORKFLOW = REPO / ".github" / "workflows" / "ci.yml"
# ⚠️ THE CHAIN IS local -> CI -> PRODUCTION, AND CHECKING ONLY THE FIRST LINK ANSWERS AN ADJACENT
# QUESTION. Measured 2026-08-06: ci.yml runs 3.11 while render.yaml declares PYTHON_VERSION 3.12.0,
# so a green CI run is not evidence about the interpreter production actually uses. Read both.
RENDER_BLUEPRINT = REPO / "render.yaml"

_PIN = re.compile(r"^([A-Za-z0-9_.\-]+)\s*\[?[^\]]*\]?\s*==\s*([^\s;#]+)")
_FLOAT = re.compile(r"^([A-Za-z0-9_.\-]+)\s*\[?[^\]]*\]?\s*(>=|>|~=|!=|<)\s*([^\s;#]+)")


class Refused(Exception):
    """Preconditions absent. Report UNKNOWN rather than a parity we cannot verify."""


def read_requirements() -> tuple[dict[str, str], dict[str, str]]:
    pinned: dict[str, str] = {}
    floating: dict[str, str] = {}
    seen_any = False
    for name in REQ_FILES:
        path = BACKEND / name
        if not path.exists():
            raise Refused(f"{path} not found")
        seen_any = True
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.split("#")[0].strip()
            if not line or line.startswith("-"):
                continue
            m = _PIN.match(line)
            if m:
                pinned[m.group(1).lower()] = m.group(2)
                continue
            m = _FLOAT.match(line)
            if m:
                floating[m.group(1).lower()] = line
    if not seen_any or not pinned:
        raise Refused("no pinned requirements parsed - the format is not what this script expects")
    return pinned, floating


def declared_python() -> str:
    """The interpreter CI actually sets up. Refuses rather than guessing a default."""
    if not CI_WORKFLOW.exists():
        raise Refused(f"{CI_WORKFLOW} not found")
    versions = set(re.findall(r"python-version:\s*'([0-9]+\.[0-9]+)'", CI_WORKFLOW.read_text(encoding="utf-8")))
    if len(versions) != 1:
        raise Refused(f"ci.yml declares {len(versions) or 'no'} distinct python-version values: {sorted(versions)}")
    return versions.pop()


def deployed_python() -> str | None:
    """
    The interpreter production declares. Returns None (reported as 'unknown') rather than refusing:
    the local-vs-CI half of the reading is still honest without it.
    ⚠️ DECLARED is not MEASURED. render.yaml is a Blueprint and this service may not be
    Blueprint-synced — its own RATING_TIDE comment says as much — so treat this as the intent and
    confirm against /api/health's `runtime.python` before relying on it.
    """
    if not RENDER_BLUEPRINT.exists():
        return None
    m = re.search(r"key:\s*PYTHON_VERSION\s*\n\s*value:\s*'?\"?([0-9]+\.[0-9]+)",
                  RENDER_BLUEPRINT.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def compare(pinned: dict[str, str]) -> tuple[list, list, list]:
    same, differ, missing = [], [], []
    for name, want in sorted(pinned.items()):
        try:
            got = metadata.version(name)
        except metadata.PackageNotFoundError:
            missing.append((name, want))
            continue
        (same if got == want else differ).append((name, want, got))
    return same, differ, missing


def summarize() -> dict:
    """The whole reading. Raises Refused if it cannot be taken honestly."""
    pinned, floating = read_requirements()
    same, differ, missing = compare(pinned)
    want_py = declared_python()
    got_py = ".".join(str(p) for p in sys.version_info[:2])
    deploy_py = deployed_python()
    return {
        "pinned": len(pinned), "same": same, "differ": differ, "missing": missing,
        "floating": floating, "want_py": want_py, "got_py": got_py,
        "deploy_py": deploy_py,
        "py_matches": got_py == want_py,
        # A separate reading from the local one, and it stays true even on a perfectly provisioned
        # workstation: CI testing a different interpreter than production is its own defect.
        "ci_matches_deploy": deploy_py is None or deploy_py == want_py,
        "in_venv": sys.prefix != sys.base_prefix,
        "matches": got_py == want_py and not differ and not missing,
    }


def chain_line(r: dict) -> str | None:
    """Reported independently of the local reading: it is about CI vs production, not this box."""
    if r["ci_matches_deploy"]:
        return None
    return (f"CI TESTS A DIFFERENT INTERPRETER THAN PRODUCTION: ci.yml runs {r['want_py']}, "
            f"render.yaml declares {r['deploy_py']} => a green CI run is not evidence about the "
            f"interpreter production uses. (Declared, not measured - confirm with "
            f"`curl -s <backend>/api/health` and read runtime.python.)")


def one_line(r: dict) -> str:
    if r["matches"]:
        return f"env parity OK: python {r['got_py']}, {len(r['same'])}/{r['pinned']} pins match"
    bits = []
    if not r["py_matches"]:
        bits.append(f"python {r['got_py']} != declared {r['want_py']}")
    if r["differ"]:
        bits.append(f"{len(r['differ'])} of {r['pinned']} pins differ")
    if r["missing"]:
        bits.append(f"{len(r['missing'])} declared packages absent")
    if not r["in_venv"]:
        bits.append("not in a virtualenv")
    return "ENVIRONMENT IS NOT THE DECLARED ONE: " + "; ".join(bits)


def report(r: dict, verbose: bool) -> None:
    print(one_line(r))
    chain = chain_line(r)
    if chain:
        print(chain)
    if r["matches"] and not verbose:
        return
    print(f"  interpreter : {r['got_py']}  (ci.yml declares {r['want_py']}, "
          f"render.yaml declares {r['deploy_py'] or 'unknown'})"
          f"{'' if r['py_matches'] else '   <-- DIFFERENT'}")
    print(f"  virtualenv  : {'yes' if r['in_venv'] else 'NO - packages come from a user/global site-packages'}")
    print(f"  pins match  : {len(r['same'])}/{r['pinned']}")
    if r["differ"]:
        print(f"  DIFFERENT ({len(r['differ'])}):")
        for name, want, got in r["differ"]:
            print(f"    {name:<26} declared {want:<14} installed {got}")
    if r["missing"]:
        print(f"  ABSENT ({len(r['missing'])}):")
        for name, want in r["missing"]:
            print(f"    {name:<26} declared {want}")
    if verbose and r["floating"]:
        # Not a divergence -- but these resolve fresh on every CI run AND every production deploy,
        # so they can move with no commit at all. Listed so that fact is visible, not implied.
        print(f"  NOT PINNED TO AN EXACT VERSION ({len(r['floating'])}) - these can change with no commit:")
        for name in sorted(r["floating"]):
            try:
                got = metadata.version(name)
            except metadata.PackageNotFoundError:
                got = "<absent here>"
            print(f"    {r['floating'][name]:<34} resolves here to {got}")
    if not r["matches"]:
        print("  => A test result from this interpreter is evidence about THIS environment, not"
              " about CI or production.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--strict", action="store_true", help="exit 1 when the environment diverges")
    ap.add_argument("--verbose", action="store_true", help="print the full table even when it matches")
    args = ap.parse_args()
    try:
        r = summarize()
    except Refused as e:
        print(f"env parity UNKNOWN - refusing to report: {e}")
        return 2
    report(r, args.verbose)
    return 1 if (args.strict and not r["matches"]) else 0


if __name__ == "__main__":
    sys.exit(main())
