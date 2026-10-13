"""memory_audit.py — check the program's memory as a whole: the git record and the agent-local memory.

WHY. The owner, 2026-09-29: "give the memory system as a whole a big check over, we need to be state of the art".
Memory that is not checked rots quietly: a stale fact reads exactly like a true one (LESSONS L-S8). This turns the
check into a command, run at the start and end of a session and, for the git half, in CI.

WHAT IT CHECKS
  git record (docs/weather-program/):
    * the required files exist; the ACTION LEDGER verifies (chain, schema, STATE's anchor);
    * STATE.md's "Updated" date is not older than the newest session log;
    * DECISIONS ids are unique and increasing; SCOREBOARD rows have six columns and non-decreasing dates;
    * no secret-shaped or infrastructure-identifier text (the repo is public).
  COMPLETENESS AND CLOCK (2026-09-29, "upgrade the memories abilities"; each is a failure the integrity checks above
  could not see, and each happened in the session that added it):
    * every PR merge on this history since the ledger began has its `pr_merge #N` line. The NEWEST merge may still
      be pending (it is ledgered by the next PR), so it only WARNs; every older one FAILs. From git, so a shallow
      clone WARNs that it cannot check;
    * COMMITMENTS (action_ledger `commitment` lines): each OVERDUE one WARNs, and open ones are listed (NOTE), so a
      session starts with what the last one promised;
    * CLOCK: STATE's `Updated` time and the session logs' section-header times are not later than the moment they
      were committed (or now, for uncommitted edits): an estimate written as a timestamp FAILs (LESSONS L-P10).
      Every `## ` log header carrying an HH:MM(:SS)Z time is read (its last one), whatever its shape, and each
      claim is held to the commit that wrote THAT line (git blame), not the file's last commit. A committed log
      header that ran ahead passes only once a ledger `correction` names it (the log is append-only);
    * every "ledger seq N" cited in the docs exists (no reference past the head).
  agent-local memory (--memory-dir; skipped with --docs-only, as in CI):
    * MEMORY.md indexes every memory file and links only to files that exist;
    * each memory has name / description / metadata.type (user, feedback, project, reference), and its name matches
      its filename;
    * every [[link]] resolves;
    * FRESHNESS: `metadata.verified: YYYY-MM-DD` records when the fact was last checked against reality. A project
      or reference fact older than --stale-days (default 7) is STALE; user and feedback facts, 30 days. A memory
      with no `verified` date is UNVERIFIED. Stale is a warning, not a failure: it says "re-check before relying".
    * LONG: a project or reference memory over 60 lines WARNs. History belongs in the git logs; a local memory
      that accumulates dated blocks turns into a second, drifting STATE.

USAGE (repo root; standard library only):
  python backend/scripts/memory_audit.py --memory-dir "C:/Users/<you>/.claude/projects/<project>/memory"
  python backend/scripts/memory_audit.py --docs-only          # CI
  python backend/scripts/memory_audit.py --selftest           # proves each new check fires
Exit 1 on any FAIL; WARN lines never fail the run. NOTE lines are information.
⛔ Read the exit code of THIS command. `memory_audit ... | tail -1 && git push` gates on `tail` (LESSONS L-P13).
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import action_ledger  # noqa: E402

ROOT = action_ledger.ROOT
DOCS = os.path.join(ROOT, "docs", "weather-program")
REQUIRED_DOCS = ("README.md", "STATE.md", "DECISIONS.md", "SCOREBOARD.md", "LESSONS.md", "ACTIONS.jsonl")
MEMORY_TYPES = {"user", "feedback", "project", "reference"}
SLOW_TYPES = {"user", "feedback"}
LONG_LINES = 60
# ⬇ 5 min -> 1 min (2026-09-30 memory audit). An honest HH:MM reading can lead its commit only by minute rounding
# (< 60 s). The real L-P10 case this check exists for, HANDOFF-2026-09-30's '~01:45Z' committed at 01:40:18Z, led by
# 4 min 42 s and sat INSIDE the old 5-minute slack: the check could not have caught the mistake that motivated it.
CLOCK_SLACK = timedelta(minutes=1)
MERGE_RE = re.compile(r"^Merge pull request #(\d+) ")
SEQ_REF_RE = re.compile(r"(?i)\bledger seq (\d+)(?:\s*[-\u2013]\s*(\d+))?")
# Credential shapes and infrastructure identifiers that must never reach this PUBLIC repo (CLAUDE.md, first rule).
SECRET_RES = [re.compile(p) for p in (
    r"sb_secret_[A-Za-z0-9_]{6,}", r"sb_publishable_[A-Za-z0-9_]{6,}", r"eyJ[A-Za-z0-9_-]{20,}\.",
    r"ghp_[A-Za-z0-9]{20,}", r"github_pat_[A-Za-z0-9_]{20,}", r"sk_(live|test)_[A-Za-z0-9]{10,}",
    r"\bsrv-[a-z0-9]{16,}\b", r"\btea-[a-z0-9]{16,}\b", r"[A-Za-z0-9._%+-]+@gmail\.com")]


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def frontmatter(text: str) -> dict:
    """The small YAML subset memory files use: top-level `key: value` and one nested `metadata:` block. PURE."""
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    out, block = {}, None
    for raw in m.group(1).split("\n"):
        if not raw.strip():
            continue
        if raw.startswith("  ") and block is not None:
            k, _, v = raw.strip().partition(":")
            out[block][k.strip()] = v.strip().strip('"')
            continue
        k, _, v = raw.partition(":")
        k, v = k.strip(), v.strip()
        if v == "":
            out[k], block = {}, k
        else:
            out[k], block = v.strip('"'), None
    return out


def audit_memory(memory_dir: str, today: date, stale_days: int = 7) -> list:
    """[(level, message)] for the agent-local memory folder. PURE given the folder."""
    res = []
    idx_path = os.path.join(memory_dir, "MEMORY.md")
    if not os.path.exists(idx_path):
        return [("FAIL", f"no MEMORY.md in {memory_dir}")]
    index = _read(idx_path)
    files = sorted(f for f in os.listdir(memory_dir) if f.endswith(".md") and f != "MEMORY.md")
    names = {f[:-3] for f in files}
    for f in files:
        if f"({f})" not in index:
            res.append(("FAIL", f"{f} is not indexed in MEMORY.md"))
    for target in re.findall(r"\]\(([^)]+\.md)\)", index):
        if target not in files:
            res.append(("FAIL", f"MEMORY.md links to {target}, which does not exist"))
    for f in files:
        text = _read(os.path.join(memory_dir, f))
        fm = frontmatter(text)
        meta = fm.get("metadata") if isinstance(fm.get("metadata"), dict) else {}
        for key in ("name", "description"):
            if not fm.get(key):
                res.append(("FAIL", f"{f}: frontmatter lacks {key}"))
        if fm.get("name") and fm["name"] != f[:-3]:
            res.append(("FAIL", f"{f}: name {fm['name']!r} does not match the filename"))
        mtype = meta.get("type")
        if mtype not in MEMORY_TYPES:
            res.append(("FAIL", f"{f}: metadata.type {mtype!r} is not one of {sorted(MEMORY_TYPES)}"))
        for link in re.findall(r"\[\[([a-z0-9-]+)\]\]", text):
            if link not in names:
                res.append(("WARN", f"{f}: [[{link}]] names no memory yet"))
        verified = meta.get("verified")
        if not verified:
            res.append(("WARN", f"{f}: UNVERIFIED (no metadata.verified date)"))
            continue
        try:
            age = (today - datetime.strptime(verified, "%Y-%m-%d").date()).days
        except ValueError:
            res.append(("FAIL", f"{f}: metadata.verified {verified!r} is not YYYY-MM-DD"))
            continue
        limit = 30 if mtype in SLOW_TYPES else stale_days
        if age > limit:
            res.append(("WARN", f"{f}: STALE, last verified {verified} ({age} d > {limit} d): re-check before relying"))
        body_lines = text.split("\n---", 2)[-1].count("\n") if text.startswith("---") else text.count("\n")
        if mtype in ("project", "reference") and body_lines > LONG_LINES:
            res.append(("WARN", f"{f}: LONG ({body_lines} lines > {LONG_LINES}): move its history to the git logs"))
    for level, text in scan_secrets({f: _read(os.path.join(memory_dir, f)) for f in files}, allow_infra=True):
        res.append((level, text))
    return res


def scan_secrets(texts: dict, allow_infra: bool = False) -> list:
    """FAIL for credential-shaped text; infrastructure IDs are allowed only in agent-local memory. PURE."""
    res = []
    for name, text in texts.items():
        for rx in SECRET_RES:
            if allow_infra and rx.pattern.startswith((r"\bsrv-", r"\btea-", "[A-Za-z0-9._%+-]+@")):
                continue
            if rx.search(text):
                res.append(("FAIL", f"{name}: matches the secret/identifier pattern {rx.pattern}"))
    return res


def _row_time(cell: str) -> str:
    """'2026-09-29 11Z', '2026-09-29 ~23Z' or '2026-09-29 13:46Z' -> '2026-09-29 11:00' etc., so rows compare by time,
    not by string (a bare hour sorted after '11:24Z' as text). PURE."""
    m = re.match(r"(\d{4}-\d{2}-\d{2})(?:\s+~?(\d{1,2})(?::(\d{2}))?Z?)?", cell)
    if not m:
        return cell
    return f"{m.group(1)} {int(m.group(2) or 0):02d}:{m.group(3) or '00'}"


def scoreboard_dates_ordered(cells: list) -> bool:
    """Date-only rows constrain the UTC day, rather than falsely asserting midnight.

    Carry every prior explicit lower bound across coarse rows. An intervening bare
    date therefore cannot hide a later timestamp reversal or an earlier-day row.
    """
    earliest = ""
    for cell in cells:
        match = re.match(r"(\d{4}-\d{2}-\d{2})(?:\s+~?(\d{1,2})(?::(\d{2}))?Z?)?", cell)
        if not match:
            return False
        lower = _row_time(cell)
        try:
            datetime.strptime(lower, "%Y-%m-%d %H:%M")
        except ValueError:
            return False
        upper = lower if match[2] is not None else match[1] + " 23:59"
        if earliest > upper:
            return False
        earliest = max(earliest, lower)
    return True


def audit_docs(docs_dir: str = DOCS, state_path: str = None, ledger_path: str = None) -> list:
    """[(level, message)] for the git record. PURE given the folder."""
    res = []
    for f in REQUIRED_DOCS:
        if not os.path.exists(os.path.join(docs_dir, f)):
            res.append(("FAIL", f"docs/weather-program/{f} is missing"))
    if any(level == "FAIL" for level, _ in res):
        return res
    lines = action_ledger.read_lines(ledger_path or os.path.join(docs_dir, "ACTIONS.jsonl"))
    anchor = action_ledger.read_anchor(state_path or os.path.join(docs_dir, "STATE.md"))
    errs = action_ledger.verify(lines, anchor=anchor)
    if not lines:
        errs.append("the ledger is empty")
    if anchor is None:
        errs.append("STATE.md has no ledger anchor")
    res += [("FAIL", f"ACTIONS.jsonl: {e}") for e in errs]
    state = _read(state_path or os.path.join(docs_dir, "STATE.md"))
    m = re.search(r"\*\*Updated (\d{4}-\d{2}-\d{2})", state)
    logs = sorted(f for f in os.listdir(os.path.join(docs_dir, "log")) if re.match(r"\d{4}-\d{2}-\d{2}-.+\.md$", f)) \
        if os.path.isdir(os.path.join(docs_dir, "log")) else []
    if not m:
        res.append(("FAIL", "STATE.md has no **Updated YYYY-MM-DD** line"))
    elif logs and m.group(1) < logs[-1][:10]:
        res.append(("WARN", f"STATE.md was updated {m.group(1)} but the newest log is {logs[-1][:10]}"))
    ids = [int(x) for x in re.findall(r"^### D-(\d{3})\b", _read(os.path.join(docs_dir, "DECISIONS.md")), re.M)]
    if ids != sorted(set(ids)):
        res.append(("FAIL", f"DECISIONS ids are not unique and increasing: {ids}"))
    rows = [r for r in _read(os.path.join(docs_dir, "SCOREBOARD.md")).split("\n") if re.match(r"^\| 20\d\d-", r)]
    dates = []
    for r in rows:
        cells = [c.strip() for c in r.strip().strip("|").split("|")]
        if len(cells) != 6:
            res.append(("FAIL", f"SCOREBOARD row has {len(cells)} columns, not 6: {r[:60]}"))
        dates.append(cells[0])
    if not scoreboard_dates_ordered(dates):
        res.append(("FAIL", "SCOREBOARD rows are not in date order (append-only rows go at the bottom)"))
    texts = {}
    for dirpath, _, fs in os.walk(docs_dir):
        for f in fs:
            texts[os.path.relpath(os.path.join(dirpath, f), docs_dir)] = _read(os.path.join(dirpath, f))
    res += scan_secrets(texts)
    return res


# ── completeness, commitments, clock, seq references ─────────────────────────────────────────────────────────────
def check_completeness(entries: list, merges: list) -> list:
    """`merges`: [(pr_number, commit_time_iso)] on this history, NEWEST FIRST, excluding HEAD itself. Every merge at
    or after the ledger's first line needs a `pr_merge #N` line; the newest may be pending (WARN). PURE."""
    if not entries:
        return []
    genesis = entries[0]["at"]
    ledgered = {str(e["target"]).strip() for e in entries if e.get("kind") == "pr_merge"}
    res = []
    for i, (n, t) in enumerate(merges):
        if t < genesis or f"#{n}" in ledgered:
            continue
        res.append(("WARN" if i == 0 else "FAIL",
                    f"PR #{n} (merged {t}) has no `pr_merge #{n}` ledger line"
                    + (" yet: the next PR records it" if i == 0 else "")))
    return res


def check_commitments(entries_lines: list, now: str) -> list:
    """OVERDUE commitments WARN; open ones are NOTEs. PURE."""
    res = []
    for c in action_ledger.commitments(entries_lines, now):
        if c["status"] == "overdue":
            res.append(("WARN", f"OVERDUE commitment seq {c['seq']} (due {c['due_at']}): {c['target']}"
                                f" -- {c['check']}"))
        elif c["status"] == "open":
            res.append(("NOTE", f"open commitment seq {c['seq']} (due {c['due_at']}): {c['target']}"))
    return res


def _utc(s: str):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


# A UTC clock time in a log header: HH:MM or HH:MM:SS, then Z ('19:11:09Z' is one time: matching is leftmost). A
# time with no Z ('12:31-12:40Z' opens with one) is not read on its own.
LOG_TIME_RE = re.compile(r"(\d{2}):(\d{2})(?::(\d{2}))?Z")


def _ref_at(ref, lineno: int):
    """A reference is one ISO time for the whole file, or {line number: ISO}, when each line was written. PURE."""
    return ref.get(lineno) if isinstance(ref, dict) else ref


def check_clock(state_text: str, state_ref, logs: dict, corrected=()) -> list:
    """STATE's `Updated YYYY-MM-DD HH:MMZ` and each log's section-header times must not be later than their reference
    moment (`state_ref`; logs: {filename: (text, ref)}), the commit that wrote them or now. PURE.
    ⬇ EVERY `## ` header (2026-09-30). Until then only the 'HH:MM-HH:MMZ · title' shape was read (the regex needed
    ' ·'), so '## PR and ledger (23:14Z-23:17Z)', committed at 23:15:52Z (0b057d3d, #206's log), passed, as did
    every header of the '## Start (19:11:09Z)' shape most session logs use. The last time in the header counts; in
    the 'time · title' shape, the last one before the ' ·', so a time named in the title is not read as the header's.
    ⬇ PER LINE (2026-09-30, the owner: "yes"). A ref may be {line number: ISO}, the commit that wrote THAT line (git
    blame). The file's last commit hid seven headers written 1-7 min ahead of their own commit: a later commit to the
    same file moved the reference past them (log/2026-09-30-clock-every-header.md). A session log is append-only, so
    such a header cannot be fixed in place: it passes only when the ledger holds a `correction` line naming its log
    and the header's exact text (`corrected`: each correction's target and corrects), and is listed in one NOTE."""
    res, excused = [], []
    m = re.search(r"\*\*Updated (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})Z\*\*", state_text)
    ref = _ref_at(state_ref, state_text.count("\n", 0, m.start()) + 1) if m else None
    if m and ref:
        t = _utc(f"{m.group(1)}T{m.group(2)}:00Z")
        if t > _utc(ref) + CLOCK_SLACK:
            res.append(("FAIL", f"STATE.md says Updated {m.group(1)} {m.group(2)}Z, later than when it was written "
                                f"({ref}): an estimate, not a clock reading"))
    for name, (text, refs) in logs.items():
        day = name[:10]
        for n, line in enumerate(text.split("\n"), 1):
            if not line.startswith("## "):
                continue
            h = line[3:].strip()
            times = LOG_TIME_RE.findall(re.split(r"\s\u00b7", h, maxsplit=1)[0])
            ref = _ref_at(refs, n)
            if not times or not ref:
                continue
            hh, mm, ss = times[-1]
            t = _utc(f"{day}T{hh}:{mm}:{ss or '00'}Z")
            if t <= _utc(ref) + CLOCK_SLACK:
                continue
            if any(f"log/{name}" in c and h in c for c in corrected):
                excused.append(f"log/{name}:{n}")
                continue
            res.append(("FAIL", f"log/{name}:{n}: the header '{h}' ends at {hh}:{mm}{':' + ss if ss else ''}Z, later "
                                f"than when it was written ({ref}): an estimate, not a clock reading (LESSONS L-P10). "
                                f"Before it is committed, fix the time; once committed, the log is append-only: add "
                                f"a dated correction and a `correction` ledger line whose target names 'log/{name}' "
                                f"and this header's exact text"))
    if excused:
        res.append(("NOTE", f"{len(excused)} log header(s) ran ahead of their commit and are corrected in the "
                            f"ledger: {', '.join(excused)}"))
    return res


HANDOFF_WRITTEN_RE = re.compile(r"written (\d{4}-\d{2}-\d{2})([^)\n]*)")


def check_handoff_clock(handoffs: dict) -> list:
    """A HANDOFF header's `written YYYY-MM-DD ... HH:MMZ` must not be later than the commit that wrote it
    (`handoffs`: {filename: (text, ref)}, ref as in check_clock). Added 2026-09-30: the L-P10 estimate in
    HANDOFF-2026-09-30.md's header ('~01:45Z', committed 01:40Z; ledger seq 135) passed because the clock check read
    only STATE and the logs. PURE."""
    res = []
    for name, (text, refs) in handoffs.items():
        head = "\n".join(text.splitlines()[:3])
        m = HANDOFF_WRITTEN_RE.search(head)
        ref = _ref_at(refs, head.count("\n", 0, m.start()) + 1) if m else None
        if not m or not ref:
            continue
        times = re.findall(r"(\d{2}):(\d{2})Z", m.group(2))
        if not times:
            continue
        hh, mm = times[-1]
        t = _utc(f"{m.group(1)}T{hh}:{mm}:00Z")
        if t > _utc(ref) + CLOCK_SLACK:
            res.append(("FAIL", f"{name}: the header says written {m.group(1)} ...{hh}:{mm}Z, later than when it was "
                                f"written ({ref}): an estimate, not a clock reading (LESSONS L-P10)"))
    return res


def check_seq_refs(texts: dict, head_seq: int) -> list:
    """Every 'ledger seq N' (or 'N-M') cited in the docs is at or before the head. PURE."""
    res = []
    for name, text in texts.items():
        for a, b in SEQ_REF_RE.findall(text):
            top = int(b or a)
            if top > head_seq:
                res.append(("FAIL", f"{name} cites ledger seq {top}, but the ledger ends at seq {head_seq}"))
    return res


def _git(*args):
    # ⬇ UTF-8 (2026-09-30): git writes UTF-8, and blame output carries file content. Decoded with the Windows locale
    # (cp1252), the U+FE0F inside a '⚠️' (bytes EF B8 8F; 0x8F is undefined there) killed the reader thread, stdout
    # came back None, and the per-line clock reference fell back to the file's time on 5 of 12 files without a word.
    try:
        r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=60)
        return r.stdout if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


BLAME_HEAD_RE = re.compile(r"^([0-9a-f]{40}) \d+ (\d+)")


def parse_blame(porcelain: str, now: str) -> dict:
    """{final line number: ISO time} from `git blame --line-porcelain`: the COMMITTER time of the commit that last
    changed each line (a rebase, amend or squash can only move it later, so a header true when committed never
    FAILs); a line not yet committed (the zero sha) was written `now`. PURE."""
    out, cur = {}, None
    for ln in porcelain.splitlines():
        m = BLAME_HEAD_RE.match(ln)
        if m:
            cur = (m.group(1), int(m.group(2)))
        elif ln.startswith("committer-time ") and cur:
            out[cur[1]] = now if set(cur[0]) == {"0"} else \
                datetime.fromtimestamp(int(ln.split()[1]), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out


def lines_written_at(rel_path: str, text: str):
    """(ref, blind). ref: {line number: when that line was written} (git blame of the working tree), or, when git
    cannot blame every line, the file's time (`written_at`; now for a file not yet committed). blind: the file IS
    committed but could not be blamed, so it is held to the weaker file-level reference; the caller says so aloud
    (before the UTF-8 fix in _git, 5 of 12 files fell back here on Windows without a word)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    refs = parse_blame(_git("blame", "--line-porcelain", "--", rel_path) or "", now)
    if refs and max(refs) >= text.count("\n"):
        return refs, False
    return written_at(rel_path), _git("cat-file", "-e", f"HEAD:{rel_path}") is not None


def git_merges():
    """[(pr_number, commit_time)] newest first, excluding HEAD itself (a dev push's HEAD is the merge being made);
    None when git cannot see the history (not a repo, or a shallow clone)."""
    if (_git("rev-parse", "--is-shallow-repository") or "").strip() != "false":
        return None
    headsha = (_git("rev-parse", "HEAD") or "").strip()
    out = _git("log", "--merges", "--format=%H|%cI|%s", "HEAD")
    if out is None:
        return None
    merges = []
    for line in out.splitlines():
        sha, t, subject = line.split("|", 2)
        m = MERGE_RE.match(subject)
        if m and sha != headsha:
            merges.append((int(m.group(1)), _utc(t).strftime("%Y-%m-%dT%H:%M:%SZ")))
    return merges


def written_at(rel_path: str) -> str:
    """When a tracked file's current content was written: now if it has uncommitted changes, else the time of the
    last commit that touched it."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if _git("status", "--porcelain", "--", rel_path):
        return now
    t = (_git("log", "-1", "--format=%cI", "--", rel_path) or "").strip()
    return _utc(t).strftime("%Y-%m-%dT%H:%M:%SZ") if t else now


def audit_completeness_and_clock(docs_dir: str = DOCS, require_history: bool = False) -> list:
    lines = action_ledger.read_lines(os.path.join(docs_dir, "ACTIONS.jsonl"))
    entries = [json.loads(x) for x in lines]
    res = []
    merges = git_merges()
    if merges is None:
        # ⛔ In CI a blind check must FAIL, not warn: the first CI run of this check WARNed and passed because a
        # later `git fetch --depth=1` had re-shallowed the clone (2026-09-29).
        res.append(("FAIL" if require_history else "WARN",
                    "cannot check ledger completeness: no full git history here "
                    "(fetch-depth: 0, and no later --depth fetch)"))
    else:
        res += check_completeness(entries, merges)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    res += check_commitments(lines, now)
    rel = os.path.relpath(docs_dir, ROOT).replace("\\", "/")
    blind = []

    def dated(rel_path):
        text = _read(os.path.join(ROOT, rel_path))
        ref, is_blind = lines_written_at(rel_path, text)
        if is_blind:
            blind.append(rel_path)
        return text, ref

    logs = {}
    logdir = os.path.join(docs_dir, "log")
    for f in sorted(os.listdir(logdir)) if os.path.isdir(logdir) else []:
        if re.match(r"\d{4}-\d{2}-\d{2}-.+\.md$", f):
            logs[f] = dated(f"{rel}/log/{f}")
    corrected = [f"{e.get('target', '')} {e.get('corrects', '')}" for e in entries if e.get("kind") == "correction"]
    res += check_clock(*dated(f"{rel}/STATE.md"), logs, corrected)
    handoffs = {f: dated(f"{rel}/{f}") for f in sorted(os.listdir(docs_dir)) if re.match(r"HANDOFF-.+\.md$", f)}
    res += check_handoff_clock(handoffs)
    if blind:
        res.append(("FAIL" if require_history else "WARN",
                    f"clock: {len(blind)} committed file(s) held to their LAST commit, not per line (git blame "
                    f"failed): {', '.join(blind)}"))
    texts = {}
    for dirpath, _, fs in os.walk(docs_dir):
        for f in fs:
            if f.endswith(".md"):
                texts[os.path.relpath(os.path.join(dirpath, f), docs_dir)] = _read(os.path.join(dirpath, f))
    res += check_seq_refs(texts, len(lines))
    return res


def selftest() -> list:
    """Each new check fires on its failure and stays quiet on the clean case. Returns failures (empty = pass)."""
    fails = []
    ents = [{"at": "2026-09-29T10:00:00Z", "kind": "finding", "target": "x"},
            {"at": "2026-09-29T11:00:00Z", "kind": "pr_merge", "target": "#5"}]
    got = check_completeness(ents, [(7, "2026-09-29T12:00:00Z"), (6, "2026-09-29T11:30:00Z"),
                                    (5, "2026-09-29T10:30:00Z"), (4, "2026-09-29T09:00:00Z")])
    if [lv for lv, _ in got] != ["WARN", "FAIL"] or "#7" not in got[0][1] or "#6" not in got[1][1]:
        fails.append(f"completeness: expected WARN #7 (newest), FAIL #6, nothing for #5 (ledgered) or #4 (before "
                     f"the ledger); got {got}")
    if check_completeness(ents, [(5, "2026-09-29T10:30:00Z")]):
        fails.append("completeness: a fully ledgered history was flagged")
    st = ("**Updated 2026-09-29 19:00Z** (log...)")
    if not any(lv == "FAIL" for lv, _ in check_clock(st, "2026-09-29T18:54:00Z", {})):
        fails.append("clock: STATE dated 19:00Z but written 18:54Z was not caught (the L-P10 case)")
    if check_clock(st, "2026-09-29T19:02:00Z", {}):
        fails.append("clock: STATE written after its Updated time was flagged")
    log = "# x\n\n## 18:30-19:00Z \u00b7 a section\n- body\n"
    if not check_clock("", "", {"2026-09-29-x.md": (log, "2026-09-29T18:54:00Z")}):
        fails.append("clock: a log header ending after its commit was not caught")
    if check_clock("", "", {"2026-09-29-x.md": (log, "2026-09-29T19:10:00Z")}):
        fails.append("clock: a log header before its commit was flagged")
    # A header with no ' ·' (0b057d3d, #206's log: this header, committed 23:15:52Z, passed the ' ·'-only regex).
    pr = "# x\n\n## PR and ledger (23:14Z-23:17Z)\n- body\n"
    if not check_clock("", "", {"2026-09-30-x.md": (pr, "2026-09-30T23:15:52Z")}):
        fails.append("clock: '## PR and ledger (23:14Z-23:17Z)' committed 23:15:52Z (0b057d3d) was not caught")
    if check_clock("", "", {"2026-09-30-x.md": (pr, "2026-09-30T23:17:00Z")}):
        fails.append("clock: a header with no ' ·' that ends when it was committed was flagged")
    start = "## Start (19:11:09Z)\n"
    if not check_clock("", "", {"2026-09-30-x.md": (start, "2026-09-30T19:10:00Z")}) \
            or check_clock("", "", {"2026-09-30-x.md": (start, "2026-09-30T19:11:09Z")}):
        fails.append("clock: an HH:MM:SSZ header was misread (19:11:09Z is 69 s after 19:10:00Z, past the slack)")
    titled = "## 12:00-12:04Z · why the 18:00Z cron missed\n## Census (method and numbers)\n## at 23:59 local\n"
    if check_clock("", "", {"2026-09-30-x.md": (titled, "2026-09-30T12:05:00Z")}):
        fails.append("clock: a time in a 'time · title' title, a header with no time, or one with no Z was read")
    # PER LINE: log/2026-09-29-consensus-and-ops.md:154, written 18:54:13Z (d09b2ceb), passed for a day because a
    # later line of the same file was committed at 22:39:02Z. Line 3 is the header; line 5 a later, honest one.
    cao = ("# x\n\n## 18:30-19:00Z · the GFS native-cell regrid, built dark\n- body\n"
           "## 22:37-22:38Z · later\n")
    per_line = {3: "2026-09-29T18:54:13Z", 5: "2026-09-29T22:39:02Z"}
    if not any(lv == "FAIL" and ":3:" in msg for lv, msg in check_clock("", "", {"2026-09-29-x.md": (cao, per_line)})):
        fails.append("clock: a header written 18:54:13Z that ends 19:00Z was not held to the commit that wrote it")
    fixed = ["log/2026-09-29-x.md, header '18:30-19:00Z · the GFS native-cell regrid, built dark'"]
    got = check_clock("", "", {"2026-09-29-x.md": (cao, per_line)}, fixed)
    if [lv for lv, _ in got] != ["NOTE"] or "log/2026-09-29-x.md:3" not in got[0][1]:
        fails.append(f"clock: a header corrected in the ledger should give one NOTE and no FAIL; got {got}")
    for other in ("log/2026-09-29-y.md, header '18:30-19:00Z · the GFS native-cell regrid, built dark'",
                  "log/2026-09-29-x.md, header '22:37-22:38Z · later'"):
        if not any(lv == "FAIL" for lv, _ in check_clock("", "", {"2026-09-29-x.md": (cao, per_line)}, [other])):
            fails.append(f"clock: a correction naming another log or another header excused this one: {other!r}")
    st2 = "# S\n\n**Updated 2026-09-29 19:00Z** (x)\nbody\n"
    if not check_clock(st2, {1: "2026-09-29T22:00:00Z", 3: "2026-09-29T18:54:00Z", 4: "2026-09-29T22:00:00Z"}, {}):
        fails.append("clock: STATE's Updated line was not held to the commit that wrote THAT line")
    h2 = "# Weather program handoff (written 2026-09-30 01:30-01:45Z by x)\n\nbody\n"
    if not check_handoff_clock({"HANDOFF-x.md": (h2, {1: "2026-09-30T01:40:18Z", 3: "2026-09-30T02:30:00Z"})}):
        fails.append("clock: a HANDOFF header was not held to the commit that wrote its line")
    # The blame parser: committer time (not author time), and an uncommitted line (the zero sha) is `now`.
    porc = ("a" * 40 + " 1 1 1\nauthor A\nauthor-time 1790683200\ncommitter-time 1790708053\nsummary s\n\t## x\n"
            + "0" * 40 + " 2 2 1\nauthor Not Committed Yet\ncommitter-time 1790683200\n\tnew line\n")
    want = {1: "2026-09-29T18:54:13Z", 2: "2026-09-30T23:59:00Z"}
    if parse_blame(porc, "2026-09-30T23:59:00Z") != want:
        fails.append(f"blame: expected {want}, got {parse_blame(porc, '2026-09-30T23:59:00Z')}")
    ho ="# Weather program handoff — 2026-09-30 (written 2026-09-30 ~01:45Z by the session x)\n\nbody\n"
    if not check_handoff_clock({"HANDOFF-2026-09-30.md": (ho, "2026-09-30T01:40:18Z")}):
        fails.append("clock: the seq-135 handoff header (~01:45Z, committed 01:40:18Z) was not caught")
    ok = "# Weather program handoff — 2026-09-30 (written 2026-09-30 01:30-01:40Z by the session x)\n"
    if check_handoff_clock({"HANDOFF-2026-09-30.md": (ok, "2026-09-30T01:40:18Z")}):
        fails.append("clock: a handoff header bounded by its commit was flagged")
    if not check_seq_refs({"STATE.md": "see ledger seq 70-72"}, 71) or check_seq_refs({"a": "ledger seq 69-71"}, 71):
        fails.append("seq refs: a reference past the head was missed, or one inside it was flagged")
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        pth = os.path.join(d, "L.jsonl")
        base = dict(actor="t", target="t", why="w", authorized_by="a", outcome="o", verified="v", rollback="r",
                    evidence=["e"])
        action_ledger.append(pth, kind="commitment", due_at="2026-09-29T06:00:00Z", check="c",
                             at="2026-09-29T01:00:00Z", **base)
        levels = [lv for lv, _ in check_commitments(action_ledger.read_lines(pth), "2026-09-29T07:00:00Z")]
        if levels != ["WARN"]:
            fails.append(f"commitments: an overdue commitment gave {levels}, not one WARN")
        md = os.path.join(d, "mem")
        os.mkdir(md)
        fm = ("---\nname: {n}\ndescription: d\nmetadata:\n  type: project\n  verified: 2026-09-29\n---\n")
        with open(os.path.join(md, "long-one.md"), "w", encoding="utf-8") as f:
            f.write(fm.format(n="long-one") + "x\n" * (LONG_LINES + 5))
        with open(os.path.join(md, "short-one.md"), "w", encoding="utf-8") as f:
            f.write(fm.format(n="short-one") + "x\n" * 5)
        with open(os.path.join(md, "MEMORY.md"), "w", encoding="utf-8") as f:
            f.write("- [L](long-one.md) - l\n- [S](short-one.md) - s\n")
        longs = [m for lv, m in audit_memory(md, date(2026, 9, 29)) if "LONG" in m]
        if len(longs) != 1 or "long-one.md" not in longs[0]:
            fails.append(f"long: expected one LONG warning for long-one.md, got {longs}")
    return fails


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--memory-dir")
    ap.add_argument("--docs-only", action="store_true")
    ap.add_argument("--stale-days", type=int, default=7)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--require-history", action="store_true",
                    help="CI: FAIL (not WARN) when the git history needed for completeness is missing")
    args = ap.parse_args(argv)
    if args.selftest:
        fails = selftest()
        for f in fails:
            print(f"SELFTEST FAIL: {f}")
        print("memory audit selftest: every check fires" if not fails else f"selftest: {len(fails)} failure(s)")
        return 1 if fails else 0
    results = audit_docs()
    if not any(level == "FAIL" for level, _ in results):
        results += audit_completeness_and_clock(require_history=args.require_history)
    if not args.docs_only:
        if not args.memory_dir:
            ap.error("--memory-dir is required unless --docs-only")
        results += audit_memory(args.memory_dir, date.today(), args.stale_days)
    for level, msg in results:
        print(f"{level}: {msg}")
    n_fail = sum(level == "FAIL" for level, _ in results)
    n_warn = sum(level == "WARN" for level, _ in results)
    n_note = sum(level == "NOTE" for level, _ in results)
    print(f"memory audit: {n_fail} FAIL, {n_warn} WARN, {n_note} NOTE{' (docs only)' if args.docs_only else ''}")
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
