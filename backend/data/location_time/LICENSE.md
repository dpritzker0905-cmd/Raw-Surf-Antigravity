# location_time grid: licence and attribution

The grid in this folder (`row_ptr.npy`, `starts.npy`, `ids.npy`, `classes.json`) is a **Derivative Database** of two databases, both licensed under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/):

1. **OpenStreetMap** land polygons, © OpenStreetMap contributors (via [osmdata.openstreetmap.de](https://osmdata.openstreetmap.de/),
   the `land-polygons-split-4326` extract; the snapshot date and sha256 are in `manifest.json`). Licence and
   attribution terms: <https://www.openstreetmap.org/copyright>.
2. **timezone-boundary-builder** time-zone boundaries (`timezones-with-oceans`; release in `manifest.json`), itself
   derived from OpenStreetMap data, packaged by `timezonefinder-data`.

This Derivative Database (those four files together with `manifest.json`) is made available under the **Open Database
License 1.0**. Any rights in individual contents are licensed under the Database Contents License where applicable.
You may use, copy, adapt and share it under the same licence, with this attribution:

> Raw Surf time-zone grid, derived from OpenStreetMap data © OpenStreetMap contributors (ODbL 1.0) and
> timezone-boundary-builder (ODbL 1.0).

**Produced Works** (anything a user sees that was computed from this grid, such as a local time label) should credit
"© OpenStreetMap contributors" where the app shows its data credits.

How it was built, and how to rebuild it: `backend/scripts/build_location_tz_grid.py` (the docstring lists the inputs;
`manifest.json` pins every input checksum).
