"""Condition reports feed — regions, feed listing, archive dates, public galleries."""
@router.get("/condition-reports/regions")
async def get_regions():
    """Get list of available surf regions for filtering"""
    return {"regions": SURF_REGIONS}


@router.get("/condition-reports/feed")
async def get_condition_reports_feed(
    region: Optional[str] = None,
    country: Optional[str] = Query(default=None, description="Filter by country (e.g. 'USA')"),
    state_province: Optional[str] = Query(default=None, description="Filter by state/province (e.g. 'Florida')"),
    city: Optional[str] = Query(default=None, description="Filter by city/area (e.g. 'Cocoa Beach')"),
    date_filter: Optional[str] = Query(default="today", description="Filter: 'today', 'yesterday', or 'archive'"),
    archive_date: Optional[str] = Query(default=None, description="ISO date for archive mode, e.g. '2026-04-15'"),
    limit: int = Query(default=20, le=50),
    offset: int = 0,
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
    spot_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get condition reports feed for the Conditions Explorer tab.
    Supports date_filter for browsing today, yesterday, and archived reports.
    
    Params:
      - date_filter: 'today' (default), 'yesterday', or 'archive'
      - archive_date: ISO date string for archive mode (e.g. '2026-04-15')
      - spot_id: Optional filter to a specific surf spot
      - country, state_province, city: Hierarchical location filters via SurfSpot
    """
    from sqlalchemy import func
    
    now = datetime.now(timezone.utc)
    
    # Determine if we need a spot join for location filtering
    needs_spot_join = bool(country or state_province or city)
    
    # Build date range based on date_filter
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    if date_filter == 'yesterday':
        # Yesterday: midnight-to-midnight in UTC
        yesterday_start = today_start - timedelta(days=1)
        date_start = yesterday_start
        date_end = today_start
    elif date_filter == 'archive' and archive_date:
        # Specific archive date
        try:
            target_date = datetime.fromisoformat(archive_date).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            target_date = today_start - timedelta(days=2)
        date_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        date_end = date_start + timedelta(days=1)
    else:
        # Default: today — strict midnight-to-midnight UTC
        date_start = today_start
        date_end = today_start + timedelta(days=1)
    
    # Base query: show ACTIVE reports created within the date range
    query = select(ConditionReport).where(
        and_(
            ConditionReport.is_active == True,
            ConditionReport.created_at >= date_start,
            ConditionReport.created_at < date_end
        )
    ).options(
        selectinload(ConditionReport.photographer),
        selectinload(ConditionReport.spot)
    )
    
    # Filter by region if specified
    if region and region != "All":
        query = query.where(ConditionReport.region == region)
    
    # Filter by spot if specified
    if spot_id:
        query = query.where(ConditionReport.spot_id == spot_id)
    
    # Hierarchical location filtering via SurfSpot join
    if needs_spot_join:
        query = query.join(SurfSpot, ConditionReport.spot_id == SurfSpot.id)
        if country:
            query = query.where(SurfSpot.country == country)
        if state_province:
            query = query.where(SurfSpot.state_province == state_province)
        if city:
            query = query.where(
                or_(SurfSpot.secondary_city == city, SurfSpot.secondary_area == city)
            )
    
    # Order by distance if user location provided, otherwise by most recent
    if user_lat is not None and user_lng is not None:
        if not needs_spot_join:
            query = query.join(ConditionReport.spot, isouter=True)
        query = query.order_by(
            func.coalesce(
                func.abs(SurfSpot.latitude - user_lat) + func.abs(SurfSpot.longitude - user_lng),
                9999
            ),
            desc(ConditionReport.created_at)
        )
    else:
        query = query.order_by(desc(ConditionReport.created_at))
    
    # Pagination
    query = query.offset(offset).limit(limit)
    
    result = await db.execute(query)
    reports = result.scalars().all()
    
    # Format response
    response_reports = []
    any_healed = False
    
    # Batch-check which photographers are currently in an active live session
    photographer_ids = list(set(r.photographer_id for r in reports))
    live_photographer_ids = set()
    if photographer_ids:
        try:
            live_result = await db.execute(
                select(LiveSession.photographer_id).where(
                    LiveSession.photographer_id.in_(photographer_ids),
                    LiveSession.status == 'active'
                )
            )
            live_photographer_ids = set(row[0] for row in live_result.fetchall())
        except Exception as e:
            cr_logger.warning(f"Failed to check live session status: {e}")
    
    for report in reports:
        # Auto-heal broken media URLs from linked galleries
        if await _auto_heal_report_media(report, db):
            any_healed = True
        
        photographer = report.photographer
        
        # Check if this report has a linked gallery (via live_session_id)
        gallery_id = None
        gallery_item_count = 0
        if report.live_session_id:
            try:
                gallery_result = await db.execute(
                    select(Gallery.id, Gallery.item_count).where(
                        Gallery.live_session_id == report.live_session_id,
                        Gallery.is_public.is_(True)
                    ).limit(1)
                )
                gallery_row = gallery_result.first()
                if gallery_row:
                    gallery_id = gallery_row[0]
                    gallery_item_count = gallery_row[1] or 0
            except Exception:
                pass
        
        report_data = ConditionReportResponse(
            id=report.id,
            photographer_id=report.photographer_id,
            photographer_name=photographer.full_name if photographer else None,
            photographer_avatar=photographer.avatar_url if photographer else None,
            photographer_role=photographer.role.value if photographer else "Unknown",
            spot_id=report.spot_id,
            spot_name=report.spot_name or (report.spot.name if report.spot else None),
            region=report.region or (report.spot.region if report.spot else None),
            media_url=report.media_url,
            media_type=report.media_type,
            thumbnail_url=report.thumbnail_url,
            caption=report.caption,
            wave_height_ft=report.wave_height_ft,
            conditions_label=report.conditions_label,
            wind_conditions=report.wind_conditions,
            crowd_level=report.crowd_level,
            view_count=report.view_count,
            is_active=report.is_active,
            is_photographer_live=report.photographer_id in live_photographer_ids,
            created_at=report.created_at,
            expires_at=report.expires_at,
            time_ago=get_time_ago(report.created_at)
        )
        
        # Extend with gallery link data (not in Pydantic model, added as dict)
        report_dict = report_data.dict()
        report_dict["gallery_id"] = gallery_id
        report_dict["gallery_item_count"] = gallery_item_count
        response_reports.append(report_dict)
    
    # Persist any healed URLs back to the database
    if any_healed:
        try:
            await db.commit()
        except Exception as e:
            cr_logger.warning(f"Failed to persist auto-healed URLs: {e}")
    
    count_sql = select(func.count(ConditionReport.id)).where(
        and_(
            ConditionReport.is_active == True,
            ConditionReport.created_at >= date_start,
            ConditionReport.created_at < date_end
        )
    )
    if region and region != "All":
        count_sql = count_sql.where(ConditionReport.region == region)
    if spot_id:
        count_sql = count_sql.where(ConditionReport.spot_id == spot_id)
    if needs_spot_join:
        count_sql = count_sql.join(SurfSpot, ConditionReport.spot_id == SurfSpot.id)
        if country:
            count_sql = count_sql.where(SurfSpot.country == country)
        if state_province:
            count_sql = count_sql.where(SurfSpot.state_province == state_province)
        if city:
            count_sql = count_sql.where(
                or_(SurfSpot.secondary_city == city, SurfSpot.secondary_area == city)
            )
    
    total = (await db.execute(count_sql)).scalar() or 0
    
    return {
        "reports": response_reports,
        "total": total,
        "has_more": offset + limit < total,
        "date_filter": date_filter
    }


@router.get("/condition-reports/archive-dates")
async def get_archive_dates(
    spot_id: Optional[str] = None,
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = Query(default=30, le=90),
    db: AsyncSession = Depends(get_db)
):
    """
    Get dates that have condition reports for the archive browser.
    Returns the most recent N dates with activity, enabling the date picker
    to show which days have content.
    Supports hierarchical location filtering via SurfSpot join.
    """
    from sqlalchemy import func, cast, Date
    
    # Query distinct dates with report counts
    query = select(
        cast(ConditionReport.created_at, Date).label('report_date'),
        func.count(ConditionReport.id).label('report_count')
    ).group_by(
        cast(ConditionReport.created_at, Date)
    ).order_by(
        desc(cast(ConditionReport.created_at, Date))
    )
    
    if spot_id:
        query = query.where(ConditionReport.spot_id == spot_id)
    
    # Hierarchical location filtering
    if country or state_province or city:
        query = query.join(SurfSpot, ConditionReport.spot_id == SurfSpot.id)
        if country:
            query = query.where(SurfSpot.country == country)
        if state_province:
            query = query.where(SurfSpot.state_province == state_province)
        if city:
            query = query.where(
                or_(SurfSpot.secondary_city == city, SurfSpot.secondary_area == city)
            )
    
    # Exclude today (today is shown in the "Today" tab)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    query = query.where(ConditionReport.created_at < today_start)
    
    query = query.limit(limit)
    
    result = await db.execute(query)
    rows = result.fetchall()
    
    # Also get gallery counts per date
    gallery_query = select(
        cast(Gallery.session_date, Date).label('gallery_date'),
        func.count(Gallery.id).label('gallery_count')
    ).where(
        Gallery.is_public.is_(True),
        Gallery.session_date.isnot(None),
        Gallery.session_date < today_start
    ).group_by(
        cast(Gallery.session_date, Date)
    ).order_by(
        desc(cast(Gallery.session_date, Date))
    ).limit(limit)
    
    if spot_id:
        gallery_query = gallery_query.where(Gallery.surf_spot_id == spot_id)
    
    gallery_result = await db.execute(gallery_query)
    gallery_rows = gallery_result.fetchall()
    gallery_map = {str(row.gallery_date): row.gallery_count for row in gallery_rows}
    
    dates = []
    for row in rows:
        date_str = str(row.report_date)
        dates.append({
            "date": date_str,
            "report_count": row.report_count,
            "gallery_count": gallery_map.get(date_str, 0)
        })
    
    return {"dates": dates}


@router.get("/condition-reports/public-galleries")
async def get_public_gallery_archive(
    spot_id: Optional[str] = None,
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    city: Optional[str] = None,
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    photographer_id: Optional[str] = None,
    limit: int = Query(default=20, le=50),
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get public session galleries for archive browsing.
    Returns galleries linked to public LiveSessions, enriched with conditions data.
    
    Params:
      - spot_id: Filter by surf spot
      - country, state_province, city: Hierarchical location filters via SurfSpot
      - date: Specific ISO date (e.g. '2026-04-15')
      - date_from / date_to: Date range
      - photographer_id: Filter by photographer
    """
    from sqlalchemy import func
    
    query = select(Gallery).where(
        Gallery.is_public.is_(True),
        Gallery.item_count > 0
    ).options(
        selectinload(Gallery.photographer),
        selectinload(Gallery.surf_spot),
        selectinload(Gallery.live_session)
    )
    
    if spot_id:
        query = query.where(Gallery.surf_spot_id == spot_id)
    
    # Hierarchical location filtering via SurfSpot join
    if country or state_province or city:
        query = query.join(SurfSpot, Gallery.surf_spot_id == SurfSpot.id)
        if country:
            query = query.where(SurfSpot.country == country)
        if state_province:
            query = query.where(SurfSpot.state_province == state_province)
        if city:
            query = query.where(
                or_(SurfSpot.secondary_city == city, SurfSpot.secondary_area == city)
            )
    
    if photographer_id:
        query = query.where(Gallery.photographer_id == photographer_id)
    
    # Date filtering
    if date:
        try:
            target = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
            day_start = target.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            query = query.where(
                and_(
                    Gallery.session_date >= day_start,
                    Gallery.session_date < day_end
                )
            )
        except (ValueError, TypeError):
            pass
    elif date_from or date_to:
        if date_from:
            try:
                start = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc, hour=0, minute=0, second=0, microsecond=0)
                query = query.where(Gallery.session_date >= start)
            except (ValueError, TypeError):
                pass
        if date_to:
            try:
                end = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc, hour=23, minute=59, second=59)
                query = query.where(Gallery.session_date <= end)
            except (ValueError, TypeError):
                pass
    
    query = query.order_by(desc(Gallery.session_date)).offset(offset).limit(limit)
    
    result = await db.execute(query)
    galleries = result.scalars().all()
    
    # Fetch linked condition reports for conditions context
    gallery_session_ids = [g.live_session_id for g in galleries if g.live_session_id]
    conditions_map = {}
    if gallery_session_ids:
        cr_result = await db.execute(
            select(ConditionReport).where(
                ConditionReport.live_session_id.in_(gallery_session_ids)
            )
        )
        for cr in cr_result.scalars().all():
            conditions_map[cr.live_session_id] = cr
    
    response = []
    for gallery in galleries:
        photographer = gallery.photographer
        spot = gallery.surf_spot
        session = gallery.live_session
        cr = conditions_map.get(gallery.live_session_id)
        
        response.append({
            "id": gallery.id,
            "title": gallery.title,
            "cover_image_url": gallery.cover_image_url,
            "item_count": gallery.item_count or 0,
            "view_count": gallery.view_count or 0,
            "session_date": gallery.session_date.isoformat() if gallery.session_date else None,
            "created_at": gallery.created_at.isoformat() if gallery.created_at else None,
            "session_type": gallery.session_type,
            "is_for_sale": gallery.is_for_sale,
            # Photographer info
            "photographer_id": gallery.photographer_id,
            "photographer_name": photographer.full_name if photographer else None,
            "photographer_avatar": photographer.avatar_url if photographer else None,
            # Spot info
            "spot_id": gallery.surf_spot_id,
            "spot_name": spot.name if spot else None,
            "spot_region": spot.region if spot else None,
            # Conditions context (from linked condition report)
            "conditions": {
                "wave_height_ft": cr.wave_height_ft if cr else None,
                "conditions_label": cr.conditions_label if cr else None,
                "wind_conditions": cr.wind_conditions if cr else None,
                "crowd_level": cr.crowd_level if cr else None,
                "media_url": cr.media_url if cr else None,
            } if cr else None,
            # Session info
            "live_session_id": gallery.live_session_id,
            "session_duration_mins": session.duration_mins if session else None,
            "participant_count": session.participant_count if session else 0,
        })
    
    return {
        "galleries": response,
        "total": len(response),
        "has_more": len(response) == limit
    }


