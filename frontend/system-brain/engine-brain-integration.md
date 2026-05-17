# Engine Brain — Map Intelligence System

> Deterministic physics + transformation rules. NOT AI.

## Purpose

The engine-brain layer ensures all weather/ocean visualization follows
physically-correct transformation rules, not ad-hoc rendering.

## Pipeline

```
DATA → MODEL → SIMULATION → RENDER

External API (Open-Meteo, RainViewer)
    ↓
Grid Parsing (marineController.js, WeatherEngine.js)
    ↓
Engine-Brain Rules (interpolation, projection, color mapping)
    ↓
GPU Rendering (WebGLWindEngine.js, GPUWindLayer.js)
```

## Rule Modules

### Vector Field Models
- Wind = 2D vector field (u, v components at each grid point)
- Interpolation: bilinear between grid cells
- Particles advected through field using Euler integration

### Raster Interpolation Rules
- Temperature, pressure, humidity = scalar fields
- Rendered as color-mapped raster tiles
- Cross-tile interpolation at boundaries required

### Wind Simulation Model
- Particle count: adaptive (1000 desktop, 500 mobile)
- Speed factor: proportional to wind magnitude
- Fade: 0.97 opacity per frame (trail effect)
- Dropout: random reset to prevent clustering

### Wave Propagation Model (Future)
- Swell = long-period energy propagation
- Wind waves = local surface energy
- Wave height = energy accumulation
- Direction = gradient flow field

### Color Ramp Physics
- ALL visualization MUST use lookup textures (LUTs)
- Wind speed → 256x1 gradient texture
- Temperature → blue-to-red gradient
- Wave height → green-to-red gradient
- Current: particles use single color (upgrade to LUT = Phase 2)

### Projection Rules
- All rendering in Web Mercator (EPSG:3857)
- Grid data in WGS84 lat/lng → must project to pixel coords
- MapLibre handles projection for raster tiles
- Custom layers receive projection matrix in render()

### Temporal Model
- Forecast data indexed by hour offset from current time
- Timeline slider controls `timeOffsetHours` state
- Engine interpolates between forecast frames
- Prefetching ±1 hour tiles = Phase 2

### Tile Streaming Model
- OM raster tiles via `om://` protocol
- Tile URLs: `https://tiles.open-meteo.com/.../{z}/{x}/{y}.png`
- Cache: time-aware (5-min cooldown per source)
- Cross-tile seams handled by MapLibre raster-tile rendering
