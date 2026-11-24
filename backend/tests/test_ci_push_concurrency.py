"""Dev-push CI runs supersede each other; PR, main and dispatch runs keep their own behaviour (2026-11-23).

Each push to dev used to get its own concurrency group (its run id), so 15 full CI runs (~25 min each) queued on
dev in one afternoon and starved every PR; they were cancelled by hand. Now pushes to dev share the group
`push-dev` with cancel-in-progress false: GitHub keeps the one RUNNING and only the NEWEST PENDING run (default
`queue: single`), so a running dev CI is never killed and the merges in between drop their pending run.

The group expression is EVALUATED here (GitHub's `&&`/`||` return an operand, exactly like Python's and/or), not
searched for a substring, so a precedence slip or a typo in the ref fails this file.
"""
import os
import re

import pytest

yaml = pytest.importorskip("yaml")

WORKFLOWS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         ".github", "workflows")
FILES = ("ci.yml", "encoding-check.yml", "loc-check.yml", "weather-program-ledger.yml")


def _load(name):
    with open(os.path.join(WORKFLOWS, name), encoding="utf-8") as fh:
        return yaml.safe_load(fh)


class _Obj(dict):
    __getattr__ = dict.__getitem__


def _eval(expr, *, workflow="CI", event, ref, pr=None, run_id=1):
    """Evaluate one `${{ … }}` expression against a fake github context. Only the operators these blocks use."""
    m = re.fullmatch(r"\s*\$\{\{(.*)\}\}\s*", expr)
    body = m.group(1) if m and "}}" not in m.group(1) and "${{" not in m.group(1) else None
    if body is None:                                   # a literal, or text with embedded expressions
        return re.sub(r"\$\{\{(.*?)\}\}", lambda x: str(_eval("${{" + x.group(1) + "}}", workflow=workflow,
                                                                 event=event, ref=ref, pr=pr, run_id=run_id)), expr)
    py = body.replace("&&", " and ").replace("||", " or ")
    py = re.sub(r"format\('([^']*)'", lambda x: "fmt('" + x.group(1) + "'", py)
    github = _Obj(workflow=workflow, event_name=event, ref=ref, run_id=run_id,
                  event=_Obj(pull_request=_Obj(number=pr)))

    def fmt(template, *args):
        return re.sub(r"\{(\d+)\}", lambda x: str(args[int(x.group(1))]), template)
    return eval(py, {"__builtins__": {}}, {"github": github, "fmt": fmt})   # noqa: S307 - test-only, fixed input


def _group(doc, **kw):
    return _eval(doc["concurrency"]["group"], **kw)


def _cancel(doc, **kw):
    v = doc["concurrency"]["cancel-in-progress"]
    return v if isinstance(v, bool) else _eval(v, **kw)


@pytest.mark.parametrize("name", FILES)
def test_pushes_to_dev_share_one_group_and_never_cancel_the_running_one(name):
    doc = _load(name)
    a = dict(workflow="W", event="push", ref="refs/heads/dev", run_id=101)
    b = dict(a, run_id=102)
    assert _group(doc, **a) == _group(doc, **b) == "W-push-dev"
    assert _cancel(doc, **a) is False, "a running dev CI must never be killed: dev would never finish a green run"


@pytest.mark.parametrize("name", FILES)
def test_main_and_other_pushes_keep_a_group_per_run(name):
    doc = _load(name)
    for ref in ("refs/heads/main", "refs/heads/codex/reconcile-euro-dev-20261019", "refs/heads/dev-x"):
        g1 = _group(doc, workflow="W", event="push", ref=ref, run_id=201)
        g2 = _group(doc, workflow="W", event="push", ref=ref, run_id=202)
        assert (g1, g2) == ("W-run-201", "W-run-202"), ref
        assert _cancel(doc, workflow="W", event="push", ref=ref) is False


@pytest.mark.parametrize("name", FILES)
def test_a_pr_keeps_its_own_group_and_cancels_its_older_run(name):
    doc = _load(name)
    kw = dict(workflow="W", event="pull_request", ref="refs/pull/7/merge", pr=7)
    assert _group(doc, **kw) == "W-pr-7"
    assert _cancel(doc, **kw) is True
    # a PR whose head branch is literally `dev` (a fork) must not land in the dev push group
    assert _group(doc, workflow="W", event="pull_request", ref="refs/heads/dev", pr=8) == "W-pr-8"


@pytest.mark.parametrize("name", FILES)
def test_dispatch_runs_keep_a_group_per_run(name):
    doc = _load(name)
    assert _group(doc, workflow="W", event="workflow_dispatch", ref="refs/heads/dev", run_id=301) == "W-run-301"


def test_the_evaluator_is_not_vacuous():
    """KNOWN-BAD CONTROL: the pre-2026-11-23 expression gave every dev push its own group, and must fail here."""
    old = {"concurrency": {"group": "${{ github.workflow }}-${{ github.event_name == 'pull_request' && "
                                    "format('pr-{0}', github.event.pull_request.number) || "
                                    "format('run-{0}', github.run_id) }}",
                           "cancel-in-progress": "${{ github.event_name == 'pull_request' }}"}}
    a = dict(workflow="W", event="push", ref="refs/heads/dev", run_id=101)
    assert _group(old, **a) != _group(old, **dict(a, run_id=102))
