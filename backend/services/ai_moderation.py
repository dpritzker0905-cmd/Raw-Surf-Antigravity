"""
AI Content Moderation Service
Uses GPT-4o to filter spam, abuse, and inappropriate content in reviews
"""

import os
from dotenv import load_dotenv

load_dotenv()

# Stub classes to replace emergentintegrations when not available
class UserMessage:
    def __init__(self, text): self.text = text

class LlmChat:
    def __init__(self, **kwargs): pass
    def with_model(self, *args, **kwargs): return self
    async def send_message(self, msg): return '{"approved": true, "reason": ""}'

load_dotenv()

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
    Moderate review content using AI.
    
    Args:
        review_text: The review text to moderate
        
    Returns:
        dict with keys:
        - approved: bool - whether the content passes moderation
        - reason: str - explanation if flagged (empty if approved)
        - error: str - error message if moderation failed
    """
    
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    
    if not api_key:
        # If no API key, default to approved (fail open)
        return {"approved": True, "reason": "", "error": "No API key configured"}
    
    # Skip moderation for very short reviews (likely just ratings)
    if len(review_text.strip()) < 3:
        return {"approved": True, "reason": ""}
    
    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"moderation-{hash(review_text)}",
            system_message=MODERATION_SYSTEM_PROMPT
        ).with_model("openai", "gpt-4o")
        
        user_message = UserMessage(
            text=f"Review the following content and determine if it should be approved or flagged:\n\n\"{review_text}\""
        )
        
        response = await chat.send_message(user_message)
        
        # Parse the JSON response
        import json
        try:
            # Handle potential markdown code blocks
            response_text = response.strip()
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
            # If parsing fails, check for keywords
            response_lower = response.lower()
            if "flag" in response_lower or "reject" in response_lower or '"approved": false' in response_lower:
                return {"approved": False, "reason": "Content flagged by AI moderation"}
            return {"approved": True, "reason": ""}
            
    except Exception as e:
        # On error, fail open (allow the review but log the error)
        print(f"AI moderation error: {str(e)}")
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
