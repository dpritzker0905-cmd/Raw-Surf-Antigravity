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

## Commitment 1377 NOT met (ledger 1391): EURO wind has not recovered
`/api/health/data` at 22:20Z: EURO/wind warn with a 22.3 h old model cycle (critical at 24 h, about 00:00Z), EURO/marine warn
(mixed cycles), EURO/weather ok (10.3 h). GFS and ICON lanes sit at 8.8 h. The recovery seen at 17:04Z did not hold.
1377 stays open. Cause is not yet diagnosed from this read; the ingest log for `ECMWF EURO-Wind` is the next read.
