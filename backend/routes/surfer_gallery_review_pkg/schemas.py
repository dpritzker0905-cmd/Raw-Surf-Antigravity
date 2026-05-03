"""Shared schemas and helpers for surfer gallery review."""
from pydantic import BaseModel
from typing import List
import json


class ClaimMatchRequest(BaseModel):
    match_id: str
    session_id: str
    use_credit: bool = True


class ClaimBatchRequest(BaseModel):
    match_ids: List[str]
    session_id: str
    use_credits: bool = True


class ConfirmIdentityRequest(BaseModel):
    match_id: str
    is_confirmed: bool


class SelfClaimRequest(BaseModel):
    gallery_item_id: str


def _parse_match_reasons(reasons_json: str) -> str:
    """Parse AI match reasons JSON and return primary method"""
    if not reasons_json:
        return "ai_match"
    try:
        reasons = json.loads(reasons_json)
        if isinstance(reasons, list) and len(reasons) > 0:
            return reasons[0]
        return "ai_match"
    except Exception:
        return "ai_match"
