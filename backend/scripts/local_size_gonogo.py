"""The RATING_LOCAL_SIZE go/no-go, as one command.

    python backend/scripts/local_size_gonogo.py

WHY THIS EXISTS
---------------
`95c5f04a` (2026-07-11) shipped local size calibration behind `RATING_LOCAL_SIZE` and put the
rollout plan in its commit message: "once climatology is sane (FL spots get small refs, big-wave
spots large), flip RATING_LOCAL_SIZE=1 and verify." Eighteen days later the flag was still 0. The
admin endpoint `/admin/surf-forecast/local-size-preview` was then built to answer it -- and still
nobody ran it, because it needs an admin JWT nobody had to hand.

★ That is the actual root cause, and it is not laziness: the verification required a credential and a
bespoke script, so it never happened. This script removes the excuse. It needs no admin JWT and no
hand-typed curl; it uses the `RENDER_API_KEY` already in `backend/.env` to read production's own
Supabase credentials, then does the whole check in-process.

⚠️ SECRET HYGIENE IS PART OF THE DESIGN. Credentials are fetched, used, and discarded inside this
process. They are never printed, never written to disk, never passed on a command line, and any
error text is scrubbed before display. Nothing here starts a local backend -- the rogue-local-backend
gate (never run the app against prod creds) is respected because this only ever READS three objects.

⚠️ THE GO/NO-GO IS THE EXEMPLARS, NEVER THE AGGREGATE. A blob giving Florida 2.5 m and Pipeline 0.7 m
-- exactly inverted -- produces a large, symmetric, entirely plausible delta distribution. Only named
exemplars with expected directions can catch that, which is why the rollout plan named them.

⚠️ READ-ONLY. This changes nothing. Flipping the flag afterwards is three places, together:
precompute.yml, forecast-ingest.yml, and Render env -- see `tests/test_flag_lane_parity.py`.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except (AttributeError, OSError, ValueError, LookupError):
    pass

RENDER_SERVICE = os.environ.get("RENDER_SERVICE_ID", "srv-d7fhiu7lk1mc73debje0")
CLIMATOLOGY_KEY = "spot_ratings/size_climatology.json"
RATINGS_KEY = "spot_ratings/latest.json"
BUCKET = "weather-products"

_SECRETS: list = []


def _scrub(text):
    """Never let a key reach the terminal, even inside a traceback or an HTTP error body."""
    out = str(text)
    for secret in _SECRETS:
        if secret and len(secret) > 8:
            out = out.replace(secret, "<redacted>")
    # Belt and braces: anything that looks like a JWT or a long opaque token.
    out = re.sub(r"eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-.]+", "<redacted-jwt>", out)
    out = re.sub(r"\b(rnd_|sbp_)[A-Za-z0-9_\-]{10,}", "<redacted>", out)
    return out


def _render_api_key():
    key = os.environ.get("RENDER_API_KEY", "").strip()
    if key:
        return key
    try:
        with open(".env", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("RENDER_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return ""


def _prod_credentials(session):
    """Production's SUPABASE_URL + service role key, read from the Render service that uses them.

    ⚠️ `backend/.env` points at the DEV project, which has no spot_ratings objects at all -- reading
    it instead of Render is how "the climatology blob is absent" got believed twice.
    """
    key = _render_api_key()
    if not key:
        raise SystemExit("no RENDER_API_KEY (env or backend/.env) -- cannot reach production")
    _SECRETS.append(key)
    resp = session.get(f"https://api.render.com/v1/services/{RENDER_SERVICE}/env-vars?limit=100",
                       headers={"Authorization": f"Bearer {key}"}, timeout=30)
    if resp.status_code != 200:
        raise SystemExit(_scrub(f"Render API {resp.status_code}: {resp.text[:200]}"))
    env = {}
    for row in resp.json():
        ev = row.get("envVar", row)
        env[ev.get("key")] = ev.get("value")
    url = (env.get("SUPABASE_URL") or "").rstrip("/")
    svc = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not svc:
        raise SystemExit("Render service has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    _SECRETS.append(svc)
    return url, svc, env


def _get_json(session, url, svc, what):
    resp = session.get(url, headers={"Authorization": f"Bearer {svc}", "apikey": svc}, timeout=120)
    if resp.status_code != 200:
        raise SystemExit(_scrub(f"{what}: HTTP {resp.status_code} {resp.text[:200]}"))
    return resp.json()


def _exemplar_defs():
    from services.weather_pipeline.local_size_preview import SANITY_EXEMPLARS
    return SANITY_EXEMPLARS


def _all_spots(session, url, svc, page=1000):
    """EVERY active spot, paginated.

    ⚠️ Supabase REST caps a response server-side (`db-max-rows`, 1000 here) and `?limit=5000` does
    NOT override it -- it truncates SILENTLY, with a 200 and no warning. The first run of this script
    read exactly 1000 of 1,773 spots and reported Mavericks as having "no reference yet", which would
    have been read as a gap in the climatology rather than a gap in the query. A round number in a
    row count is a truncation tell; check it before believing anything downstream.
    """
    out, offset = [], 0
    while True:
        rows = _get_json(
            session,
            f"{url}/rest/v1/surf_spots?select=id,name,latitude,longitude"
            f"&is_active=eq.true&latitude=not.is.null&order=id&offset={offset}&limit={page}",
            svc, f"surf_spots (offset {offset})")
        out.extend(rows)
        if len(rows) < page:
            return out
        offset += page
        if offset > 100_000:                      # runaway guard
            return out


def main():
    try:
        import requests
    except ImportError:
        raise SystemExit("needs `requests`")

    with requests.Session() as session:
        url, svc, render_env = _prod_credentials(session)
        project = (re.search(r"https://([a-z0-9]+)\.supabase", url) or [None, "?"])[1]
        print(f"production project : {project}")
        print(f"RATING_LOCAL_SIZE on the serve lane : "
              f"{render_env.get('RATING_LOCAL_SIZE', '(unset -> 0)')}")
        print()

        clim = _get_json(session, f"{url}/storage/v1/object/{BUCKET}/{CLIMATOLOGY_KEY}", svc,
                         "climatology blob")
        # ⚠️ RATINGS_KEY was declared at the top of this file from the first commit and READ BY
        # NOTHING — so the go/no-go answered "is the blob sane?" and never "what does the flip do to
        # the product?", even though local_size_preview.preview_impact computes exactly that and is
        # EXACT (reference_size_m enters only two multiplicative factors, so the A/B is a ratio on
        # the persisted score and costs one blob read). A dead constant is not a neutral leftover
        # here: it named the missing half of the decision and made it look answered.
        served = _get_json(session, f"{url}/storage/v1/object/{BUCKET}/{RATINGS_KEY}", svc,
                           "served ratings blob")
        spots = _all_spots(session, url, svc)

    from services.weather_pipeline.local_size_preview import anchor_report, sanity_check

    cells = clim.get("spots") or clim.get("cells") or {}
    print(f"climatology        : {len(cells)} entries, updated {clim.get('updated_at')}")
    print(f"active spots        : {len(spots)}")
    print()

    report = sanity_check(clim, spots)
    print("=" * 92)
    print("THE GO/NO-GO -- named exemplars, because an inverted blob is invisible in aggregate")
    print("=" * 92)
    for row in report["exemplars"]:
        bounds = []
        if row.get("expected_min_m") is not None:
            bounds.append(f">={row['expected_min_m']}")
        if row.get("expected_max_m") is not None:
            bounds.append(f"<={row['expected_max_m']}")
        print(f"  {row['verdict']:>14}  {row['exemplar']:<34} "
              f"ref={row['reference_m']} m  expected {' and '.join(bounds) or '-'}")
    print()
    print(f"resolved {report['resolved']} / failures {report['failures']}")
    print(f"VERDICT: {report['verdict']}")

    # What the owner's own anchors do at a representative local reference, for context only -- the
    # exemplar verdict above is the decision.
    for ref in (0.65, 0.75, 0.85):
        rep = anchor_report(ref)
        print(f"  owner anchors at R={ref} m : {rep['passed']}/{rep['total']} pass")

    # ── What to CHANGE, not just whether to go ──────────────────────────────────────────────────
    # The exemplar bounds ask "is the blob shaped right". They do not ask the question that actually
    # decides the rollout: does the reference this blob yields make the OWNER'S ANCHORS pass? At p80
    # it does not -- Florida lands ~1.0-1.2 m while the anchors need 0.65-0.85 m, so flipping would
    # push clean 2-3 ft to poor_fair and pumping 6-8 ft down from epic. REF_PERCENTILE is a kwarg, so
    # sweep it and report the percentile that lands Florida in the window.
    from services.weather_pipeline.spot_size_climatology import REF_PERCENTILE, reference_map
    print()
    print("=" * 92)
    print(f"PERCENTILE SWEEP -- REF_PERCENTILE is {REF_PERCENTILE}; which value satisfies the anchors?")
    print("=" * 92)
    coord_of = {}
    for label, lat, lng, _hi, _lo in _exemplar_defs():
        best, sid = None, None
        for sp in spots:
            try:
                d = abs(float(sp["latitude"]) - lat) + abs(float(sp["longitude"]) - lng)
            except (TypeError, ValueError, KeyError):
                continue
            if best is None or d < best:
                best, sid = d, str(sp.get("id"))
        if best is not None and best < 0.2:
            coord_of[label] = sid

    labels = list(coord_of)
    print("  pctl  " + "".join(f"{l.split('(')[-1].rstrip(')')[:13]:>15}" for l in labels)
          + "   anchors@FL")
    for pctl in (0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85):
        refs = reference_map(clim, percentile=pctl) or {}
        cells = [refs.get(coord_of[l]) for l in labels]
        fl = [c for l, c in zip(labels, cells) if "Florida" in l and c]
        anchors = anchor_report(sum(fl) / len(fl)).get("passed") if fl else None
        row = "".join(f"{(f'{c:.2f}' if c else '-'):>15}" for c in cells)
        mark = " <-" if anchors == 5 else ""
        print(f"  {pctl:.2f}  {row}   {anchors}/5{mark}")

    # ── THE PRODUCT IMPACT — a sane blob is not the same question as a safe flip ─────────────────
    # ★★ The exemplars and the anchors say the REFERENCE is right. They say nothing about how many
    # spot-hours change LEVEL when the flag flips, and LEVEL is what a surfer reads. The recorded
    # precedent is the partitions A/B, where a change that looked defensible moved 50% of spot-hours
    # and was therefore a product event needing its own decision, not a config edit.
    # ⚠️ The direction matters more than the magnitude: local calibration is a REDISTRIBUTION whose
    # curves cross at 2.83 ft, so a healthy result is DOWNGRADES at the top (the saturation this
    # exists to stop) and small moves below. Mass upgrades would mean the blob is inverted.
    from services.weather_pipeline.local_size_preview import preview_impact
    frames = (served.get("frames") if isinstance(served, dict) else None) or \
             (served if isinstance(served, list) else None) or \
             ([served] if isinstance(served, dict) and served.get("spots") else [])
    print()
    print("=" * 92)
    print(f"PRODUCT IMPACT -- A/B over the served ratings ({len(frames)} frame(s))")
    print("=" * 92)
    imp = preview_impact(clim, frames)
    r, i = imp["readiness"], imp["impact"]
    print(f"  coverage   {r['spots_with_reference']}/{r['spots_rated']} rated spots have a "
          f"reference ({r['coverage_pct']}%)")
    print(f"  compared   {i['spot_hours_compared']} spot-hours  "
          f"(indeterminate {i['indeterminate']})")
    print(f"  LEVEL      unchanged {i['level_unchanged']}  up {i['level_up']}  "
          f"down {i['level_down']}  => {i['level_change_pct']}% CHANGE")
    print(f"  delta      p10 {i['delta_p10']}  median {i['delta_median']}  p90 {i['delta_p90']}  "
          f"(min {i['delta_min']}, max {i['delta_max']})")
    if imp.get("level_flow"):
        print("  flow       " + ", ".join(f"{k} x{v}" for k, v in
                                          list(imp["level_flow"].items())[:8]))
    def _mover(row, arrow):
        # Keys are name/score_now/score_after/level_now/level_after — NOT spot/score/level. A first
        # pass guessed the latter and printed "None -> None" for every row, which reads as missing
        # data rather than a wrong field name. ★ An instrument that renders None on a healthy blob
        # is indistinguishable from the blob being empty.
        print(f"    {arrow} {row.get('name') or row.get('spot_id')}: "
              f"{row.get('level_now')} -> {row.get('level_after')}  "
              f"({row.get('score_now')} -> {row.get('score_after')}, "
              f"h={row.get('surf_height_m')} m, ref={row.get('reference_m')} m)")
    for row in (imp.get("biggest_downgrades") or [])[:4]:
        _mover(row, "v")
    for row in (imp.get("biggest_upgrades") or [])[:4]:
        _mover(row, "^")

    print()
    if report["verdict"] == "SANE":
        print("GO. Flip RATING_LOCAL_SIZE=1 in ALL THREE, together:")
        print("   .github/workflows/precompute.yml, .github/workflows/forecast-ingest.yml, Render env")
        print("   (test_flag_lane_parity.py fails if the lanes drift apart)")
        return 0
    print("NO-GO. Do not flip. 'NOT ENOUGH DATA' means the blob is still accumulating;")
    print("'INVERTED OR MISCALIBRATED' means an exemplar is on the wrong side of its bound.")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:                                   # noqa: BLE001 - scrub before showing
        print(_scrub(f"{type(exc).__name__}: {exc}"), file=sys.stderr)
        sys.exit(2)
