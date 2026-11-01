"""Run the unchanged Marine fetcher with its payload held only in memory."""
from pathlib import Path
import runpy
import sys


def main():
    target = Path(sys.argv[1]).resolve()
    allowed = Path(__file__).resolve().parents[1] / "services"
    if target.parent != allowed or target.name not in ("copernicus_global_fetcher.py", "copernicus_fetcher.py"):
        raise RuntimeError("Unexpected Marine fetcher path")
    payload = sys.stdin.read()
    sys.path.insert(0, str(target.parent))
    # Python's argv is in-process only; the OS command line contains no payload.
    sys.argv = [str(target), payload]
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
