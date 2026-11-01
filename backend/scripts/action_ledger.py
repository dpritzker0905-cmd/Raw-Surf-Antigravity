"""action_ledger.py — the weather program's ACTION LEDGER: append-only, hash-chained, verified in CI.

WHY. The owner, 2026-09-29: "we need to be state of the art, and the only way is for you to be accountable for every
action you do." Every state-changing action a session takes, and every action of the owner's that a session learns
of, is one line of `docs/weather-program/ACTIONS.jsonl`. That covers a PR opened or merged, a push, a workflow
dispatch, an env or flag change, a deploy, a data or memory write, a decision, and a correction of an earlier claim.
Each line records who acted, what was done, the words that authorized it, the evidence, how the outcome was
verified, and how to roll it back.

TAMPER-EVIDENT, NOT MERELY APPEND-BY-CONVENTION.
  * Each line carries `prev`, the SHA-256 of the previous line's exact bytes (the first line: "GENESIS"). Editing,
    deleting or reordering any line breaks every later link.
  * Truncating the tail leaves a valid chain, so STATE.md publishes the ANCHOR, `Ledger head: seq N, sha256 H`, and
    each update moves it forward. A ledger that lost line N fails.
  * In CI on a pull request, `verify --base <the base branch's copy>` also requires the base ledger to be a byte-exact
    prefix of the new one, so a PR can only ADD lines.
  * `at` is when a line is WRITTEN and never goes backwards; an action recorded late also carries `acted_at`, when it
    happened, so the order of the ledger is the order of accountability, and the true time is still kept.
  * Every line must be in canonical form (sorted keys, compact separators, UTF-8), so `append` is the only writer
    format and a hand edit shows up even when it happens to preserve the JSON.

COMMITMENTS (2026-09-29, the owner: "upgrade the memories abilities"). A follow-up a session promises ("verify the
first post-flip ingest", "read the shadow's scored rows at 17Z") used to live only in that session's context, and a
compaction or a new session lost it. Now it is a `commitment` line with `due_at` (UTC) and `check` (how it will be
verified). A later line closes it with `fulfills: <seq>`, which must name an earlier commitment. `open` lists every
unfulfilled commitment and marks the OVERDUE ones; memory_audit surfaces them at every session start.

FRAGMENTS (owner, 2026-10-22 23:11 EDT; D-0XX; ledger_fragments.py). Two open PRs that both appended here always
claimed the same seq, so since the protocol landed a PR never writes this file: `append` writes the PR's lines to
`ledger.d/<branch-slug>.jsonl` (no seq/prev/at), and the lead's `fold-pr` chains every merged fragment onto this
file in MERGE ORDER, moves the anchor and removes the folded fragments in one commit. `append --direct` is the old
writer, kept for the fold and for PRs opened before the protocol landed. References: `--fulfills`/`--corrects` take
a seq already here, `@frag:N` (line N of your fragment) or `@frag:<name>:N` (a fragment already merged to dev).

USAGE (from the repo root; standard library only):
  python backend/scripts/action_ledger.py append --actor codex --kind pr_open --target "#470" \
      --why "..." --authorized-by "owner (chat, 2026-10-22): '...'" \
      --evidence "CI 11/11 green" --evidence "hosted estate 2343" \
      --outcome "opened" --verified "gh pr view 470: OPEN" --rollback "gh pr close 470"
                                                                   # -> ledger.d/<branch-slug>.jsonl:N
  python backend/scripts/action_ledger.py verify [--base FILE]     # exit 1 on any break
  python backend/scripts/action_ledger.py head                     # the anchor line for STATE.md
  python backend/scripts/action_ledger.py open                     # unfulfilled commitments, fragments included
  python backend/scripts/action_ledger.py selftest                 # proves each tamper is caught
  python backend/scripts/action_ledger.py fold-pr [--dry-run]      # the lead: fold dev's fragments, open the PR
  python backend/scripts/action_ledger.py check-pr --base origin/dev   # CI: the PR's ledger changes are legal
"""
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LEDGER = os.path.join(ROOT, "docs", "weather-program", "ACTIONS.jsonl")
STATE = os.path.join(ROOT, "docs", "weather-program", "STATE.md")
GENESIS = "GENESIS"
ANCHOR_RE = re.compile(r"Ledger head: seq (\d+), sha256 ([0-9a-f]{64})")
KINDS = frozenset({
    "pr_open", "pr_merge", "push", "workflow_dispatch", "env_change", "flag_flip", "deploy", "data_write",
    "memory_write", "doc_write", "decision", "finding", "correction", "owner_action", "commitment",
})
TEXT_FIELDS = ("actor", "kind", "target", "why", "authorized_by", "outcome", "verified", "rollback")
REQUIRED = ("seq", "at", "prev", "evidence") + TEXT_FIELDS
AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$")
# LESSONS L-P10, MECHANIZED (2026-09-30 memory audit). `verified` says when and how a result was READ BACK, so an
# estimated clock time there ("~02:21Z", "~23:55-00:05Z", "02:2xZ") is a claim nobody measured. The prose lesson did
# not hold: it was broken three times after it was written (seq 109, seq 145, and a handoff header, seq 135, which
# memory_audit now checks). Refused at APPEND, so history stays valid; a `pending:` note may forecast a time.
# ⬆ Widened the same evening (seq 189 wrote "18:4x... bound"): an `HH:Mx` estimate is one with or without the Z.
ESTIMATED_TIME_RE = re.compile(r"~\s?\d{1,2}(?::\d{2})?(?:\s?[-–]\s?\d{1,2}(?::\d{2})?)?\s?Z"
                               r"|\b\d{1,2}:\d?[xX]{1,2}(?![A-Za-z0-9])|\b\d{1,2}[xX]{1,2}Z")
# Completeness credits exactly #N. Refuse malformed NEW merge records before writing;
# verify remains compatible with append-only historical records. ASCII digits only.
PR_MERGE_TARGET_RE = re.compile(r"#[1-9][0-9]*")


def pr_merge_target_problem(kind: str, target) -> str | None:
    """Return the refusal for a new merge target; other action kinds keep free targets."""
    if kind != "pr_merge" or PR_MERGE_TARGET_RE.fullmatch(str(target)):
        return None
    return (f"a pr_merge target must be exactly '#<PR number>' (e.g. '#219'); got {target!r}. "
            "Put the branch and title in --why or --outcome")


def estimated_time_in_verified(verified: str):
    """The estimated clock time in a `verified` field (or None). A `pending:` note is a forecast, not a reading. PURE."""
    v = str(verified or "")
    if v.lstrip().lower().startswith("pending"):
        return None
    m = ESTIMATED_TIME_RE.search(v)
    return m.group(0) if m else None


def canonical(entry: dict) -> str:
    return json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def line_hash(line: str) -> str:
    return hashlib.sha256(line.encode("utf-8")).hexdigest()


def read_lines(path: str) -> list:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    if text and not text.endswith("\n"):
        raise ValueError(f"{path}: the last line has no newline (a partial write?)")
    return text.split("\n")[:-1] if text else []


def check_entry(e: dict, seq: int) -> list:
    """Schema problems of one decoded entry at 1-based position `seq`. PURE."""
    errs = [f"missing {k}" for k in REQUIRED if k not in e]
    if errs:
        return errs
    if e["seq"] != seq:
        errs.append(f"seq {e['seq']} at position {seq}")
    if e["kind"] not in KINDS:
        errs.append(f"unknown kind {e['kind']!r}")
    if not AT_RE.match(str(e["at"])):
        errs.append(f"at {e['at']!r} is not UTC ISO (YYYY-MM-DDTHH:MM[:SS]Z)")
    for k in TEXT_FIELDS:
        if not isinstance(e[k], str) or not e[k].strip():
            errs.append(f"{k} is empty")
    if not isinstance(e["evidence"], list) or not e["evidence"] or not all(isinstance(x, str) and x.strip()
                                                                          for x in e["evidence"]):
        errs.append("evidence must be a non-empty list of non-empty strings")
    # `at` is when the line was WRITTEN (monotonic); `acted_at`, when present, is when a late-recorded action happened.
    if "acted_at" in e and (not AT_RE.match(str(e["acted_at"])) or str(e["acted_at"]) > str(e["at"])):
        errs.append(f"acted_at {e.get('acted_at')!r} must be UTC ISO and not after at")
    if e["kind"] == "commitment":
        if not AT_RE.match(str(e.get("due_at", ""))):
            errs.append("a commitment needs `due_at` (UTC ISO): when it will be checked")
        if not isinstance(e.get("check"), str) or not e["check"].strip():
            errs.append("a commitment needs `check`: how it will be verified")
    if "fulfills" in e:
        f_ = e["fulfills"]
        if not (isinstance(f_, int) and not isinstance(f_, bool) and 1 <= f_ < seq):
            errs.append(f"fulfills {f_!r} must be an earlier seq")
    if e["kind"] == "correction":
        # What is corrected: an earlier ledger seq, or a named place a claim was written ("log/2026-09-29-x.md §…").
        c = e.get("corrects")
        if not ((isinstance(c, int) and not isinstance(c, bool) and 1 <= c < seq)
                or (isinstance(c, str) and c.strip())):
            errs.append("a correction must name what it corrects (`corrects`: an earlier seq or a reference)")
    return errs


def verify(lines: list, anchor=None, base=None) -> list:
    """Every problem with a ledger given as its lines (no newlines). PURE."""
    errs, prev, last_at, kinds = [], GENESIS, "", {}
    if base is not None:
        if len(base) > len(lines):
            errs.append(f"the base ledger has {len(base)} lines and this one {len(lines)}: lines were removed")
        for i, (b, c) in enumerate(zip(base, lines), 1):
            if b != c:
                errs.append(f"line {i} differs from the base ledger: the ledger is append-only")
    for i, line in enumerate(lines, 1):
        try:
            e = json.loads(line)
        except ValueError as ex:
            errs.append(f"line {i}: not JSON ({ex})")
            prev = line_hash(line)
            continue
        if not isinstance(e, dict):
            errs.append(f"line {i}: not an object")
            prev = line_hash(line)
            continue
        if canonical(e) != line:
            errs.append(f"line {i}: not canonical (written by hand?)")
        errs += [f"line {i}: {m}" for m in check_entry(e, i)]
        kinds[i] = e.get("kind")
        f_ = e.get("fulfills")
        if isinstance(f_, int) and not isinstance(f_, bool) and 1 <= f_ < i and kinds.get(f_) != "commitment":
            errs.append(f"line {i}: fulfills seq {f_}, which is not a commitment")
        if e.get("prev") != prev:
            errs.append(f"line {i}: prev does not match line {i - 1}'s hash (an edit, deletion or reorder)")
        at = str(e.get("at", ""))
        if at and last_at and at < last_at:
            errs.append(f"line {i}: at {at} is earlier than line {i - 1}'s {last_at}")
        last_at = at or last_at
        prev = line_hash(line)
    if anchor is not None:
        seq, h = anchor
        if seq > len(lines):
            errs.append(f"the anchor names seq {seq} but the ledger has {len(lines)} lines: it was truncated")
        elif line_hash(lines[seq - 1]) != h:
            errs.append(f"the anchor's hash does not match line {seq}")
    return errs


def read_anchor(state_path: str = STATE):
    if not os.path.exists(state_path):
        return None
    with open(state_path, encoding="utf-8") as f:
        m = ANCHOR_RE.search(f.read())
    return (int(m.group(1)), m.group(2)) if m else None


def make_entry(lines: list, **fields) -> dict:
    prev = line_hash(lines[-1]) if lines else GENESIS
    e = {"seq": len(lines) + 1, "prev": prev, **fields}
    e.setdefault("at", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    return e


def append(path: str, **fields) -> dict:
    """Validate the whole ledger, then append ONE canonical line. Refuses to write onto a broken ledger."""
    lines = read_lines(path)
    broken = verify(lines)
    if broken:
        raise ValueError("refusing to append to a broken ledger:\n  " + "\n  ".join(broken))
    e = make_entry(lines, **fields)
    problems = check_entry(e, e["seq"])
    if problems:
        raise ValueError("refusing an invalid entry: " + "; ".join(problems))
    bad_target = pr_merge_target_problem(e["kind"], e["target"])
    if bad_target:
        raise ValueError(f"refusing the entry: {bad_target}")
    est = estimated_time_in_verified(e.get("verified"))
    if est:
        raise ValueError(f"refusing an estimated time in `verified` ({est!r}): give the clock or platform reading "
                         f"(`date -u`, a log timestamp) or a bound ('between 02:24:33Z and 02:31Z'); LESSONS L-P10")
    if lines and e["at"] < json.loads(lines[-1])["at"]:
        raise ValueError(f"at {e['at']} is earlier than the last entry's")
    with open(path, "a", encoding="utf-8", newline="") as f:
        f.write(canonical(e) + "\n")
    return e


def commitments(lines: list, now: str) -> list:
    """Every commitment with its status at `now` (UTC ISO): {seq, target, due_at, check, status, fulfilled_by}, where
    status is "fulfilled", "overdue" or "open". PURE."""
    out, by_seq = [], {}
    for line in lines:
        e = json.loads(line)
        if e.get("kind") == "commitment":
            c = {"seq": e["seq"], "target": e["target"], "due_at": e.get("due_at"), "check": e.get("check"),
                 "status": "open", "fulfilled_by": None}
            by_seq[e["seq"]] = c
            out.append(c)
        f_ = e.get("fulfills")
        if f_ in by_seq and by_seq[f_]["fulfilled_by"] is None:
            by_seq[f_].update(status="fulfilled", fulfilled_by=e["seq"])
    for c in out:
        if c["status"] == "open" and str(c["due_at"]) < now:
            c["status"] = "overdue"
    return out


def head(lines: list) -> str:
    return f"Ledger head: seq {len(lines)}, sha256 {line_hash(lines[-1])}" if lines else "Ledger head: empty"


def rechain(lines: list) -> list:
    """The same entries with every `prev` recomputed (what a tamperer would do to hide an edit). PURE."""
    out, prev = [], GENESIS
    for line in lines:
        e = {**json.loads(line), "prev": prev}
        out.append(canonical(e))
        prev = line_hash(out[-1])
    return out


def selftest() -> list:
    """Build a ledger in a temp dir and prove every tamper is detected. Returns the failures (empty = pass)."""
    fails = []
    base = dict(actor="selftest", target="t", why="w", authorized_by="a", outcome="o", verified="v",
                rollback="r", evidence=["e"])
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "ACTIONS.jsonl")
        for i, kind in enumerate(("pr_open", "pr_merge", "finding"), 1):
            target = "#2" if kind == "pr_merge" else "t"
            append(p, kind=kind, at=f"2026-09-29T0{i}:00:00Z", **{**base, "target": target})
        append(p, kind="correction", corrects=3, at="2026-09-29T04:00:00Z", **base)
        good = read_lines(p)
        # Commitments: a second ledger, so the tamper cases below keep their four-line shape.
        pc = os.path.join(d, "COMMIT.jsonl")
        append(pc, kind="commitment", due_at="2026-09-29T06:00:00Z", check="read X", at="2026-09-29T01:00:00Z",
               **base)
        append(pc, kind="commitment", due_at="2026-09-29T09:00:00Z", check="read Y", at="2026-09-29T02:00:00Z",
               **base)
        append(pc, kind="finding", fulfills=1, at="2026-09-29T03:00:00Z", **base)
        cl = read_lines(pc)
        st = {c["seq"]: c["status"] for c in commitments(cl, "2026-09-29T10:00:00Z")}
        if verify(cl) or st != {1: "fulfilled", 2: "overdue"}:
            fails.append(f"commitments: a clean ledger {verify(cl)} or wrong statuses {st}")
        if {c["seq"]: c["status"] for c in commitments(cl, "2026-09-29T08:00:00Z")}.get(2) != "open":
            fails.append("commitments: a commitment not yet due was not 'open'")
        # L-P10 at append: the two real historical estimates are refused; a reading, a bound and a forecast are not.
        pe = os.path.join(d, "EST.jsonl")
        for bad in ("urllib reads 2026-09-30 ~02:21Z and 02:36Z", "a production build, 2026-09-29 ~23:55-00:05Z",
                    "read at 02:2xZ", "memory_audit.py 0 FAIL / 0 WARN at 18:4x... bound"):
            try:
                append(pe, kind="finding", at="2026-09-29T05:00:00Z", **{**base, "verified": bad})
                fails.append(f"estimated time: {bad!r} was accepted in `verified`")
            except ValueError:
                pass
        for ok in ("date -u at the write: 23:56:24Z", "between 02:24:33Z and 02:31Z",
                   "pending: the first pass after the deploy (~15:18Z)"):
            try:
                append(pe, kind="finding", at="2026-09-29T05:00:00Z", **{**base, "verified": ok})
            except ValueError as ex:
                fails.append(f"estimated time: {ok!r} was refused ({ex})")

        def cmut(*changes):
            """(line index, {field: value or None to drop}) pairs applied, then the chain re-hashed."""
            out = list(cl)
            for i, change in changes:
                e = {**json.loads(out[i]), **change}
                for k in [k for k, v in change.items() if v is None]:
                    e.pop(k)
                out[i] = canonical(e)
            return rechain(out)
        anchor = (4, line_hash(good[3]))
        if verify(good, anchor=anchor, base=good[:2]):
            fails.append(f"a clean ledger failed: {verify(good, anchor=anchor, base=good[:2])}")
        edited = list(good)
        edited[1] = edited[1].replace('"outcome":"o"', '"outcome":"x"')
        swapped = [good[0], good[2], good[1], good[3]]

        def mutate(i, **change):
            """Line i changed and the WHOLE chain re-hashed after it, as a careful tamperer would: only the check
            under test (schema, anchor, base) can catch it, never a broken link."""
            out = list(good)
            e = {**json.loads(out[i]), **change}
            for k in [k for k, v in change.items() if v is None]:
                e.pop(k)
            out[i] = canonical(e)
            return rechain(out)

        rewritten = mutate(1, outcome="x")
        if verify(rewritten):
            fails.append(f"the re-chained control is not clean without an anchor: {verify(rewritten)}")
        cases = {
            "an edited middle line": (verify(edited), "prev does not match"),
            "a deleted middle line": (verify([good[0], good[2], good[3]]), "prev does not match"),
            "a reordered pair": (verify(swapped), "prev does not match"),
            "a re-chained rewrite of history (caught by the anchor)": (verify(rewritten, anchor=anchor), "anchor"),
            "a re-chained rewrite of history (caught by the base prefix)": (verify(rewritten, base=good[:2]),
                                                                          "append-only"),
            "a truncated tail": (verify(good[:3], anchor=anchor), "truncated"),
            "a removed base line": (verify(good[1:], base=good[:2]), "append-only"),
            "a non-canonical line": (verify(good[:3] + [json.dumps(json.loads(good[3]), indent=1).replace("\n", "")]),
                                     "canonical"),
            "an unknown kind": (verify(mutate(0, kind="oops")), "unknown kind"),
            "a correction naming nothing": (verify(mutate(3, corrects=None)), "must name what it corrects"),
            "an empty authorization": (verify(mutate(0, authorized_by=" ")), "authorized_by is empty"),
            "empty evidence": (verify(mutate(1, evidence=[])), "evidence must be"),
            "an action dated after its line": (verify(mutate(0, acted_at="2026-09-29T09:00:00Z")), "acted_at"),
            "a line dated before its predecessor": (verify(mutate(2, at="2026-09-29T00:30:00Z")), "is earlier than"),
            "a skipped seq": (verify(mutate(2, seq=7)), "at position"),
            "a commitment without a due time": (verify(cmut((0, {"due_at": None}))), "needs `due_at`"),
            "a commitment without a check": (verify(cmut((1, {"check": " "}))), "needs `check`"),
            "fulfilling a line that is not a commitment": (verify(cmut(
                (1, {"kind": "finding", "due_at": None, "check": None}), (2, {"fulfills": 2}))), "not a commitment"),
            "fulfilling a future line": (verify(cmut((2, {"fulfills": 9}))), "must be an earlier seq"),
        }
        for name, (errs, expect) in cases.items():
            if not any(expect in e for e in errs):
                fails.append(f"{name} was NOT caught by its own check ({expect!r}); got {errs}")
        try:
            with open(p, "a", encoding="utf-8") as f:
                f.write(edited[1] + "\n")
            append(p, kind="finding", **base)
            fails.append("append wrote onto a broken ledger")
        except ValueError:
            pass
    return fails


def _check_pr_cli(args) -> int:
    """check-pr's exit code. The PR's changed files are listed first with plain git: a PR that touches no ledger file
    passes before any ledger logic runs, so a bug in the checker can never block an unrelated merge. For a PR that
    does touch the ledger, any exception in the checker FAILS (closed). A failure to list the changed files at all
    (no base fetched) also fails: it cannot tell the two apart."""
    F = _fragments()
    try:
        _, files, moved = F.touched(ROOT, args.base, args.head)
    except Exception as ex:  # noqa: BLE001 - the reason is printed; the exit is 1
        print(f"LEDGER-PR: cannot list this PR's changed files against {args.base} ({ex}); fetch the base first")
        return 1
    if not files and not moved:
        print("check-pr: this PR touches no ledger file and does not move the STATE anchor: nothing to check")
        return 0
    try:
        problems, notes = F.check_pr(ROOT, args.base, args.head, pr_created_at=args.pr_created_at,
                                     head_ref=args.head_ref)
    except Exception as ex:  # noqa: BLE001 - fail CLOSED on a PR that touches the ledger
        problems, notes = [f"the checker failed on a PR that touches the ledger, so the check fails closed: {ex!r}"], []
    for n in notes:
        print(f"check-pr: {n}")
    for p in problems:
        print(f"LEDGER-PR: {p}")
    print(f"check-pr: {len(problems)} problem(s) in {len(files)} ledger file(s) changed"
          + (" (the STATE anchor moved)" if moved else ""))
    return 1 if problems else 0


def _fragments():
    """ledger_fragments, imported the way this module was (a package in tests, a script directory on the CLI)."""
    if __package__:
        from . import ledger_fragments
    else:
        import ledger_fragments
    return ledger_fragments


def _ref(value: str, flag: str):
    """A CLI reference: digits are a seq; '@frag:...' stays as written; anything else is refused (`corrects` also
    takes a free reference to where a claim was written)."""
    if value is None:
        return None
    if value.isdigit():
        return int(value)
    if value.startswith("@frag") or flag == "corrects":
        return value
    raise ValueError(f"--{flag} {value!r}: give a seq, '@frag:N' or '@frag:<name>:N'")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("append")
    a.add_argument("--kind", required=True, choices=sorted(KINDS))
    for k in ("actor", "target", "why", "authorized-by", "outcome", "verified", "rollback"):
        a.add_argument(f"--{k}", required=True)
    a.add_argument("--evidence", action="append", required=True)
    a.add_argument("--corrects", help="an earlier seq, @frag:N, @frag:<name>:N, or where the claim was written")
    a.add_argument("--at", help="--direct only: when the line is written (default now)")
    a.add_argument("--acted-at", help="when the action happened (a fragment line defaults to now)")
    a.add_argument("--reconstructed", action="store_true", help="written after the fact from records")
    a.add_argument("--due-at", help="commitment: when it will be checked (UTC ISO)")
    a.add_argument("--check", help="commitment: how it will be verified")
    a.add_argument("--fulfills", help="the commitment this line closes: a seq, @frag:N or @frag:<name>:N")
    a.add_argument("--direct", action="store_true",
                   help="write ACTIONS.jsonl itself (the fold, and PRs opened before the fragment protocol only)")
    a.add_argument("--fragment", help="the fragment's name (default: the branch's slug)")
    a.add_argument("--base", default="origin/dev", help="the base ref fragment names and references are read from")
    v = sub.add_parser("verify")
    v.add_argument("--base", help="the base branch's ledger; it must be a prefix of this one")
    sub.add_parser("head")
    sub.add_parser("open")
    sub.add_parser("selftest")
    fo = sub.add_parser("fold", help="fold the base's fragments into ACTIONS.jsonl in THIS checkout")
    fo.add_argument("--base", default="origin/dev")
    fo.add_argument("--at", help="the fold time (default now)")
    fp = sub.add_parser("fold-pr", help="fold dev's fragments in a temporary worktree and open the fold PR")
    fp.add_argument("--remote", default="origin")
    fp.add_argument("--base", default="dev")
    fp.add_argument("--dry-run", action="store_true")
    fp.add_argument("--replace", metavar="BRANCH", help="re-fold onto fresh dev and force-push this fold branch")
    fp.add_argument("--no-pr", action="store_true", help="push the branch but do not open the PR")
    fp.add_argument("--co-author", action="append", default=[], help="a Co-Authored-By trailer (repeatable)")
    fp.add_argument("--record-merges", action="store_true",
                    help="also record a reconstructed pr_merge line for every merge on the base the ledger lacks")
    fp.add_argument("--actor", help="--record-merges: who writes the reconstructed lines")
    rm = sub.add_parser("record-merges", help="append a reconstructed pr_merge line to this branch's fragment for "
                                              "every merge on the base that the ledger (folded + fragments) lacks")
    rm.add_argument("--actor", required=True)
    rm.add_argument("--base", default="origin/dev")
    rm.add_argument("--fragment", help="the fragment's name (default: the branch's slug)")
    cp = sub.add_parser("check-pr", help="CI: is this PR's change to the ledger legal?")
    cp.add_argument("--base", required=True, help="the base ref, e.g. origin/dev")
    cp.add_argument("--head", default="HEAD")
    cp.add_argument("--pr-created-at", help="the PR's created_at (UTC ISO); before the protocol landed = legacy")
    cp.add_argument("--head-ref", help="the PR's branch (a ledger-fold/ branch is a fold)")
    args = ap.parse_args(argv)
    if args.cmd == "append":
        fields = {"kind": args.kind, "target": args.target, "why": args.why, "authorized_by": args.authorized_by,
                  "outcome": args.outcome, "verified": args.verified, "rollback": args.rollback,
                  "evidence": args.evidence,
                  "actor": args.actor}
        for k in ("corrects", "fulfills"):
            if getattr(args, k) is not None:
                fields[k] = _ref(getattr(args, k), k)
        if args.acted_at:
            fields["acted_at"] = args.acted_at
        if args.reconstructed:
            fields["reconstructed"] = True
        for k in ("due_at", "check"):
            if getattr(args, k) is not None:
                fields[k] = getattr(args, k)
        if args.direct:
            if args.at:
                fields["at"] = args.at
            if any(isinstance(fields.get(k), str) and fields[k].startswith("@frag") for k in ("corrects", "fulfills")):
                raise ValueError("an @frag reference belongs in a fragment, not in a --direct line")
            e = append(LEDGER, **fields)
            print(f"appended seq {e['seq']} ({e['kind']} {e['target']})")
            print(head(read_lines(LEDGER)))
            return 0
        if args.at:
            raise ValueError("--at is the fold's (a fragment line has none); --acted-at says when the action happened")
        name, n, e = _fragments().append_fragment(ROOT, fields, name=args.fragment, base_ref=args.base)
        print(f"appended ledger.d/{name}.jsonl:{n} ({e['kind']} {e['target']})")
        print(f"cite it as ledger.d/{name}.jsonl:{n} (or @frag:{n} from your own fragment) until the fold gives it "
              f"a seq; commit the fragment with your PR")
        return 0
    if args.cmd == "head":
        print(head(read_lines(LEDGER)))
        return 0
    if args.cmd == "open":
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        F = _fragments()
        texts, problems = F.read_dir_fragments(os.path.dirname(LEDGER))
        order = F.working_order(ROOT, list(texts))
        lines, labels, errs = F.virtual_ledger(read_lines(LEDGER), [(n, texts[n]) for n in order], now)
        cs = [c for c in commitments(lines, now) if c["status"] != "fulfilled"]
        for c in cs:
            where = labels.get(c["seq"], f"seq {c['seq']:>4}")
            print(f"{c['status'].upper():8s} {where} due {c['due_at']}  {c['target']}  -- check: {c['check']}")
        for p in problems + errs:
            print(f"FRAGMENT: {p}")
        print(f"commitments: {len(cs)} open ({sum(c['status'] == 'overdue' for c in cs)} overdue)")
        return 0
    if args.cmd == "selftest":
        fails = selftest() + [f"fragments: {f}" for f in _fragments().selftest()]
        for f in fails:
            print(f"SELFTEST FAIL: {f}")
        print("selftest: every tamper detected" if not fails else f"selftest: {len(fails)} failure(s)")
        return 1 if fails else 0
    if args.cmd == "fold":
        s = _fragments().fold(ROOT, args.base, at=args.at)
        for n, k, first in s["folded"]:
            print(f"folded ledger.d/{n}.jsonl: {k} line(s) -> seq {first}-{first + k - 1}")
        print(s["head"] or "nothing to fold")
        return 0
    if args.cmd == "fold-pr":
        if args.record_merges and not args.actor:
            raise ValueError("--record-merges needs --actor (who writes the reconstructed lines)")
        _fragments().fold_pr(ROOT, remote=args.remote, base=args.base, dry_run=args.dry_run, replace=args.replace,
                             open_pr=not args.no_pr, co_authors=args.co_author,
                             record_actor=args.actor if args.record_merges else None)
        return 0
    if args.cmd == "record-merges":
        if __package__:
            from . import ledger_merges as LM
        else:
            import ledger_merges as LM
        done = LM.record_merges(ROOT, args.base, LM.ledger_as_it_will_be(ROOT), args.actor, name=args.fragment)
        print(f"record-merges: {len(done)} pr_merge line(s) recorded" + (f" ({', '.join(f'#{n}' for n in done)})"
                                                                           if done else ""))
        return 0
    if args.cmd == "check-pr":
        return _check_pr_cli(args)
    lines = read_lines(LEDGER)
    base = read_lines(args.base) if args.base else None
    anchor = read_anchor()
    errs = verify(lines, anchor=anchor, base=base)
    # "0 of 0" is blindness, not a pass (LESSONS L-S4): an empty ledger or an unanchored one proves nothing.
    if not lines:
        errs.append("the ledger is empty")
    if anchor is None:
        errs.append("STATE.md publishes no `Ledger head: seq N, sha256 H` anchor")
    for e in errs:
        print(f"LEDGER: {e}")
    print(f"ledger: {len(lines)} entries, {'OK' if not errs else f'{len(errs)} problem(s)'}")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
