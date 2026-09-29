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
  agent-local memory (--memory-dir; skipped with --docs-only, as in CI):
    * MEMORY.md indexes every memory file and links only to files that exist;
    * each memory has name / description / metadata.type (user, feedback, project, reference), and its name matches
      its filename;
    * every [[link]] resolves;
    * FRESHNESS: `metadata.verified: YYYY-MM-DD` records when the fact was last checked against reality. A project
      or reference fact older than --stale-days (default 7) is STALE; user and feedback facts, 30 days. A memory
      with no `verified` date is UNVERIFIED. Stale is a warning, not a failure: it says "re-check before relying".

USAGE (repo root; standard library only):
  python backend/scripts/memory_audit.py --memory-dir "C:/Users/<you>/.claude/projects/<project>/memory"
  python backend/scripts/memory_audit.py --docs-only          # CI
Exit 1 on any FAIL; WARN lines never fail the run.
"""
import argparse
import os
import re
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import action_ledger  # noqa: E402

ROOT = action_ledger.ROOT
DOCS = os.path.join(ROOT, "docs", "weather-program")
REQUIRED_DOCS = ("README.md", "STATE.md", "DECISIONS.md", "SCOREBOARD.md", "LESSONS.md", "ACTIONS.jsonl")
MEMORY_TYPES = {"user", "feedback", "project", "reference"}
SLOW_TYPES = {"user", "feedback"}
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
        dates.append(_row_time(cells[0]))
    if dates != sorted(dates):
        res.append(("FAIL", "SCOREBOARD rows are not in date order (append-only rows go at the bottom)"))
    texts = {}
    for dirpath, _, fs in os.walk(docs_dir):
        for f in fs:
            texts[os.path.relpath(os.path.join(dirpath, f), docs_dir)] = _read(os.path.join(dirpath, f))
    res += scan_secrets(texts)
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--memory-dir")
    ap.add_argument("--docs-only", action="store_true")
    ap.add_argument("--stale-days", type=int, default=7)
    args = ap.parse_args(argv)
    results = audit_docs()
    if not args.docs_only:
        if not args.memory_dir:
            ap.error("--memory-dir is required unless --docs-only")
        results += audit_memory(args.memory_dir, date.today(), args.stale_days)
    for level, msg in results:
        print(f"{level}: {msg}")
    n_fail = sum(level == "FAIL" for level, _ in results)
    n_warn = sum(level == "WARN" for level, _ in results)
    print(f"memory audit: {n_fail} FAIL, {n_warn} WARN{' (docs only)' if args.docs_only else ''}")
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
