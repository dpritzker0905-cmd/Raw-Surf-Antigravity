"""
AI Content Moderation Service
Uses GPT-4o to filter spam, abuse, and inappropriate content in reviews
"""

import os
import json
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# System prompt for content moderation
MODERATION_SYSTEM_PROMPT = """You are a content moderation assistant for a surf photography marketplace. 
Your job is to review user-submitted reviews and determine if they are appropriate.

APPROVE content that is:
- Genuine feedback (positive or negative) about the photographer/surfer
- Constructive criticism
- Professional and respectful even if negative
- Contains mild colloquial language common in surf culture

FLAG content that contains:
- Hate speech, discrimination, or slurs
- Personal attacks or harassment
- Spam or promotional content unrelated to the review
- Explicit sexual content
- Threats of violence
- Contact information (phone numbers, addresses) for privacy
- Completely irrelevant content

Respond with ONLY a JSON object in this exact format:
{"approved": true/false, "reason": "brief explanation if flagged, empty string if approved"}

Be lenient with casual surf slang and expressions. Only flag truly problematic content."""


async def moderate_review_content(review_text: str) -> dict:
    """
    Moderate review content using GPT-4o via OpenAI API.
    
    Args:
        review_text: The review text to moderate
        
    Returns:
        dict with keys:
        - approved: bool - whether the content passes moderation
        - reason: str - explanation if flagged (empty if approved)
        - error: str - error message if moderation failed
    """

    api_key = os.environ.get('OPENAI_API_KEY')

    if not api_key:
        # If no API key, default to approved (fail open)
        logger.warning("No OPENAI_API_KEY configured — skipping AI moderation")
        return {"approved": True, "reason": "", "error": "No API key configured"}

    # Skip moderation for very short reviews (likely just ratings)
    if len(review_text.strip()) < 3:
        return {"approved": True, "reason": ""}

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key)

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": MODERATION_SYSTEM_PROMPT},
                {"role": "user", "content": f"Review the following content and determine if it should be approved or flagged:\n\n\"{review_text}\""}
            ],
            temperature=0,
            max_tokens=100
        )

        response_text = response.choices[0].message.content.strip()

        # Strip markdown code blocks if present
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]

        result = json.loads(response_text)
        return {
            "approved": result.get("approved", True),
            "reason": result.get("reason", "")
        }

    except json.JSONDecodeError:
        # If JSON parsing fails, check for keywords
        response_lower = response_text.lower()
        if "false" in response_lower or "flag" in response_lower or "reject" in response_lower:
            return {"approved": False, "reason": "Content flagged by AI moderation"}
        return {"approved": True, "reason": ""}

    except Exception as e:
        # On error, fail open (allow the review but log the error)
        logger.error(f"AI moderation error: {str(e)}")
        return {"approved": True, "reason": "", "error": str(e)}


async def moderate_batch(reviews: list) -> list:
    """
    Moderate multiple reviews in batch.
    
    Args:
        reviews: List of review texts
        
    Returns:
        List of moderation results
    """
    results = []
    for review in reviews:
        result = await moderate_review_content(review)
        results.append(result)
    return results
