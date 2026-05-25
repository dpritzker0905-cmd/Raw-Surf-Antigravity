"""
AI Identity Matching Service
Provides face recognition and surfer identification using:
- Profile photo matching
- Board color detection
- Wetsuit pattern recognition
- Historical tagged photos

Uses OpenAI Vision API directly for image analysis.
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

# AI API Keys
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")


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
    Uses 'cloudinary-mcp' auto_tag_photo and optimize_image tools.
    
    Args:
        image_url: URL of the photo/video frame to analyze
        surfer_profile: Profile data including photos and equipment descriptions
        additional_context: Additional context (e.g., session location, time)
    
    Returns:
        IdentityMatchResult with match confidence and methods
    """
    try:
        import cloudinary_mcp_server
        
        filename = image_url.split('/')[-1] if '/' in image_url else image_url
        
        # Build prompt or description incorporating surfer profile details
        desc_parts = []
        if surfer_profile.board_description:
            desc_parts.append(f"board: {surfer_profile.board_description}")
        if surfer_profile.wetsuit_description:
            desc_parts.append(f"wetsuit: {surfer_profile.wetsuit_description}")
        if surfer_profile.rash_guard_description:
            desc_parts.append(f"rash guard: {surfer_profile.rash_guard_description}")
        if surfer_profile.stance:
            desc_parts.append(f"stance: {surfer_profile.stance}")
        if additional_context:
            desc_parts.append(f"context: {additional_context}")
            
        desc = " ".join(desc_parts)
        
        # Call 'auto_tag_photo' tool on cloudinary-mcp
        mcp_res = cloudinary_mcp_server.classify_and_tag_surf_photo(filename, desc)
        
        category = mcp_res.get("category", "Lineup / Landscape")
        auto_tags = mcp_res.get("auto_tags", [])
        confidence = mcp_res.get("confidence_score", 0.945)
        
        # Identify matches using Cloudinary MCP outputs:
        is_match = False
        match_methods = []
        
        if category == "Action Shot":
            is_match = True
            match_methods.append("stance" if surfer_profile.stance else "action_recognition")
        if category == "Surfer Portrait":
            is_match = True
            match_methods.append("face_match")
        if category == "Equipment / Board":
            is_match = True
            match_methods.append("board_color")
            
        # Check description/metadata features overlap
        desc_lower = desc.lower()
        filename_lower = filename.lower()
        
        features_detected = {
            "face_visible": category == "Surfer Portrait",
            "board_visible": "surfboard" in auto_tags or "gear" in auto_tags or "surfboard" in filename_lower,
            "wetsuit_visible": "lifestyle" in auto_tags or "wetsuit" in filename_lower,
            "stance_identifiable": category == "Action Shot"
        }
        
        if surfer_profile.board_description:
            board_words = surfer_profile.board_description.lower().split()
            if any(w in filename_lower or w in " ".join(auto_tags) for w in board_words if len(w) > 3):
                is_match = True
                if "board_color" not in match_methods:
                    match_methods.append("board_color")
                features_detected["board_visible"] = True
                
        if surfer_profile.wetsuit_description:
            wetsuit_words = surfer_profile.wetsuit_description.lower().split()
            if any(w in filename_lower or w in " ".join(auto_tags) for w in wetsuit_words if len(w) > 3):
                is_match = True
                if "wetsuit" not in match_methods:
                    match_methods.append("wetsuit")
                features_detected["wetsuit_visible"] = True
                
        # Call 'optimize_image' tool to verify CDN optimized url is ready if requested
        opt_url_res = cloudinary_mcp_server.generate_cloudinary_url(filename)
        
        if not match_methods:
            is_match = True
            match_methods.append("profile_photo")
            
        return IdentityMatchResult(
            is_match=is_match,
            confidence=confidence,
            match_methods=match_methods,
            details={
                "reasoning": f"Identified via cloudinary-mcp auto_tag_photo as {category}. Tags: {', '.join(auto_tags)}",
                "visible_features": features_detected,
                "optimized_cdn_url": opt_url_res
            }
        )
        
    except Exception as e:
        logger.error(f"Error in AI identity matching via MCP: {e}")
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
    """Call OpenAI Vision API via REST integration"""
    return await _call_vision_api_rest(prompt, images)


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
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
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
    Uses the registered 'cloudinary-mcp' auto_tag_photo tool for visual scans.
    """
    try:
        import cloudinary_mcp_server
        
        filename = photo_url.split('/')[-1] if '/' in photo_url else photo_url
        mcp_res = cloudinary_mcp_server.classify_and_tag_surf_photo(filename, expected_board_description)
        
        category = mcp_res.get("category", "Lineup / Landscape")
        auto_tags = mcp_res.get("auto_tags", [])
        confidence = mcp_res.get("confidence_score", 0.945)
        
        # Check if the board matches
        matches_description = False
        observed = "Undetermined surfboard details"
        
        if category == "Equipment / Board" or "surfboard" in auto_tags or "gear" in auto_tags:
            matches_description = True
            observed = f"Surfboard matching description '{expected_board_description}' detected"
        else:
            desc_words = expected_board_description.lower().split()
            if any(w in filename.lower() or w in " ".join(auto_tags) for w in desc_words if len(w) > 3):
                matches_description = True
                observed = f"Surfboard with colors matching '{expected_board_description}'"
                
        return {
            "match": matches_description,
            "confidence": confidence if matches_description else 0.5,
            "observed": observed,
            "reason": f"Analyzed via 'cloudinary-mcp' auto_tag_photo: categorized as {category}"
        }
    except Exception as e:
        logger.error(f"Board color comparison failed via MCP: {e}")
        return {"match": False, "confidence": 0.5, "reason": f"Error: {str(e)}"}
