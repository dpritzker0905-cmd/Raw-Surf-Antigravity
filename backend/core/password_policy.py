"""Minimum length for newly set account passwords."""

from fastapi import HTTPException


MIN_PASSWORD_LENGTH = 12


def validate_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
