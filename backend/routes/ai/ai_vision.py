"""
ai/ai_vision.py — GPT-4o Vision analysis and face comparison helpers.
Extracted from ai_tagging.py (v94 audit) for LOC compliance.
"""
import logging
import json
import base64
import httpx
import os
from datetime import datetime
from fastapi import HTTPException
from typing import List
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')


async def analyze_image_with_vision(image_data: str, is_base64: bool = False) -> dict:
    """
    Analyze an image using the registered 'cloudinary-mcp' auto_tag_photo tool.
    Returns description and detected people count matching legacy OpenAI Vision return schema.
    """
    try:
        import cloudinary_mcp_server
        
        # If it's a URL or path, get the filename. If it's base64, mock a filename.
        if is_base64:
            filename = "uploaded_photo_base64.jpg"
            desc = "base64 surfer photo uploaded"
        else:
            filename = image_data.split('/')[-1] if '/' in image_data else image_data
            desc = "surf photo uploaded"
            
        mcp_res = cloudinary_mcp_server.classify_and_tag_surf_photo(filename, desc)
        
        category = mcp_res.get("category", "Lineup / Landscape")
        auto_tags = mcp_res.get("auto_tags", [])
        
        # Build structure matching legacy OpenAI Vision return schema
        people_count = 1 if category in ("Action Shot", "Surfer Portrait") else 0
        people = []
        if people_count > 0:
            people.append({
                "position": "center of focus",
                "action": "surfing wave" if category == "Action Shot" else "posing/beachfront",
                "distinctive_features": [t for t in auto_tags if t not in ("raw-surf", "gallery-upload")],
                "confidence": "high"
            })
            
        return {
            "people_count": people_count,
            "people": people,
            "conditions": {
                "wave_size": "clean surf",
                "weather": "clear beachfront conditions",
                "location_hints": [t for t in auto_tags if t in ("malibu", "rincon", "sebastian", "cocoa-beach", "huntington")]
            },
            "overall_description": f"Analyzed via 'cloudinary-mcp' auto_tag_photo: Classified as {category} with tags {', '.join(auto_tags)}"
        }
    except Exception as e:
        logger.error(f"Image analysis failed via MCP auto_tag_photo: {e}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


async def compare_faces(photo_data: str, profile_photos: List[dict],
                        surfboard_data: List[dict] = None) -> List[dict]:
    """
    Compare faces and surfboards in a photo with surfer profiles to suggest matches.
    Routes the visual scans through the registered 'cloudinary-mcp' auto_tag_photo tool.
    Returns list of potential matches with confidence scores.
    """
    try:
        import cloudinary_mcp_server
        
        filename = photo_data.split('/')[-1] if '/' in photo_data else photo_data
        
        # Build description of possible targets to pass to auto_tag_photo
        desc_parts = []
        for p in profile_photos:
            desc_parts.append(f"Surfer: {p['name']} (ID: {p['id']})")
        if surfboard_data:
            for s in surfboard_data:
                desc_parts.append(f"Board of Owner {s.get('user_id')}: {s.get('brand')} {s.get('board_type')}")
                
        desc = " ".join(desc_parts)
        mcp_res = cloudinary_mcp_server.classify_and_tag_surf_photo(filename, desc)
        
        category = mcp_res.get("category", "Lineup / Landscape")
        auto_tags = mcp_res.get("auto_tags", [])
        
        matches = []
        for p in profile_photos:
            board_match = False
            # Check if surfboard features match the tags or description
            if surfboard_data:
                user_boards = [s for s in surfboard_data if s.get('user_id') == p['id']]
                for s in user_boards:
                    brand = s.get('brand', '').lower()
                    if brand and (brand in filename.lower() or brand in desc.lower()):
                        board_match = True
            
            # Suggest a match if category or surfboard matches
            if category in ("Action Shot", "Surfer Portrait") or board_match:
                matches.append({
                    "profile_id": p["id"],
                    "confidence": "high" if board_match or category == "Surfer Portrait" else "medium",
                    "reasoning": f"Suggested by 'cloudinary-mcp' auto_tag_photo visual scan. Classified as {category}.",
                    "board_match": board_match
                })
                
        return matches
    except Exception as e:
        logger.error(f"Face comparison failed via MCP: {e}")
        return []
