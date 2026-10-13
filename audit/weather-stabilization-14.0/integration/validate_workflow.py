"""Parse exact workflow YAML and materialize its existing read-only checks."""
import hashlib
import json
from pathlib import Path
import re
import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


class UniqueBaseLoader(yaml.BaseLoader):
    """Keep GitHub's `on` key as a string and reject duplicate YAML keys."""


def mapping(loader, node):
    pairs = loader.construct_pairs(node)
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate YAML key: {key}")
        result[key] = value
    return result


UniqueBaseLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
workflows = {}
for name in ("ci.yml", "encoding-check.yml", "loc-check.yml"):
    path = ROOT / ".github/workflows" / name
    workflows[name] = yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueBaseLoader)
    assert "on" in workflows[name] and "jobs" in workflows[name]

ci = workflows["ci.yml"]
broad_job = ci["jobs"]["lint-and-build"]
broad_test = next(step for step in broad_job["steps"] if step.get("name") == "Run tests")
focused_job = ci["jobs"]["frontend-marine-composition-guards"]
focused_test = next(step for step in focused_job["steps"]
                    if "--testPathPattern" in step.get("run", ""))
assert broad_test.get("continue-on-error", "false") == "false"
assert broad_job.get("continue-on-error", "false") == "false"
assert focused_test.get("continue-on-error", "false") == "false"
assert focused_job.get("continue-on-error", "false") == "false"
gate = next(step for step in focused_job["steps"]
            if "const MIN_SUITES" in step.get("run", ""))
assert gate.get("if") == "always()"
js = gate["run"].split("node - <<'JS'\n", 1)[1].rsplit("\nJS", 1)[0]
input_path = HERE.parent / "frontend-gate.json"
results = json.loads(input_path.read_text(encoding="utf-8"))
js = js.replace("fs.readFileSync('guard-results.json', 'utf8')",
                "fs.readFileSync(" + json.dumps(str(input_path)) + ", 'utf8')")
(HERE / "frontend-gate-check.cjs").write_text(js + "\n", encoding="utf-8")
pattern = re.search(r'--testPathPattern="([^"]+)"', focused_test["run"]).group(1)
names = [Path(test["name"]).name for test in results["testResults"]]
assert all(re.search(pattern, name) for name in names), names
encoding = next(step for step in workflows["encoding-check.yml"]["jobs"]["check-encoding"]["steps"]
                if "run" in step)
(HERE / "encoding-check.sh").write_text(encoding["run"], encoding="utf-8", newline="\n")
receipt = {
    "yaml_parser": "PyYAML " + yaml.__version__ + "; BaseLoader preserves on; duplicate keys rejected",
    "yaml_files": {name: {"jobs": len(value["jobs"]),
        "sha256": hashlib.sha256((ROOT / ".github/workflows" / name).read_bytes()).hexdigest()}
        for name, value in workflows.items()},
    "broad_frontend_test_blocks": True,
    "focused_frontend_test_blocks": True,
    "focused_count_gate_runs_always": True,
    "focused_pattern": pattern,
    "recorded_result_input_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
    "recorded_result_files_match_pattern": names,
    "recorded_results": {key: results[key] for key in (
        "numTotalTestSuites", "numPassedTestSuites", "numPassedTests", "numFailedTests")},
    "limit": "YAML parse/structural and recorded-result checks, not actionlint, a fresh Jest run, or hosted Actions execution. Gate JavaScript input filename alone is adapted to the saved receipt.",
}
(HERE / "workflow-validation.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt, indent=2))
