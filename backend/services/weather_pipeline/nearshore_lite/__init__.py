"""nearshore_lite: the offline "MOP-lite" nearshore transform (gate docs/weather-program/gates/nearshore-moplite-v1.md).

DARK. Nothing here runs on the Render box and nothing here changes a served number unless the default-OFF flag
SURF_NEARSHORE_LITE is turned on AND a verified per-spot coefficient file is supplied to the surf chain.
Heavy work (ray tracing, bathymetry fetch, scoring) is offline / CI only.
"""
