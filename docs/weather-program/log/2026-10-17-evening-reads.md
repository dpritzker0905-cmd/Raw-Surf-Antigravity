# 2026-10-17 evening: merges recorded, scoring read back, EURO wind not recovered

Weather-program facts only. This log records what was read, not the security work of the same day.

## Merges recorded (ledger 1383-1389)
`pr_merge` lines for #366-#372 with GitHub's merge times and the owner's authorizing words. #366 and #367 were merged
by the owner at 17:49Z; #368-#372 are repairs unrelated to the forecast chain. No forecast, rating or sim number moved.

## Commitment 1379 closed (ledger 1390): the scoring stall prediction held
Precompute run 39055840698, forecast-skill line at 18:39:13Z: `ledgered=1203 scored=878 pending=51764
evicted_cap=0`. Pending fell from the 54000 cap. Scored pairs exist at lead 24 (raw_surf n=76 over 55 buoys) and lead 48
(n=37). One pass: it shows the cap stopped evicting in that pass, not that it stays stopped. The 21:24Z pass
(run 39070774151) is unread.

## Commitment 1377: not met at 22:20Z, met by 22:52Z (ledger 1391, corrected by 1392)
At 22:20Z `/api/health/data` read EURO/wind warn with a 22.3 h cycle (critical at 24 h), EURO/marine warn (mixed cycles),
EURO/weather ok (10.3 h). That was recorded as "recovery did not hold". It was wrong: at 22:52Z every EURO lane is ok at a
10.9 h cycle (the 12Z cycle) and overall health is ok. ECMWF had the whole 12Z cycle by then (HEAD 200 at steps 0, 144, 240).
The cause of the wind lane trailing the weather lane for hours is NOT established (the 21:03Z ingest log was unreadable
while the run was in progress). The daily pattern is the risk: the wind lane's cycle age reaches 22 h before the new cycle
lands, 2 h under the 24 h critical threshold.
