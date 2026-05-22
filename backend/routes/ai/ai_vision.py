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
    Analyze an image using GPT-4o Vision API to detect surfers.
    Returns description and detected people count.
    """
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="AI service not configured — OPENAI_API_KEY missing")

    system_message = """You are a surf photo analysis AI. Your job is to analyze surf photos and:
1. Count how many surfers/people are visible in the image
2. Describe what each person is doing (surfing, paddling, watching, etc.)
3. Note distinctive features that could help identify them (wetsuit color, board color, position)
4. Identify the surf conditions and location characteristics

Return your analysis as JSON with this structure:
{
    "people_count": number,
    "people": [
        {
            "position": "description of where in image",
            "action": "what they're doing",
            "distinctive_features": ["list of identifying features"],
            "confidence": "high/medium/low"
        }
    ],
    "conditions": {
        "wave_size": "description",
        "weather": "description",
        "location_hints": ["any identifying features of the location"]
    },
    "overall_description": "brief description of the scene"
}"""

    try:
        if is_base64:
            img_url = f"data:image/jpeg;base64,{image_data}"
        else:
            img_url = image_data

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o",
                    "messages": [
                        {"role": "system", "content": system_message},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": "Analyze this surf photo and identify all people visible. Return JSON only."},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": img_url,
                                        "detail": "high"
                                    }
                                }
                            ]
                        }
                    ],
                    "max_tokens": 800,
                    "response_format": {"type": "json_object"}
                }
            )
            if response.status_code != 200:
                logger.error(f"OpenAI Vision API error: {response.text}")
                raise HTTPException(status_code=response.status_code, detail=f"OpenAI error: {response.text}")

            result_data = response.json()
            response_text = result_data["choices"][0]["message"]["content"]

        # Parse JSON from response
        try:
            if "```json" in response_text:
                json_str = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                json_str = response_text.split("```")[1].split("```")[0].strip()
            else:
                json_str = response_text.strip()

            return json.loads(json_str)
        except json.JSONDecodeError:
            return {
                "people_count": 0,
                "people": [],
                "conditions": {},
                "overall_description": response_text,
                "raw_response": True
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


async def compare_faces(photo_data: str, profile_photos: List[dict],
                        surfboard_data: List[dict] = None) -> List[dict]:
    """
    Compare faces in a photo with profile photos to suggest matches.
    Optionally includes surfboard quiver data for board-based identification.
    Returns list of potential matches with confidence scores.
    """
    if not OPENAI_API_KEY:
        return []

    # Build surfboard context for each profile
    board_context = ""
    if surfboard_data:
        board_lines = []
        for bd in surfboard_data:
            specs = []
            if bd.get('brand'):
                specs.append(f"Brand: {bd['brand']}")
            if bd.get('model'):
                specs.append(f"Model: {bd['model']}")
            if bd.get('board_type'):
                specs.append(f"Type: {bd['board_type']}")
            if bd.get('length_feet') or bd.get('length_inches'):
                ft = bd.get('length_feet', '')
                inch = bd.get('length_inches', '')
                specs.append(f"Length: {ft}'{inch}\"")
            if specs:
                board_lines.append(
                    f"  - Owner ID {bd['user_id']}: {', '.join(specs)}"
                )
        if board_lines:
            board_context = (
                "\n\nRegistered surfboards (use board brand/shape/size to "
                "help confirm identity):\n" + "\n".join(board_lines)
            )

    system_message = (
        "You are helping identify surfers in photos by comparing with "
        "their profile photos and registered surfboard data.\n"
        "Given a surf action photo and profile photos, identify which "
        "profile photos might match people in the action shot.\n"
        "Consider: body type, stance, wetsuit/gear if visible, hair "
        "color/style, and any other identifying features.\n"
        "IMPORTANT: Also compare the surfboard visible in the action "
        "shot against the registered surfboard data (brand logos, board "
        "shape, size, color). A matching board is a strong signal.\n"
        "Note: This is for tagging assistance only. Be conservative "
        "with matches - only suggest high-confidence matches.\n\n"
        "Return JSON:\n"
        '{\n'
        '    "matches": [\n'
        '        {\n'
        '            "profile_id": "id from the profile list",\n'
        '            "confidence": "high/medium/low",\n'
        '            "reasoning": "why you think this is a match",\n'
        '            "board_match": true or false\n'
        '        }\n'
        '    ]\n'
        '}'
    )

    try:
        # Download main photo
        async with httpx.AsyncClient() as client:
            response = await client.get(photo_data, timeout=30)
            if response.status_code != 200:
                return []
            main_photo_base64 = base64.b64encode(response.content).decode('utf-8')

        # Build prompt with profile info
        profiles_text = "\n".join([
            f"Profile ID: {p['id']}, Name: {p['name']}"
            for p in profile_photos
        ])

        # Call OpenAI Vision API directly using httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o",
                    "messages": [
                        {"role": "system", "content": system_message},
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": f"Analyze this surf photo. These are the potential surfers to match:\n{profiles_text}{board_context}\n\nBased on any visible features (face, body, wetsuit, AND surfboard), suggest which profiles might be in this photo. Return JSON with matches array."
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{main_photo_base64}",
                                        "detail": "high"
                                    }
                                }
                            ]
                        }
                    ],
                    "max_tokens": 800,
                    "response_format": {"type": "json_object"}
                }
            )
            if response.status_code != 200:
                logger.error(f"OpenAI Vision compare_faces API error: {response.text}")
                return []

            result_data = response.json()
            response_text = result_data["choices"][0]["message"]["content"]

        try:
            if "```json" in response_text:
                json_str = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                json_str = response_text.split("```")[1].split("```")[0].strip()
            else:
                json_str = response_text.strip()

            result = json.loads(json_str)
            return result.get("matches", [])
        except json.JSONDecodeError:
            return []

    except Exception as e:
        logger.error(f"Face comparison error: {e}")
        return []
