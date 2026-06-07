from pydantic import BaseModel, Field
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

