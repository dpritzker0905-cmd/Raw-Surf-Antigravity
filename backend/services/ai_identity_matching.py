"""Photo matching capability status; unavailable inference never establishes a match.

Filename/category/description heuristics have no image evidence. They cannot verify
an identity or equipment match or authorize a claim. Manual gallery review remains available.
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel

MATCHING_UNAVAILABLE_MESSAGE = "Photo matching is unavailable. Please browse and review gallery photos manually."

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


def _fallback_match() -> IdentityMatchResult:
    """No image evidence is an unavailable analysis, not a potential match."""
    return IdentityMatchResult(is_match=False, confidence=0.0, match_methods=[], details={
        "analysis_status": "unavailable", "reasoning": MATCHING_UNAVAILABLE_MESSAGE,
        "requires_confirmation": True})


async def analyze_image_for_surfer(image_url: str, surfer_profile: SurferProfile,
                                   additional_context: Optional[str] = None) -> IdentityMatchResult:
    """Preserve the caller contract without inventing image evidence or performing external inference."""
    return _fallback_match()


async def batch_analyze_session_photos(photo_urls: List[str], surfer_profile: SurferProfile,
                                      session_context: Optional[str] = None) -> List[Dict[str, Any]]:
    return [{"photo_url": url, **_fallback_match().model_dump()} for url in photo_urls]


async def compare_board_colors(photo_url: str, expected_board_description: str) -> Dict[str, Any]:
    return {"match": False, "confidence": 0.0, "observed": None,
            "analysis_status": "unavailable", "reason": MATCHING_UNAVAILABLE_MESSAGE}
