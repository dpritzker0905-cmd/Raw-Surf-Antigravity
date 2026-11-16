# Owner observations (a labelled truth stream)

What the owner saw or reported at a spot, written down the day it was said. Rule:
`log/2026-11-16-fable-surf-spot-panel-prereg.md`, section (b).

**How to use it.** It supplements the buoys. It is NEVER the only gate for a served change: one observer at one spot
cannot be told apart from that spot's quirk, and the served number is a significant height while an eye reads faces
and sets. A row counts toward the n >= 30 per spot class that a spot-type factor needs.

**Write protocol.** Append-only: add a row at the bottom, never edit or delete one. A correction is a new row that
names the row it corrects. No pipes inside a cell.

**Columns.**
- `said (UTC)`: when the owner said it. `for (UTC)`: the time the observation is about, if different or known.
- `spot`, `lat, lng`: the catalogue name if there is one, else a description.
- `observed`: the owner's words for size, as close to verbatim as the record allows, with the unit he used.
- `sets`: what he said about sets, if anything.
- `kind`: `eyes-on` (he was looking at it), `expectation` (what he says it should read from knowing the spot),
  or `unknown`. An expectation is information about the spot, not a measurement of that hour.
- `served then`: what the product showed for that spot and hour, with its source, if it was read.
- `logged by, from`: who wrote the row and from what: the owner's words typed in that session, or a relay.

| said (UTC) | for (UTC) | spot | lat, lng | observed | sets | kind | served then | logged by, from |
|---|---|---|---|---|---|---|---|---|
| 2026-11-16 00:07 to 00:12 | same hour, not stated | St. Augustine to Volusia, no catalogue spot named | 29.77, -81.25 | under 2 ft; infobox surf "too high" | 2 to 3 ft on sets | unknown (relayed as "expects": not confirmed eyes-on) | surf 1.58 m (5.2 ft), offshore 1.12 m at 7.28 s from 52 degrees, one live /point reading by the director | Fable repair lead, from the director's relay of the owner's report in the senior research lead's session; the owner's own words were not seen in this session |
| 2026-11-16 00:49 (clarification relayed) | corrects the row above | St. Augustine to Volusia, no catalogue spot named | 29.77, -81.25 | under 2 ft | 2 to 3 ft on sets | expectation (the owner said what the spot should read; it was not a timed look at the water) | as the row above | Fable repair lead, from the director relay of the owner clarification at 19:49 EST; corrects the kind of the row above from unknown to expectation |
