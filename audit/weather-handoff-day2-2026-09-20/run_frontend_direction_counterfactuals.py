"""Temporarily change only owned frontend files; always restore exact bytes."""
import json
import os
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent.parent
FRONTEND = ROOT / "frontend"
OWNED = ["backendWeatherServiceClient.js", "backendWeatherServiceClientHelpers.js", "backendWeatherServiceClientPoint.js"]
PATHS = [ROOT / "frontend/src/components/map" / name for name in OWNED]
MODULE = ROOT / "frontend/src/components/map/marineDirectionBlend.js"
HEAD = "d82032f5cd5978967622721b8c9638da36a87f7d"
NODE = r"C:\Program Files\nodejs\node.exe"


def run(label, pattern=None):
    output = OUT / (label + ".json")
    args = [NODE, "node_modules/react-scripts/bin/react-scripts.js", "test", "--watch=false", "--runInBand",
            "--runTestsByPath", "src/components/map/backendWeatherServiceClient.directionValidity.test.js",
            "--json", "--outputFile=" + str(output)]
    if pattern:
        args += ["--testNamePattern=" + pattern]
    with (OUT / (label + ".log")).open("wb") as log:
        result = subprocess.run(args, cwd=FRONTEND, env={**os.environ, "CI": "true"}, stdout=log,
                                stderr=subprocess.STDOUT, timeout=90)
    data = json.loads(output.read_text(encoding="utf-8"))
    counts = {key: data[key] for key in ["numPassedTests", "numFailedTests", "numPendingTests"]}
    assert result.returncode != 0 and counts["numFailedTests"] > 0, (label, result.returncode, counts)
    return {"label": label, "returncode": result.returncode, **counts}


saved = {p: p.read_bytes() for p in PATHS + [MODULE]}
results = []
try:
    for path in PATHS:
        relative = path.relative_to(ROOT).as_posix()
        path.write_bytes(subprocess.check_output(["git", "show", HEAD + ":" + relative], cwd=ROOT))
    results.append(run("frontend-direction-before"))
finally:
    for path, content in saved.items():
        path.write_bytes(content)

try:
    text = MODULE.read_text(encoding="utf-8")
    target = "Math.hypot(sumU, sumV) / amplitude <= MIN_RESULTANT"
    assert text.count(target) == 1
    MODULE.write_text(text.replace(target, "Math.hypot(sumU, sumV) / amplitude < 0"), encoding="utf-8")
    results.append(run("frontend-direction-mutation", "opposed|relative resultant|subvector and trend|extended grid.*masks|point refuses"))
finally:
    for path, content in saved.items():
        path.write_bytes(content)
assert all(path.read_bytes() == content for path, content in saved.items())
(OUT / "frontend-direction-counterfactuals.json").write_text(json.dumps({"baseline_head": HEAD,
    "mutation": "Disable only normalized-resultant rejection", "restored_exact_bytes": True,
    "results": results}, indent=2) + "\n", encoding="utf-8")
print(json.dumps(results))
