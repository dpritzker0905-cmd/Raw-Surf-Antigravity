"""
Admin Spot Deduplication — exact-name and near-name dedup, merge, FK re-parenting.

Extracted from admin_spots.py (v99 audit) to keep each module under 800 LOC.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpot

router = APIRouter()


# FK tables that reference surf_spots.id (shared by both dedup endpoints)
FK_REFS = [
    ("profiles", "current_spot_id"),
    ("spot_refinements", "spot_id"),
    ("spot_verifications", "spot_id"),
    ("spot_edit_logs", "spot_id"),
    ("spot_of_the_day", "spot_id"),
    ("bookings", "surf_spot_id"),
    ("dispatch_requests", "spot_id"),
    ("posts", "spot_id"),
    ("live_session_participants", "spot_id"),
    ("check_ins", "spot_id"),
    ("surf_reports", "spot_id"),
    ("surf_alerts", "spot_id"),
    ("photographer_requests", "spot_id"),
    ("stories", "spot_id"),
    ("gallery_items", "spot_id"),
    ("surfer_gallery_items", "spot_id"),
    ("live_sessions", "surf_spot_id"),
    ("galleries", "surf_spot_id"),
    ("condition_reports", "spot_id"),
    ("social_live_streams", "spot_id"),
    ("surf_passport_checkins", "spot_id"),
    ("spot_seo_metadata", "spot_id"),
    # Added 2026-11-18. Both reference surf_spots with ON DELETE SET NULL, so a merge that did not list them
    # silently detached every surf log entry and surf-truth observation from the spot it deleted.
    ("surf_log_entries", "spot_id"),
    ("surf_observations", "spot_id"),
]

# SQL safety: the only table+column pairs the dynamic FK queries may name.
ALLOWED_FK_REFS = set(FK_REFS)


from sqlalchemy import text as sa_text


def _safe_fk_query(query_template: str, table: str, column: str) -> str:
    """Build a dynamic SQL string only if (table, column) is in the allowlist.
    Raises ValueError if an unknown pair is passed — prevents SQL injection."""
    if (table, column) not in ALLOWED_FK_REFS:
        raise ValueError(f"Disallowed FK reference: {table}.{column}")
    return sa_text(query_template.format(table=table, column=column))


def missing_fk_refs() -> list:
    """Tables that reference `surf_spots.id` but are NOT in FK_REFS, read from the models.

    FK_REFS is kept by hand, and a merge DELETES the duplicate row. A referencing table that is not listed is not
    re-parented: its rows are cascaded away or detached (SET NULL) by the delete, with nothing reported. Measured
    2026-11-18: the list held 22 of 24 (it lacked `surf_log_entries` and `surf_observations`). Both merge endpoints
    refuse to execute while this is non-empty, so the next table to reference a spot cannot be forgotten quietly."""
    import models  # noqa: F401  (registers every table)
    from database import Base
    listed = set(FK_REFS)
    found = set()
    for table in Base.metadata.tables.values():
        for fk in table.foreign_keys:
            if fk.column.table.name == "surf_spots" and fk.column.name == "id":
                found.add((table.name, fk.parent.name))
    return sorted(found - listed)


def _refusal(missing: list) -> dict:
    names = ", ".join(f"{t}.{c}" for t, c in missing)
    return {
        "success": False, "mode": "REFUSED", "missing_fk_refs": [f"{t}.{c}" for t, c in missing],
        "error": (f"Refused: {len(missing)} table(s) reference surf_spots but are not in the merge list ({names}). "
                  "Deleting a duplicate now would drop or detach their rows. Add them to FK_REFS first. "
                  "Nothing was changed."),
    }


async def _reparent_fk_refs(
    db: AsyncSession,
    survivor_id: str,
    dup_id: str,
    execute: bool,
) -> dict:
    """
    Re-parent all FK references from dup_id to survivor_id.
    Returns a dict of {table.column: count_or_action}.

    When executing, an error here STOPS the merge (the caller rolls back). It used to be swallowed, and the caller
    then deleted the duplicate anyway, taking the rows that had failed to move with it.
    """
    moved = {}
    for table, column in FK_REFS:
        try:
            if execute:
                # Handle unique constraint on spot_seo_metadata
                if table == "spot_seo_metadata":
                    existing = await db.execute(
                        _safe_fk_query("SELECT COUNT(*) FROM {table} WHERE {column} = :new_id", table, column),
                        {"new_id": str(survivor_id)}
                    )
                    if (existing.scalar() or 0) > 0:
                        r = await db.execute(
                            _safe_fk_query("DELETE FROM {table} WHERE {column} = :old_id", table, column),
                            {"old_id": str(dup_id)}
                        )
                        if r.rowcount:
                            moved[f"{table}.{column}"] = f"{r.rowcount} deleted"
                        continue

                r = await db.execute(
                    _safe_fk_query("UPDATE {table} SET {column} = :new_id WHERE {column} = :old_id", table, column),
                    {"new_id": str(survivor_id), "old_id": str(dup_id)}
                )
                if r.rowcount:
                    moved[f"{table}.{column}"] = r.rowcount
            else:
                r = await db.execute(
                    _safe_fk_query("SELECT COUNT(*) FROM {table} WHERE {column} = :old_id", table, column),
                    {"old_id": str(dup_id)}
                )
                cnt = r.scalar() or 0
                if cnt > 0:
                    moved[f"{table}.{column}"] = cnt
        except Exception as e:
            if execute:
                raise
            moved[f"{table}.{column}"] = f"could not be counted: {type(e).__name__}"
    return moved


@router.post("/surf-spots/admin/dedup")
async def dedup_surf_spots(
    execute: bool = Query(False, description="Set to true to actually merge. Default is dry-run."),
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Deduplicate surf spots — finds spots with the same name in the same state/country
    and merges them, re-parenting all FK references to the survivor.
    
    Default is DRY RUN. Pass ?execute=true to apply changes.
    """
    results = {"groups": [], "total_merged": 0, "errors": []}
    missing = missing_fk_refs()
    if execute and missing:
        return _refusal(missing)
    results["missing_fk_refs"] = [f"{t}.{c}" for t, c in missing]

    try:
        # Find duplicate groups: same name + state_province + country with count > 1
        dup_result = await db.execute(
            select(
                SurfSpot.name,
                SurfSpot.state_province,
                SurfSpot.country,
                func.count(SurfSpot.id).label("cnt")
            )
            .where(SurfSpot.is_active.is_(True))
            .group_by(SurfSpot.name, SurfSpot.state_province, SurfSpot.country)
            .having(func.count(SurfSpot.id) > 1)
            .order_by(SurfSpot.name)
        )
        groups = dup_result.all()

        if not groups:
            return {"success": True, "message": "No duplicate spots found. Database is clean.", "groups": [], "total_merged": 0}

        for name, state, country, count in groups:
            spots_result = await db.execute(
                select(SurfSpot).where(
                    SurfSpot.name == name,
                    SurfSpot.state_province == state,
                    SurfSpot.country == country,
                    SurfSpot.is_active.is_(True)
                ).order_by(SurfSpot.created_at)
            )
            spots = spots_result.scalars().all()

            if len(spots) < 2:
                continue

            # Pick survivor: prefer spot with more specific region, earliest created
            survivor = spots[0]
            for s in spots:
                if s.region and not survivor.region:
                    survivor = s
                elif s.region and survivor.region and len(s.region) > len(survivor.region):
                    survivor = s

            duplicates_info = []
            for dup in spots:
                if dup.id == survivor.id:
                    continue

                moved = await _reparent_fk_refs(db, survivor.id, dup.id, execute)

                if execute:
                    await db.execute(
                        sa_text("DELETE FROM surf_spots WHERE id = :dup_id"),
                        {"dup_id": str(dup.id)}
                    )

                duplicates_info.append({
                    "id": str(dup.id),
                    "region": dup.region,
                    "fk_refs": moved,
                    "action": "DELETED" if execute else "WOULD DELETE"
                })
                results["total_merged"] += 1

            results["groups"].append({
                "name": name,
                "state": state,
                "country": country,
                "count": count,
                "survivor_id": str(survivor.id),
                "survivor_region": survivor.region,
                "duplicates": duplicates_info
            })

        if execute:
            await db.commit()

        return {
            "success": True,
            "mode": "EXECUTED" if execute else "DRY RUN",
            "message": f"{'Merged' if execute else 'Would merge'} {results['total_merged']} duplicate(s) across {len(results['groups'])} groups.",
            **results
        }
    except Exception as e:
        import traceback
        await db.rollback()      # a merge that failed part-way leaves NOTHING applied
        results["errors"].append(str(e))
        return {"success": False, "error": str(e), "traceback": traceback.format_exc(), **results}


# ── Near-duplicate pairs: (canonical_name, duplicate_name, same_state_required) ──
NEAR_DUPE_PAIRS = [
    ("Jetty Park", "Jetty Park - Cape Canaveral", True),
    ("Spessard Holland", "Spessard Holland Park", True),
    ("Picnic Tables", "Tables (Picnic Tables)", True),
    ("10th Street Folly", "10th Street East Folly", True),
    ("Melbourne Beach", "Melbourne Beach - Ocean Avenue", True),
    ("Indialantic", "Indialantic Boardwalk", True),
    ("Indialantic", "Ocean Avenue (Indialantic)", True),
    ("RC's", "RC's", False),
    ("Hightower Beach", "Hightower Park", False),
]


@router.post("/surf-spots/admin/merge-near-dupes")
async def merge_near_duplicate_spots(
    execute: bool = Query(False, description="Set to true to actually merge. Default is dry-run."),
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Merge near-duplicate surf spots that have slightly different names but refer
    to the same physical location. The exact-name dedup endpoint can't catch these.
    
    Default is DRY RUN. Pass ?execute=true to apply changes.
    """
    results = {"merges": [], "total_merged": 0, "skipped": [], "errors": []}
    missing = missing_fk_refs()
    if execute and missing:
        return _refusal(missing)
    results["missing_fk_refs"] = [f"{t}.{c}" for t, c in missing]

    try:
        for survivor_pattern, dup_pattern, same_state in NEAR_DUPE_PAIRS:
            if survivor_pattern == dup_pattern:
                # Cross-region dupe: find all spots with this name, keep earliest
                spots_result = await db.execute(
                    select(SurfSpot).where(
                        SurfSpot.name == survivor_pattern,
                        SurfSpot.is_active.is_(True)
                    ).order_by(SurfSpot.created_at)
                )
                spots = spots_result.scalars().all()
                if len(spots) < 2:
                    results["skipped"].append(f"'{survivor_pattern}' - only {len(spots)} found, no merge needed")
                    continue
                survivor = spots[0]
                duplicates = spots[1:]
            else:
                # Find survivor (canonical name)
                survivor_result = await db.execute(
                    select(SurfSpot).where(
                        SurfSpot.name == survivor_pattern,
                        SurfSpot.is_active.is_(True)
                    ).order_by(SurfSpot.created_at).limit(1)
                )
                survivor = survivor_result.scalar_one_or_none()

                if not survivor:
                    results["skipped"].append(f"Survivor '{survivor_pattern}' not found")
                    continue

                dup_query = select(SurfSpot).where(
                    SurfSpot.name == dup_pattern,
                    SurfSpot.is_active.is_(True)
                )
                if same_state and survivor.state_province:
                    dup_query = dup_query.where(SurfSpot.state_province == survivor.state_province)

                dup_result = await db.execute(dup_query)
                duplicates = dup_result.scalars().all()

                if not duplicates:
                    results["skipped"].append(f"Duplicate '{dup_pattern}' not found")
                    continue

            for dup in duplicates:
                moved = await _reparent_fk_refs(db, survivor.id, dup.id, execute)

                if execute:
                    await db.execute(
                        sa_text("DELETE FROM surf_spots WHERE id = :dup_id"),
                        {"dup_id": str(dup.id)}
                    )

                results["merges"].append({
                    "survivor": {"id": str(survivor.id), "name": survivor.name, "region": survivor.region},
                    "deleted": {"id": str(dup.id), "name": dup.name, "region": dup.region},
                    "fk_refs_moved": moved,
                    "action": "MERGED" if execute else "WOULD MERGE"
                })
                results["total_merged"] += 1

        if execute:
            await db.commit()

        return {
            "success": True,
            "mode": "EXECUTED" if execute else "DRY RUN",
            "message": f"{'Merged' if execute else 'Would merge'} {results['total_merged']} near-duplicate(s).",
            **results
        }
    except Exception as e:
        import traceback
        await db.rollback()      # a merge that failed part-way leaves NOTHING applied
        results["errors"].append(str(e))
        return {"success": False, "error": str(e), "traceback": traceback.format_exc(), **results}
