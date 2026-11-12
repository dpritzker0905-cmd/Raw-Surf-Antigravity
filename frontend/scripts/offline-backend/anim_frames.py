"""Analyse scn_layer_anim.js runs: what the user saw per layer, from the compositor's own frames (2026-11-11).

Per run directory (one layer x viewport x theme x arm): the screencast JPEGs, run.json (marks, rAF, long tasks).
Each frame is reduced to a 60 x 60 grey+colour thumbnail. The REFERENCE is the median of the frames between 'ref' and
'toggle' (the basemap with the layer off). For every frame: D_ref = mean |frame - reference| (how much layer is on screen) and
D_prev = mean |frame - previous frame| (how much changed).

  toggle_first_ms   toggle mark -> first frame with D_ref above ON_FRAC of the run's settled layer level (the layer appears)
  toggle_full_ms    toggle mark -> first frame within 15 % of the settled level (the full picture)
  blank_frames      frames after the first toggle frame whose D_ref falls under BLANK_FRAC of the settled level (the layer gone)
  flash_events      runs of such frames (each a visible blank flash)
  step_settle_ms    per step: mark -> last frame whose D_prev exceeds the animation's own idle churn x 3, within STEP_GAP
  raf p50/p95, dropped (> 33.4 ms) and long-task ms, per phase (toggle, scrub, zoom, pan, idle)
Usage: python anim_frames.py <out dir> [--md summary.md]
Animated layers (wind, waves) churn every frame; the idle churn (median D_prev in the 1.5 s before the first step) is
subtracted as the noise floor, so a step's settle is "the frame-to-frame change is back to idle".
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ON_FRAC = 0.25
BLANK_FRAC = 0.35
FULL_FRAC = 0.85


def thumb(path):
    im = Image.open(path).convert("RGB").resize((60, 60), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32)


def pct(xs, q):
    return float(np.percentile(xs, q)) if len(xs) else None


def phase_of(t, marks):
    names = [m for m in marks if m[0] <= t]
    if not names:
        return "pre"
    n = names[-1][1]
    if n.startswith("step"):
        return "scrub"
    return {"toggle": "toggle", "zoom": "zoom", "pan": "pan", "ref": "pre", "end": "post"}.get(n, n)


def analyse(run_dir):
    run = json.loads((run_dir / "run.json").read_text())
    if run.get("error") or not run.get("frames"):
        return {"tag": run_dir.name, "error": run.get("error", "no frames")}
    marks = sorted(run["marks"])
    mk = {name: t for t, name in marks}
    frames = sorted(run["frames"], key=lambda f: f["ts"])
    ts = np.array([f["ts"] for f in frames])
    imgs = [thumb(run_dir / f["file"]) for f in frames]
    pre = [im for t, im in zip(ts, imgs) if mk["ref"] <= t < mk["toggle"]]
    ref = np.median(np.stack(pre), axis=0) if pre else imgs[0]
    d_ref = np.array([np.abs(im - ref).mean() for im in imgs])
    d_prev = np.concatenate([[0.0], [np.abs(imgs[i] - imgs[i - 1]).mean() for i in range(1, len(imgs))]])
    after = ts >= mk["toggle"]
    first_step = mk.get("step1", mk.get("zoom"))
    settle_win = (ts >= first_step - 1500) & (ts < first_step)
    level = float(np.median(d_ref[settle_win])) if settle_win.any() else float(d_ref[after].max())
    idle_churn = float(np.median(d_prev[settle_win])) if settle_win.any() else 0.0
    on_idx = np.where(after & (d_ref >= ON_FRAC * level))[0]
    full_idx = np.where(after & (d_ref >= FULL_FRAC * level))[0]
    out = {"tag": run_dir.name, "layer": run["layer"], "vp": run["vp"], "theme": run["theme"], "arm": run["arm"],
           "frames": len(frames), "level": round(level, 2), "idle_churn": round(idle_churn, 3)}
    out["toggle_first_ms"] = round(ts[on_idx[0]] - mk["toggle"]) if len(on_idx) else None
    out["toggle_full_ms"] = round(ts[full_idx[0]] - mk["toggle"]) if len(full_idx) else None
    blank = after & (ts > (ts[on_idx[0]] if len(on_idx) else mk["toggle"])) & (d_ref < BLANK_FRAC * level)
    out["blank_frames"] = int(blank.sum())
    out["flash_events"] = int(np.sum(np.diff(blank.astype(int)) == 1))
    # where blanks happen, by phase
    out["blank_by_phase"] = {}
    for t in ts[blank]:
        p = phase_of(t, marks)
        out["blank_by_phase"][p] = out["blank_by_phase"].get(p, 0) + 1
    # per step: settle time and the biggest single-frame jump (a pop)
    steps = []
    for i in range(1, 100):
        k = "step%d" % i
        if k not in mk:
            break
        nxt = mk.get("step%d" % (i + 1), mk.get("zoom"))
        win = (ts >= mk[k]) & (ts < nxt)
        busy = np.where(win & (d_prev > max(3 * idle_churn, 0.6)))[0]
        settle = round(ts[busy[-1]] - mk[k]) if len(busy) else 0
        busy_frames = int(len(busy))
        pop = float(d_prev[win].max()) if win.any() else 0.0
        steps.append({"settle_ms": settle, "busy_frames": busy_frames, "pop": round(pop, 2)})
    out["step_settle_p50"] = pct([s["settle_ms"] for s in steps], 50)
    out["step_settle_max"] = max([s["settle_ms"] for s in steps], default=None)
    out["step_busy_frames_p50"] = pct([s["busy_frames"] for s in steps], 50)
    out["step_pop_p50"] = pct([s["pop"] for s in steps], 50)
    out["step_pop_rel"] = round(out["step_pop_p50"] / level, 3) if level and out["step_pop_p50"] is not None else None
    # frame pacing
    raf = np.array(run.get("raf", []))
    gaps = np.diff(raf) if len(raf) > 1 else np.array([])
    gph = {}
    for t, g in zip(raf[1:], gaps):
        gph.setdefault(phase_of(t, marks), []).append(g)
    out["raf"] = {p: {"n": len(v), "p50": round(pct(v, 50), 1), "p95": round(pct(v, 95), 1),
                      "dropped": int(sum(1 for x in v if x > 33.4)), "max": round(max(v), 1)} for p, v in gph.items()}
    lt = {}
    for t, d in run.get("lt", []):
        p = phase_of(t, marks)
        lt[p] = lt.get(p, 0) + d
    out["longtask_ms"] = {p: round(v) for p, v in lt.items()}
    loaf = {}
    scripts = {}
    for row in run.get("loaf", []):
        t, d, b = row[0], row[1], row[2]
        p = phase_of(t, marks)
        loaf[p] = loaf.get(p, 0) + b
        for sc in (row[3] if len(row) > 3 else []):
            key = "%s|%s|%s|%s@%s" % (p, sc[1], sc[2], sc[3], sc[4])
            scripts[key] = scripts.get(key, 0) + sc[0]
    out["top_scripts"] = sorted(((round(v), k) for k, v in scripts.items()), reverse=True)[:14]
    out["loaf_blocking_ms"] = {p: round(v) for p, v in loaf.items()}
    out["errors"] = len(run.get("errors", []))
    return out


def main():
    root = Path(sys.argv[1])
    rows = [analyse(d) for d in sorted(root.iterdir()) if (d / "run.json").exists()]
    (root / "anim_summary.json").write_text(json.dumps(rows, indent=1))
    md = ["| run | toggle first / full ms | blank frames (flashes) | step settle p50 / max ms | step pop / level | rAF p95 scrub / zoom / pan | dropped scrub / zoom / pan | long-task ms toggle / scrub |",
          "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r.get("error"):
            md.append("| %s | error: %s |||||||" % (r["tag"], r["error"][:60]))
            continue
        R = r["raf"]
        g = lambda p, k: (R.get(p) or {}).get(k, "-")  # noqa: E731
        md.append("| %s | %s / %s | %d (%d) | %s / %s | %s | %s / %s / %s | %s / %s / %s | %s / %s |" % (
            r["tag"], r["toggle_first_ms"], r["toggle_full_ms"], r["blank_frames"], r["flash_events"],
            r["step_settle_p50"], r["step_settle_max"], r["step_pop_rel"],
            g("scrub", "p95"), g("zoom", "p95"), g("pan", "p95"), g("scrub", "dropped"), g("zoom", "dropped"), g("pan", "dropped"),
            r["longtask_ms"].get("toggle", 0), r["longtask_ms"].get("scrub", 0)))
    text = "\n".join(md)
    print(text)
    if "--md" in sys.argv:
        Path(sys.argv[sys.argv.index("--md") + 1]).write_text(text + "\n")


if __name__ == "__main__":
    main()
