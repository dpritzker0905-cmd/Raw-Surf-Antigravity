"""MUTATION BATTERY for the Mission-2 load-time stride.

Green tests prove the code passes them. They do not prove the tests would catch the code being
wrong. Six arms, each disabling one piece of the change in-process (no file is edited), each with
a REQUIRED outcome:

  N1  neuter the store seam (_stride_raw_grid_dicts -> no-op)   -> the construction gate must go RED
  N2  drop the load_stride stamp                                -> the wiring test must go RED
                                                                   (double decimation returns)
  N3  write the strided product under the FULL cache key        -> the cache guard must go RED
  N4  make the kill switch inert                                -> the kill-switch test must go RED
  N5  stop the build loop forwarding the hint                   -> the wiring test must go RED
  N6  everything restored                                       -> all green

Run from backend/:  python M2c_mutation_battery.py
"""
import subprocess
import sys

sys.path.insert(0, r"C:\Users\dprit\Raw-Surf\backend")

TESTS = "tests/test_series_load_stride.py"
GATE = f"{TESTS}::test_a_strided_load_constructs_only_the_cells_it_keeps"
WIRING = f"{TESTS}::test_the_series_loop_forwards_the_stride_to_the_resolver"
CACHE = f"{TESTS}::test_a_strided_load_never_poisons_the_full_grid_cache"
KILL = f"{TESTS}::test_kill_switch_restores_the_unstrided_load"

PY = r"C:\Users\dprit\AppData\Local\Python\bin\python3.exe"


def run_test(nodeid, patch_src):
    """Run one test with a conftest-style in-process patch applied first."""
    code = (
        "import sys; sys.path.insert(0, '.')\n"
        + patch_src
        + "\nimport pytest\n"
        f"raise SystemExit(pytest.main(['-q','-p','no:cacheprovider','{nodeid}']))\n"
    )
    r = subprocess.run([PY, "-c", code], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=r"C:\Users\dprit\Raw-Surf\backend")
    out = (r.stdout or "") + (r.stderr or "")
    passed = " passed" in out and " failed" not in out
    return ("PASS" if passed else "FAIL"), out.strip().splitlines()[-1][:110] if out.strip() else ""


ARMS = [
    ("N1  neuter the store seam", GATE, "FAIL",
     "from services.weather_pipeline import store as S\n"
     "S._stride_raw_grid_dicts = lambda data, stride: False\n"),

    ("N2  drop the load_stride stamp", WIRING, "FAIL",
     # the fake resolver in the wiring test stamps it itself, so neuter the CONSUMER instead:
     # a build loop that cannot read the stamp re-strides an already-strided grid.
     "from services.weather_pipeline import grid_series_helper as G\n"
     "G._load_stride_of = lambda grid: 1\n"),

    ("N3  strided product under the FULL cache key", CACHE, "FAIL",
     "from services.weather_pipeline import store as S\n"
     "_orig = S.ProductStore.load_product\n"
     "def poisoned(self, filename, stride=None):\n"
     "    p = _orig(self, filename, stride)\n"
     "    if stride and stride > 1:\n"
     "        S.ProductStore._product_cache[filename] = (p, __import__('time').time())\n"
     "    return p\n"
     "S.ProductStore.load_product = poisoned\n"),

    ("N4  kill switch made inert", KILL, "FAIL",
     "from services.weather_pipeline import store as S\n"
     "S._effective_load_stride = lambda stride: (int(stride) if stride and int(stride) > 1 else 1)\n"),

    ("N5  build loop stops forwarding", WIRING, "FAIL",
     "from services.weather_pipeline import grid_series_helper as G\n"
     "G._resolver_takes_series_stride = lambda r: False\n"),

    ("N6  everything restored", TESTS, "PASS", ""),
]

if __name__ == "__main__":
    print("MUTATION BATTERY -- Mission 2 load-time stride\n")
    caught = 0
    for label, nodeid, expected, patch in ARMS:
        got, last = run_test(nodeid, patch)
        ok = got == expected
        caught += ok
        print(f"  [{'CAUGHT' if ok else 'MISSED'}] {label}")
        print(f"           expect {expected}  got {got}   {last}")
    print(f"\n  {caught}/{len(ARMS)} arms behaved as required.")
    sys.exit(0 if caught == len(ARMS) else 1)
