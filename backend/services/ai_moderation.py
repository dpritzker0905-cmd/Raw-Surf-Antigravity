"""
AI Content Moderation Service
Uses GPT-4o to filter spam, abuse, and inappropriate content in reviews
"""

import os
import json
import logging
from dotenv import load_dotenv
from services.openai_budget import reserve_openai_request, BudgetUnavailable

load_dotenv()

logger = logging.getLogger(__name__)

# Default-off: when MODERATION_USE_PYDANTIC_GATEWAY is truthy, moderation goes through the
# Pydantic AI Gateway (Anthropic route) instead of OpenAI. Read at call time.
GATEWAY_BASE_URL = "https://gateway-us.pydantic.dev/proxy/anthropic"
GATEWAY_MODEL = "claude-opus-4-8"


def _gateway_enabled() -> bool:
    return os.environ.get("MODERATION_USE_PYDANTIC_GATEWAY", "").strip().lower() in ("1", "true", "yes", "on")


def _user_prompt(review_text: str) -> str:
    return f"Review the following content and determine if it should be approved or flagged:\n\n\"{review_text}\""


async def _complete_via_gateway(api_key: str, review_text: str) -> str:
    """One moderation completion through the Pydantic AI Gateway (Anthropic Messages API)."""
    import httpx

    base = os.environ.get("PYDANTIC_AI_GATEWAY_BASE_URL", "").rstrip("/")
    url = (f"{base}/anthropic" if base else GATEWAY_BASE_URL) + "/v1/messages"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            url,
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={
                "model": GATEWAY_MODEL,
                "max_tokens": 100,
                "system": MODERATION_SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": _user_prompt(review_text)}],
            },
        )
        resp.raise_for_status()
        return "".join(b.get("text", "") for b in resp.json().get("content", []) if b.get("type") == "text").strip()

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
    Moderate review content using GPT-4o via OpenAI API (or Claude via the Pydantic AI Gateway
    when MODERATION_USE_PYDANTIC_GATEWAY is set).
    
    Args:
        review_text: The review text to moderate
        
    Returns:
        dict with keys:
        - approved: bool - whether the content passes moderation
        - reason: str - explanation if flagged (empty if approved)
        - error: str - error message if moderation failed
    """

    use_gateway = _gateway_enabled()
    key_name = 'PYDANTIC_AI_GATEWAY_API_KEY' if use_gateway else 'OPENAI_API_KEY'
    api_key = os.environ.get(key_name)

    if not api_key:
        # If no API key, default to approved (fail open)
        logger.warning("No %s configured — skipping AI moderation", key_name)
        return {"approved": True, "reason": "", "error": "No API key configured"}

    # Skip moderation for very short reviews (likely just ratings)
    if len(review_text.strip()) < 3:
        return {"approved": True, "reason": ""}

    response_text = ""
    try:
        if use_gateway:
            # Not an OpenAI call, so the OpenAI testing-budget guard does not apply.
            response_text = await _complete_via_gateway(api_key, review_text)
        else:
            from openai import AsyncOpenAI
            model = await reserve_openai_request("gpt-4o", 100)
            client = AsyncOpenAI(api_key=api_key, base_url="https://api.openai.com/v1", max_retries=0)
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": MODERATION_SYSTEM_PROMPT},
                    {"role": "user", "content": _user_prompt(review_text)}
                ],
                temperature=0,
                max_tokens=100,
                service_tier="default",
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

    except BudgetUnavailable:
        # Preserve the existing moderation fail-open contract, without a paid call.
        return {"approved": True, "reason": "", "error": "AI moderation paused: testing budget unavailable"}
    except json.JSONDecodeError:
        # If JSON parsing fails, check for keywords
        response_lower = response_text.lower()
        if "false" in response_lower or "flag" in response_lower or "reject" in response_lower:
            return {"approved": False, "reason": "Content flagged by AI moderation"}
        return {"approved": True, "reason": ""}

    except Exception as e:
        # On error, fail open (allow the review but log the error)
        logger.error("AI moderation provider unavailable")
        return {"approved": True, "reason": "", "error": "AI moderation unavailable"}


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
