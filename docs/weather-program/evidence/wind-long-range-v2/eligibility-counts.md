# Eligibility count: VOID_BY_CONSTRUCTION

**VOID BY CONSTRUCTION, accepted by the owner before TEST. DESCRIPTIVE ONLY: no skill conclusion, positive or negative, may be drawn from this output, and nothing ships from it.**

Inputs: stations sha256 `ec87dc04d27caaab75cb3b021c0620f2acccb3f3d55a168b97394c61393602c8`, pairing sha256 `f89b9ee1e2a96401a1d5e7835163c9dfd7e63ec5030a914397b59c197aaa52e3`. Order of operations: eligibility count, then VOID, then holdout and coverage.

| region | gated | raw NDBC | raw ASOS | marine NDBC | marine ASOS | gust-eligible marine NDBC | marine (NDBC+ASOS) >= 10 |
|---|---|---|---|---|---|---|---|
| US_PACIFIC | yes | 66 | 14 | 22 | 0 | 22 | yes |
| US_ATLANTIC_GULF | yes | 193 | 30 | 34 | 0 | 34 | yes |
| HAWAII | yes | 8 | 3 | 0 | 0 | 0 | no |
| EUROPE_ATLANTIC | yes | 3 | 0 | 0 | 0 | 0 | no |
| MEDITERRANEAN | yes | 0 | 0 | 0 | 0 | 0 | no |
| ALASKA | yes | 107 | 13 | 5 | 0 | 5 | no |
| CARIBBEAN_PR | yes | 10 | 0 | 1 | 0 | 1 | no |
| GREAT_LAKES | no | 76 | 0 | 0 | 0 | 0 | no |
| BLACK_SEA | no | 0 | 0 | 0 | 0 | 0 | no |
| OTHER | no | 0 | 0 | 0 | 0 | 0 | no |

**VOID trigger:** 2 of 7 gated regions have >= 10 marine-exposed stations (wind) and 2 of 7 have >= 10 gust-eligible marine NDBC stations (gust); the threshold is 3.
