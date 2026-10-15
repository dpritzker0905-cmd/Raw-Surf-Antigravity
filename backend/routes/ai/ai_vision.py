"""
Photo analysis availability boundary.

The former implementation inferred identities and image content from filename
keywords and candidate metadata. Fail explicitly until a real provider is wired.
"""
from fastapi import HTTPException
from typing import List


async def analyze_image_with_vision(image_data: str, is_base64: bool = False) -> dict:
    """Do not present filename keywords as visual analysis of the supplied image."""
    raise HTTPException(status_code=503, detail="Photo analysis is unavailable until an image-analysis provider is integrated.")


async def compare_faces(photo_data: str, profile_photos: List[dict],
                        surfboard_data: List[dict] = None) -> List[dict]:
    """Identity suggestions require image evidence, not candidate names or board brands."""
    raise HTTPException(status_code=503, detail="Photo identity matching is unavailable until a validated matcher is integrated.")
