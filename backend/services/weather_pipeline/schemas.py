from pydantic import BaseModel, Field, model_serializer
from typing import List, Optional, Dict, Any
from datetime import datetime

class CoverageBounds(BaseModel):
    west: float
    south: float
    east: float
    north: float

class GridVector(BaseModel):
    lat: float
    lng: float
    speed: float = 0.0
    direction: float = 0.0
    u: float = 0.0
    v: float = 0.0
    period: Optional[float] = None
    gust: Optional[float] = None
    value: Optional[float] = None
    is_valid: bool = True
    # §0B-a render-confidence (2026-07-03): circular resultant length (0..1) of the direction
    # estimator over the source block — LOW where multi-system seas annihilate and the exported
    # direction is a residual with no stable truth (the (20,-120) Baja class). None = not exported
    # (regional/legacy products, non-marine layers). Consumers fade crest rendering, never the heatmap.
    dir_confidence: Optional[float] = None
    # §0e ANIM-PHYS (2026-07-14): the HONEST wave height on surf=1 grids, set by
    # rating_transform_grid before it overwrites `speed` with score/10 (rated cells) or masks
    # is_valid (open-ocean cells) — the frontend animates crests from this while the rating
    # band colors from the score. OMITTED from serialization when None (see _omit_none_extras)
    # so non-surf grids/products carry zero extra bytes.
    phys_speed: Optional[float] = None
    # ENSEMBLE SPREAD (2026-08-07): the standard deviation of `speed` across the ECMWF waef members
    # at this cell, in the same unit as `speed`. None on every deterministic product — which is all
    # of them until ECMWF_WAVE_ENSEMBLE is on — and None per-cell wherever fewer than TWO members
    # carried a finite value, because a spread from one member is 0.0 and 0.0 reads as perfect
    # agreement, the most confident answer the scale can express, when it means "not sampled".
    # ⭐ A DISTRIBUTION IS THE POINT. Measured on real GRIB (run 31135305076), the median spread
    # grows 0.0000 m at +0 h to 0.1595 m at +120 h (p90 0.6250, max 2.97) — that growth IS the
    # forecast uncertainty a point estimate discards.
    speed_spread: Optional[float] = None

    @model_serializer(mode="wrap")
    def _omit_none_extras(self, handler):
        d = handler(self)
        if isinstance(d, dict) and d.get("phys_speed") is None:
            d.pop("phys_speed", None)
        # ⚠️ OMITTED WHEN ABSENT, not serialized as null. Products are ~688 bytes/vector already and
        # a global_mid carries ~15,000 of them; an always-present null on every deterministic grid
        # would grow every product for a field none of them has. Same rule as phys_speed above.
        if isinstance(d, dict) and d.get("speed_spread") is None:
            d.pop("speed_spread", None)
        return d

class NormalizedGrid(BaseModel):
    bounds: CoverageBounds
    cols: int
    rows: int
    vectors: List[GridVector]
    diagnostics: Optional[Dict[str, Any]] = None

class NormalizedProduct(BaseModel):
    model: str
    provider: str
    domain: str
    layer: str
    run_time: datetime
    valid_time: datetime
    is_forecast_authoritative: bool
    is_estimated: bool
    estimate_basis: Optional[Dict[str, Any]] = None
    coverage: CoverageBounds
    grid: Optional[NormalizedGrid] = None
    value_kind: str
    value_unit: str
    display_unit_hint: str
    product_id: Optional[str] = None
    units: Dict[str, str] = Field(default_factory=lambda: {
        "speed": "kn",
        "direction": "degrees",
        "period": "seconds"
    })
    source_variables: List[str]
    freshness_sec: int
    warnings: List[str] = Field(default_factory=list)
    is_test_fixture: bool = False
    source_dataset: Optional[str] = None
    upstream_provider: Optional[str] = None
    upstream_model: Optional[str] = None
    # ★★★ SUBSTITUTED-DATA PROVENANCE (declared 2026-08-03; MASTER AUDIT 1.0 §2a).
    # `coarse_gulf_fill` copies GFS values onto a EURO/ICON vector and flips `is_valid` True, then
    # stamps this. It had been writing to an UNDECLARED attribute since 2026-07-23: pydantic raises
    # `ValueError: "NormalizedProduct" object has no field "coarse_fill"`, the write site swallowed
    # it, and `"coarse_fill" in model_dump_json()` was False on every served product — the fill was
    # real and the provenance was not. Declaring it here is necessary but NOT sufficient on its own:
    # `/grid` sets `response_model=NormalizedProduct`, so an undeclared field is filtered out at the
    # route even when the assignment succeeds. TWO barriers; this clears both.
    # None = nothing was substituted. See `test_coarse_fill_layers.py` §3 for the round-trip guard.
    coarse_fill: Optional[Dict[str, Any]] = None

    # Region metadata fields for Stage 6H
    region_id: Optional[str] = None
    coverage_mode: Optional[str] = None
    tile_id: Optional[str] = None
    
    # Dynamic viewport metadata fields for Stage 6J
    is_dynamic_viewport_product: bool = False
    cache_key: Optional[str] = None
    cache_hit: Optional[str] = None
    requested_bbox: Optional[str] = None
    served_bbox: Optional[str] = None
    coverage_scope: Optional[str] = None
    coordinate_count: Optional[int] = None
    resolution: Optional[float] = None
    truthTag: Optional[Dict[str, Any]] = None
    requested_bbox_original: Optional[str] = None
    query_bbox: Optional[str] = None
    partial_coverage: bool = False
    stale: bool = False
    staleReason: Optional[str] = None
    fallbackReason: Optional[str] = None
    # SERVING HONESTY (2026-07-14 §0c, frame-skew postmortem): `valid_time` on a /grid response
    # has always ECHOED THE REQUEST — a ±3h nearest-frame substitution served as if exact, with
    # the product_id filename as the only truth (that mask hid the surf-override frame skew for
    # hours). The echo is a load-bearing frontend contract, so it stays; the truth rides in
    # these ADDITIVE fields instead: the frame actually served, its signed offset from the ask,
    # and a flag when the offset exceeds 30 min.
    served_valid_time: Optional[str] = None
    frame_offset_hours: float = 0.0
    frame_substituted: bool = False


class NormalizedPointDetail(BaseModel):
    requested_lat: float
    requested_lng: float
    sampled_lat: float
    sampled_lng: float
    speed: float = 0.0
    direction: float = 0.0
    u: float = 0.0
    v: float = 0.0
    period: Optional[float] = None
    gust: Optional[float] = None
    value: Optional[float] = None
    interpolation_method: str
    # ── ECMWF PERIOD BANDS (M4, 2026-08-02) ────────────────────────────────────────────────────
    # {'h1012': 1.2, 'h1214': 0.8, ...} — significant height per >=10 s period band, keyed by the
    # ECMWF param name VERBATIM so producer and consumer share one vocabulary
    # (`ecmwf_opendata_fetcher.WAVE_PERIOD_BAND_PARAMS` -> `period_bands.bands_to_partitions`).
    # ★ WHY THIS IS ON THE POINT AND NOT A SEPARATE LAYER. `_resolve_partitions` splits the sea by
    # sampling THREE more layers per point — 4x cost, which is why SURF_PARTITIONS is off by
    # default on a 1-CPU box. The bands ride in the SAME wave product as the total, so composing
    # from them costs ZERO extra point resolutions.
    # None unless ECMWF_PERIOD_BANDS is on AND the sampler populated it; every other path is
    # unaffected, which is what keeps this additive.
    wave_bands: Optional[Dict[str, float]] = None

class NormalizedPointResponse(BaseModel):
    model: str
    provider: str
    domain: str
    layer: str
    run_time: datetime
    valid_time: datetime
    is_forecast_authoritative: bool
    is_estimated: bool
    estimate_basis: Optional[Dict[str, Any]] = None
    point: NormalizedPointDetail
    value_kind: str
    value_unit: str
    display_unit_hint: str
    product_id: Optional[str] = None
    units: Dict[str, str] = Field(default_factory=lambda: {
        "speed": "kn",
        "direction": "degrees",
        "period": "seconds"
    })
    source_variables: List[str]
    freshness_sec: int
    warnings: List[str] = Field(default_factory=list)
    is_test_fixture: bool = False
    source_dataset: Optional[str] = None
    upstream_provider: Optional[str] = None
    upstream_model: Optional[str] = None

    # Point Fallback status fields for Stage 6H
    source: Optional[str] = None
    coverage_status: Optional[str] = None
    fallback_attempted: Optional[bool] = None
    fallback_reason: Optional[str] = None
    
    # Dynamic viewport metadata fields for Stage 6J
    is_dynamic_viewport_product: bool = False
    cache_key: Optional[str] = None
    cache_hit: Optional[str] = None
    requested_bbox: Optional[str] = None
    served_bbox: Optional[str] = None
    coverage_scope: Optional[str] = None
    coordinate_count: Optional[int] = None
    resolution: Optional[float] = None
    grid_parity: Optional[Any] = None
    gridParity: Optional[Any] = None
    truthTag: Optional[Dict[str, Any]] = None
    gridPointParity: Optional[Dict[str, Any]] = None
    mismatchReason: Optional[str] = None
    requested_bbox_original: Optional[str] = None
    query_bbox: Optional[str] = None
    partial_coverage: bool = False
    stale: bool = False
    staleReason: Optional[str] = None
    fallbackReason: Optional[str] = None

    # Option-2 bathymetry surf transform (ESTIMATE): nearshore breaking ("surf") height derived from the
    # offshore swell + bundled shelf bathymetry. Additive/Optional -> backward compatible. The headline
    # 'speed' stays the offshore wave height; the frontend shows surf alongside it (and the Swell<->Surf map).
    surf_height_m: Optional[float] = None       # transformed breaking/surf height, metres
    surf_regime: Optional[str] = None           # calm | deep | shelf | breaking | unknown
    shelf_depth_m: Optional[float] = None        # representative shelf depth used by the transform (m)
    shore_normal_deg: Optional[float] = None     # seaward bearing (0=N,90=E); offshore/onshore wind for the surf rating
    # NEARSHORE display gate (2026-07-18, user: "Estimated surf should only appear on a marker that is
    # nearshore"): land within ~±0.25° (is_coastal radius_cells=1) — STRICTER than the transform's own
    # ±0.75° coastal gate, which kept the row visible for markers well offshore. Display-only tag; the
    # estimate itself is computed the same either way.
    surf_nearshore: Optional[bool] = None
    # ── PROVENANCE FOR THE SURF NUMBER ITSELF (2026-07-30) ──────────────────────────────────────
    # `shore_normal_deg` above was served bare, and a bearing off the COARSE 0.25° grid is
    # indistinguishable from a measured one — Bondi Beach served `111.54097591853844`, fourteen
    # decimals of false precision on a bearing whose class is median 22.3° off, with the rating
    # LEVEL differing on 45.8% of evaluations. `resolve_surf_geometry` already knows which it is and
    # `spot_geometry_readiness.assess_geometry` already grades it; both were dropped here, so NO
    # surface (point, glyphs, hub, sim) could say a spot was running on degraded inputs.
    # Additive/Optional -> backward compatible; every consumer that ignores them is unaffected.
    # coarse | etopo | etopo:borrowed | override:<name> | none        (sim adds: catalog_fallback)
    # ★ `etopo` means FITTED AT THIS COORDINATE; `etopo:borrowed` means taken from a gate-passed
    #   neighbour up to BEARING_RADIUS_KM away. Split 2026-08-02 — before it, the two were one
    #   string and 91 live spots claimed a measurement they did not have.
    # ⚠️ `overlay` was listed here and is NOT a value of this field. It belongs to
    #   `shore_normal_asset.source_at()`, which answers a DIFFERENT question — which STORE replied
    #   (asset|overlay) — and merging the two vocabularies into one documented range is how a
    #   consumer comes to switch on a string that never arrives.
    shore_normal_source: Optional[str] = None
    break_depth_m: Optional[float] = None        # nearshore breaking depth; None => the size cap cannot bind
    geometry_readiness: Optional[str] = None     # full | degraded | blind
    # ── THE SIZE AND THE QUALITY DISAGREE ABOUT THIS SWELL (MASTER-AUDIT-2.0 §2) ────────────────
    # "How much of this swell reaches this break" is reduced TWICE from the SAME bearing, with
    # floors 5.95x apart: quality `swell_exposure` -> 0.100, height `_height_exposure_factor` ->
    # 0.595. Height scales as sqrt(energy), so the energy the HEIGHT chain implies at the floor is
    # 0.354 against the QUALITY chain's 0.100 — a 3.54x contradiction inside ONE object, saturating
    # for every dtheta >= 90 deg because past there BOTH factors are flat.
    # ⚠️ DISCLOSES, DOES NOT CORRECT. The height is the likelier overestimate (spectral flux at
    # dtheta=100 deg is 0.013, making 0.354 ~27x generous) but is currently right BY CANCELLATION
    # against a second error, so the reconciliation is gated on the ERA5 record. Until then the
    # honest move is to say so rather than serve a contradiction silently.
    # ★ STAMPED HERE because `surf_height_m` is produced here and nowhere else — the caveat is ABOUT
    #   that number, so computing it anywhere else risks describing a height nobody served. Same
    #   reasoning as `geometry_readiness` above.
    # ⭐ IT MATTERS ON THIS RESPONSE SPECIFICALLY: the frontend computes the infobox rating badge
    #   ITSELF from these fields (see the local-size note below), so without this it would have to
    #   re-derive the contradiction client-side — or, as today, never show it at all.
    # ABSENT (None) unless it binds at dtheta >= 75.73 deg. A caveat on every point is noise.
    directional_conflict: Optional[dict] = None
    # ── THE LOCAL SIZE REFERENCE (2026-08-01, the RATING_LOCAL_SIZE flip `3263031c`) ─────────────
    # The frontend computes the infobox rating badge itself (see point_surf_augment: "the frontend
    # pairs the shore normal with the already-fetched wind point + surf height/period"), and it was
    # passing `referenceSizeM = null` — a DECLARED waiver, which test_rating_composition_parity
    # accepts as a position. That waiver was harmless only while the backend also graded on the
    # global 1.2 m curve. The moment RATING_LOCAL_SIZE flipped, the glyph began grading against each
    # spot's own good day while the badge kept the global curve — a median 4.9 and up to 58.1 point
    # split between two surfaces showing the same spot-hour.
    # ★★ A WAIVER IS NOT A CONSTANT. It is only as correct as the flag it silently shadows, and a
    # structural parity guard cannot see that: "declares null" stays a valid declaration while the
    # thing null MEANS changes underneath it. Served so the badge can grade the same composition.
    # None when RATING_LOCAL_SIZE is off or the spot has no climatology => global curve, unchanged.
    reference_size_m: Optional[float] = None     # spot's local good-day breaking height (m)
    geometry_missing: Optional[List[str]] = None  # which inputs are absent, e.g. ["fine_shore_normal"]
    # ── THE SPECTRAL PARTITIONS THE HEIGHT RAN ON (2026-07-30) ──────────────────────────────────
    # [{h, tp, dir, kind}] (kind 'swell'|'windsea'), RECONCILED to the total Hs — attached at the
    # same single injection point that produces `surf_height_m` (point_surf_augment), so the rating
    # surfaces grade the SAME sea state the height was computed from instead of re-resolving their
    # own. None whenever SURF_PARTITIONS is off (the default) or no usable train came back —
    # consumers fall through to the total field, BEHAVIOUR-identical to before. (The wire is not
    # byte-identical: like every Optional field above, the JSON gains a constant `"partitions":
    # null` on flag-off responses — ~18 bytes, no in-repo consumer parses it strictly.)
    partitions: Optional[List[Dict[str, Any]]] = None


class ManifestProduct(BaseModel):
    model: str
    provider: str
    domain: str
    layer: str
    run_time: datetime
    valid_time_start: datetime
    valid_time_end: datetime
    resolution: float
    freshness_sec: int
    is_forecast_authoritative: bool
    coverage: CoverageBounds
    filename: str
    is_test_fixture: bool = False
    is_estimated: bool = False
    estimate_basis: Optional[Dict[str, Any]] = None
    source_dataset: Optional[str] = None
    upstream_provider: Optional[str] = None
    upstream_model: Optional[str] = None
    
    # Region metadata fields for Stage 6H
    region_id: Optional[str] = None
    coverage_mode: Optional[str] = None
    tile_id: Optional[str] = None
    product_id: Optional[str] = None

class PipelineManifest(BaseModel):
    last_manifest_update: datetime
    products: List[ManifestProduct] = Field(default_factory=list)
    # L2 writer attribution (audit #28): stamped by store.dump_manifest_for_l2 on every L2 upload —
    # "designated:gh-run-<id>" from the ingest runner. The health monitor warns when the served
    # manifest's last L2 writer was anything else (gate bypassed) or when the field is absent
    # (written by pre-gate code — the rogue-local-backend signature).
    written_by: Optional[str] = None


class ClientDiagnosticReport(BaseModel):
    timestamp: datetime
    event_type: str
    model: Optional[str] = None
    layer: Optional[str] = None
    timeOffset: Optional[float] = None
    fps: Optional[float] = None
    memory: Optional[float] = None
    correlationId: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


