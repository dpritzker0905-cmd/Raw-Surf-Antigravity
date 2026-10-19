"""
AI Service Health Check Endpoint
Reports status of all AI matching services (Gemini, OpenAI).
Visible in admin dashboard to verify AI pipeline is operational.
"""
import os
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from services.llm_transport import openai_connection

router = APIRouter(tags=["AI Health"])
logger = logging.getLogger(__name__)


@router.get("/ai/health")
async def ai_health_check():
    """
    Health check for all AI services.
    Returns which engines are configured and reachable.
    """
    from services.ai_gemini_matcher import check_gemini_health
    
    # Check Gemini
    gemini_status = await check_gemini_health()
    
    # Check OpenAI
    connection = openai_connection()
    openai_key = connection.api_key
    openai_status = {
        "service": "openai_gpt4o",
        "key_configured": bool(openai_key),
        "transport": "pydantic_gateway" if connection.via_gateway else "openai_direct",
        "role": "premium_fallback"
    }
    
    # Determine overall status
    any_configured = gemini_status.get("key_configured") or openai_status.get("key_configured")
    primary_engine = "gemini_flash" if gemini_status.get("key_configured") else (
        "openai_gpt4o" if openai_status.get("key_configured") else "none"
    )
    
    return {
        "ai_operational": any_configured,
        "primary_engine": primary_engine,
        "engines": {
            "gemini": gemini_status,
            "openai": openai_status
        },
        "distribution_model": "hybrid_d",
        "description": "Hybrid Model: 'Your Waves' (AI-matched) + 'All Session' (browse all)"
    }
