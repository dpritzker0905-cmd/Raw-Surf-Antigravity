# Spot-hub phase 4 charts: 3 themes x desktop and phone (offline mock backend)

Real components (SpotHub, SpotConditions, MapForecastOverlay) from a scratch harness build; every backend call answered by a Playwright mock (132 answers, 96 other requests aborted), never the live box. Hub and infobox as a free user (72 h), drawer as premium (14 days). Data = the fixture `frontend/src/components/spot-hub/charts/spotSeries.fixture.js` (synthetic, not a forecast).

## hub-free

| | light | dark | beach |
|---|---|---|---|
| desktop | ![](hub-free-light-desktop.png) | ![](hub-free-dark-desktop.png) | ![](hub-free-beach-desktop.png) |
| phone | ![](hub-free-light-phone.png) | ![](hub-free-dark-phone.png) | ![](hub-free-beach-phone.png) |

## drawer-premium

| | light | dark | beach |
|---|---|---|---|
| desktop | ![](drawer-premium-light-desktop.png) | ![](drawer-premium-dark-desktop.png) | ![](drawer-premium-beach-desktop.png) |
| phone | ![](drawer-premium-light-phone.png) | ![](drawer-premium-dark-phone.png) | ![](drawer-premium-beach-phone.png) |

## infobox-free

| | light | dark | beach |
|---|---|---|---|
| desktop | ![](infobox-free-light-desktop.png) | ![](infobox-free-dark-desktop.png) | ![](infobox-free-beach-desktop.png) |
| phone | ![](infobox-free-light-phone.png) | ![](infobox-free-dark-phone.png) | ![](infobox-free-beach-phone.png) |

