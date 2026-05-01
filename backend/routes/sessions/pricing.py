"""Sessions pricing — capture session unified API and participant lookup."""
# ============ CAPTURE SESSION UNIFIED API ============

class CaptureSessionPricingRequest(BaseModel):
    photographer_id: str
    session_mode: str = 'live_join'  # 'live_join', 'on_demand', 'gallery'
    resolution: str = 'standard'  # 'web', 'standard', 'high'

@router.post("/sessions/pricing")
async def get_session_pricing(
    data: CaptureSessionPricingRequest,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get dynamic pricing for CaptureSession based on context.
    
    Modes:
    - live_join: Entry Fee + Resolution-based price
    - on_demand: Booking Fee + Resolution-based price
    - gallery: Standard Resolution-based price
    
    Returns pricing info including any photos included in buy-in and user's credit balance.
    """
    # Get photographer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == data.photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get user for credit balance check
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get active session if exists
    active_session = None
    if data.session_mode == 'live_join':
        session_result = await db.execute(
            select(LiveSession)
            .where(LiveSession.photographer_id == data.photographer_id)
            .where(LiveSession.status == 'active')
        )
        active_session = session_result.scalar_one_or_none()
    
    # Calculate pricing based on mode
    pricing = {
        'entry_fee': 0.0,
        'photo_price': 0.0,
        'photos_included': 0,
        'resolution': data.resolution,
        'session_mode': data.session_mode,
        'user_credit_balance': user.credit_balance or 0.0,
        'can_use_credits': (user.credit_balance or 0) > 0,
    }
    
    # Resolution-based photo pricing
    price_map = {
        'web': photographer.photo_price_web or photographer.live_photo_price_web or 3.0,
        'standard': photographer.photo_price_standard or photographer.live_photo_price_standard or 5.0,
        'high': photographer.photo_price_high or photographer.live_photo_price_high or 10.0,
    }
    pricing['photo_price'] = price_map.get(data.resolution, price_map['standard'])
    
    # Mode-specific entry fees and photos included
    if data.session_mode == 'live_join':
        pricing['entry_fee'] = photographer.live_buyin_price or photographer.session_price or 25.0
        if active_session:
            pricing['photos_included'] = active_session.photos_included or photographer.live_session_photos_included or 3
        else:
            pricing['photos_included'] = photographer.live_session_photos_included or 3
        pricing['session_active'] = active_session is not None
        
    elif data.session_mode == 'on_demand':
        pricing['entry_fee'] = photographer.on_demand_hourly_rate or 75.0
        pricing['photos_included'] = photographer.on_demand_photos_included or 3
        
    elif data.session_mode == 'gallery':
        pricing['entry_fee'] = 0.0
        pricing['photos_included'] = 0
    
    # Check if user has already joined this session
    if active_session:
        existing_participant = await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.live_session_id == active_session.id)
            .where(LiveSessionParticipant.surfer_id == user_id)
            .where(LiveSessionParticipant.status == 'active')
        )
        participant = existing_participant.scalar_one_or_none()
        if participant:
            pricing['already_joined'] = True
            pricing['remaining_photo_credits'] = participant.photos_credit_remaining or 0
        else:
            pricing['already_joined'] = False
            pricing['remaining_photo_credits'] = 0
    else:
        pricing['already_joined'] = False
        pricing['remaining_photo_credits'] = 0
    
    return pricing


@router.get("/sessions/participant/{session_id}/{user_id}")
async def get_participant_credits(
    session_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a participant's remaining photo credits for a session.
    Used to check if photos should be free (from buy-in) or paid.
    """
    participant_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.live_session_id == session_id)
        .where(LiveSessionParticipant.surfer_id == user_id)
        .where(LiveSessionParticipant.status == 'active')
    )
    participant = participant_result.scalar_one_or_none()
    
    if not participant:
        return {
            'in_session': False,
            'photos_credit_remaining': 0,
            'resolution_preference': 'standard'
        }
    
    return {
        'in_session': True,
        'photos_credit_remaining': participant.photos_credit_remaining or 0,
        'resolution_preference': participant.resolution_preference or 'standard',
        'participant_role': participant.participant_role or 'participant'
    }

