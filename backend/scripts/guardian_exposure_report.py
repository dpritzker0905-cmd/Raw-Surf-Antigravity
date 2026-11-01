"""Print the guardian exposure counts (numbers only, small cells masked). Read-only.

Usage (from backend/):  DATABASE_URL=... python scripts/guardian_exposure_report.py
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def main() -> int:
    from database import AsyncSessionLocal
    from services.guardian_exposure import compute_exposure
    async with AsyncSessionLocal() as db:
        print(json.dumps(await compute_exposure(db), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
