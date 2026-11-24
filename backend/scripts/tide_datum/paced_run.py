"""Run a script with every CO-OPS request paced and bounded (coops_pacing; tide-a-harcon-v1 amendment 2).

    python backend/scripts/tide_datum/paced_run.py backend/scripts/tide_datum/a_harcon_parity.py --start 2027-02-01 ...

The target runs as __main__ with sys.argv = [target, *args] and its own directory first on sys.path.
"""
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import coops_pacing as CP  # noqa: E402


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    target = argv[0]
    CP.install()
    sys.argv = [target] + argv[1:]
    sys.path.insert(0, str(Path(target).resolve().parent))
    runpy.run_path(target, run_name="__main__")


if __name__ == "__main__":
    main()
