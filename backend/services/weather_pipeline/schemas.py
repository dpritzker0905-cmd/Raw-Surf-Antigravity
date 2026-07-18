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

    @model_serializer(mode="wrap")
    def _omit_none_extras(self, handler):
        d = handler(self)
        if isinstance(d, dict) and d.get("phys_speed") is None:
            d.pop("phys_speed", None)
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


