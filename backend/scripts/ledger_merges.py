"""ledger_merges.py — the PR merges a history holds, and `pr_merge` ledger lines for the ones never ledgered.

WHY (2026-10-23). memory_audit's completeness check ("every PR merge since the ledger began has its `pr_merge #N`
line") read only `Merge pull request #N` merge commits. Dev squash-merges, so from #380 (2026-10-18) on it saw no
merge at all: 166 squash merges since the ledger began, 56 of them never ledgered (#262 .. #468), and nothing
failed. Under unattended auto-merge (D-0XX, the ledger fragments) nobody writes a merge's line unless something
records it. The lead chose (option A, 2026-10-23): "Backfill the 56 missing pr_merge lines, one per PR ... Widen the
check to "(#N)" subjects: a merge newer than the last fold WARNs, older FAILs. fold-pr --record-merges writes the
missing pr_merge lines for merges since the previous fold into a fragment on the fold branch, so unattended
auto-merge stays recorded."

  * A merge is a `Merge pull request #N ...` commit anywhere in the history, or a first-parent commit whose subject
    ends in `(#N)` (GitHub's squash subject). HEAD itself is left out (on a dev push it is the merge being made).
  * The LAST FOLD POINT is the newest first-parent commit that deleted a fragment (a fold landed), else the commit
    that brought ledger.d/README.md (the protocol landing). A merge at or after it may still be unledgered: the next
    `fold-pr --record-merges` records it, so the audit WARNs; an older one FAILs.
  * A recorded line is RECONSTRUCTED from GitHub's own records (`gh pr view`, the PR timeline): mergedAt, the merge
    commit, who merged or armed auto-merge and on which head. It says plainly that the authorizing words were not
    recorded in the ledger.
Standard library plus the `gh` CLI (injectable, so tests never touch the network).
"""
import json
import re
import subprocess
from datetime import datetime, timezone

try:
    from . import ledger_fragments as F   # imported as scripts.ledger_merges (tests)
except ImportError:
    import ledger_fragments as F  # noqa: E402 - run from backend/scripts

L = F.L
MERGE_RE = re.compile(r"^Merge pull request #(\d+) ")
SQUASH_RE = re.compile(r"\(#([1-9][0-9]*)\)$")
TIMELINE_Q = ("query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){"
              "timelineItems(itemTypes:[PULL_REQUEST_COMMIT,AUTO_MERGE_ENABLED_EVENT,AUTO_SQUASH_ENABLED_EVENT,"
              "AUTO_REBASE_ENABLED_EVENT,MERGED_EVENT],last:100){nodes{__typename "
              "... on PullRequestCommit{commit{oid}} ... on AutoMergeEnabledEvent{createdAt actor{login}} "
              "... on AutoSquashEnabledEvent{createdAt actor{login}} ... on AutoRebaseEnabledEvent{createdAt "
              "actor{login}} ... on MergedEvent{createdAt actor{login} commit{oid}}}}}}}")


def _iso(t: str) -> str:
    return datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_merges(merge_log: str, first_parent_log: str, head_sha: str) -> list:
    """[(pr, merged UTC ISO)] newest first, one per PR, from `git log --merges` and `git log --first-parent
    --no-merges` lines (`sha|committer ISO|subject`). PURE."""
    found = {}
    for log, rx in ((merge_log, MERGE_RE), (first_parent_log, SQUASH_RE)):
        for line in (log or "").splitlines():
            sha, t, subject = line.split("|", 2)
            m = rx.match(subject) if rx is MERGE_RE else rx.search(subject.rstrip())
            if m and sha != head_sha:
                n, when = int(m.group(1)), _iso(t)
                found[n] = max(found.get(n, ""), when)
    return sorted(((n, t) for n, t in found.items()), key=lambda x: (x[1], x[0]), reverse=True)


def git_merges(root: str, ref: str = "HEAD", include_tip: bool = False):
    """The merges on `ref`'s history, newest first; None without the full history (a shallow clone, no git). The tip
    is left out unless `include_tip`: for the audit it is the merge being made, for record-merges a merge to record."""
    try:
        if F.git(root, "rev-parse", "--is-shallow-repository").strip() != "false":
            return None
        head = "" if include_tip else F.git(root, "rev-parse", ref).strip()
        return parse_merges(F.git(root, "log", "--merges", "--format=%H|%cI|%s", ref),
                            F.git(root, "log", "--first-parent", "--no-merges", "--format=%H|%cI|%s", ref), head)
    except (F.LedgerError, OSError, subprocess.SubprocessError, ValueError):
        return None


def last_fold_point(root: str, ref: str = "HEAD"):
    """When the last fold landed on `ref` (the newest first-parent commit that deleted a fragment), else when the
    fragment protocol landed; None before it landed."""
    # --name-only: --diff-merges=first-parent implies a patch in git >= 2.4x, and the first line is the time.
    out = F.git(root, "log", "--first-parent", "--diff-merges=first-parent", "--diff-filter=D", "-1", "--name-only",
                "--format=%cI", ref, "--", f"{F.FRAG_DIR_REL}/*.jsonl").strip()
    if out:
        return _iso(out.splitlines()[0])
    landed = F.landing_time(root, ref)
    return _iso(landed) if landed else None


def ledgered(lines: list) -> set:
    """The PR numbers a ledger (folded or virtual) already has a `pr_merge #N` line for. PURE."""
    out = set()
    for x in lines:
        e = json.loads(x)
        if e.get("kind") == "pr_merge" and re.fullmatch(r"#[1-9][0-9]*", str(e.get("target", "")).strip()):
            out.add(int(str(e["target"]).strip()[1:]))
    return out


def missing_merges(merges: list, lines: list) -> list:
    """The merges since the ledger's first line that have no `pr_merge` line, OLDEST first. PURE."""
    if not lines:
        return []
    genesis, have = json.loads(lines[0])["at"], ledgered(lines)
    return sorted(((n, t) for n, t in merges if t >= genesis and n not in have), key=lambda x: (x[1], x[0]))


def run_gh(args: list, cwd: str = None) -> str:
    r = subprocess.run(["gh", *args], cwd=cwd, capture_output=True, timeout=120)
    if r.returncode != 0:
        raise F.LedgerError(f"gh {' '.join(args[:3])} failed: {r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout.decode("utf-8")


def merge_fields(n: int, actor: str, gh=None, today: str = None) -> dict:
    """The fields of one reconstructed `pr_merge #n` line, from GitHub's records. Refuses a PR that is not merged."""
    gh, today = gh or run_gh, today or F.now_utc()[:10]
    pr = json.loads(gh(["pr", "view", str(n), "--json", "number,title,url,state,mergedAt,mergedBy,mergeCommit,"
                                                       "headRefOid"]))
    if pr.get("state") != "MERGED" or not pr.get("mergedAt") or not (pr.get("mergeCommit") or {}).get("oid"):
        raise F.LedgerError(f"#{n} is not a merged PR on GitHub (state {pr.get('state')!r})")
    repo = json.loads(gh(["repo", "view", "--json", "owner,name"]))
    tl = json.loads(gh(["api", "graphql", "-f", f"query={TIMELINE_Q}", "-F", f"o={repo['owner']['login']}",
                        "-F", f"r={repo['name']}", "-F", f"n={n}"]))
    nodes = tl["data"]["repository"]["pullRequest"]["timelineItems"]["nodes"]
    mc, merged_at = pr["mergeCommit"]["oid"], _iso(pr["mergedAt"])
    by = (pr.get("mergedBy") or {}).get("login") or "unknown"
    armed, head_at_arm = None, None
    for i, node in enumerate(nodes):
        if node["__typename"].startswith("Auto") and node["__typename"].endswith("EnabledEvent"):
            armed = node
            commits = [x["commit"]["oid"] for x in nodes[:i] if x["__typename"] == "PullRequestCommit"]
            head_at_arm = commits[-1] if commits else None
    head = pr.get("headRefOid") or "?"
    if armed:
        how = (f"auto-merge armed by {(armed.get('actor') or {}).get('login') or 'unknown'} at {_iso(armed['createdAt'])}"
               f" on head {(head_at_arm or head)[:12]} (the last commit before it in the PR timeline); GitHub merged "
               f"head {head[:12]} at {merged_at}")
    else:
        how = f"merged by {by} at {merged_at} (no auto-merge in the PR timeline)"
    return {
        "actor": actor, "kind": "pr_merge", "target": f"#{n}", "acted_at": merged_at, "reconstructed": True,
        "why": f"merged: {pr.get('title', '').strip() or '(no title)'}",
        "authorized_by": f"reconstructed {today}; authorizing words not recorded in the ledger; {how}",
        "evidence": [pr.get("url") or f"#{n}",
                     f"gh pr view {n}: mergedAt {merged_at}, merge commit {mc}, mergedBy {by}"],
        "outcome": f"merged into the base as {mc[:12]}",
        "verified": f"gh pr view {n} read {F.now_utc()}: MERGED, merge commit {mc}",
        "rollback": f"git revert {mc[:12]}",
    }


def record_merges(root: str, base_ref: str, lines: list, actor: str, name: str = None, gh=None, out=print):
    """Append a reconstructed `pr_merge` line to fragment `name` for every merge on `base_ref` that `lines` (the
    ledger as it will be: folded, plus every fragment) does not have. Returns the PR numbers recorded."""
    merges = git_merges(root, base_ref, include_tip=True)
    if merges is None:
        raise F.LedgerError(f"cannot read {base_ref}'s merges: fetch the full history (fetch-depth: 0)")
    done = []
    for n, _ in missing_merges(merges, lines):
        fname, i, _e = F.append_fragment(root, merge_fields(n, actor, gh=gh), name=name, base_ref=base_ref)
        name = fname
        done.append(n)
        out(f"recorded pr_merge #{n} as ledger.d/{fname}.jsonl:{i}")
    return done


def ledger_as_it_will_be(root: str) -> list:
    """This checkout's ACTIONS.jsonl plus every fragment in it, as the next fold would chain them."""
    texts, _ = F.read_dir_fragments(f"{root}/docs/weather-program")
    order = F.working_order(root, list(texts))
    return F.virtual_ledger(L.read_lines(f"{root}/{F.LEDGER_REL}"), [(n, texts[n]) for n in order])[0]
