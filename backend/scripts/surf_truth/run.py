"""Run the pre-registered surf-truth fit (#989) on manifested private exports. OFFLINE ONLY.

    python -m scripts.surf_truth.run --export DIR [--export DIR ...] --classes classes.json \\
        --review-ref "<research lead review: PR/commit/link>" --model-version <commit> --out run.json

Refuses (exit 2) without a recorded research-lead review of this code against #989 (builder and checker apart).
Below the registered floor it writes a NOT RUNNABLE record with the counts and fits nothing (exit 0).
Otherwise: fit (gated Bayesian), leak check, predict and score the held-out anchor targets, both controls, verdict.
The record is a VERSIONED RUN for the admin Model tab; a VOID run can never be made active.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone

from . import controls, gate, prep


def _exports(dirs: list[str]):
    rows, manifests = [], []
    for d in dirs:
        for mpath in sorted(glob.glob(os.path.join(d, "*.manifest.json"))):
            data = mpath.replace(".manifest.json", ".jsonl")
            if not os.path.exists(data):
                continue
            r, m = prep.load_export(data, mpath)
            rows.extend(r)
            manifests.append(m)
    if not manifests:
        raise prep.NotRunnable("no manifested export found")
    prep.same_key(manifests)
    seen, unique = set(), []
    for r in rows:                      # overlapping exports: one row per row_key
        if r["row_key"] not in seen:
            seen.add(r["row_key"])
            unique.append(r)
    return unique, manifests


def _score(fit, prepared, spot_class, model):
    predictive, others = {}, {}
    for cell in prepared.holdout_cells:
        for t in prep.scoreable_targets(cell):
            rest = [r for r in cell.rows if r is not t]
            predictive[t["row_key"]] = model.predict_target(fit, t, rest)
            others[t["row_key"]] = rest
    targets = [t for c in prepared.holdout_cells for t in prep.scoreable_targets(c)]
    return gate.score(targets, predictive, others, spot_class)


def run(args) -> dict:
    record = {"schema": "raw-surf/surf-truth-run/1", "model_version": args.model_version,
              "review_ref": args.review_ref, "seed": gate.SEED,
              "started_at": datetime.now(timezone.utc).isoformat(), "registration": "#989 + amendments 1-2"}
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

    from . import model                                     # NumPyro/JAX only past this point
    leak = controls.leak_check(prepared.fit_rows, prepared.holdout_cells)
    fit = model.fit(prepared.fit_rows, chains=args.chains, warmup=args.warmup, samples=args.samples)
    real = _score(fit, prepared, spot_class, model)
    shuffled_rows = controls.shuffle_within_role(prepared.fit_rows)
    shuffled = _score(model.fit(shuffled_rows, chains=args.chains, warmup=args.warmup, samples=args.samples),
                      prepared, spot_class, model)
    syn_fit = model.fit(controls.add_synthetic_observer(prepared.fit_rows, fit), chains=args.chains,
                        warmup=args.warmup, samples=args.samples)
    positive = controls.positive_ok(syn_fit)
    negative_ok = real.get("n", 0) > 0 and shuffled.get("n", 0) > 0 and \
        real["improvement"] >= shuffled["improvement"]
    ctrl = {"leak": leak["ok"], "negative": negative_ok, "positive": positive["ok"]}
    return {**record, "diagnostics": fit.diagnostics, "gate": real, "leak": leak,
            "negative_control": {"real_improvement": real.get("improvement"),
                                 "shuffled_improvement": shuffled.get("improvement")},
            "positive_control": positive, "verdict": gate.final_verdict(real, ctrl, fit.diagnostics)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", action="append", required=True, help="a directory of manifested exports")
    ap.add_argument("--classes", required=True, help="JSON spot_id -> class, from the REGISTERED B2 scheme")
    ap.add_argument("--review-ref", required=True, help="the research lead's review of this code against #989")
    ap.add_argument("--model-version", required=True, help="the commit of this code")
    ap.add_argument("--out", required=True)
    ap.add_argument("--chains", type=int, default=4)
    ap.add_argument("--warmup", type=int, default=1000)
    ap.add_argument("--samples", type=int, default=1000)
    args = ap.parse_args(argv)
    if not args.review_ref.strip():
        print("refused: no research-lead review recorded", file=sys.stderr)
        return 2
    if (args.chains, args.warmup, args.samples) != (4, 1000, 1000):
        print("refused: the gated fit is registered as 4 chains x 1000 warmup x 1000 samples", file=sys.stderr)
        return 2
    rec = run(args)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=1, default=str)
    print(rec["verdict"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
