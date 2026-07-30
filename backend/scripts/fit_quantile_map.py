"""Fit the offshore-height quantile map from the production residual archive.

Phase 1 of the 2026-07-30 accuracy strategy: the offshore input COMPRESSES (small seas read high,
big seas read low, the aggregate hides it). This fits EQM on the bands with real independence
(2026-07-30: 0.5-1.0 m / 38 buoys, 1.0-1.5 / 46, 1.5-2.5 / 33) and leaves the thin tails on the
identity map. The fitting core lives in services/weather_pipeline/height_quantile_map.py — the
same module the engine will apply the blob through when HEIGHT_QUANTILE_MAP ships.

Usage (from backend/):
  python scripts/fit_quantile_map.py                 # fit + report, DRY RUN (nothing uploaded)
  python scripts/fit_quantile_map.py --upload        # also upload the blob to L2
  python scripts/fit_quantile_map.py --input f.json  # fit a local archive copy (offline/tests)

Credentials: production Supabase creds are read via RENDER_API_KEY (backend/.env), the same
pattern as local_size_gonogo.py — backend/.env's own SUPABASE_* point at DEV, which holds no
archive at all, and reading it is how "the blob is absent" got believed twice.

⚠️ Judge the result per band, never on the aggregate. The aggregate near zero is the trap.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.weather_pipeline.buoy_calibration import BUOY_RESIDUAL_ARCHIVE_KEY  # noqa: E402
from services.weather_pipeline.height_quantile_map import (  # noqa: E402
    QUANTILE_MAP_L2_KEY, fit_height_quantile_map,
)


def _fetch_archive_from_prod(session):
    from scripts.local_size_gonogo import _prod_credentials, _get_json
    url, svc, _env = _prod_credentials(session)
    rows = _get_json(session, f"{url}/storage/v1/object/weather-products/{BUOY_RESIDUAL_ARCHIVE_KEY}",
                     svc, "residual archive")
    return rows, url, svc


def _upload_blob(session, url, svc, blob):
    resp = session.post(
        f"{url}/storage/v1/object/weather-products/{QUANTILE_MAP_L2_KEY}",
        headers={"Authorization": f"Bearer {svc}", "apikey": svc,
                 "Content-Type": "application/json", "x-upsert": "true"},
        data=json.dumps(blob, separators=(",", ":")).encode("utf-8"), timeout=60,
    )
    if resp.status_code not in (200, 201):
        raise SystemExit(f"upload failed: HTTP {resp.status_code} {resp.text[:200]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--input", help="local archive JSON instead of production L2")
    ap.add_argument("--upload", action="store_true", help="upload the fitted blob to L2")
    args = ap.parse_args()

    session = url = svc = None
    if args.input:
        rows = json.loads(Path(args.input).read_text(encoding="utf-8"))
    else:
        import requests
        session = requests.Session()
        rows, url, svc = _fetch_archive_from_prod(session)

    print(f"archive rows: {len(rows)}  distinct buoys: {len({r.get('buoy_id') for r in rows})}")
    blob = fit_height_quantile_map(rows)
    if blob is None:
        print("NO-GO: no band satisfies both MIN_ROWS_TO_FIT and MIN_BUOYS_TO_FIT — "
              "identity map stays; wait for the archive (or the history backfill) to deepen.")
        sys.exit(1)

    print(f"\nfitted: {blob['n_rows']} rows / {blob['n_buoys']} buoys, "
          f"domain {blob['domain_m'][0]:.2f}-{blob['domain_m'][1]:.2f} m (model values), "
          f"bands {blob['bands_fitted']}")
    print(f"rows/buoy spread: {blob['rows_per_buoy']}")
    print("\n  observed band     n  buoys   bias before -> after     MAE before -> after")
    for b in blob["per_band"]:
        tag = "FITTED  " if [b["band_lo_m"], b["band_hi_m"]] in blob["bands_fitted"] else "identity"
        if "before" in b:
            print(f"  {b['band_lo_m']:4.1f}-{b['band_hi_m']:4.1f} m {tag} {b['n']:5d} {b['n_buoys']:5d}"
                  f"   {b['before']['bias_m']:+7.3f} -> {b['after']['bias_m']:+7.3f}"
                  f"      {b['before']['mae_m']:6.3f} -> {b['after']['mae_m']:6.3f}")
        else:
            print(f"  {b['band_lo_m']:4.1f}-{b['band_hi_m']:4.1f} m {tag} {b['n']:5d} {b['n_buoys']:5d}   (no rows)")
    agg_rows = [b for b in blob["per_band"] if "before" in b]
    n_tot = sum(b["n"] for b in agg_rows)
    agg_before = sum(b["before"]["bias_m"] * b["n"] for b in agg_rows) / max(n_tot, 1)
    agg_after = sum(b["after"]["bias_m"] * b["n"] for b in agg_rows) / max(n_tot, 1)
    print(f"\n  aggregate bias {agg_before:+.3f} -> {agg_after:+.3f}  "
          f"(THE TRAP — a near-zero aggregate hides compression; judge the bands)")

    # ── The two numbers that decide whether a GLOBAL map may ship ────────────────────────────
    # (2026-07-30, measured on the live archive: between-buoy share was 67.5% and two fitted
    # bands regressed — the residual is dominated by WHERE the buoy is, not how big the sea is,
    # the same site-offset pattern the nearshore Kr validation found. A global curve fits the
    # minority component and smears the majority.)
    from collections import defaultdict
    by_buoy = defaultdict(list)
    for r in rows:
        if isinstance(r.get("model_hs_m"), (int, float)) and isinstance(r.get("buoy_wvht_m"), (int, float)) \
                and r["model_hs_m"] > 0:
            by_buoy[r.get("buoy_id")].append(r["model_hs_m"] - r["buoy_wvht_m"])
    all_errs = [e for errs in by_buoy.values() for e in errs]
    grand = sum(all_errs) / max(len(all_errs), 1)
    ss_between = sum(len(v) * ((sum(v) / len(v)) - grand) ** 2 for v in by_buoy.values())
    ss_total = sum((e - grand) ** 2 for e in all_errs) or 1.0
    between_share = ss_between / ss_total
    regressed = [b for b in blob["per_band"]
                 if "before" in b and [b["band_lo_m"], b["band_hi_m"]] in blob["bands_fitted"]
                 and b["after"]["mae_m"] > b["before"]["mae_m"] + 0.005]
    print(f"\n  between-buoy share of residual variance: {between_share:.1%}"
          f"  (high = the defect is WHERE you are — a per-site offset, not a global curve)")
    if regressed or between_share > 0.5:
        print(f"  VERDICT: NO-GO for a global map — "
              f"{len(regressed)} fitted band(s) regress on MAE and/or the residual is site-dominated. "
              f"Path: retain pairs (buoy_residual_retention) until per-site fits are independent, "
              f"then correct per site.")
        if args.upload:
            raise SystemExit("refusing --upload on a NO-GO verdict")
    else:
        print("  VERDICT: fitted bands improve and the residual is not site-dominated — "
              "a global map is defensible.")

    if args.upload:
        if args.input:
            raise SystemExit("--upload requires fitting from production (drop --input)")
        _upload_blob(session, url, svc, blob)
        print(f"\nuploaded {QUANTILE_MAP_L2_KEY} (version {blob['version']}, fitted_at {blob['fitted_at']})")
    else:
        print("\nDRY RUN — re-run with --upload to publish the blob. The engine does not read it "
              "until HEIGHT_QUANTILE_MAP ships (separate, A/B-measured change).")


if __name__ == "__main__":
    main()
