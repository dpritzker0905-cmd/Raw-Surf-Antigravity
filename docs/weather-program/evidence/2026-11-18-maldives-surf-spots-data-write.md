# The Maldives data write on `surf_spots`, 2026-11-18 16:50:35Z: what ran, what it changed, how to undo it

Filed at the director's request after the advisor's after-the-fact read. Ledger: the `data_write` line in #1070
(`ledger.d/claude--spots-1-safety.jsonl:1`) and its correction (`:3`). Everything below is copied from the executing
session's own record (the statement as sent, and the two reads either side of it), not rewritten from memory.

**Authority.** David: "fix Maldives yes" (13:13Z, relayed by the director), then, typed in the executing session in
answer to "Run the Maldives fix SQL on the production database now?": "Yes, run it".
**Review.** None before the run. The advisor read it afterwards (2026-11-18, evening). The executing session's own
guards were the row-count checks below and the two reads.

## 1. The statement that ran (verbatim)

Sent as one call at 16:50Z. `id` is a text column, so the ids are plain strings (the draft's uuid casts were
dropped). The `do` block is atomic: any failed guard raises and nothing is changed.

```sql
do $$
declare n int;
begin
  -- A. Quarters: move to the repo's seed value
  update surf_spots
     set original_latitude  = coalesce(original_latitude, latitude),
         original_longitude = coalesce(original_longitude, longitude),
         latitude  = 3.9333,
         longitude = 73.4833,
         last_refined_at = now(),
         refinement_count = coalesce(refinement_count, 0) + 1
   where id = 'bf9c56b6-0d96-4f4a-b492-971dea4b7217'
     and name = 'Quarters'
     and latitude = 3.938 and longitude = 73.248
     and is_active = true
     and accuracy_flag = 'low_accuracy' and flagged_for_review = true;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'guard A failed: % rows', n; end if;

  -- B. hide four rows
  update surf_spots
     set is_active = false,
         flagged_for_review = true
   where is_active = true
     and ( (id = '71c4097c-5d66-4fae-99d6-9477ffa7f16d' and name = 'Yin Yang'     and latitude = 3.968  and longitude = 73.268)
        or (id = '3e3e3fc1-8fce-4607-8861-ad5584d39d41' and name = 'Five Islands' and latitude = 2.8333 and longitude = 72.95)
        or (id = 'b2ac47a1-e42b-4bdc-b2c8-daa9d9d8edea' and name = 'Malik''s'     and latitude = 2.75   and longitude = 73.0)
        or (id = '4bd36e2c-e0d4-4e8c-a03c-da3c011ed460' and name = 'Pasta Point'  and latitude = 3.898  and longitude = 73.408) );
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'guard B failed: % rows', n; end if;

  -- C. flag the remaining 11 for review (accuracy_flag untouched)
  update surf_spots
     set flagged_for_review = true
   where country ilike 'Maldives'
     and is_active = true
     and flagged_for_review = false
     and accuracy_flag = 'unverified'
     and id in ('8a7a0669-ab13-42a0-bf22-f04b2b0b7605','ba8fabd8-42c2-4ec5-a536-3b84f9087a9e','47b75ec5-c999-4cf1-bafe-d6dfb55a19f8',
                '90b4f448-c346-4613-9b48-4a5117d893dd','cb0ef9cd-f174-40f9-9d2c-63e18d343e53','9014457b-be7a-4cc2-8fe8-3404b9ef2b61',
                '9796d279-ca44-4f58-8117-9e7a37586945','525e9548-befa-4a58-a856-2d298f636089','a1084dca-4717-468a-a2e0-c2f29aff7132',
                '7cc5ffff-8c7a-4fc0-a1d5-4cc2c8765d24','763177d1-db3a-437b-a057-20e62650dce8');
  get diagnostics n = row_count;
  if n <> 11 then raise exception 'guard C failed: % rows', n; end if;
end $$;
select name, latitude, longitude, original_latitude, original_longitude, is_active, accuracy_flag, flagged_for_review, refinement_count, last_refined_at from surf_spots where country ilike 'Maldives' order by name;
```

## 2. The rows, before (read 16:44:49Z) and after (read back in the same call, 16:50Z)

There are 17 Maldives rows. The write changed 16. Tiger Stripes was already `low_accuracy` and flagged, and was not
touched.

| Spot | id | Before | After |
|---|---|---|---|
| Quarters | `bf9c56b6-0d96-4f4a-b492-971dea4b7217` | 3.938, 73.248; active; `low_accuracy`; flagged; `original_latitude/longitude` NULL | **3.9333, 73.4833**; `original_latitude/longitude` = 3.938, 73.248; `refinement_count` 1; `last_refined_at` 2026-11-18 16:50:35.771811+00; active, `low_accuracy`, flagged (unchanged) |
| Yin Yang | `71c4097c-5d66-4fae-99d6-9477ffa7f16d` | 3.968, 73.268; active; `low_accuracy`; **already flagged** | **hidden** (`is_active` false); flagged; coordinate unchanged |
| Five Islands | `3e3e3fc1-8fce-4607-8861-ad5584d39d41` | 2.8333, 72.95; active; `unverified`; not flagged | **hidden**; flagged; coordinate unchanged |
| Malik's | `b2ac47a1-e42b-4bdc-b2c8-daa9d9d8edea` | 2.75, 73; active; `unverified`; not flagged | **hidden**; flagged; coordinate unchanged |
| Pasta Point | `4bd36e2c-e0d4-4e8c-a03c-da3c011ed460` | 3.898, 73.408; active; `unverified`; not flagged | **hidden**; flagged; coordinate unchanged |
| Beacons, Chickens, Cokes, Guru's, Honkys, Jailbreaks, Kandooma Right, Lohis, Ninjas, Riptides, Sultans | the 11 ids in block C | active; `unverified`; not flagged | **flagged**; nothing else changed |
| Tiger Stripes | `68849d55-1b35-4a96-9378-77dcb4f19e1c` | 0.4833, 73.1833; active; `low_accuracy`; flagged | not touched |

**Two values were NOT read before the write, and are therefore not known:** Quarters' `refinement_count` and
`last_refined_at`. The pre-write read did not select them. After the write, `refinement_count` is 1, so it was 0 or
NULL before; every other Maldives row reads 0 and NULL. The rollback below restores 0 and NULL on that inference,
and says so.

## 3. Rollback, hardened. NOT RUN. Needs the owner's word.

The draft rollback in the review file had no guards. This one only undoes a row that is still exactly as the write
left it, counts every step, and is atomic. Yin Yang is un-hidden but stays flagged, because it was flagged before.

```sql
do $$
declare n int;
begin
  -- A. Quarters: back to its actual pre-write coordinate (3.938, 73.248). original_* were NULL before the write.
  --    refinement_count 0 and last_refined_at NULL are INFERRED (not read before the write; see section 2).
  update surf_spots
     set latitude  = 3.938,
         longitude = 73.248,
         original_latitude  = null,
         original_longitude = null,
         refinement_count = 0,
         last_refined_at  = null
   where id = 'bf9c56b6-0d96-4f4a-b492-971dea4b7217'
     and name = 'Quarters'
     and latitude = 3.9333 and longitude = 73.4833
     and original_latitude = 3.938 and original_longitude = 73.248
     and refinement_count = 1
     and last_refined_at = timestamptz '2026-11-18 16:50:35.771811+00'
     and is_active = true and accuracy_flag = 'low_accuracy' and flagged_for_review = true;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'rollback A refused: % rows (Quarters has changed since the write)', n; end if;

  -- B1. un-hide and un-flag the three that were active and NOT flagged before
  update surf_spots
     set is_active = true,
         flagged_for_review = false
   where is_active = false and flagged_for_review = true and accuracy_flag = 'unverified'
     and ( (id = '3e3e3fc1-8fce-4607-8861-ad5584d39d41' and name = 'Five Islands' and latitude = 2.8333 and longitude = 72.95)
        or (id = 'b2ac47a1-e42b-4bdc-b2c8-daa9d9d8edea' and name = 'Malik''s'     and latitude = 2.75   and longitude = 73.0)
        or (id = '4bd36e2c-e0d4-4e8c-a03c-da3c011ed460' and name = 'Pasta Point'  and latitude = 3.898  and longitude = 73.408) );
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'rollback B1 refused: % rows', n; end if;

  -- B2. un-hide Yin Yang; it was ALREADY flagged before the write, so it stays flagged
  update surf_spots
     set is_active = true
   where id = '71c4097c-5d66-4fae-99d6-9477ffa7f16d' and name = 'Yin Yang'
     and latitude = 3.968 and longitude = 73.268
     and is_active = false and flagged_for_review = true and accuracy_flag = 'low_accuracy';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'rollback B2 refused: % rows', n; end if;

  -- C. un-flag the 11 that were not flagged before
  update surf_spots
     set flagged_for_review = false
   where country ilike 'Maldives'
     and is_active = true and flagged_for_review = true and accuracy_flag = 'unverified'
     and id in ('8a7a0669-ab13-42a0-bf22-f04b2b0b7605','ba8fabd8-42c2-4ec5-a536-3b84f9087a9e','47b75ec5-c999-4cf1-bafe-d6dfb55a19f8',
                '90b4f448-c346-4613-9b48-4a5117d893dd','cb0ef9cd-f174-40f9-9d2c-63e18d343e53','9014457b-be7a-4cc2-8fe8-3404b9ef2b61',
                '9796d279-ca44-4f58-8117-9e7a37586945','525e9548-befa-4a58-a856-2d298f636089','a1084dca-4717-468a-a2e0-c2f29aff7132',
                '7cc5ffff-8c7a-4fc0-a1d5-4cc2c8765d24','763177d1-db3a-437b-a057-20e62650dce8');
  get diagnostics n = row_count;
  if n <> 11 then raise exception 'rollback C refused: % rows', n; end if;
end $$;
```

If a person has since reviewed one of these rows (un-flagged it, moved it, verified it), the matching step refuses
and the whole block is undone. That is the intended behaviour: undo by hand what is still wanted undone.
Running it would put Quarters back on a coordinate that resolves to open ocean, so the shore-normals build must be
re-run after it too.

## 4. The advisor's limit on the result

Quarters now serves, on the offline test sea (1.5 m, 12 s, head-on), **4.9 ft before and 8.3 ft after** (1.50 m and
2.54 m). The after value rests on an ESTIMATED coordinate (the repo's seed value, not a surveyed peak) and a
shore normal BORROWED from a neighbour. There is no surf truth at Quarters. The change removes a known wrong (the
offshore height served as surf from a pin in open water); it does not establish that 8.3 ft is right.

## 5. Open items, with owners

| # | Item | Owner | Needs |
|---|---|---|---|
| 1 | Re-run `build-shore-normals.yml` so Quarters gets its own shore normal | the director, on David's word | a workflow dispatch |
| 2 | Recount active spots resolving to `open_ocean` or `unknown_depth` (expected 2 -> 0; measured 2026-11-17 over 1,773 rows, not re-measured) | surf-spot lane | a fresh read-only catalogue export, then the offline chain |
| 3 | Correct the seed script that still carries the old Maldives coordinates (`backend/scripts/caribbean_asia_pacific_expansion.py:355-372`), and put the retired-script stop on it: it finds spots by name (`:644`) and is not one of the five that #1070 guards | surf-spot lane | a small PR |
| 4 | Confirm when the ratings precompute and the spot-list cache picked the change up (Quarters at the new coordinate; the four hidden spots absent) | surf-spot lane | one read of the published ratings object and one read of the public spot list |
| 5 | Confirm the serve box reads the project the write went to (`jnfbxcvcbtndtsvscppt`). So far documentary evidence only | surf-spot lane for the read; the director or David for the Render setting itself | read-only: the public spot list should show Quarters at 3.9333, 73.4833; if it does, the serve box reads the database that was written |
| 6 | A licence-clean coordinate for Yin Yang, Five Islands, Malik's and Pasta Point, so they can be shown again | a person, through the admin editor | no surf-site or OpenStreetMap coordinate may be written |
