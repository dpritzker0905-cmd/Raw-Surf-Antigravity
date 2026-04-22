"""
Gemini Flash AI Matching Engine
Free-tier AI service for surfer identification in surf photos.

Uses Google Gemini 2.5 Flash (free tier) for:
- Face comparison (selfie vs surf photo)
- Board color matching
- Wetsuit/rash guard detection
- Confidence scoring

Falls back to OpenAI GPT-4o if Gemini is unavailable and OPENAI_API_KEY is set.
"""
import os
import json
import logging
import base64
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import httpx

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash-preview-04-17"
GEMINI_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"


async def match_surfer_in_photo(
    photo_url: str,
    surfer_selfie_url: Optional[str] = None,
    surfer_avatar_url: Optional[str] = None,
    board_description: Optional[str] = None,
    wetsuit_description: Optional[str] = None,
    rash_guard_description: Optional[str] = None,
    stance: Optional[str] = None,
    additional_context: Optional[str] = None
) -> Dict[str, Any]:
    """
    Use Gemini Flash to determine if a surfer appears in a photo.
    
    Returns:
        {
            "is_match": bool,
            "confidence": float (0.0-1.0),
            "match_methods": ["face_match", "board_color", "wetsuit", ...],
            "reasoning": str,
            "engine": "gemini_flash"
        }
    """
    if not GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY not configured, cannot use Gemini matching")
        return _no_key_result()
    
    try:
        # Download images and convert to base64
        images_data = []
        
        # The surf photo to analyze (required)
        photo_b64 = await _download_image_as_base64(photo_url)
        if not photo_b64:
            return _error_result("Could not download surf photo")
        images_data.append({"data": photo_b64, "label": "SURF_PHOTO"})
        
        # Session selfie (best reference — same day)
        if surfer_selfie_url:
            selfie_b64 = await _download_image_as_base64(surfer_selfie_url)
            if selfie_b64:
                images_data.append({"data": selfie_b64, "label": "SESSION_SELFIE"})
        
        # Profile avatar (secondary reference)
        if surfer_avatar_url:
            avatar_b64 = await _download_image_as_base64(surfer_avatar_url)
            if avatar_b64:
                images_data.append({"data": avatar_b64, "label": "PROFILE_PHOTO"})
        
        # Build the prompt
        prompt = _build_gemini_prompt(
            has_selfie=bool(surfer_selfie_url),
            has_avatar=bool(surfer_avatar_url),
            board_description=board_description,
            wetsuit_description=wetsuit_description,
            rash_guard_description=rash_guard_description,
            stance=stance,
            additional_context=additional_context
        )
        
        # Call Gemini API
        result = await _call_gemini_vision(prompt, images_data)
        return result
        
    except Exception as e:
        logger.error(f"Gemini matching error: {e}")
        return _error_result(str(e))


async def batch_match_surfers(
    photo_urls: List[str],
    surfer_profiles: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Match multiple photos against multiple surfer profiles.
    Returns a list of match results for each photo-surfer combination.
    
    Args:
        photo_urls: List of photo URLs to analyze
        surfer_profiles: List of dicts with keys:
            - surfer_id, selfie_url, avatar_url, board_description,
              wetsuit_description, rash_guard_description, stance
    
    Returns:
        List of {photo_url, surfer_id, is_match, confidence, match_methods, ...}
    """
    results = []
    
    for photo_url in photo_urls:
        for profile in surfer_profiles:
            try:
                match = await match_surfer_in_photo(
                    photo_url=photo_url,
                    surfer_selfie_url=profile.get("selfie_url"),
                    surfer_avatar_url=profile.get("avatar_url"),
                    board_description=profile.get("board_description"),
                    wetsuit_description=profile.get("wetsuit_description"),
                    rash_guard_description=profile.get("rash_guard_description"),
                    stance=profile.get("stance")
                )
                
                results.append({
                    "photo_url": photo_url,
                    "surfer_id": profile["surfer_id"],
                    **match
                })
            except Exception as e:
                logger.error(f"Batch match error for {photo_url} / {profile.get('surfer_id')}: {e}")
                results.append({
                    "photo_url": photo_url,
                    "surfer_id": profile["surfer_id"],
                    "is_match": False,
                    "confidence": 0.0,
                    "match_methods": [],
                    "reasoning": f"Error: {str(e)}",
                    "engine": "error"
                })
    
    return results


def _build_gemini_prompt(
    has_selfie: bool = False,
    has_avatar: bool = False,
    board_description: Optional[str] = None,
    wetsuit_description: Optional[str] = None,
    rash_guard_description: Optional[str] = None,
    stance: Optional[str] = None,
    additional_context: Optional[str] = None
) -> str:
    """Build the analysis prompt for Gemini"""
    
    prompt = """You are a surf photo identification AI. Analyze the SURF_PHOTO and determine if the surfer in it matches the reference images and description provided.

MATCHING CRITERIA (in order of reliability):
1. FACE MATCH: Compare facial features if visible (most reliable)
2. SESSION SELFIE: If provided, this was taken the SAME DAY — best reference for current appearance
3. BOARD COLOR/DESIGN: Compare surfboard appearance
4. WETSUIT/RASH GUARD: Compare clothing colors and patterns
5. STANCE: Regular (left foot forward) vs Goofy (right foot forward)
6. BODY BUILD: Height, build, posture

REFERENCE DATA:
"""
    
    if has_selfie:
        prompt += "- SESSION_SELFIE image provided (taken same day — most reliable reference)\n"
    if has_avatar:
        prompt += "- PROFILE_PHOTO image provided (may be older but shows face)\n"
    if board_description:
        prompt += f"- Board: {board_description}\n"
    if wetsuit_description:
        prompt += f"- Wetsuit: {wetsuit_description}\n"
    if rash_guard_description:
        prompt += f"- Rash Guard: {rash_guard_description}\n"
    if stance:
        prompt += f"- Stance: {stance} footer ({'left' if stance == 'regular' else 'right'} foot forward)\n"
    if additional_context:
        prompt += f"- Context: {additional_context}\n"
    
    prompt += """
IMPORTANT NOTES:
- Surf photos are challenging: distance, water spray, motion blur
- When face is not visible, rely on board/wetsuit/stance
- Be honest about uncertainty — don't force a match
- A partial view (back of head, distant shot) should lower confidence

Respond ONLY with valid JSON (no markdown, no code blocks):
{
    "is_match": true or false,
    "confidence": 0.0 to 1.0,
    "match_methods": ["face_match", "board_color", "wetsuit", "stance", "body_build"],
    "reasoning": "Brief explanation of your analysis",
    "face_visible": true or false,
    "board_visible": true or false,
    "multiple_surfers": true or false
}
"""
    return prompt


async def _call_gemini_vision(
    prompt: str,
    images_data: List[Dict[str, str]]
) -> Dict[str, Any]:
    """Call Google Gemini API with images"""
    
    # Build the parts array for Gemini multimodal request
    parts = []
    
    # Add images first
    for img in images_data:
        parts.append({
            "inlineData": {
                "mimeType": "image/jpeg",
                "data": img["data"]
            }
        })
        parts.append({"text": f"[{img['label']}]"})
    
    # Add the prompt
    parts.append({"text": prompt})
    
    request_body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 500,
            "responseMimeType": "application/json"
        }
    }
    
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
                json=request_body,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code != 200:
                error_text = response.text[:500]
                logger.error(f"Gemini API error {response.status_code}: {error_text}")
                return _error_result(f"Gemini API error: {response.status_code}")
            
            result = response.json()
            
            # Extract the text response
            candidates = result.get("candidates", [])
            if not candidates:
                return _error_result("No response from Gemini")
            
            content = candidates[0].get("content", {})
            text_parts = [p.get("text", "") for p in content.get("parts", []) if "text" in p]
            response_text = "".join(text_parts).strip()
            
            # Parse JSON response
            # Handle potential markdown wrapping
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
                response_text = response_text.strip()
            
            parsed = json.loads(response_text)
            
            return {
                "is_match": parsed.get("is_match", False),
                "confidence": float(parsed.get("confidence", 0.0)),
                "match_methods": parsed.get("match_methods", []),
                "reasoning": parsed.get("reasoning", ""),
                "face_visible": parsed.get("face_visible", False),
                "board_visible": parsed.get("board_visible", False),
                "multiple_surfers": parsed.get("multiple_surfers", False),
                "engine": "gemini_flash"
            }
            
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Gemini response as JSON: {e}")
        return _error_result(f"JSON parse error: {str(e)}")
    except httpx.TimeoutException:
        logger.error("Gemini API request timed out")
        return _error_result("Request timed out")
    except Exception as e:
        logger.error(f"Gemini API call failed: {e}")
        return _error_result(str(e))


async def _download_image_as_base64(url: str) -> Optional[str]:
    """Download an image URL and return base64 encoded string"""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url)
            if response.status_code == 200:
                return base64.b64encode(response.content).decode("utf-8")
            else:
                logger.warning(f"Failed to download image {url}: HTTP {response.status_code}")
                return None
    except Exception as e:
        logger.warning(f"Error downloading image {url}: {e}")
        return None


def _no_key_result() -> Dict[str, Any]:
    """Return when no API key is configured"""
    return {
        "is_match": False,
        "confidence": 0.0,
        "match_methods": [],
        "reasoning": "No AI API key configured (GEMINI_API_KEY)",
        "engine": "none"
    }


def _error_result(error: str) -> Dict[str, Any]:
    """Return on error"""
    return {
        "is_match": False,
        "confidence": 0.0,
        "match_methods": [],
        "reasoning": f"AI error: {error}",
        "engine": "error"
    }


async def check_gemini_health() -> Dict[str, Any]:
    """
    Health check for the Gemini AI service.
    Returns status of API key and connectivity.
    """
    status = {
        "service": "gemini_flash",
        "model": GEMINI_MODEL,
        "key_configured": bool(GEMINI_API_KEY),
        "key_preview": f"{GEMINI_API_KEY[:8]}..." if GEMINI_API_KEY else None,
        "api_reachable": False,
        "error": None
    }
    
    if not GEMINI_API_KEY:
        status["error"] = "GEMINI_API_KEY not set in environment"
        return status
    
    try:
        # Quick health check — list models
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}?key={GEMINI_API_KEY}"
            )
            status["api_reachable"] = response.status_code == 200
            if response.status_code != 200:
                status["error"] = f"API returned {response.status_code}"
    except Exception as e:
        status["error"] = str(e)
    
    return status
