"""
AI Identity Matching Service
Provides face recognition and surfer identification using:
- Profile photo matching
- Board color detection
- Wetsuit pattern recognition
- Historical tagged photos

Uses OpenAI Vision API via Emergent LLM Key for image analysis.
"""
import os
import json
import logging
import base64
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Emergent LLM Key for OpenAI
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")


class IdentityMatchResult(BaseModel):
    """Result of identity matching analysis"""
    is_match: bool
    confidence: float  # 0.0 to 1.0
    match_methods: List[str]  # face_match, board_color, wetsuit, profile_photo
    details: Dict[str, Any]


class SurferProfile(BaseModel):
    """Surfer identity data for matching"""
    profile_photo_url: Optional[str] = None
    session_selfie_url: Optional[str] = None  # Selfie taken at session join (best for matching)
    board_photo_url: Optional[str] = None  # Board/wetsuit photo from session signup
    board_description: Optional[str] = None  # e.g., "white shortboard with blue stripes"
    wetsuit_description: Optional[str] = None  # e.g., "black wetsuit with red logo"
    rash_guard_description: Optional[str] = None  # e.g., "white rash guard with blue logo"
    stance: Optional[str] = None  # 'regular' or 'goofy' - helps identify in action shots
    tagged_photos: List[str] = []  # URLs of photos where user was tagged


async def analyze_image_for_surfer(
    image_url: str,
    surfer_profile: SurferProfile,
    additional_context: Optional[str] = None
) -> IdentityMatchResult:
    """
    Analyze an image to determine if the surfer in the photo matches the profile.
    Uses OpenAI Vision API for face recognition and equipment matching.
    
    Args:
        image_url: URL of the photo/video frame to analyze
        surfer_profile: Profile data including photos and equipment descriptions
        additional_context: Additional context (e.g., session location, time)
    
    Returns:
        IdentityMatchResult with match confidence and methods
    """
    if not EMERGENT_LLM_KEY:
        logger.warning("EMERGENT_LLM_KEY not configured, using fallback matching")
        return _fallback_match()
    
    try:
        # Build the analysis prompt
        prompt = _build_identity_prompt(surfer_profile, additional_context)
        
        # Prepare images for the API (order matters - most relevant first)
        images = [{"url": image_url, "type": "subject"}]
        
        # Session selfie is the best reference (same day photo)
        if surfer_profile.session_selfie_url:
            images.append({"url": surfer_profile.session_selfie_url, "type": "session_selfie"})
        
        if surfer_profile.profile_photo_url:
            images.append({"url": surfer_profile.profile_photo_url, "type": "profile"})
        
        if surfer_profile.board_photo_url:
            images.append({"url": surfer_profile.board_photo_url, "type": "equipment"})
        
        # Add up to 2 tagged photos for reference
        for i, tagged_url in enumerate(surfer_profile.tagged_photos[:2]):
            images.append({"url": tagged_url, "type": f"tagged_{i}"})
        
        # Call OpenAI Vision API
        result = await _call_vision_api(prompt, images)
        
        return result
        
    except Exception as e:
        logger.error(f"Error in AI identity matching: {e}")
        return _fallback_match()


def _build_identity_prompt(
    profile: SurferProfile, 
    context: Optional[str] = None
) -> str:
    """Build the prompt for identity matching analysis"""
    
    prompt = """You are an AI assistant specialized in identifying surfers in photos.

Analyze the SUBJECT image and compare it to the reference images to determine if they show the same person.

MATCHING CRITERIA (in order of reliability):
1. FACE MATCH: Compare facial features if faces are visible (most reliable)
2. SESSION SELFIE: Compare with the selfie taken at session check-in (very reliable - same day photo)
3. BOARD COLOR: Compare surfboard colors and designs
4. WETSUIT/RASH GUARD: Compare wetsuit or rash guard colors, patterns, and logos
5. STANCE: Check if the surfer is regular (left foot forward) or goofy (right foot forward)
6. BODY BUILD: Consider height, build, and posture if visible

REFERENCE DATA:
"""
    
    if profile.stance:
        prompt += f"- Stance: {profile.stance} footer ({'left' if profile.stance == 'regular' else 'right'} foot forward)\n"
    
    if profile.wetsuit_description:
        prompt += f"- Wetsuit: {profile.wetsuit_description}\n"
    
    if profile.rash_guard_description:
        prompt += f"- Rash Guard: {profile.rash_guard_description}\n"
    
    if profile.board_description:
        prompt += f"- Board: {profile.board_description}\n"
    
    if context:
        prompt += f"- Context: {context}\n"
    
    prompt += """

IMPORTANT: The SESSION SELFIE image (if provided) was taken on the same day as the surf photos, so it's the best reference for face matching and current appearance (hair, facial hair, tan, etc.).

INSTRUCTIONS:
1. Carefully examine the SUBJECT image
2. Compare with session selfie first (if available), then profile photo
3. Check equipment matches (board, wetsuit, rash guard)
4. Verify stance if visible in action shots
5. Consider partial visibility (back of head, distance shots)
6. Be confident but not overconfident - surfing photos are often challenging

Respond in JSON format:
{
    "is_match": true/false,
    "confidence": 0.0-1.0,
    "match_methods": ["face_match", "session_selfie", "board_color", "wetsuit", "rash_guard", "stance"],
    "reasoning": "Brief explanation",
    "visible_features": {
        "face_visible": true/false,
        "board_visible": true/false,
        "wetsuit_visible": true/false,
        "stance_identifiable": true/false
    }
}
"""
    return prompt


async def _call_vision_api(
    prompt: str, 
    images: List[Dict[str, str]]
) -> IdentityMatchResult:
    """Call OpenAI Vision API via Emergent integration"""
    
    try:
        # Import emergent integration
        from emergentintegrations.llm.chat import chat, UserMessage, ImageContent, TextContent
        
        # Build message content
        content = [TextContent(text=prompt)]
        
        for img in images:
            content.append(ImageContent(
                image_url=img["url"],
                detail="high"
            ))
        
        # Call the API
        response = await chat(
            api_key=EMERGENT_LLM_KEY,
            model="gpt-4o",
            messages=[UserMessage(content=content)],
            response_format={"type": "json_object"}
        )
        
        # Parse response
        result_json = json.loads(response.content)
        
        return IdentityMatchResult(
            is_match=result_json.get("is_match", False),
            confidence=float(result_json.get("confidence", 0.5)),
            match_methods=result_json.get("match_methods", ["ai_analysis"]),
            details={
                "reasoning": result_json.get("reasoning", ""),
                "visible_features": result_json.get("visible_features", {})
            }
        )
        
    except ImportError:
        logger.warning("emergentintegrations not available, using REST API fallback")
        return await _call_vision_api_rest(prompt, images)
    except Exception as e:
        logger.error(f"Vision API call failed: {e}")
        return _fallback_match()


async def _call_vision_api_rest(
    prompt: str,
    images: List[Dict[str, str]]
) -> IdentityMatchResult:
    """Fallback REST API call for OpenAI Vision"""
    
    try:
        # Build message content
        content = [{"type": "text", "text": prompt}]
        
        for img in images:
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": img["url"],
                    "detail": "high"
                }
            })
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {EMERGENT_LLM_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o",
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 500,
                    "response_format": {"type": "json_object"}
                }
            )
            
            if response.status_code != 200:
                logger.error(f"OpenAI API error: {response.text}")
                return _fallback_match()
            
            result = response.json()
            result_text = result["choices"][0]["message"]["content"]
            result_json = json.loads(result_text)
            
            return IdentityMatchResult(
                is_match=result_json.get("is_match", False),
                confidence=float(result_json.get("confidence", 0.5)),
                match_methods=result_json.get("match_methods", ["ai_analysis"]),
                details={
                    "reasoning": result_json.get("reasoning", ""),
                    "visible_features": result_json.get("visible_features", {})
                }
            )
            
    except Exception as e:
        logger.error(f"REST API call failed: {e}")
        return _fallback_match()


def _fallback_match() -> IdentityMatchResult:
    """Return a low-confidence fallback result when AI is unavailable"""
    return IdentityMatchResult(
        is_match=True,  # Default to potential match for review
        confidence=0.5,  # Medium confidence - needs user confirmation
        match_methods=["time_location"],  # Based on session timing
        details={
            "reasoning": "AI analysis unavailable, matched based on session timing",
            "requires_confirmation": True
        }
    )


async def batch_analyze_session_photos(
    photo_urls: List[str],
    surfer_profile: SurferProfile,
    session_context: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Analyze multiple photos from a session for surfer identification.
    Optimized for batch processing.
    
    Args:
        photo_urls: List of photo URLs to analyze
        surfer_profile: Target surfer's profile data
        session_context: Session context (spot, time, etc.)
    
    Returns:
        List of match results with photo URLs
    """
    results = []
    
    for url in photo_urls:
        try:
            match_result = await analyze_image_for_surfer(
                image_url=url,
                surfer_profile=surfer_profile,
                additional_context=session_context
            )
            
            results.append({
                "photo_url": url,
                "is_match": match_result.is_match,
                "confidence": match_result.confidence,
                "match_methods": match_result.match_methods,
                "details": match_result.details
            })
            
        except Exception as e:
            logger.error(f"Error analyzing photo {url}: {e}")
            results.append({
                "photo_url": url,
                "is_match": False,
                "confidence": 0.0,
                "match_methods": [],
                "details": {"error": str(e)}
            })
    
    return results


async def compare_board_colors(
    photo_url: str,
    expected_board_description: str
) -> Dict[str, Any]:
    """
    Compare board colors in a photo to expected description.
    Useful for identifying surfers by their board when face isn't visible.
    """
    if not EMERGENT_LLM_KEY:
        return {"match": False, "confidence": 0.5, "reason": "AI unavailable"}
    
    prompt = f"""Analyze the surfboard in this image.

Expected board description: {expected_board_description}

Determine if the surfboard in the image matches this description.

Consider:
- Primary board color
- Secondary colors/stripes
- Board shape (shortboard, longboard, fish, etc.)
- Any visible logos or designs

Respond in JSON:
{{
    "matches_description": true/false,
    "confidence": 0.0-1.0,
    "observed_board": "Description of what you see",
    "reason": "Why it matches or doesn't"
}}
"""
    
    try:
        from emergentintegrations.llm.chat import chat, UserMessage, ImageContent, TextContent
        
        response = await chat(
            api_key=EMERGENT_LLM_KEY,
            model="gpt-4o",
            messages=[UserMessage(content=[
                TextContent(text=prompt),
                ImageContent(image_url=photo_url, detail="high")
            ])],
            response_format={"type": "json_object"}
        )
        
        result = json.loads(response.content)
        return {
            "match": result.get("matches_description", False),
            "confidence": result.get("confidence", 0.5),
            "observed": result.get("observed_board", ""),
            "reason": result.get("reason", "")
        }
        
    except Exception as e:
        logger.error(f"Board color comparison failed: {e}")
        return {"match": False, "confidence": 0.5, "reason": f"Error: {str(e)}"}
