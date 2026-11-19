"""T1 P3: what a user's data-deletion and data-export requests do to the surf-truth tables.

Account deletion (`/compliance/delete-my-data`) anonymizes the profile instead of deleting it, so the
`ON DELETE CASCADE` foreign keys on these tables never fire. Before this module, a deleted account's blind surf
observations (with device GPS, photo EXIF positions and an install-id hash) and the server's photo-fact records
survived the request. `erase_surf_truth` removes them in the SAME transaction as the rest of the deletion.

What is erased:
- every `surf_observations` row the user submitted, and every `observation_media` row (photo hash, EXIF position);
- the user's `surf_truth_anchors` row (their observer status);
- `audited_by` on OTHER users' observations this user audited (the verdict stays; who gave it does not).

What is KEPT on purpose: `surf_truth_consent_events`, the append-only history of the person's consent choices. It is
the proof of consent (like ToS acknowledgements, which the deletion also keeps) and holds no observation or position.
With the observations erased, nothing remains for that consent to cover.

What is NOT erased here, and why (David's call, recorded in the T1 log):
- `surf_truth_anchor_events` and `surf_truth_admin_actions` are append-only audit logs (database triggers refuse
  UPDATE and DELETE even for the owner). They hold the profile id, which after deletion points at an anonymized
  profile, and admin-written reasons. Whether a deletion request must reach them needs a legal decision.
- Exports already written to private storage (`surf-truth/exports/`) carry the user only as an HMAC pseudonym; the
  proposed retention rule purges them within 7 days of a deletion. Not built until David answers.
- The report photo itself lives with its condition/surf report in the `conditions` bucket, owned by those features.
"""
from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import ObservationMedia, SurfObservation, SurfTruthAnchor, SurfTruthConsentEvent

# Columns left out of a data-export package: server bookkeeping that says nothing about the person.
_EXPORT_SKIP = {"_sa_instance_state"}


async def erase_surf_truth(db: AsyncSession, user_id: str) -> dict:
    """Erase the user's surf-truth rows. Does NOT commit: the caller's deletion transaction does, so a failure here
    rolls the whole request back instead of reporting a deletion that left these rows behind."""
    observations = (await db.execute(delete(SurfObservation).where(SurfObservation.user_id == user_id))).rowcount
    media = (await db.execute(delete(ObservationMedia).where(ObservationMedia.user_id == user_id))).rowcount
    anchor = (await db.execute(delete(SurfTruthAnchor).where(SurfTruthAnchor.profile_id == user_id))).rowcount
    audits = (await db.execute(update(SurfObservation).where(SurfObservation.audited_by == user_id)
                               .values(audited_by=None))).rowcount
    return {"surf_observations": observations or 0, "observation_media": media or 0,
            "surf_truth_anchor": anchor or 0, "audits_unattributed": audits or 0}


def _row(obj) -> dict:
    out = {}
    for key in obj.__table__.columns.keys():
        if key in _EXPORT_SKIP:
            continue
        value = getattr(obj, key, None)
        out[key] = value.isoformat() if hasattr(value, "isoformat") else value
    return out


async def export_surf_truth(db: AsyncSession, user_id: str) -> dict:
    """The user's own surf-truth rows for a data-portability package (every column: it is their data)."""
    observations = (await db.execute(select(SurfObservation).where(SurfObservation.user_id == user_id)
                                     .order_by(SurfObservation.received_at.desc()))).scalars().all()
    media = (await db.execute(select(ObservationMedia).where(ObservationMedia.user_id == user_id))).scalars().all()
    anchor = (await db.execute(select(SurfTruthAnchor).where(SurfTruthAnchor.profile_id == user_id))).scalars().all()
    consents = (await db.execute(select(SurfTruthConsentEvent).where(SurfTruthConsentEvent.profile_id == user_id)
                                 .order_by(SurfTruthConsentEvent.at))).scalars().all()
    return {"surf_observations": [_row(o) for o in observations],
            "observation_media": [_row(m) for m in media],
            "surf_truth_anchor": [_row(a) for a in anchor],
            "surf_truth_consent_history": [_row(c) for c in consents]}
