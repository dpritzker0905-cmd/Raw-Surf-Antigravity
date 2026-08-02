"""Every surface must be able to say what its surf number is STANDING ON.

MEASURED BEFORE, 2026-07-30, Bondi Beach (a spot with genuinely degraded geometry):

    /api/weather/point   shore_normal_deg = 111.54097591853844   <- FOURTEEN DECIMALS
                         shore_normal_source = (absent)
                         break_depth_m       = (absent)
                         geometry_readiness  = (absent)
    /spot-ratings        per-spot keys had `confidence` and `confirmed`, nothing about geometry
    weather sim          the richest — a full geometry block — but no verdict

So a spot running on the COARSE 0.25° grid, whose bearing class is median 22.3° off and whose
rating LEVEL differs on 45.8% of evaluations, was rendered identically to a fully-measured one —
and with more apparent precision than the measured one deserves. `resolve_surf_geometry` already
knew, and `spot_geometry_readiness.assess_geometry` already graded it. Both were dropped.

★ Stamped at the SINGLE injection point where `surf_height_m` is produced, so the glyphs, the hub
and the sim inherit ONE verdict rather than each growing its own idea of "trustworthy" — the same
reason the spectral partitions are resolved there.

⚠️ `geometry_readiness` is NOT `confidence`. `confidence` grades the PIN (accuracy_flag /
is_verified_peak); this grades the INPUTS the forecast ran on. A correctly-placed, human-verified
pin can still be scored against a coarse bearing.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.schemas import NormalizedPointResponse
from services.weather_pipeline.spot_geometry_readiness import assess_geometry
from services.weather_pipeline.surf_point import resolve_surf_geometry

# Real coordinates, measured verdicts (2026-07-30).
FULL = [("Mavericks", 37.4915, -122.5083), ("Lower Trestles", 33.3819, -117.5885),
        ("Montauk", 41.0370, -71.8980)]
# ⚠️ FIXTURES REFRESHED 2026-08-02, and the reason is a finding, not churn. Bondi and Chicama used
# to sit here because both were rejected by the fit gate (`ambiguous_coastline`) and fell back to
# the coarse 0.25° bearing. Once `shore_normal_at` was given its own 3 km radius they both BORROW a
# gate-passed neighbour's bearing and now report `shore_normal_src="etopo"`, so they no longer
# demonstrate a missing fine normal. Their verdict is still `degraded` — on `break_depth`, which
# correctly did NOT widen. See `test_a_borrowed_bearing_does_not_borrow_a_depth` below.
# These two are >15 km from any gate-passed entry, so an asset rebuild will not quietly flip them.
DEGRADED = [("Makapuu", 21.3103, -157.6608), ("Old Orchard Beach", 43.5151, -70.3776)]


def test_the_point_schema_carries_the_whole_envelope():
    """All four, or a consumer can still be told a bearing without being told its class."""
    fields = set(NormalizedPointResponse.model_fields)
    for f in ("shore_normal_source", "break_depth_m", "geometry_readiness", "geometry_missing"):
        assert f in fields, f"{f} missing — the surf number cannot describe itself"


def test_every_envelope_field_is_OPTIONAL():
    """Additive only. An older cached product, or any path that never resolves geometry, must
    still validate — a diagnostic that can 500 a forecast is a worse defect than the one it
    reports."""
    fields = NormalizedPointResponse.model_fields
    for f in ("shore_normal_source", "break_depth_m", "geometry_readiness", "geometry_missing"):
        assert fields[f].default is None, f"{f} must default to None"


@pytest.mark.parametrize("name,lat,lng", FULL)
def test_a_fully_resolved_spot_grades_full(name, lat, lng):
    a = assess_geometry(resolve_surf_geometry(lat, lng))
    assert a["verdict"] == "full", f"{name} regressed to {a['verdict']} ({a['missing']})"
    assert a["missing"] == []


@pytest.mark.parametrize("name,lat,lng", DEGRADED)
def test_a_coarse_spot_grades_DEGRADED_and_names_what_is_missing(name, lat, lng):
    """The point of the envelope: this spot is served a plausible-looking bearing off the coarse
    grid, and until now nothing said so."""
    g = resolve_surf_geometry(lat, lng)
    a = assess_geometry(g)
    assert a["verdict"] == "degraded", f"{name} graded {a['verdict']}"
    assert "fine_shore_normal" in a["missing"]
    assert g.shore_normal_deg is not None, "a coarse bearing is still SERVED — that is the trap"
    assert a["actionable"] is True


def test_the_verdict_distinguishes_spots_the_old_payload_could_not():
    """BEFORE, these two were indistinguishable in the served payload: both carried a
    `shore_normal_deg` float and nothing else."""
    mav = assess_geometry(resolve_surf_geometry(37.4915, -122.5083))
    bondi = assess_geometry(resolve_surf_geometry(-33.8900, 151.2780))
    assert mav["verdict"] != bondi["verdict"]
    assert mav["shore_normal_deg"] is not None and bondi["shore_normal_deg"] is not None, \
        "both DO serve a bearing — the verdict is the only thing that separates them"


def test_the_sim_geometry_payload_carries_the_verdict_and_plain_english():
    from services.weather_pipeline.sim_rating import geometry_payload
    out = geometry_payload({"name": "Makapuu", "latitude": 21.3103, "longitude": -157.6608})
    assert out["readiness"] == "degraded"
    assert "fine_shore_normal" in (out.get("readiness_missing") or [])
    assert "coarse" in (out.get("readiness_note") or "").lower(), \
        "the note must say what degraded MEANS, not just that it is degraded"
    # the raw fields must survive alongside it
    assert out["shore_normal_deg"] is not None and out["shore_normal_source"] == "coarse"


@pytest.mark.parametrize("name,lat,lng", [("Bondi Beach", -33.8900, 151.2780),
                                          ("Chicama", -7.7110, -79.5000)])
def test_a_borrowed_bearing_does_not_borrow_a_depth(name, lat, lng):
    """★ THE HALF-RESOLVED STATE, pinned on the two spots that first exhibited it.

    Both were REJECTED by the fit gate (`ambiguous_coastline` — Bondi re-fitted to spread 48.0° and
    was refused a second time), so neither has an entry at its own coordinate. Both now take a
    bearing from a gate-passed neighbour within 3 km, because a coastline's orientation is smooth
    over that distance (hold-out p50 4.3°, and 7.4° even in the most-ambiguous quartile).

    Neither may take a DEPTH from that neighbour: borrowed at 3 km the break depth is p50 25.7% off
    with 7.6% wrong by more than 2x, and a depth borrowed too shallow caps the breaking height at a
    number the spot never sees. So the correct end state is exactly this — bearing resolved, depth
    still missing, and the readiness envelope SAYING SO rather than reporting the spot as resolved.

    This is the guard that would catch someone "tidying" the two radii back into one constant."""
    g = resolve_surf_geometry(lat, lng)
    a = assess_geometry(g)
    assert g.shore_normal_src == "etopo:borrowed", \
        f"{name} lost its borrowed bearing, or stopped declaring it ({g.shore_normal_src})"
    assert g.shore_normal_match_km is not None and g.shore_normal_match_km > 1.0, \
        f"{name} claims a borrowed bearing but carries no distance to prove it"
    assert g.break_depth_m is None, f"{name} borrowed a depth it must not have"
    assert a["verdict"] == "degraded", f"{name} must not report as fully resolved"
    assert a["missing"] == ["borrowed_shore_normal", "break_depth"]


def test_a_borrowed_bearing_is_DISTINGUISHABLE_from_a_measured_one():
    """★★ THE PROVENANCE DEFECT, pinned. Shipped 2026-08-02 and caught by audit v5 the same day.

    Giving the shore normal a 3 km borrow radius made "the asset answered" two different facts —
    fitted AT this coordinate, or inferred from the coast next door — and for a few hours both
    reported `shore_normal_src="etopo"` and graded `full` with `missing: []`. 231 of 231 borrowed
    spots shared a (verdict, missing) cell with measured spots: the envelope discriminated for
    ZERO of them, while `scripts/seed_geometry_columns.py` writes a DB row on exactly that string
    and would have frozen borrowed bearings in as measured geometry.

    The distance was computed in `_scan` the whole time and thrown away. This test fails the moment
    the two collapse back into one label."""
    measured = resolve_surf_geometry(37.4915, -122.5083)      # Mavericks — entry at its own coord
    borrowed = resolve_surf_geometry(-33.8900, 151.2780)      # Bondi — gate-REJECTED, borrows

    assert measured.shore_normal_src == "etopo"
    assert borrowed.shore_normal_src == "etopo:borrowed"
    assert measured.shore_normal_src != borrowed.shore_normal_src, \
        "a borrowed bearing and a measured one carry the SAME label — the defect is back"

    assert measured.shore_normal_match_km == 0.0
    assert borrowed.shore_normal_match_km > 1.0

    # And the grading must differ too — a label nothing acts on is not provenance.
    am, ab = assess_geometry(measured), assess_geometry(borrowed)
    assert (am["verdict"], am["missing"]) != (ab["verdict"], ab["missing"]), \
        "the readiness envelope grades borrowed and measured identically"
    assert "borrowed_shore_normal" in ab["missing"]
    assert "borrowed_shore_normal" not in am["missing"]
    # ...and it must NOT be mistaken for the coarse fallback, which is 3x worse.
    assert "fine_shore_normal" not in ab["missing"], \
        "a borrowed bearing is being reported as if it were the 0.25 deg grid"


def test_unresolvable_geometry_reports_BLIND_rather_than_silently_omitting():
    from services.weather_pipeline.sim_rating import geometry_payload
    out = geometry_payload({"name": "nowhere", "latitude": None, "longitude": None})
    assert out["resolved"] is False
    assert out["readiness"] == "blind"
    assert out.get("readiness_note")


def test_the_readiness_payload_stays_SMALL():
    """A 93.5 KB response is one a client REJECTS rather than displays. The per-point envelope
    carries the verdict and a short list — never the paragraph-long `impact` strings."""
    import json
    from services.weather_pipeline.sim_rating import geometry_payload
    out = geometry_payload({"name": "Bondi", "latitude": -33.89, "longitude": 151.278})
    assert len(json.dumps(out)) < 600, f"geometry payload grew to {len(json.dumps(out))} bytes"
    assert "impact" not in out


def test_the_glyph_row_declares_readiness_separately_from_confidence():
    """They answer different questions and must not be conflated: `confidence` grades the PIN,
    `geometry_readiness` grades the INPUTS."""
    import inspect
    from routes import weather as W
    src = inspect.getsource(W.SpotRatingItem)
    assert "geometry_readiness" in src and "confidence" in src
    from services.weather_pipeline import spot_ratings
    rsrc = inspect.getsource(spot_ratings.rate_one_spot)
    assert "geometry_readiness" in rsrc, "the glyph row stopped carrying readiness"
    assert "marine.geometry_readiness" in rsrc, \
        "readiness must come FROM the point response, not be recomputed — one grader, one answer"


# ── THE VOCABULARY GUARDS ───────────────────────────────────────────────────────────────────────
# `shore_normal_src` gained a value on 2026-08-02 (`etopo:borrowed`) and the places that DOCUMENT
# the vocabulary were not updated with it. That is the same defect the readiness envelope exists to
# prevent, one level up: a field whose declared range no longer matches what it can hold.
_SCHEMAS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "services", "weather_pipeline", "schemas.py")


def _schema_vocabulary_block() -> str:
    """The documented range of `shore_normal_source`: its declaration line PLUS the comment block
    directly above it.

    ⚠️ TWO of my own versions of this helper were wrong, and both failures are worth keeping:
      1. It read ONLY the field line. Moving the vocabulary into a comment block above the field —
         where it belongs once it needs three sentences — left the guard inspecting a line that no
         longer held the answer, so it reported the FIX as the defect.
      2. It then read the WHOLE comment block, which includes prose EXPLAINING that `overlay` is
         not a value of this field. A substring guard cannot tell an explanation from a claim, so
         the note documenting the correction tripped the guard checking for it.
    ⇒ It returns the DECLARATION — the pipe-separated range — and nothing else. A guard on a
    documented range must read the range, not the discussion around it."""
    lines = open(_SCHEMAS, encoding="utf-8").read().splitlines()
    idx = next(i for i, l in enumerate(lines) if l.strip().startswith("shore_normal_source"))
    for i in range(idx - 1, max(idx - 15, -1), -1):
        stripped = lines[i].strip()
        if not stripped.startswith("#"):
            break
        body = stripped.lstrip("#").strip()
        if body.count("|") >= 2:          # the range line: `a | b | c`
            return body
    raise AssertionError(
        "no pipe-separated vocabulary line found above `shore_normal_source` in schemas.py — the "
        "field's documented range has been deleted, which is worse than it being wrong")


def _emitted_src_values():
    """Every literal `resolve_surf_geometry` can assign to `src`, extracted by AST.

    DERIVED, never listed — a hand-maintained list here would be a second copy of the fact and
    would rot exactly as the schema comment did."""
    import ast
    import inspect
    from services.weather_pipeline import surf_point
    tree = ast.parse(inspect.getsource(surf_point.resolve_surf_geometry))
    out = set()

    def _lits(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            out.add(node.value)
        elif isinstance(node, ast.JoinedStr):          # f"override:{name}" -> the literal prefix
            for v in node.values:
                if isinstance(v, ast.Constant) and isinstance(v.value, str) and v.value:
                    out.add(v.value)
        elif isinstance(node, ast.IfExp):              # ("etopo:borrowed" if borrowed else "etopo")
            _lits(node.body)
            _lits(node.orelse)

    for n in ast.walk(tree):
        targets = []
        if isinstance(n, ast.Assign):
            targets, value = n.targets, n.value
        elif isinstance(n, ast.AnnAssign) and n.value is not None:
            targets, value = [n.target], n.value
        else:
            continue
        names = []
        for t in targets:
            if isinstance(t, ast.Name):
                names.append(t.id)
            elif isinstance(t, ast.Tuple):
                names += [e.id for e in t.elts if isinstance(e, ast.Name)]
        if "src" not in names:
            continue
        if isinstance(value, ast.Tuple):
            for i, name in enumerate(names):
                if name == "src" and i < len(value.elts):
                    _lits(value.elts[i])
        else:
            _lits(value)
    return out


def test_the_ast_extractor_actually_finds_the_known_values():
    """POSITIVE CONTROL. An extractor returning an empty set would make every guard below pass
    vacuously — the failure mode this repo has recorded seven times."""
    vals = _emitted_src_values()
    for known in ("none", "coarse", "etopo", "etopo:borrowed", "override:"):
        assert known in vals, f"the AST extractor missed {known!r}; it found {sorted(vals)}"


def test_the_schema_documents_every_source_value_the_resolver_can_emit():
    """★ `schemas.py`'s `shore_normal_source` comment is the only place a consumer can learn the
    range of that field. `etopo:borrowed` was added to the resolver and not to the comment, so a
    reader matching on the documented set would silently mis-handle 91 live spots."""
    doc = _schema_vocabulary_block()
    missing = [v for v in sorted(_emitted_src_values())
               if v not in ("none",) and v.rstrip(":") not in doc and v not in doc]
    assert not missing, (
        f"schemas.py documents shore_normal_source as {doc.split('#')[-1].strip()!r} but the "
        f"resolver can also emit {missing} — a field whose declared range is smaller than its "
        f"actual one is exactly what the readiness envelope exists to prevent")


def test_the_schema_does_not_document_a_value_nothing_emits():
    """⚠️ `overlay` is `shore_normal_asset.source_at()`'s vocabulary — WHICH STORE answered
    (asset|overlay) — not a provenance label. Listing it beside `coarse`/`etopo` merges two
    different questions into one field's documented range, which is the repo's recorded
    'two quantities sharing a name' class."""
    doc = _schema_vocabulary_block()
    emitted = _emitted_src_values()
    assert "overlay" not in emitted, "resolve_surf_geometry now emits 'overlay' — update this guard"
    assert "overlay" not in doc, (
        "schemas.py lists 'overlay' as a shore_normal_source value, but that is source_at()'s "
        "store label — WHICH STORE replied — and no code path ever assigns it here")


def test_the_nearest_docstring_does_not_state_a_radius_the_constants_contradict():
    """★ `_nearest`'s docstring explains the asset-before-overlay precedence in terms of a radius.
    The bearing radius became 3 km on 2026-08-02 and the prose still said 1 km, so the paragraph
    justified the design with a number the module no longer uses."""
    from services.weather_pipeline import shore_normal_asset as sna
    doc = sna._nearest.__doc__ or ""
    assert doc, "_nearest lost its docstring"
    stale = [f"{n} km" for n in ("1", "1.0")
             if f"within {n} km" in doc and sna.BEARING_RADIUS_KM != float(n)]
    assert not stale, (
        f"_nearest's docstring says 'within {stale[0]}' while BEARING_RADIUS_KM is "
        f"{sna.BEARING_RADIUS_KM} — the precedence argument is stated against the wrong radius")
