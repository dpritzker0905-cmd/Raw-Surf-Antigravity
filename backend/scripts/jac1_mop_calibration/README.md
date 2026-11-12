# JAC-1 calibration against CDIP MOP (2026-11-10)

The instrument behind `docs/research/FINDING-2026-11-11-jac1-mop-refutes-the-landward-taper.md`. It asks what the
surf-height swell-angle factor (`surf_transform._height_exposure_factor`) should do beyond 90 deg off the chain's shore
normal, using CDIP MOP v1.1 alongshore hindcasts (a physical refraction/diffraction model) against the offshore CDIP buoys
that drive MOP.

Reads only public CDIP THREDDS data (about 8 MB of OPeNDAP subsets plus the 12.5 MB MOP catalogue) and the repo's own
`backend/data/mop_spot_cells.json` and `surf_point._shore_normal_precedence`. Never calls the app backend.

Run from `backend/` with `backend/.venv` and `RUNTIME_FLAGS_MANIFEST=0 TESTING=1`, in this order; every script reads and
writes its work directory `JAC1_MOP_DIR` (default `jac1_mop_work/`, keep it out of git):

1. `locate.py`: the spots, their chain shore normals and the nearest MOP alongshore point (writes `spots.json`).
2. `fetch.py`: MOP and buoy subsets, 2022-01 to 2025-03, every second hour (writes `dl/npz/`).
3. `analyze.py`: binned Hs ratios by angle, the taper family and the fits (writes `binned.json`).
4. `losers.py`: the spots whose served height a taper would cut, and by how much.
5. `tables.py`, `assemble.py`: the report tables.

These are research scripts (not imported by the app, not in any CI lane). Reuse them before any change to the >90 deg
part of the height factor, or to tune a raised floor, and re-check the shore normals first: the chain's normals differ
from MOP's own by up to 37 deg at several spots, which alone moves Rincon's share of hours beyond 90 deg from 62% to 1%.
