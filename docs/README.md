# Raw Surf App — Technical Documentation

> **Project**: Raw Surf OS — E-commerce, Tracking & Global Surf Adventure Platform  
> **Stack**: React + MapLibre GL + Open-Meteo Marine API + Netlify  
> **Last Updated**: 2026-05-24

## Directory Layout

```
docs/
├── README.md                 ← You are here
├── architecture/             ← System design, data flow diagrams
│   └── weather-engine.md     ← Marine API integration architecture
├── api/                      ← API schemas, endpoint contracts
│   └── open-meteo-marine.md  ← Open-Meteo Marine API reference
├── schemas/                  ← Data models, TypeScript interfaces
└── runbooks/                 ← Deployment, debugging, operational playbooks
```

## Core Systems

| System | Status | Description |
|--------|--------|-------------|
| Weather Engine | ✅ Active | Open-Meteo Marine API → MapLibre raster tiles |
| Marine Raster Layer | 🔧 Fixing | Colored wave/swell/period overlays on map |
| Wind Particle Engine | ✅ Active | GPU-accelerated wind particle visualization |
| Marine Particle Canvas | ✅ Active | Ocean foam/crest particle rendering |
| Forecast Overlay | ✅ Active | Infobox with spot-level marine forecast data |

## API Endpoints

- **Marine Forecast**: `https://marine-api.open-meteo.com/v1/marine`
- **Marine Tiles**: `https://map-tiles.open-meteo.com/data_spatial/{model}/latest.json`
- **Weather Proxy**: `/api/weather-proxy` (Netlify function, rate-limit mitigation)
