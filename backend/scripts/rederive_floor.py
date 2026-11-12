#!/usr/bin/env python3
"""rederive_floor.py — re-derive ONE lane's CI floor from dev, plus this PR's new tests, in both places it lives.

WHY (the lead, 2026-10-23). A lane's floor is two facts that move together: `MIN_PASSED` (and, for guards and chain,
`MIN_FILES`) in .github/workflows/ci.yml, and the reading it was set from, `_FLOOR_SET_FROM[lane]` in
backend/tests/test_ci_floor_staleness.py. Every PR that adds tests moves both. Two PRs that move the SAME lane always
conflict, and the honest resolution is not "pick one side": it is to re-derive from what dev holds now, plus this
PR's own tests. Done by hand that re-derivation went wrong often enough to have its own lessons (L-P floors). This
does it the same way every time:

    base     = max(dev's last GREEN hosted read of the lane, dev's _FLOOR_SET_FROM[lane])
               (the map can be AHEAD of the hosted read: a PR that merged after the last green run already put its
               projection there; never take the lower)
    set_from = base + --add                 (this PR's new tests in that lane)
    floor    = set_from - the lane's budget (guards/chain 6, estate 2: ci_floor_staleness.LANES)
    files    = max(the hosted file count, dev's MIN_FILES) + --add-files   (guards/chain; exact)

It reads dev's map and ci.yml from the base ref (`git show origin/dev:...`), never from this checkout, so running it
twice gives the same numbers. It rewrites this checkout's two files: the lane's assignment in ci.yml, with a two-line
comment above it naming the run and the arithmetic (replaced, not stacked, when re-run on the same branch), and the
lane's value and its ONE provenance comment line in the map. The map holds one block per lane with a blank line
between lanes, because git conflicts on changes to ADJACENT lines: with all three lanes on one line (and even with
one key per line and no blank between) any two PRs that moved DIFFERENT lanes conflicted.

⬇ 2026-11-11: FRAGMENTS ARE NOW THE DEFAULT (owner-approved). Rewriting the base lines above still made any two PRs
that grew the SAME lane conflict, and every merge re-broke every other open PR (9 of 10 open on the day). So a feature
PR no longer edits ci.yml or _FLOOR_SET_FROM: this script writes ONE file per lane it grows,
`.github/ci-floors.d/<branch-slug>.<lane>.json`, and CI's floor = base literal + the sum of every fragment
(backend/scripts/ci_floor_fragments.py, the one helper every reader uses). Lanes: guards, chain, estate, frontend.
    python backend/scripts/rederive_floor.py --lane chain --add 91 --add-files 2 --note "location-time phase 1"
    python backend/scripts/rederive_floor.py --lane frontend --add 12 --add-files 1     # files = Jest suites
    python backend/scripts/rederive_floor.py --lane chain --add auto   # converting a PR that edited the base lines
    python backend/scripts/rederive_floor.py --compact                 # ON DEV ONLY, in a PR of its own
The pre-fragment behaviour below (re-derive the BASE from dev's hosted read) is kept as `--base-from-hosted`, for
the dev-only compaction PR when the base itself must be re-read; never in a feature PR.

USAGE of --base-from-hosted (from the repo root or backend/; needs `gh` for the hosted read):
    python backend/scripts/rederive_floor.py --lane estate --add 13 --base-from-hosted
    # mid-conflict (`git merge origin/dev`, then `git checkout --theirs` the two files): read the PR's own change
    python backend/scripts/rederive_floor.py --lane chain --add auto --base-from-hosted   # HEAD vs its merge base, files included
    python backend/scripts/rederive_floor.py --lane chain --add 8 --add-files 1 --dry-run --base-from-hosted
    python backend/scripts/rederive_floor.py --lane guards --add 6 --add-files 1 --run 39861554298 --base-from-hosted
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from . import ci_floor_staleness as S   # as scripts.rederive_floor (tests): ONE module, so patches reach it
    from . import ci_floor_fragments as F
except ImportError:
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import ci_floor_staleness as S  # noqa: E402 - run as a script
    import ci_floor_fragments as F  # noqa: E402 - run as a script

REPO = os.path.dirname(os.path.dirname(HERE))
CI_REL = ".github/workflows/ci.yml"
MAP_REL = "backend/tests/test_ci_floor_staleness.py"
MARK = "rederive_floor.py"


class Refusal(Exception):
    pass


# ── the map ──────────────────────────────────────────────────────────────────────────────────────────────────────
def map_block(text: str):
    """(start, end) of the `_FLOOR_SET_FROM = {...}` literal. PURE."""
    i = text.find("_FLOOR_SET_FROM = {")
    j = text.find("}", i)
    if i < 0 or j < 0:
        raise Refusal(f"no `_FLOOR_SET_FROM = {{...}}` in {MAP_REL}")
    return i, j + 1


def parse_map(text: str) -> dict:
    """{lane: set-from value}, from the one-line or the one-block-per-lane form. PURE."""
    i, j = map_block(text)
    return {k: int(v) for k, v in re.findall(r'"(\w+)":\s*(\d+)', text[i:j])}


def set_map(text: str, lane: str, value: int, comment: str) -> str:
    """The map with `lane` set to `value` and its provenance line (`# lane: ...`, directly above) replaced. PURE.
    Refuses the one-line form: that is the layout that made different-lane PRs conflict."""
    i, j = map_block(text)
    block = text[i:j]
    if "\n" not in block:
        raise Refusal("the map is on one line; split it into one block per lane first (blank line between lanes)")
    lines = block.split("\n")
    hits = [n for n, ln in enumerate(lines) if re.fullmatch(r'\s*"' + re.escape(lane) + r'":\s*\d+,\s*', ln)]
    if len(hits) != 1:
        raise Refusal(f"the map holds {len(hits)} `\"{lane}\": N,` lines, not one")
    n = hits[0]
    indent = re.match(r"\s*", lines[n]).group(0)
    lines[n] = f'{indent}"{lane}": {value},'
    note = f"{indent}# {lane}: {comment}"
    if n > 0 and re.match(r"\s*# " + re.escape(lane) + r":", lines[n - 1]):
        lines[n - 1] = note
    else:
        lines.insert(n, note)
    return text[:i] + "\n".join(lines) + text[j:]


# ── ci.yml ───────────────────────────────────────────────────────────────────────────────────────────────────────
def _floor_match(text: str, lane: str):
    """The lane's assignment, located exactly as ci_floor_staleness.read_floors locates it (by the junit anchor)."""
    spec = S.LANES[lane]
    anchor = re.escape(spec["anchor"])
    if spec["has_files_floor"]:
        rx = (r"MIN_FILES,\s*MIN_PASSED\s*=\s*(\d+),\s*(\d+)\s*\n(?:.*\n)?"
              r"\s*try:\s*\n\s*root = ET\.parse\('" + anchor + r"'\)")
    else:
        rx = r"MIN_PASSED\s*=\s*(\d+)\s*\n(?:.*\n)*?\s*root = ET\.parse\('" + anchor + r"'\)"
    m = re.search(rx, text)
    if not m:
        raise Refusal(f"could not find the {lane} floor in ci.yml by its anchor {spec['anchor']!r}")
    return m


def floor_values(text: str, lane: str):
    """(files or None, passed) of the lane's floor in a ci.yml text. PURE."""
    m = _floor_match(text, lane)
    return (int(m.group(1)), int(m.group(2))) if S.LANES[lane]["has_files_floor"] else (None, int(m.group(1)))


def set_ci_floor(text: str, lane: str, files, passed: int, note: list, branch: str) -> str:
    """ci.yml with the lane's numbers replaced and `note` (comment lines) directly above the assignment; a note this
    branch wrote before is replaced, never stacked. PURE."""
    m = _floor_match(text, lane)
    has_files = S.LANES[lane]["has_files_floor"]
    spans = [(m.start(1), m.end(1), files), (m.start(2), m.end(2), passed)] if has_files else \
        [(m.start(1), m.end(1), passed)]
    out = text
    for a, b, v in sorted(spans, reverse=True):
        out = out[:a] + str(v) + out[b:]
    line_start = out.rfind("\n", 0, m.start()) + 1
    indent = re.match(r"[ \t]*", out[line_start:]).group(0)
    before = out[:line_start].split("\n")[:-1]
    n = len(note)
    if len(before) >= n and f"({MARK}, {branch})" in before[-n]:
        before = before[:-n]               # this branch's earlier note: replace it, never stack a second
    head = "\n".join(before + [indent + ln for ln in note])
    return head + "\n" + out[line_start:]


# ── the derivation ───────────────────────────────────────────────────────────────────────────────────────────────
def derive(lane: str, hosted_passed: int, hosted_files, map_dev: int, files_dev, add: int, add_files: int) -> dict:
    """The new numbers for one lane. PURE."""
    if add < 0 or add_files < 0:
        raise Refusal("--add and --add-files count tests and files THIS PR adds; they are never negative")
    spec = S.LANES[lane]
    base = max(hosted_passed, map_dev)
    set_from = base + add
    out = {"lane": lane, "base": base, "base_from": "hosted read" if hosted_passed >= map_dev else "dev's map",
           "set_from": set_from, "floor": set_from - spec["passed_budget"], "budget": spec["passed_budget"],
           "files": None}
    if spec["has_files_floor"]:
        out["files"] = max(hosted_files or 0, files_dev or 0) + add_files
    return out


def base_text(rel: str, base_ref: str) -> str:
    r = subprocess.run(["git", "show", f"{base_ref}:{rel}"], cwd=REPO, capture_output=True)
    if r.returncode != 0:
        raise Refusal(f"cannot read {rel} at {base_ref}: {r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout.decode("utf-8")


NOTE_TESTS_RE = re.compile(r"\+ (\d+) new test\(s\)")
NOTE_FILES_RE = re.compile(r"\b(\d+) new file\(s\)")


def note_delta(ci_text: str, lane: str, branch: str):
    """(tests, files or None) from the note THIS branch's earlier run wrote above the lane's assignment, else None. A
    note before 2026-10-24 records only the tests, so its files come back None. PURE."""
    m = _floor_match(ci_text, lane)
    before = ci_text[:ci_text.rfind("\n", 0, m.start()) + 1].split("\n")[:-1]
    if len(before) < 2 or f"({MARK}, {branch})" not in before[-2]:
        return None
    t, f = NOTE_TESTS_RE.search(before[-1]), NOTE_FILES_RE.search(before[-1])
    return (int(t.group(1)), int(f.group(1)) if f else None) if t else None


def own_delta(lane: str, base_ref: str, head: str = "HEAD"):
    """(tests, files) THIS branch added to the lane. During a conflicted `git merge origin/dev`, HEAD is still the
    branch's own tip, so this reads the PR's change even after `git checkout --theirs` put dev's files in the working
    tree; it works on the old one-line map too (the lead's case, 2026-10-23).
    ⬇ 2026-10-24: FIRST the branch's own note (`+ N new test(s)`, tagged with the branch), when its earlier run wrote
    one; only without a note, HEAD minus the merge base. The difference alone read +43 for #513's +17: that branch's
    map value had been set by this helper from a NEWER dev than its merge base, so the difference also counted 26 tests
    other PRs had merged in between."""
    mb = subprocess.run(["git", "merge-base", head, base_ref], cwd=REPO, capture_output=True, text=True)
    if mb.returncode != 0 or not mb.stdout.strip():
        raise Refusal(f"no merge base between {head} and {base_ref}: {mb.stderr.strip()}")
    base = mb.stdout.strip()
    branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", head], cwd=REPO, capture_output=True,
                            text=True).stdout.strip()
    head_ci = base_text(CI_REL, head)
    noted = note_delta(head_ci, lane, branch) if branch and branch != "HEAD" else None
    files = 0
    if S.LANES[lane]["has_files_floor"]:
        files = floor_values(head_ci, lane)[0] - floor_values(base_text(CI_REL, base), lane)[0]
    if noted:
        return noted[0], (noted[1] if noted[1] is not None else files)
    return parse_map(base_text(MAP_REL, head))[lane] - parse_map(base_text(MAP_REL, base))[lane], files


def legacy_main(args) -> int:
    """`--base-from-hosted` (dev only, e.g. in the --compact PR): the pre-2026-11-11 behaviour, re-deriving the BASE
    lines in ci.yml and _FLOOR_SET_FROM from dev's last green hosted read. Never in a feature PR: editing the base
    lines is what made every open PR conflict."""
    try:
        if args.add == "auto":
            args.add, auto_files = own_delta(args.lane, args.base)
            args.add_files = auto_files if args.add_files in (None, "auto") else int(args.add_files)
            print(f"{args.lane}: this branch's own change (HEAD vs its merge base with {args.base}): +{args.add} "
                  f"test(s), +{args.add_files} file(s)")
        else:
            if not str(args.add).isdigit():
                raise Refusal(f"--add {args.add!r}: a count of tests, or 'auto'")
            args.add = int(args.add)
            args.add_files = int(args.add_files or 0)
        run = args.run or S.last_green_run(args.branch)[0]
        hosted_files, hosted_passed = S.observed(run, args.lane)
        map_dev = parse_map(base_text(MAP_REL, args.base))[args.lane]
        files_dev, floor_dev = floor_values(base_text(CI_REL, args.base), args.lane)
        d = derive(args.lane, hosted_passed, hosted_files, map_dev, files_dev, args.add, args.add_files)
        branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=REPO, capture_output=True,
                                text=True).stdout.strip() or "?"
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        ci_path, map_path = os.path.join(REPO, *CI_REL.split("/")), os.path.join(REPO, *MAP_REL.split("/"))
        with open(ci_path, encoding="utf-8", newline="") as f:
            ci = f.read()
        with open(map_path, encoding="utf-8", newline="") as f:
            mp = f.read()
        old_files, old = floor_values(ci, args.lane)
        files_txt = f" / {hosted_files} files" if hosted_files is not None else ""
        note = [f"# ⬆ {floor_dev}→{d['floor']} on {today} ({MARK}, {branch}): dev run {run} read {hosted_passed}{files_txt}; "
                f"dev's map {map_dev};",
                f"#   base {d['base']} ({d['base_from']}) + {args.add} new test(s)"
                + (f" and {args.add_files} new file(s)" if d["files"] is not None else "") + f" = {d['set_from']}"
                + (f", files {d['files']}" if d["files"] is not None else "")
                + f"; floor {d['set_from']} - {d['budget']} = {d['floor']}. This PR must read {d['set_from']} passed."]
        new_ci = set_ci_floor(ci, args.lane, d["files"], d["floor"], note, branch)
        new_map = set_map(mp, args.lane, d["set_from"],
                          f"set from {d['set_from']} = max(dev run {run} read {hosted_passed}, dev's map {map_dev}) "
                          f"+ {args.add} ({branch}, {today}); floor {d['floor']}, margin {d['budget']}.")
    except (Refusal, S.Refusal, KeyError, ValueError) as exc:
        print(f"rederive_floor: REFUSED: {exc}")
        return 1
    print(f"{args.lane}: dev run {run} read {hosted_passed}{files_txt}; dev's map {map_dev}; base {d['base']} "
          f"({d['base_from']}) + {args.add} = {d['set_from']}; MIN_PASSED {old} -> {d['floor']}"
          + (f"; MIN_FILES {old_files} -> {d['files']}" if d["files"] is not None else ""))
    print(f"This PR must read {d['set_from']} passed in the {args.lane} lane.")
    if args.dry_run:
        print("dry run: no file written")
        return 0
    with open(ci_path, "w", encoding="utf-8", newline="") as f:
        f.write(new_ci)
    with open(map_path, "w", encoding="utf-8", newline="") as f:
        f.write(new_map)
    print(f"wrote {CI_REL} and {MAP_REL}")
    return 0


# ── fragments (2026-11-11): the default ─────────────────────────────────────────────────────────────────────────
FRONT_RE = re.compile(r"const FRONTEND_BASE_SUITES = (\d+), FRONTEND_BASE_TESTS = (\d+);")


def frontend_values(text: str):
    """(suites, tests) of the frontend lane's BASE floor in a ci.yml text. PURE."""
    if len(FRONT_RE.findall(text)) != 1:
        raise Refusal("could not find exactly one `const FRONTEND_BASE_SUITES = N, FRONTEND_BASE_TESTS = M;` in ci.yml")
    m = FRONT_RE.search(text)
    return int(m.group(1)), int(m.group(2))


def set_frontend_floor(text: str, suites: int, tests: int, note: str) -> str:
    """ci.yml with the frontend base literals replaced and a `//` note line directly above them. PURE."""
    frontend_values(text)
    m = FRONT_RE.search(text)
    out = text[:m.start(1)] + str(suites) + text[m.end(1):m.start(2)] + str(tests) + text[m.end(2):]
    line_start = out.rfind("\n", 0, m.start()) + 1
    indent = re.match(r"[ \t]*", out[line_start:]).group(0)
    return out[:line_start] + indent + "// " + note + "\n" + out[line_start:]


def write_fragment(lane: str, tests: int, files: int, branch: str, note: str, today: str, frag_dir=None) -> str:
    """Write (or replace) this branch's fragment for one lane, validated by the SAME helper CI reads it with."""
    if tests < 0 or files < 0:
        raise Refusal("--add and --add-files count tests and files THIS PR adds; they are never negative")
    name = f"{F.slug(branch)}.{lane}.json"
    data = {"lane": lane, "tests": tests, "files": files, "branch": branch, "date": today, "note": note}
    if lane in F.NO_FILES_FLOOR:
        if files:
            raise Refusal(f"the {lane} lane has no file floor; --add-files must be 0")
        del data["files"]
    F.validate(name, data)
    d = frag_dir or F.FRAG_DIR
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(data, indent=2) + "\n")
    return path


def effective(lane: str, ci: str, mp: str, frag_dir=None) -> dict:
    """The lane's base numbers and its effective ones (base + every fragment)."""
    s = F.sums(frag_dir)[lane]
    if lane == "frontend":
        suites, tests = frontend_values(ci)
        return {"files": suites, "passed": tests, "set_from": tests, "eff_files": suites + s["files"],
                "eff_passed": tests + s["tests"], "eff_set_from": tests + s["tests"], "sum": s}
    files, passed = floor_values(ci, lane)
    set_from = parse_map(mp)[lane]
    return {"files": files, "passed": passed, "set_from": set_from,
            "eff_files": None if files is None else files + s["files"], "eff_passed": passed + s["tests"],
            "eff_set_from": set_from + s["tests"], "sum": s}


def _read(rel):
    with open(os.path.join(REPO, *rel.split("/")), encoding="utf-8", newline="") as f:
        return f.read()


def _write(rel, text):
    with open(os.path.join(REPO, *rel.split("/")), "w", encoding="utf-8", newline="") as f:
        f.write(text)


def compact(today: str, frag_dir=None, dry_run=False) -> int:
    """Fold every fragment into the base literals (ci.yml) and _FLOOR_SET_FROM, one `⬆` line per lane, then delete
    the fragments. ON DEV ONLY, in a PR of its own: run in a feature PR it re-creates the conflicts this removes."""
    frags = F.load(frag_dir)
    if not frags:
        print("no fragments to compact")
        return 0
    sums = F.sums(frag_dir)
    ci, mp = _read(CI_REL), _read(MAP_REL)
    tag = f"compact {today}"
    for lane in F.LANES:
        s = sums[lane]
        if not s["n"]:
            continue
        e = effective(lane, ci, mp, frag_dir)
        names = ", ".join(f["name"] for f in frags if f["lane"] == lane)
        what = f"folded {s['n']} fragment(s), +{s['tests']} test(s) and +{s['files']} file(s): {names}"
        if lane == "frontend":
            ci = set_frontend_floor(ci, e["eff_files"], e["eff_passed"],
                                    f"⬆ {e['files']}/{e['passed']}→{e['eff_files']}/{e['eff_passed']} on {today} "
                                    f"({MARK}, {tag}): {what}.")
        else:
            ci = set_ci_floor(ci, lane, e["eff_files"], e["eff_passed"],
                              [f"# ⬆ {e['passed']}→{e['eff_passed']} on {today} ({MARK}, {tag}): {what}."], tag)
            mp = set_map(mp, lane, e["eff_set_from"],
                         f"set from {e['eff_set_from']} = {e['set_from']} + {s['tests']} ({tag}, {s['n']} "
                         f"fragment(s)); floor {e['eff_passed']}, margin {e['eff_set_from'] - e['eff_passed']}.")
        print(f"{lane}: base {e['files']}/{e['passed']} -> {e['eff_files']}/{e['eff_passed']} ({what})")
    if dry_run:
        print("dry run: no file written")
        return 0
    _write(CI_REL, ci)
    _write(MAP_REL, mp)
    for f in frags:
        os.remove(os.path.join(frag_dir or F.FRAG_DIR, f["name"]))
    print(f"wrote {CI_REL} and {MAP_REL}; removed {len(frags)} fragment(s)")
    return 0


def _current_branch():
    return subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=REPO, capture_output=True,
                          text=True).stdout.strip()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lane", choices=list(F.LANES))
    ap.add_argument("--add", help="tests this PR adds to the lane, or 'auto' (backend lanes): its own map at HEAD "
                                  "minus at its merge base, for converting a PR that edited the base lines")
    ap.add_argument("--add-files", help="test files (frontend: Jest suites) this PR adds; default 0")
    ap.add_argument("--note", default="", help="one line saying what the tests are")
    ap.add_argument("--branch-name", help="the branch the fragment is named after (default: the current branch)")
    ap.add_argument("--compact", action="store_true", help="fold every fragment into the base lines (dev only)")
    ap.add_argument("--base-from-hosted", action="store_true",
                    help="dev only: the old behaviour, re-deriving the BASE lines from dev's last green hosted read")
    ap.add_argument("--base", default="origin/dev", help="the ref whose map and ci.yml are the base")
    ap.add_argument("--branch", default="dev", help="the branch whose last green CI run is the hosted read")
    ap.add_argument("--run", type=int, help="read this CI run instead of the last green one")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        if args.compact:
            return compact(today, dry_run=args.dry_run)
        if not args.lane or args.add is None:
            raise Refusal("--lane and --add are required (or --compact)")
        if args.base_from_hosted:
            if args.lane == "frontend":
                raise Refusal("the frontend lane has no hosted reader; --base-from-hosted is for backend lanes")
            return legacy_main(args)
        if args.add == "auto":
            if args.lane == "frontend":
                raise Refusal("--add auto reads _FLOOR_SET_FROM, which has no frontend lane; give the counts")
            tests, auto_files = own_delta(args.lane, args.base)
            files = auto_files if args.add_files in (None, "auto") else int(args.add_files)
        else:
            if not str(args.add).isdigit():
                raise Refusal(f"--add {args.add!r}: a count of tests, or 'auto'")
            tests, files = int(args.add), int(args.add_files or 0)
        branch = args.branch_name or _current_branch()
        if not branch or branch == "HEAD":
            raise Refusal("detached HEAD: pass --branch-name <the PR's branch>")
        if args.dry_run:
            print(f"dry run: would write {F.slug(branch)}.{args.lane}.json: +{tests} test(s), +{files} file(s)")
            return 0
        path = write_fragment(args.lane, tests, files, branch, args.note, today)
        e = effective(args.lane, _read(CI_REL), _read(MAP_REL))
    except (Refusal, S.Refusal, F.FragmentError, KeyError, ValueError) as exc:
        print(f"rederive_floor: REFUSED: {exc}")
        return 1
    s = e["sum"]
    print(f"wrote {os.path.relpath(path, REPO)}: {args.lane} +{tests} test(s), +{files} file(s)")
    unit = "suites" if args.lane == "frontend" else "files"
    files_txt = "" if e["eff_files"] is None else f"; {unit} {e['files']} + {s['files']} = {e['eff_files']}"
    print(f"{args.lane}: base floor {e['passed']} + {s['n']} fragment(s) {s['tests']} = {e['eff_passed']}{files_txt}")
    print(f"This PR must read {e['eff_set_from']} passed in the {args.lane} lane "
          f"(set-from {e['set_from']} + {s['tests']}; the CI step enforces {e['eff_passed']}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
