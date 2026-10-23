"""ledger_fragments.py — per-PR ledger FRAGMENTS, and the FOLD that chains them into ACTIONS.jsonl in merge order.

WHY. The owner, 2026-10-22 23:11 EDT: "Yes: build the per-PR ledger fragments (ledger.d/<pr>.jsonl folded into
ACTIONS.jsonl in merge order) so PRs stop colliding and auto-merge runs unattended. Keep the hash chain intact."
Until then every PR appended its lines to ACTIONS.jsonl and moved STATE's anchor, so any two open PRs claimed the
same seq. The second to merge conflicted, the lead re-chained it by hand and CI ran again (~25 min): on 2026-10-22
about 15 merges, most of them re-chained, and auto-merge could never run unattended.

THE PROTOCOL (D-0XX; README "Write rules"; BRAIN_RULES §23)
  * A PR never edits ACTIONS.jsonl or the STATE anchor. `action_ledger.py append` writes its lines to
    docs/weather-program/ledger.d/<branch-slug>.jsonl: every validated field, but NO seq/prev/at (only the fold writes
    those). `acted_at` is when the line was written unless the action is recorded late (`--acted-at`).
  * REFERENCES (`fulfills`, `corrects`): an int is a seq already in ACTIONS.jsonl; "@frag:N" is line N of the same
    fragment; "@frag:<name>:N" is line N of a fragment already merged to dev, folded or not.
  * THE FOLD (`action_ledger.py fold-pr`, run by the lead) appends every fragment on dev to ACTIONS.jsonl in MERGE
    ORDER (the order the files were added to dev's first-parent history; line order within a file), with the normal
    chain: seq, prev, `at` = the fold time. Each folded line keeps `"fragment": "<name>:<line>"` (provenance: how
    "@frag:<name>:N" resolves after the file is gone). It verifies the whole chain, moves the STATE anchor,
    content-matches every fragment line against ACTIONS.jsonl and only then deletes the folded files, in the same
    commit. Git history keeps the fragments. A GitHub workflow cannot do this: dev's ruleset 25675068 requires the
    11 ci.yml jobs with no bypass (no direct push), and a PR opened with GITHUB_TOKEN triggers no CI.
  * GUARDS (`check-pr`, in the Weather Program Ledger workflow): a PR that edits ACTIONS.jsonl or moves the anchor
    fails unless it is a fold whose lines EQUAL the fold recomputed from dev, or a LEGACY PR (opened before this
    protocol landed: before the commit that added ledger.d/README.md to the base). Merged fragments are immutable,
    a fragment name is never reused, and every fragment line validates. memory_audit runs a VIRTUAL fold, so a
    fragment's commitments, fulfilments and corrections count before the lead folds them.
Standard library only.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

try:
    from . import action_ledger as L  # imported as scripts.ledger_fragments (tests)
except ImportError:
    import action_ledger as L  # noqa: E402 - run from backend/scripts (the CLI, memory_audit)

LEDGER_REL = "docs/weather-program/ACTIONS.jsonl"
STATE_REL = "docs/weather-program/STATE.md"
FRAG_DIR_REL = "docs/weather-program/ledger.d"
SENTINEL_REL = FRAG_DIR_REL + "/README.md"    # its first commit on the base is when the protocol LANDED
NAME_RE = re.compile(r"[a-z0-9][a-z0-9._-]{0,119}")
REF_RE = re.compile(r"@frag:(?:([a-z0-9][a-z0-9._-]{0,119}):)?([1-9][0-9]*)")
FOLD_ONLY_KEYS = ("seq", "prev", "at", "fragment")
FOLD_BRANCH_PREFIX = "ledger-fold/"
FOLD_TRAILER = "Ledger-Fold:"


class LedgerError(ValueError):
    pass


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def label(name: str, i: int) -> str:
    return f"ledger.d/{name}.jsonl:{i}"


def frag_path(root: str, name: str) -> str:
    return os.path.join(root, *FRAG_DIR_REL.split("/"), f"{name}.jsonl")


def split_lines(text: str) -> list:
    return text.split("\n")[:-1] if text.endswith("\n") else (text.split("\n") if text else [])


def slug(branch: str) -> str:
    """'claude/clever-wozniak-c0485c' -> 'claude--clever-wozniak-c0485c'. PURE."""
    s = re.sub(r"[^a-z0-9._-]", "-", branch.strip().lower().replace("/", "--"))
    s = re.sub(r"^[^a-z0-9]+", "", s)[:110]
    if not NAME_RE.fullmatch(s or "-"):
        raise LedgerError(f"cannot make a fragment name from the branch {branch!r}: pass --fragment NAME")
    return s


# ── the fold itself (PURE) ───────────────────────────────────────────────────────────────────────────────────────
def _resolve(value, key, name, i, prov, folded_len, errs):
    """A reference made concrete: an int stays (it must already be folded), "@frag:..." becomes its seq."""
    if isinstance(value, bool):
        errs.append(f"{key} {value!r} is not a reference")
        return value
    if isinstance(value, int):
        if not 1 <= value <= folded_len:
            errs.append(f"{key} {value} must be a seq already in ACTIONS.jsonl (1-{folded_len}); a line that is not "
                        f"folded yet is named '@frag:<name>:N'")
        return value
    if isinstance(value, str) and value.startswith("@frag"):
        m = REF_RE.fullmatch(value)
        if not m:
            errs.append(f"{key} {value!r} is not '@frag:N' or '@frag:<name>:N'")
            return value
        ref_name, n = m.group(1) or name, int(m.group(2))
        if ref_name == name and n >= i:
            errs.append(f"{key} {value!r} must name an EARLIER line of this fragment")
            return value
        seq = prov.get(f"{ref_name}:{n}")
        if seq is None:
            errs.append(f"{key} {value!r} does not resolve: {label(ref_name, n)} is neither folded nor earlier in "
                        f"this fold (a cross-fragment reference names a fragment already merged to dev)")
            return value
        return seq
    if key == "corrects" and isinstance(value, str) and value.strip():
        return value      # a named place a claim was written ("log/2026-10-22-x.md §2")
    errs.append(f"{key} {value!r} is not a seq, '@frag:N', '@frag:<name>:N'"
                + (" or a reference" if key == "corrects" else ""))
    return value


def fold_entries(ledger_lines: list, fragments: list, at: str):
    """Chain `fragments` ([(name, text)], in fold order) onto `ledger_lines`. Returns (new_lines, errors). PURE.
    A new line is its fragment entry with references resolved, plus seq, prev, `at` (the fold time) and `fragment`.
    Errors name the fragment line; an erroneous line is still chained so later positions stay meaningful."""
    errs, prov, kinds, new, seen = [], {}, {}, [], set()
    for line in ledger_lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            kinds[e.get("seq")] = e.get("kind")
            if isinstance(e.get("fragment"), str):
                prov[e["fragment"]] = e.get("seq")
    folded_len = len(ledger_lines)
    prev = L.line_hash(ledger_lines[-1]) if ledger_lines else L.GENESIS
    try:
        last_at = str(json.loads(ledger_lines[-1]).get("at", "")) if ledger_lines else ""
    except (ValueError, AttributeError):
        last_at = ""
    if not L.AT_RE.match(str(at)):
        errs.append(f"the fold time {at!r} is not UTC ISO (YYYY-MM-DDTHH:MM:SSZ)")
    elif last_at and str(at) < last_at:
        errs.append(f"the fold time {at} is earlier than the ledger's last line ({last_at})")
    for name, text in fragments:
        if not NAME_RE.fullmatch(name):
            errs.append(f"ledger.d/{name}.jsonl: a fragment name must match {NAME_RE.pattern}")
        if name in seen:
            errs.append(f"ledger.d/{name}.jsonl: the same fragment twice in one fold")
            continue
        seen.add(name)
        if text and not text.endswith("\n"):
            errs.append(f"ledger.d/{name}.jsonl: the last line has no newline (a partial write?)")
        raw_lines = split_lines(text)
        if not raw_lines:
            errs.append(f"ledger.d/{name}.jsonl: empty (a fragment holds at least one line)")
        for i, raw in enumerate(raw_lines, 1):
            seq, bad = folded_len + len(new) + 1, []
            try:
                e = json.loads(raw)
            except ValueError as ex:
                errs.append(f"{label(name, i)}: not JSON ({ex})")
                continue
            if not isinstance(e, dict):
                errs.append(f"{label(name, i)}: not an object")
                continue
            if L.canonical(e) != raw:
                bad.append("not canonical (written by hand? use action_ledger.py append)")
            bad += [f"carries `{k}`, which only the fold writes" for k in FOLD_ONLY_KEYS if k in e]
            if "acted_at" not in e:
                bad.append("lacks `acted_at` (append records when the line was written)")
            entry = {k: v for k, v in e.items() if k not in FOLD_ONLY_KEYS}
            for key in ("fulfills", "corrects"):
                if key in entry:
                    entry[key] = _resolve(entry[key], key, name, i, prov, folded_len, bad)
            entry.update(seq=seq, prev=prev, at=at, fragment=f"{name}:{i}")
            bad += L.check_entry(entry, seq)
            f_ = entry.get("fulfills")
            if isinstance(f_, int) and not isinstance(f_, bool) and 1 <= f_ < seq and kinds.get(f_) != "commitment":
                bad.append(f"fulfills seq {f_}, which is not a commitment")
            target_problem = L.pr_merge_target_problem(entry.get("kind"), entry.get("target"))
            if target_problem:
                bad.append(target_problem)
            est = L.estimated_time_in_verified(entry.get("verified"))
            if est:
                bad.append(f"an estimated time in `verified` ({est!r}): give a reading or a bound (LESSONS L-P10)")
            errs += [f"{label(name, i)}: {m}" for m in bad]
            out = L.canonical(entry)
            new.append(out)
            prov[f"{name}:{i}"], kinds[seq], prev = seq, entry.get("kind"), L.line_hash(out)
    return new, errs


def content_mismatches(ledger_lines: list, fragments: list) -> list:
    """Every line of every fragment ([(name, text)], in fold order) must be in the ledger exactly once, field for
    field (its references resolved), and in that order. The check that runs before a fragment file is removed. PURE."""
    by_frag = {}
    for line in ledger_lines:
        e = json.loads(line)
        if isinstance(e.get("fragment"), str):
            by_frag.setdefault(e["fragment"], []).append(e)
    prov = {k: v[0]["seq"] for k, v in by_frag.items()}
    problems, last_seq = [], 0
    for name, text in fragments:
        for i, raw in enumerate(split_lines(text), 1):
            key, found = f"{name}:{i}", by_frag.get(f"{name}:{i}", [])
            if len(found) != 1:
                problems.append(f"{label(name, i)} is in ACTIONS.jsonl {len(found)} times, not once")
                continue
            x, e = found[0], json.loads(raw)
            for k in ("fulfills", "corrects"):
                m = REF_RE.fullmatch(e[k]) if isinstance(e.get(k), str) else None
                if m:
                    e[k] = prov.get(f"{m.group(1) or name}:{m.group(2)}")
            want = {**e, "seq": x["seq"], "prev": x["prev"], "at": x["at"], "fragment": key}
            if L.canonical(want) != L.canonical(x):
                problems.append(f"{label(name, i)}: ACTIONS.jsonl seq {x['seq']} differs from it")
            if x["seq"] <= last_seq:
                problems.append(f"{label(name, i)} is seq {x['seq']}, not after seq {last_seq}: out of merge order")
            last_seq = max(last_seq, x["seq"])
    return problems


def virtual_ledger(ledger_lines: list, fragments: list, now: str = None):
    """ACTIONS + the fragments as the next fold would chain them: (lines, {seq: fragment label}, errors). PURE but
    for the clock. What memory_audit and `open` read, so unfolded commitments and corrections count."""
    at = now or now_utc()
    try:
        last = str(json.loads(ledger_lines[-1]).get("at", "")) if ledger_lines else ""
    except (ValueError, AttributeError):
        last = ""
    new, errs = fold_entries(ledger_lines, fragments, max(at, last))
    labels = {}
    for x in new:
        e = json.loads(x)
        n, _, i = e["fragment"].rpartition(":")
        labels[e["seq"]] = label(n, int(i))
    return ledger_lines + new, labels, errs


# ── git ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def git(root: str, *args, binary: bool = False):
    r = subprocess.run(["git", *args], cwd=root, capture_output=True, timeout=300)
    if r.returncode != 0:
        raise LedgerError(f"git {' '.join(args)} failed: {r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout if binary else r.stdout.decode("utf-8")


def show(root: str, ref: str, rel: str):
    """The file at `ref` (exact bytes as text), or None when it does not exist there."""
    r = subprocess.run(["git", "show", f"{ref}:{rel}"], cwd=root, capture_output=True, timeout=120)
    return r.stdout.decode("utf-8") if r.returncode == 0 else None


def fragment_adds(root: str, ref: str) -> list:
    """[(name, commit)] for each fragment ADDED on `ref`'s first-parent history, oldest first: the merge order (dev
    squash-merges, so one first-parent commit per PR; several files added by one commit come in path order)."""
    if git(root, "rev-parse", "--is-shallow-repository").strip() != "false":
        raise LedgerError("a shallow clone cannot see the merge order: fetch the full history (fetch-depth: 0)")
    out = git(root, "log", "--first-parent", "--diff-merges=first-parent", "--diff-filter=A", "--reverse",
              "--name-only", "--format=%x00%H", ref, "--", FRAG_DIR_REL)
    adds, commit, prefix = [], None, FRAG_DIR_REL + "/"
    for tok in out.split("\n"):
        if tok.startswith("\x00"):
            commit = tok[1:].strip()
        elif tok.startswith(prefix) and tok.endswith(".jsonl") and "/" not in tok[len(prefix):]:
            adds.append((tok[len(prefix):-len(".jsonl")], commit))
    return adds


def tree_fragments(root: str, ref: str) -> list:
    out = git(root, "ls-tree", "--name-only", ref, "--", FRAG_DIR_REL + "/")
    return sorted(p.rsplit("/", 1)[-1] for p in out.split("\n") if p.strip())


def pending_on_ref(root: str, ref: str) -> list:
    """The fragments in `ref`'s tree, in merge order: [(name, text)]. Refuses a reused name, a file whose add is not
    in the history, and a file that is not a fragment."""
    adds = [n for n, _ in fragment_adds(root, ref)]
    reused = sorted({n for n in adds if adds.count(n) > 1})
    if reused:
        raise LedgerError(f"fragment name(s) added more than once on {ref}: {reused} (a name is never reused)")
    files = tree_fragments(root, ref)
    stray = [f for f in files if f != "README.md" and not (f.endswith(".jsonl") and NAME_RE.fullmatch(f[:-6]))]
    if stray:
        raise LedgerError(f"ledger.d on {ref} holds files that are not fragments: {stray}")
    present = {f[:-6] for f in files if f.endswith(".jsonl")}
    missing = sorted(present - set(adds))
    if missing:
        raise LedgerError(f"no add commit found for fragment(s) {missing} on {ref}'s first-parent history")
    return [(n, show(root, ref, f"{FRAG_DIR_REL}/{n}.jsonl")) for n in adds if n in present]


def landing_time(root: str, ref: str):
    """When the fragment protocol landed on `ref` (its README's first commit there), or None if it has not."""
    out = git(root, "log", "--first-parent", "--diff-merges=first-parent", "--diff-filter=A", "--reverse",
              "--format=%cI", ref, "--", SENTINEL_REL).split()
    return out[0] if out else None


def _utc(s: str) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)


def working_order(root: str, docs_names: list) -> list:
    """`docs_names` ordered as the next fold would take them: by their add on HEAD's history, then the uncommitted
    ones by name. Without the history (a shallow clone, no git), by name."""
    try:
        adds = [n for n, _ in fragment_adds(root, "HEAD")]
    except (LedgerError, OSError, subprocess.SubprocessError):
        adds = []
    first = [n for n in dict.fromkeys(adds) if n in docs_names]
    return first + sorted(set(docs_names) - set(first))


def read_dir_fragments(docs_dir: str):
    """({name: text}, [problems]) for docs_dir/ledger.d. PURE but for the reads."""
    d, out, problems = os.path.join(docs_dir, "ledger.d"), {}, []
    if not os.path.isdir(d):
        return out, problems
    for f in sorted(os.listdir(d)):
        if f == "README.md":
            continue
        if not (f.endswith(".jsonl") and NAME_RE.fullmatch(f[:-6])):
            problems.append(f"ledger.d/{f} is not a fragment (<name>.jsonl, name matching {NAME_RE.pattern})")
            continue
        with open(os.path.join(d, f), encoding="utf-8", newline="") as fh:
            out[f[:-6]] = fh.read()
    return out, problems


# ── append ───────────────────────────────────────────────────────────────────────────────────────────────────────
def default_name(root: str, base_ref: str = None) -> str:
    """The branch's slug; `-2`, `-3`... when that name was ever used on the base (a reused branch name): a merged
    fragment is never appended to."""
    branch = git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()
    if branch == "HEAD":
        raise LedgerError("a detached HEAD has no branch to name the fragment after: pass --fragment NAME")
    stem = slug(branch)
    for k in range(1, 100):
        cand = stem if k == 1 else f"{stem}-{k}"
        try:
            used = bool(base_ref) and bool(git(root, "log", "-1", "--format=%H", base_ref, "--",
                                               f"{FRAG_DIR_REL}/{cand}.jsonl").strip())
        except LedgerError:
            used = False       # no such base ref here (a clone without the remote): the slug stands
        if not used:
            return cand
    raise LedgerError(f"no free fragment name for {stem!r}: pass --fragment NAME")


def _context(root: str, base_ref: str, name: str):
    """(ledger lines, [(name, text)] of the OTHER fragments) to validate a new line against: the base's state when it
    is reachable (a cross-fragment reference must name a fragment already merged there), else this checkout's."""
    wt_ledger = L.read_lines(os.path.join(root, *LEDGER_REL.split("/")))
    base_text = show(root, base_ref, LEDGER_REL) if base_ref else None
    if base_text is None:
        texts, _ = read_dir_fragments(os.path.join(root, "docs", "weather-program"))
        return wt_ledger, [(n, t) for n, t in sorted(texts.items()) if n != name]
    base_ledger = split_lines(base_text)
    ledger = wt_ledger if wt_ledger[:len(base_ledger)] == base_ledger else base_ledger
    return ledger, [(n, t) for n, t in pending_on_ref(root, base_ref) if n != name]


def append_fragment(root: str, fields: dict, name: str = None, base_ref: str = "origin/dev", now: str = None):
    """Validate ONE line in context, then append it to ledger.d/<name>.jsonl. Returns (name, line number, entry)."""
    name = name or default_name(root, base_ref)
    if not NAME_RE.fullmatch(name):
        raise LedgerError(f"a fragment name must match {NAME_RE.pattern}; got {name!r}")
    stray = [k for k in FOLD_ONLY_KEYS if k in fields]
    if stray:
        raise LedgerError(f"a fragment line carries no {stray}: only the fold writes seq, prev, at and fragment "
                          f"(--acted-at says when the action happened)")
    entry = {**fields}
    entry.setdefault("acted_at", now or now_utc())
    path = frag_path(root, name)
    existing = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8", newline="") as f:
            existing = f.read()
    if existing and not existing.endswith("\n"):
        raise LedgerError(f"ledger.d/{name}.jsonl: the last line has no newline (a partial write?)")
    base_known = bool(base_ref) and show(root, base_ref, LEDGER_REL) is not None
    for key in ("fulfills", "corrects"):
        m = REF_RE.fullmatch(entry[key]) if isinstance(entry.get(key), str) else None
        if m and m.group(1) and m.group(1) != name and base_known:
            if m.group(1) not in {n for n, _ in fragment_adds(root, base_ref)}:
                raise LedgerError(f"{key} {entry[key]!r}: ledger.d/{m.group(1)}.jsonl is not on {base_ref}; a "
                                  f"cross-fragment reference names a fragment already merged to the base")
    line = L.canonical(entry)
    ledger, others = _context(root, base_ref if base_known else None, name)
    last = str(json.loads(ledger[-1]).get("at", "")) if ledger else ""
    n = len(split_lines(existing)) + 1
    _, errs = fold_entries(ledger, others + [(name, existing + line + "\n")], max(entry["acted_at"], last))
    mine = [e for e in errs if e.startswith(f"ledger.d/{name}.jsonl")]
    if mine:
        raise LedgerError("refusing the line:\n  " + "\n  ".join(mine))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="") as f:
        f.write(line + "\n")
    return name, n, entry


# ── fold ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def anchor_of(text):
    """(seq, sha256) of the `Ledger head:` anchor in a STATE text, or None. PURE."""
    m = L.ANCHOR_RE.search(text or "")
    return (int(m.group(1)), m.group(2)) if m else None


def move_anchor(state_path: str, head_line: str) -> None:
    """Replace STATE's one `Ledger head: seq N, sha256 H` with `head_line` (exact-string edit; refuses 0 or 2+)."""
    with open(state_path, encoding="utf-8", newline="") as f:
        text = f.read()
    found = list(L.ANCHOR_RE.finditer(text))
    if len(found) != 1:
        raise LedgerError(f"STATE.md holds {len(found)} `Ledger head:` anchors, not one")
    m = found[0]
    with open(state_path, "w", encoding="utf-8", newline="") as f:
        f.write(text[:m.start()] + head_line + text[m.end():])


def fold(root: str, base_ref: str, at: str = None) -> dict:
    """Fold every fragment on `base_ref` into ACTIONS.jsonl in the checkout at `root` (which must hold the base's
    ledger and fragments unchanged): append, verify, move the anchor, content-match, THEN delete the fragments."""
    frags = pending_on_ref(root, base_ref)
    lp, sp = os.path.join(root, *LEDGER_REL.split("/")), os.path.join(root, *STATE_REL.split("/"))
    summary = {"folded": [], "first_seq": None, "last_seq": None, "head": None, "at": None}
    if not frags:
        return summary
    with open(lp, encoding="utf-8", newline="") as f:
        ledger_text = f.read()
    if ledger_text != show(root, base_ref, LEDGER_REL):
        raise LedgerError(f"ACTIONS.jsonl here differs from {base_ref}'s: fold from a clean checkout of the base "
                          f"(`action_ledger.py fold-pr` does)")
    for name, text in frags:
        with open(frag_path(root, name), encoding="utf-8", newline="") as f:
            if f.read() != text:
                raise LedgerError(f"ledger.d/{name}.jsonl here differs from {base_ref}'s copy")
    old = L.read_lines(lp)
    at = at or now_utc()
    new, errs = fold_entries(old, frags, at)
    errs += L.verify(old + new, base=old) + content_mismatches(old + new, frags)
    if errs:
        raise LedgerError("refusing the fold:\n  " + "\n  ".join(errs))
    with open(sp, encoding="utf-8", newline="") as f:
        state_text = f.read()
    try:
        with open(lp, "a", encoding="utf-8", newline="") as f:
            f.write("".join(x + "\n" for x in new))
        move_anchor(sp, L.head(old + new))
        lines, anchor = L.read_lines(lp), L.read_anchor(sp)
        errs = L.verify(lines, anchor=anchor, base=old) + content_mismatches(lines, frags)
        if anchor != (len(lines), L.line_hash(lines[-1])):
            errs.append(f"the anchor {anchor} is not the new head")
        if errs:
            raise LedgerError("the written fold does not verify:\n  " + "\n  ".join(errs))
    except Exception:
        with open(lp, "w", encoding="utf-8", newline="") as f:
            f.write(ledger_text)
        with open(sp, "w", encoding="utf-8", newline="") as f:
            f.write(state_text)
        raise
    for name, _ in frags:
        os.remove(frag_path(root, name))
    first = len(old) + 1
    for name, text in frags:
        k = len(split_lines(text))
        summary["folded"].append((name, k, first))
        first += k
    summary.update(first_seq=len(old) + 1, last_seq=len(lines), head=L.head(lines), at=at)
    return summary


# ── check-pr: the guard ──────────────────────────────────────────────────────────────────────────────────────────
def touched(root: str, base_ref: str, head: str = "HEAD"):
    """(merge-base, [(status, path)] of the ledger files the PR changes, anchor moved?). Plain git and no ledger
    logic, so a bug in the checker below can never fail a PR that touches no ledger file."""
    mb = git(root, "merge-base", base_ref, head).strip()
    diff = [ln.split("\t", 1) for ln in git(root, "diff", "--no-renames", "--name-status", mb, head).split("\n")
            if "\t" in ln]
    files = [(s, p) for s, p in diff if p == LEDGER_REL or p.startswith(FRAG_DIR_REL + "/")]
    moved = any(p == STATE_REL for _, p in diff) and \
        anchor_of(show(root, mb, STATE_REL)) != anchor_of(show(root, head, STATE_REL))
    return mb, files, moved


def check_pr(root: str, base_ref: str, head: str = "HEAD", pr_created_at: str = None, head_ref: str = None):
    """(problems, notes) for one PR. A PR that touches no ledger file returns ([], [note]) before any ledger logic."""
    mb, files, moved = touched(root, base_ref, head)
    if not files and not moved:
        return [], ["this PR touches no ledger file and does not move the STATE anchor"]
    problems, notes = [], []
    landing = landing_time(root, base_ref)
    is_fold = (head_ref or "").startswith(FOLD_BRANCH_PREFIX) or any(
        ln.startswith(FOLD_TRAILER) for ln in git(root, "log", "--format=%B", f"{mb}..{head}").split("\n"))
    legacy = landing is None or (bool(pr_created_at) and _utc(pr_created_at) < _utc(landing))
    ever = dict(fragment_adds(root, base_ref))
    pending = pending_on_ref(root, base_ref)
    added, deleted = [], []
    for status, path in files:
        f = path[len(FRAG_DIR_REL) + 1:]
        if path == LEDGER_REL or f == "README.md":
            continue
        name = f[:-6] if f.endswith(".jsonl") else ""
        if not NAME_RE.fullmatch(name):
            problems.append(f"ledger.d/{f}: only <name>.jsonl fragments (name matching {NAME_RE.pattern}) and "
                            f"README.md live in ledger.d")
        elif status == "A":
            if name in ever:
                problems.append(f"ledger.d/{name}.jsonl: a DUPLICATE fragment name, already added on {base_ref} in "
                                f"{ever[name][:12]}; a name is never reused (append picks <slug>-2)")
            added.append(name)
        elif status == "D":
            deleted.append(name)
            if not is_fold:
                problems.append(f"ledger.d/{name}.jsonl is deleted: only a fold removes a fragment")
        else:
            problems.append(f"ledger.d/{name}.jsonl is a fragment already on {base_ref}, and merged fragments are "
                            f"immutable: record a `correction` in your own fragment instead")
    base_ledger = split_lines(show(root, base_ref, LEDGER_REL) or "")
    head_ledger = split_lines(show(root, head, LEDGER_REL) or "")
    ctx = head_ledger if head_ledger[:len(base_ledger)] == base_ledger else base_ledger
    frags = [(n, t) for n, t in pending if n not in deleted] + \
        [(n, show(root, head, f"{FRAG_DIR_REL}/{n}.jsonl") or "") for n in sorted(added)]
    last = str(json.loads(ctx[-1]).get("at", "")) if ctx else ""
    problems += fold_entries(ctx, frags, max(now_utc(), last))[1]
    if any(p == LEDGER_REL for _, p in files) or moved:
        if is_fold:
            problems += _check_fold(root, head, base_ref, base_ledger, head_ledger, pending, deleted)
        elif legacy:
            notes.append(f"a LEGACY PR (opened {pr_created_at or '?'}, before the fragment protocol landed "
                         f"{landing or 'on this base'}): its direct ACTIONS.jsonl append is checked as before")
            problems += L.verify(head_ledger, anchor=anchor_of(show(root, head, STATE_REL)), base=base_ledger)
        else:
            problems.append(f"this PR edits ACTIONS.jsonl or moves the STATE anchor directly. Since {landing} "
                            f"(D-0XX) a PR's ledger lines go in its fragment: `action_ledger.py append ...` (without "
                            f"--direct). Only a fold PR (`action_ledger.py fold-pr`, branch {FOLD_BRANCH_PREFIX}...) "
                            f"writes ACTIONS.jsonl")
    if is_fold:
        notes.append(f"a FOLD PR folding {len(deleted)} fragment(s)")
    if added:
        notes.append(f"adds fragment(s): {', '.join(f'ledger.d/{n}.jsonl' for n in sorted(added))}")
    return problems, notes


def _check_fold(root, head, base_ref, base_ledger, head_ledger, pending, deleted) -> list:
    """A fold PR's ACTIONS.jsonl must EQUAL the fold, recomputed from the base, of exactly the fragments it deletes,
    which must be the oldest ones in merge order (a fold never skips a fragment, so no line jumps the queue)."""
    order, k = [n for n, _ in pending], len(deleted)
    if not k or sorted(deleted) != sorted(order[:k]):
        return [f"a fold takes the OLDEST fragments on {base_ref} in merge order: it deletes {sorted(deleted)}, the "
                f"first {k} are {order[:k]}"]
    if head_ledger[:len(base_ledger)] != base_ledger:
        return [f"{base_ref}'s ACTIONS.jsonl is not a prefix of the fold's: re-run `fold-pr --replace <branch>`"]
    extra = head_ledger[len(base_ledger):]
    if not extra:
        return ["a fold PR adds no ledger line"]
    expect, errs = fold_entries(base_ledger, pending[:k], json.loads(extra[0]).get("at"))
    problems = list(errs)
    if extra != expect:
        diff = next((i for i, (a, b) in enumerate(zip(extra, expect)) if a != b), min(len(extra), len(expect)))
        problems.append(f"the fold's lines are not the fold of {order[:k]} recomputed from {base_ref}: they first "
                        f"differ at seq {len(base_ledger) + diff + 1} ({len(extra)} lines written, {len(expect)} "
                        f"expected)")
    anchor = anchor_of(show(root, head, STATE_REL))
    if anchor != (len(head_ledger), L.line_hash(head_ledger[-1])):
        problems.append(f"the STATE anchor {anchor} is not the folded ledger's head")
    return problems + content_mismatches(head_ledger, pending[:k])


# ── fold-pr: the one command the lead runs ───────────────────────────────────────────────────────────────────────
def fold_pr(repo: str, remote: str = "origin", base: str = "dev", dry_run: bool = False, replace: str = None,
            open_pr: bool = True, co_authors=(), at: str = None, out=print) -> dict:
    """Fetch the base, fold it in a TEMPORARY worktree (the caller's checkout is untouched), commit with the
    `Ledger-Fold:` trailer, push `ledger-fold/<UTC stamp>` (or force-push `replace`), open the PR with the caller's
    gh login (a GITHUB_TOKEN PR would trigger no CI), and remove the worktree."""
    git(repo, "fetch", remote, f"+refs/heads/{base}:refs/remotes/{remote}/{base}")
    base_ref = f"{remote}/{base}"
    base_sha = git(repo, "rev-parse", base_ref).strip()
    tmp = tempfile.mkdtemp(prefix="ledger-fold-")
    wt = os.path.join(tmp, "wt")
    git(repo, "worktree", "add", "--detach", wt, base_sha)
    try:
        s = fold(wt, base_ref, at=at)
        if not s["folded"]:
            out(f"nothing to fold: {base_ref} @ {base_sha[:12]} holds no fragment")
            return s
        span = f"seq {s['first_seq']}-{s['last_seq']}"
        rows = [f"  ledger.d/{n}.jsonl: {k} line(s) -> seq {a}-{a + k - 1}" for n, k, a in s["folded"]]
        title = f"chore(ledger): fold {len(rows)} fragment(s) into ACTIONS.jsonl ({span})"
        body = "\n".join([
            f"Folds every ledger fragment on `{base}` @ {base_sha[:12]} into `ACTIONS.jsonl`, in merge order (the "
            f"order each file was added to `{base}`'s first-parent history; line order within a file):", "",
            *rows, "", f"STATE anchor -> `{s['head']}`. Fold time `at` = {s['at']}; each line keeps its `acted_at`.",
            "Every folded line carries `\"fragment\": \"<name>:<line>\"`; every fragment line was content-matched "
            "against ACTIONS.jsonl before its file was removed. `check-pr` (Weather Program Ledger workflow) "
            "recomputes this fold from the base and fails on any difference. Made by `action_ledger.py fold-pr` "
            "(D-0XX)."])
        out(title + "\n" + "\n".join(rows))
        s.update(title=title, body=body, base_sha=base_sha)
        if dry_run:
            out("dry run: nothing committed or pushed")
            return s
        branch = replace or f"{FOLD_BRANCH_PREFIX}{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        git(wt, "switch", "-q", "-C", branch)
        git(wt, "add", "-A", "--", "docs/weather-program")
        trailers = [f"{FOLD_TRAILER} {len(rows)} fragments, {span}"] + [f"Co-Authored-By: {c}" for c in co_authors]
        msg = os.path.join(tmp, "msg.txt")
        with open(msg, "w", encoding="utf-8", newline="\n") as f:
            f.write(title + "\n\n" + body + "\n\n" + "\n".join(trailers) + "\n")
        git(wt, "commit", "-q", "-F", msg)
        git(wt, "push", *(["--force"] if replace else []), remote, f"HEAD:refs/heads/{branch}")
        s.update(branch=branch, commit=git(wt, "rev-parse", "HEAD").strip())
        if open_pr and not replace:
            bf = os.path.join(tmp, "body.md")
            with open(bf, "w", encoding="utf-8", newline="\n") as f:
                f.write(body + "\n")
            r = subprocess.run(["gh", "pr", "create", "--base", base, "--head", branch, "--title", title,
                                "--body-file", bf], cwd=wt, capture_output=True, timeout=120)
            if r.returncode != 0:
                raise LedgerError(f"pushed {branch} but `gh pr create` failed: "
                                  f"{r.stderr.decode('utf-8', 'replace').strip()}")
            s["pr_url"] = r.stdout.decode("utf-8").strip()
        out(f"pushed {branch} @ {s['commit']}" + (f"; PR {s['pr_url']}" if s.get("pr_url") else ""))
        return s
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", wt], cwd=repo, capture_output=True, timeout=120)
        shutil.rmtree(tmp, ignore_errors=True)


# ── selftest (no git): the fold and its checks catch what they claim to ─────────────────────────────────────────
def selftest() -> list:
    fails = []
    base = dict(actor="selftest", target="t", why="w", authorized_by="a", outcome="o", verified="v", rollback="r",
                evidence=["e"])
    led = []
    for i, kind in enumerate(("commitment", "finding"), 1):
        extra = {"due_at": "2026-10-23T06:00:00Z", "check": "c"} if kind == "commitment" else {}
        led.append(L.canonical(L.make_entry(led, kind=kind, at=f"2026-10-23T0{i}:00:00Z", **base, **extra)))

    def frag(*entries):
        return "".join(L.canonical({"acted_at": "2026-10-23T02:30:00Z", **base, **e}) + "\n" for e in entries)
    a = frag({"kind": "commitment", "due_at": "2026-10-24T00:00:00Z", "check": "read it"},
             {"kind": "finding", "fulfills": "@frag:1"}, {"kind": "finding", "fulfills": 1})
    b = frag({"kind": "correction", "corrects": "@frag:a:2"}, {"kind": "pr_merge", "target": "#9"})
    at = "2026-10-23T03:00:00Z"
    good, errs = fold_entries(led, [("a", a), ("b", b)], at)
    full = led + good
    if errs or L.verify(full, base=led) or content_mismatches(full, [("a", a), ("b", b)]):
        fails.append(f"a clean fold is not clean: {errs} {L.verify(full, base=led)}")
    got = [(json.loads(x)["seq"], json.loads(x).get("fulfills"), json.loads(x).get("corrects")) for x in good]
    if got != [(3, None, None), (4, 3, None), (5, 1, None), (6, None, 4), (7, None, None)]:
        fails.append(f"references resolved wrong: {got}")
    later, errs = fold_entries(full, [("c", frag({"kind": "finding", "fulfills": "@frag:a:1"}))], at)
    if errs or json.loads(later[0])["fulfills"] != 3:
        fails.append(f"a reference to an already folded fragment did not resolve by provenance: {errs}")
    rechained = L.rechain(led + good[:1] + good[2:])
    cases = {
        "the fold in reversed merge order": (fold_entries(led, [("b", b), ("a", a)], at)[1], "does not resolve"),
        "lines checked against the reversed order": (content_mismatches(full, [("b", b), ("a", a)]),
                                                     "out of merge order"),
        "a dropped line (re-chained)": (content_mismatches(rechained, [("a", a), ("b", b)]), "0 times"),
        "an edited folded line": (content_mismatches(full[:3] + [full[3].replace('"o"', '"x"')] + full[4:],
                                                     [("a", a), ("b", b)]), "differs"),
        "a fragment line carrying seq": (fold_entries(led, [("d", frag({"kind": "finding", "seq": 3}))], at)[1],
                                         "only the fold writes"),
        "a hand-written (non-canonical) line": (fold_entries(led, [("d", '{"kind": "finding"}\n')], at)[1],
                                                "not canonical"),
        "a line without acted_at": (fold_entries(led, [("d", L.canonical({**base, "kind": "finding"}) + "\n")],
                                                 at)[1], "acted_at"),
        "a forward local reference": (fold_entries(led, [("d", frag({"kind": "finding", "fulfills": "@frag:1"}))],
                                                   at)[1], "EARLIER line"),
        "an int reference past the folded ledger": (fold_entries(led, [("d", frag({"kind": "finding",
                                                                                   "fulfills": 3}))], at)[1],
                                                    "already in ACTIONS.jsonl"),
        "fulfilling a finding": (fold_entries(led, [("d", frag({"kind": "finding", "fulfills": 2}))], at)[1],
                                 "not a commitment"),
        "a titled pr_merge target": (fold_entries(led, [("d", frag({"kind": "pr_merge", "target": "PR #9"}))],
                                                  at)[1], "pr_merge target"),
        "a fold dated before the ledger's head": (fold_entries(led, [("a", a)], "2026-10-23T00:00:00Z")[1],
                                                  "earlier than"),
    }
    for name, (errs, expect) in cases.items():
        if not any(expect in e for e in errs):
            fails.append(f"{name} was NOT caught ({expect!r}); got {errs}")
    return fails
