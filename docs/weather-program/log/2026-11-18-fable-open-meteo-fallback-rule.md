# 2026-11-18 Fable: the Open-Meteo rule changes from "test-only" to "fallback where nothing better is available" (D-082)

Session: Fable repair lead (`e372475c`). Branch `fable/open-meteo-fallback-rule`, cut from `dev` at `c66d8c055`.
A decision entry and a note on the entry it supersedes. No code. No served number moves. Nothing dispatched.

## 2026-11-18 19:33Z What was done, and why

**Asked for by David**, typed in this session at 14:09 EST (19:09Z): "Keep until covered. But we need to modify my
rules from only using Open-Meteo for test only, to we can use it as a fallback if no better alternative is
available/causing a downgrade of our services."

**What led to it.** The director relayed an owner decision ("No user data should be open-meteo", quoted as typed at
13:13Z in the director's session) with a build task: make the point path answer "no data" where it now falls back to
Open-Meteo, at an estimated cost of 5 to 8 percent of rated spot-frames at hours 0 and +3. A relay is not the owner's
word to this session, so nothing was built. David then asked here whether Open-Meteo is used only where there is no
better path. The read of `services/weather_pipeline/point_resolution.py`:

- The marine branch reaches Open-Meteo only after the stored lookups (the hinted product, the dynamic cache, the
  scheduled products) miss, or after the only covering product is a world grid whose sample is land-masked or taken
  from the nearest ocean cell. The stored sample is kept as the last resort if Open-Meteo fails.
- So nothing better is STORED at those points. A better SOURCE exists and is not wired in: the agencies' 0.25 degree
  wave fields, stored at that resolution only inside the 14 regional tiles.
- NOT checked: the wind and pressure/precipitation direct-point branches; whether the 2 degree world grid counts as a
  world grid in the degraded test.

**What was written.** `DECISIONS.md`: D-082 (the rule, what it changes in D-074, what it supersedes from today, the
unchanged condition about paying, the point path's standing against it), and an appended update on D-074 saying its
"test-only" line is superseded.

## What this does not do

- It does not remove, add or change any Open-Meteo call. The count of fallback answers is whatever it was.
- It does not check Open-Meteo's terms of use against the served use. D-074's condition (not on a basis that would
  require paying) stands and is unverified here.
- It does not build the CI guard. D-082 says how the guard changes when it is built.
- It does not scope the work to cover the uncovered spots with agency data ("keep until covered").
