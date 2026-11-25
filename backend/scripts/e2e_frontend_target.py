"""e2e_frontend_target.py - which Netlify build should the E2E lane wait for? (the frontend twin of e2e_backend_ready.py)

WHY (2026-11-25, director, at David's request to make false reds green): E2E Tests on dev failed on every push whose
commit carries `[skip netlify]` (runs 45470009231, 45501339887, 45510009683: "never served a build matching <sha> after
20 minutes"), because Netlify, by design, never builds that commit. The last pass (45462244885, ac7aadff7) had no tag.
The site was fine; the lane was waiting for a build that could not exist.

RULE (netlify.toml: the dev branch builds EVERY commit, `ignore = "false"`, except a commit whose message carries a
Netlify skip marker (SKIP_MARKERS: both word orders of the ci and netlify markers, any case); the next built commit then ships the skipped
changes too):
    expected = the newest first-parent commit at or before HEAD whose message has no skip marker
    expected == HEAD                                          -> "head":    wait for HEAD (as before)
    expected != HEAD, and the skipped commits changed nothing
      Netlify builds (frontend/, netlify/, scripts/, netlify.toml, node/npm/yarn files: netlify-ignore.cjs's list)
                                                              -> "earlier": wait for `expected`; the bundle it serves is
                                                                            exactly what HEAD would build, so E2E runs
    expected != HEAD, and a skipped commit DID change a built file
                                                              -> "skip":    E2E is SKIPPED with a notice. The served
                                                                            bundle lacks HEAD's frontend changes, and
                                                                            the lane never runs against a stale bundle
    no unskipped commit in reach (a shallow clone)            -> "head" (the old behaviour: wait for HEAD, fail loud)
Kill: E2E_NETLIFY_TARGET=0 (always "head", as before).

Usage (the workflow): python3 backend/scripts/e2e_frontend_target.py [rev] >> "$GITHUB_OUTPUT"
    prints `target=<sha>`, `verdict=<head|earlier|skip>`, `skip=<true|false>` and `reason=<one line>`.
"""
from __future__ import annotations

import os
import subprocess
import sys

# Netlify's skip markers, both word orders (advisor nit after #1300: neither reversed spelling is used today, and a
# missing one only causes a false red, never a stale green). Matched case-insensitively.
SKIP_MARKERS = ("[skip netlify]", "[skip ci]", "[netlify skip]", "[ci skip]")
# The paths frontend/scripts/netlify-ignore.cjs's needsBuild() counts as "Netlify builds this" (kept equal by test).
BUILD_PREFIXES = ("frontend/", "netlify/", "scripts/")
BUILD_FILES = ("netlify.toml", ".node-version", ".nvmrc", ".npmrc", ".yarnrc", ".yarnrc.yml", "package.json",
               "package-lock.json", "yarn.lock")


def _git(*args, cwd=None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def needs_build(paths) -> bool:
    """netlify-ignore.cjs's needsBuild(), in Python. PURE."""
    return any(p.startswith(BUILD_PREFIXES) or p in BUILD_FILES for p in paths)


def expected_frontend_sha(rev: str = "HEAD", cwd=None) -> str:
    """The newest first-parent commit at or before `rev` that Netlify builds (no skip marker in its message), or ''."""
    args = ["log", "-1", "--first-parent", "--format=%H", "--fixed-strings", "--regexp-ignore-case", "--invert-grep"]
    for m in SKIP_MARKERS:
        args.append(f"--grep={m}")
    return _git(*args, rev, cwd=cwd)


def decide(head: str, expected: str, changed_paths) -> dict:
    """The verdict. PURE."""
    if not expected:
        return {"target": head, "verdict": "head", "skip": False,
                "reason": "no unskipped commit in reach (shallow history): wait for HEAD"}
    if expected == head:
        return {"target": head, "verdict": "head", "skip": False, "reason": "HEAD is a Netlify build: wait for it"}
    if needs_build(changed_paths):
        built = sorted(p for p in changed_paths if needs_build([p]))
        return {"target": expected, "verdict": "skip", "skip": True, "built": built,
                "reason": f"HEAD carries a Netlify skip marker and the skipped commits change built files "
                          f"({', '.join(built[:5])}{'...' if len(built) > 5 else ''}); the served bundle would be stale"}
    return {"target": expected, "verdict": "earlier", "skip": False,
            "reason": f"HEAD carries a Netlify skip marker; nothing Netlify builds changed since {expected[:9]}, so its "
                      f"bundle is HEAD's: wait for it"}


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    rev = argv[0] if argv else "HEAD"
    head = _git("rev-parse", rev)
    if os.environ.get("E2E_NETLIFY_TARGET", "1") == "0":
        d = {"target": head, "verdict": "head", "skip": False, "reason": "E2E_NETLIFY_TARGET=0: wait for HEAD"}
    else:
        expected = expected_frontend_sha(rev)
        changed = _git("diff", "--name-only", expected, head).split("\n") if expected and expected != head else []
        d = decide(head, expected, [p for p in changed if p])
    print(f"target={d['target']}\nverdict={d['verdict']}\nskip={'true' if d['skip'] else 'false'}\n"
          f"reason={d['reason']}")
    if d.get("built"):
        # advisor nit after #1300: a frontend change committed under a Netlify skip marker NEVER deploys until the next
        # built commit. Not an E2E failure, but it must be visible. On STDERR: stdout is appended to $GITHUB_OUTPUT.
        print(f"::warning title=Frontend change not deployed (Netlify skip marker)::these built files changed under a "
              f"skip marker and are not live until the next built commit: {', '.join(d['built'][:10])}"
              f"{' ...' if len(d['built']) > 10 else ''}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
