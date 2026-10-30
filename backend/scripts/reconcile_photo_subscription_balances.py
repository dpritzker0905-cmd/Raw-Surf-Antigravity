"""Report historical photo-subscription evidence from an explicit offline JSON export.

No database, environment configuration, provider connection or application startup.
This phase only inventories evidence; it cannot apply financial corrections.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON object keys are not allowed")
        result[key] = value
    return result


def _reject_constant(_value):
    raise ValueError("Non-finite JSON numbers are not allowed")


def _finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON numbers are not allowed")
    return number


def _load_analyzer():
    # Import the standalone stdlib module by path. Importing the utils package
    # or application database configuration is deliberately unnecessary.
    path = Path(__file__).resolve().parents[1] / "utils" / "photo_subscription_reconciliation.py"
    spec = importlib.util.spec_from_file_location("offline_photo_subscription_reconciliation", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Offline analyzer is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Inventory historical photo-subscription evidence. Report only; no financial corrections.",
    )
    parser.add_argument("--input", required=True, type=Path, help="Explicit UTF-8 JSON export file")
    parser.add_argument("--output", type=Path, help="Create a new report file; existing paths are never overwritten")
    args = parser.parse_args(argv)
    try:
        raw = args.input.read_bytes()
    except OSError:
        print("Could not read the input file", file=sys.stderr)
        return 2
    try:
        payload = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_unique_object,
                             parse_constant=_reject_constant, parse_float=_finite_float)
    except UnicodeError:
        print("Input must be UTF-8 JSON", file=sys.stderr)
        return 2
    except json.JSONDecodeError as error:
        print(f"Invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}", file=sys.stderr)
        return 2
    except ValueError as error:
        print(f"Invalid JSON: {error}", file=sys.stderr)
        return 2
    try:
        analyzer = _load_analyzer()
    except Exception:
        print("Could not load the standalone offline analyzer", file=sys.stderr)
        return 1
    try:
        report = analyzer.analyze_export(payload)
    except ValueError as error:
        print(f"Invalid export: {error}", file=sys.stderr)
        return 2
    except Exception:
        print("Offline analysis failed; no correction was applied", file=sys.stderr)
        return 1
    try:
        if (not isinstance(report, dict) or report.get("apply_ready") is not False
                or report.get("money_correction", "missing") is not None
                or report.get("input_digest") != analyzer.canonical_digest(payload)):
            raise ValueError("Unexpected report-only contract")
        for group in ("cases", "accounts"):
            for row in report[group]:
                if row.get("apply_ready") is not False or row.get("money_correction", "missing") is not None:
                    raise ValueError("Unexpected row correction contract")
        report["input_file_sha256"] = hashlib.sha256(raw).hexdigest()
        output = json.dumps(report, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False) + "\n"
    except Exception:
        print("Analyzer returned an invalid report-only result", file=sys.stderr)
        return 1
    if args.output is None:
        sys.stdout.write(output)
        return 0
    try:
        with args.output.open("x", encoding="utf-8", newline="\n") as target:
            target.write(output)
    except FileExistsError:
        print("Output already exists; choose a new report path", file=sys.stderr)
        return 1
    except OSError:
        print("Could not create the output report; input was not modified", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
