#!/usr/bin/env python3
"""Break-glass: remove every second factor from ONE account whose owner has lost all of them.

Run only after the person is verified out of band. It needs the same DATABASE_URL the backend uses (set it in the
shell; it is never printed). It removes the authenticator, the recovery codes and any open sign-in challenges, leaves the
password alone, records an in-app notice for the user, and prints what it did. It never prints a secret or a code.

    python scripts/mfa_admin_reset.py --email person@example.com           # dry run: says what it would do
    python scripts/mfa_admin_reset.py --email person@example.com --yes     # does it

If the account's role is listed in MFA_REQUIRED_ROLES the user will be asked to enrol again at their next sign-in.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def run(email: str, apply: bool) -> int:
    from sqlalchemy import func, select

    from database import AsyncSessionLocal
    from models import Profile
    from services import mfa_factors

    async with AsyncSessionLocal() as db:
        profile = (await db.execute(
            select(Profile).where(func.lower(Profile.email) == email.strip().lower())
        )).scalar_one_or_none()
        if profile is None:
            print("No account has that email address.")
            return 1
        state = await mfa_factors.get_factor_state(db, profile.id)
        print(f"Account {profile.id}: authenticator={'yes' if state.totp else 'no'}, "
              f"passkeys={state.passkeys}, unused recovery codes={state.recovery_remaining}")
        if not state.enabled and not state.recovery_remaining:
            print("Nothing to remove.")
            return 0
        if not apply:
            print("Dry run. Re-run with --yes to remove these factors.")
            return 0
        await mfa_factors.remove_all_factors(db, profile.id)
        await mfa_factors.notify_security_event(
            db, profile.id, "Two-step verification was reset by support",
            "Your sign-in factors were removed after you asked for help. Set two-step verification up again in "
            "Settings. If you did not ask for this, change your password now.")
        print("Removed. The user can now sign in with their password.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True)
    parser.add_argument("--yes", action="store_true", help="actually remove the factors (default is a dry run)")
    args = parser.parse_args()
    return asyncio.run(run(args.email, args.yes))


if __name__ == "__main__":
    sys.exit(main())
