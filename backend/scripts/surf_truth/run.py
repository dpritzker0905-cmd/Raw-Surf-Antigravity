"""Run the pre-registered surf-truth fit (#989) on manifested private exports. OFFLINE ONLY.

    python -m scripts.surf_truth.run --export DIR [--export DIR ...] --classes classes.json \\
        --review-ref "#992 reviewed at <sha>" --run-store PRIVATE_RUN_DIR

Refuses (exit 2):
- unless --review-ref names a reviewed sha whose surf_truth code is IDENTICAL to the code that runs (amendment 5.2),
- from a dirty working tree under scripts/surf_truth (the model version is that code's git TREE; amendment 5.1),
- if the run store already holds a SCORED run of this version (one scored run per version; amendment 5.3),
- with any sampler size other than the registered 4 chains x 1000 warmup x 1000 samples,
- if the model's own tests fail in this environment (they do not run in CI; amendment 4.10).
Below the floor, without a class scheme, or with physical-reference rows: a NOT RUNNABLE record, nothing fitted.
Otherwise: three fits (real, shuffled, synthetic; ALL must converge, else VOID), the leak check, scoring of the
held-out anchor targets, the controls, the session sensitivity, and the verdict. The record is a VERSIONED RUN for the
admin Model tab; a VOID run can never be made active.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

import numpy as np

from . import controls, gate, prep

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REVIEW_RE = re.compile(r"reviewed at ([0-9a-f]{7,40})")


def _git(*args) -> str:
    return subprocess.run(["git", *args], cwd=BACKEND, capture_output=True, text=True, check=True).stdout.strip()


def code_version() -> dict:
    """Amendment 5.1: the model version is the git TREE of scripts/surf_truth (identical code = the same version);
    the commit is recorded beside it, and `since` is when this code last changed. A dirty tree refuses."""
    if _git("status", "--porcelain", "--", "scripts/surf_truth"):
        raise SystemExit("refused: the surf_truth code has uncommitted changes; the model version must be committed")
    return {"tree": _git("rev-parse", "HEAD:./scripts/surf_truth"), "commit": _git("rev-parse", "HEAD"),
            "since": _git("log", "-1", "--format=%cI", "--", "scripts/surf_truth")}


def code_differs(sha: str):
    """True if scripts/surf_truth differs between `sha` and HEAD, False if identical, None if `sha` is unknown."""
    proc = subprocess.run(["git", "diff", "--quiet", sha, "HEAD", "--", "scripts/surf_truth"], cwd=BACKEND)
    return {0: False, 1: True}.get(proc.returncode)


def _exports(dirs: list[str]):
    """Every manifested export; when a row is in several, the NEWEST cut's copy wins (amendment 4.6)."""
    loaded = []
    for d in dirs:
        for mpath in sorted(glob.glob(os.path.join(d, "*.manifest.json"))):
            data = mpath.replace(".manifest.json", ".jsonl")
            if os.path.exists(data):
                loaded.append(prep.load_export(data, mpath))
    if not loaded:
        raise prep.NotRunnable("no manifested export found")
    manifests = [m for _, m in loaded]
    prep.same_key(manifests)
    if any(not m.get("cut_at") for m in manifests):
        raise prep.NotRunnable("an export manifest has no cut_at; cut order cannot be established (amendment 5.4)")
    newest: dict = {}
    for rows, _m in sorted(loaded, key=lambda rm: datetime.fromisoformat(rm[1]["cut_at"])):   # instants
        for r in rows:
            newest[r["row_key"]] = r                     # later cuts overwrite earlier copies
    return list(newest.values()), manifests


def read_store(store: str) -> list[dict]:
    records = []
    for path in sorted(glob.glob(os.path.join(store, "*.json"))):
        with open(path, encoding="utf-8") as fh:
            records.append(json.load(fh))
    return records


def already_scored(prior_runs: list[dict], version: dict) -> bool:
    """Amendment 5.3 (2 E): ONE scored run per model version."""
    return any(r.get("gate") and r.get("model_version") == version["tree"] for r in prior_runs)


def scored_after(prior_runs: list[dict], version: dict) -> str:
    """Amendment 4.5 / 5.3: if any earlier SCORED run used another model version, only targets received after this
    version came into being are scored. Returns the cut-off (ISO), or "" for none."""
    scored = [r for r in prior_runs if r.get("gate") and r.get("model_version") != version["tree"]]
    return version["since"] if scored else ""


def _score(fit, prepared, spot_class, model, after: str = ""):
    predictive, others, targets = {}, {}, []
    cutoff = datetime.fromisoformat(after) if after else None        # compare instants, never ISO strings
    for cell in prepared.holdout_cells:
        for t in prep.scoreable_targets(cell):
            if cutoff is not None and datetime.fromisoformat(t["received_at"]) <= cutoff:
                continue
            rest = [r for r in cell.rows if r is not t and prep.independent(t, r)]   # amendment 3.5
            predictive[t["row_key"]] = model.predict_target(fit, t, rest)
            others[t["row_key"]] = rest
            targets.append(t)
    return gate.score(targets, predictive, others, spot_class)


def model_tests() -> dict:
    """Amendment 4.10: the model's tests run here, in the fit environment, before every run."""
    proc = subprocess.run([sys.executable, "-m", "pytest", "-q", "--noconftest", "-p", "no:cacheprovider",
                           "tests/test_surf_truth_fit_model.py", "tests/test_surf_truth_fit_prep.py"],
                          cwd=BACKEND, capture_output=True, text=True)
    tail = (proc.stdout.strip().splitlines() or [""])[-1]
    return {"ok": proc.returncode == 0, "summary": tail}


def run(args, version: dict, tests: dict) -> dict:
    record = {"schema": "raw-surf/surf-truth-run/3", "model_version": version["tree"], "commit": version["commit"],
              "model_since": version["since"], "review_ref": args.review_ref, "seed": gate.SEED,
              "model_tests": tests, "started_at": datetime.now(timezone.utc).isoformat(),
              "registration": "#989 + amendments 1-5"}
    try:
        rows, manifests = _exports(args.export)
        with open(args.classes, encoding="utf-8") as fh:
            spot_class = json.load(fh)
        prepared = prep.prepare(rows, spot_class)
    except prep.NotRunnable as exc:
        return {**record, "verdict": "NOT RUNNABLE", "reason": str(exc)}
    record.update({"data_cut": [m.get("cut_at") for m in manifests], "excluded": prepared.excluded,
                   "floor": prepared.floor})
    if not prepared.floor["runnable"]:
        return {**record, "verdict": "NOT RUNNABLE", "reason": "registered floor not met"}
    after = scored_after(read_store(args.run_store), version)
    record["scored_only_after"] = after or None

    from . import model                                     # NumPyro/JAX only past this point
    sizes = dict(chains=args.chains, warmup=args.warmup, samples=args.samples)
    leak = controls.leak_check(prepared.fit_rows, prepared.holdout_cells)
    fit = model.fit(prepared.fit_rows, **sizes)
    real = _score(fit, prepared, spot_class, model, after)
    shuffled_fit = model.fit(controls.shuffle_within_role(prepared.fit_rows), **sizes)
    shuffled = _score(shuffled_fit, prepared, spot_class, model, after)
    syn_fit = model.fit(controls.add_synthetic_observer(prepared.fit_rows, fit), **sizes)
    positive = controls.positive_ok(syn_fit)
    sensitivity = _session_sensitivity(rows, spot_class, model, sizes, after)
    paired = gate.shuffled_significantly_better(real.pop("records", []), shuffled.pop("records", []))
    ctrl = {"leak": leak["ok"], "negative": not paired["significantly_better"], "positive": positive["ok"]}
    all_converged = all(f.diagnostics["converged"] for f in (fit, shuffled_fit, syn_fit))     # amendment 4.3
    return {**record, "diagnostics": {**fit.diagnostics, "all_three_converged": all_converged}, "gate": real,
            "leak": leak,
            "negative_control": {"paired_bootstrap": paired, "real_improvement": real.get("improvement"),
                                 "shuffled_improvement": shuffled.get("improvement"),
                                 "tau_median_real": float(np.median(fit.samples["tau"])),
                                 "tau_median_shuffled": float(np.median(shuffled_fit.samples["tau"])),
                                 "diagnostics": shuffled_fit.diagnostics},
            "positive_control": {**positive, "diagnostics": syn_fit.diagnostics},
            "sensitivity_sessions_collapsed": sensitivity,
            "verdict": gate.final_verdict(real, ctrl, {"converged": all_converged})}


def _session_sensitivity(rows, spot_class, model, sizes, after) -> dict:
    """Edit 6 / amendment 3.7: the gate re-run with same-spot reports within 30 minutes collapsed to one."""
    try:
        collapsed = prep.prepare(prep.collapse_sessions(rows), spot_class)
    except prep.NotRunnable as exc:
        return {"verdict": "NOT RUNNABLE", "reason": str(exc)}
    if not collapsed.floor["runnable"]:
        return {"verdict": "NOT RUNNABLE", "reason": "floor not met after collapsing", "floor": collapsed.floor}
    cfit = model.fit(collapsed.fit_rows, **sizes)
    out = _score(cfit, collapsed, spot_class, model, after)
    out.pop("records", None)
    return {"gate": out, "diagnostics": cfit.diagnostics}


def check_review(review_ref: str, differs=None) -> str:
    """Amendment 5.2: the review must name a sha whose surf_truth code is IDENTICAL to the code that runs.
    Returns '' when it is, else the reason. `differs(sha)` -> True / False / None (unknown sha)."""
    differs = differs or code_differs
    m = REVIEW_RE.search(review_ref or "")
    if not m:
        return "no research-lead review recorded (expected '... reviewed at <sha>')"
    verdict = differs(m.group(1))
    if verdict is None:
        return f"the reviewed sha {m.group(1)} is not in this repository"
    if verdict:
        return f"the surf_truth code differs from the reviewed {m.group(1)}: a new review is needed"
    return ""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", action="append", required=True, help="a directory of manifested exports")
    ap.add_argument("--classes", required=True, help="JSON spot_id -> class, from the REGISTERED B2 scheme")
    ap.add_argument("--review-ref", required=True, help="the research lead's review: '#992 reviewed at <sha>'")
    ap.add_argument("--run-store", required=True, help="the PRIVATE directory of every run record (amendment 5.3)")
    ap.add_argument("--chains", type=int, default=4)
    ap.add_argument("--warmup", type=int, default=1000)
    ap.add_argument("--samples", type=int, default=1000)
    args = ap.parse_args(argv)
    if (args.chains, args.warmup, args.samples) != (4, 1000, 1000):
        print("refused: the gated fit is registered as 4 chains x 1000 warmup x 1000 samples", file=sys.stderr)
        return 2
    try:
        version = code_version()
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        return 2
    reason = check_review(args.review_ref)
    if reason:
        print("refused: " + reason, file=sys.stderr)
        return 2
    os.makedirs(args.run_store, exist_ok=True)
    if already_scored(read_store(args.run_store), version):
        print("refused: this model version already has a scored run (one per version; amendment 5.3)", file=sys.stderr)
        return 2
    tests = model_tests()
    if not tests["ok"]:
        print("refused: the model's tests fail in this environment: " + tests["summary"], file=sys.stderr)
        return 2
    rec = run(args, version, tests)
    name = f"{rec['started_at'].replace(':', '').replace('-', '')[:15]}-{version['tree'][:12]}.json"
    with open(os.path.join(args.run_store, name), "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=1, default=str)
    print(rec["verdict"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
