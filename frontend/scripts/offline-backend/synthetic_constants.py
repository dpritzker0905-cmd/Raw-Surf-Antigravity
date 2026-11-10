"""Grid constants shared by the offline harness backend (serve_synthetic.py) and its modules. Split out 2026-11-09 so
serve_synthetic.py stays under the 800-line limit; serve_synthetic re-exports every name (day14_arms.py reads ss.RES etc.)."""
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "backend"

WORLD = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 84.0}      # global_mid, 2 deg: 181 x 83
COARSE = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 80.0}     # global_coarse, 10 deg: 37 x 17 = 629 cells
COVERAGE = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
RES = 2.0
COARSE_RES = 10.0
REGIONAL_RES = 0.25
