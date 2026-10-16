"""Bounded, local equipment overlap for manual review. No identity inference or writes."""
import re

from fastapi import HTTPException
from sqlalchemy import select, union

from models import (Gallery, LiveSession, LiveSessionParticipant, Booking, BookingParticipant,
                    DispatchRequest, DispatchRequestParticipant, Surfboard, Profile)

MAX_BOARDS = 200
MAX_CLUES = 20


def normalized(value):
    return " ".join(re.findall(r"[a-z0-9]+", str(value or "").lower()))


def contains(text, phrase):
    needle = normalized(phrase)
    return bool(needle and f" {needle} " in f" {normalized(text)} ")


def note_features(description):
    # Saved notes are untrusted text, not instructions. Ignore negative/uncertain clauses.
    clauses = re.split(r"[.;!?\n]", (description or "")[:2000])
    positive = " ".join(c for c in clauses if not re.search(
        r"\b(no|not|without|unknown|unsure|maybe|possibly|wetsuit|person|surfer|rider|hair|eyes|skin|wearing)\b", c, re.I))
    aliases = {"grey": ("grey", "gray"), "stripes": ("stripes", "striped"),
               "checkerboard": ("checkerboard", "checkered"), "flames": ("flames", "flame"),
               "wood grain": ("wood grain", "wooden", "wood finish"), "gradient": ("gradient",)}
    words = ("white", "black", "blue", "red", "green", "yellow", "orange", "pink", "purple", "brown")
    return {w for w in (*words, *aliases) if any(contains(positive, x) for x in aliases.get(w, (w,)))}


def canonical(value):
    value = normalized(value)
    aliases = {"twin fin": "twin", "twin fins": "twin", "three fins": "thruster",
               "tri fin": "thruster", "single fin": "single", "quad fin": "quad",
               "swallow tail": "swallow", "round tail": "round", "squash tail": "squash",
               "pin tail": "pin", "fish surfboard": "fish", "short board": "shortboard",
               "long board": "longboard"}
    return aliases.get(value, value)


def compare_saved_boards(observations, candidates):
    """Return transparent overlaps, preserving ties; no probabilities or person assignments."""
    clues = []
    for observation in observations:
        if observation["relationship"] not in ("holding", "riding") or observation["confidence"] == "low":
            continue
        for board in candidates:
            evidence, conflicts = [], []
            text = " ".join(observation["visible_text"])
            for field in ("brand", "model"):
                saved = (board.get(field) or "").strip()
                if len(normalized(saved)) >= 3 and normalized(saved) not in ("unknown", "other", "none") and contains(text, saved):
                    evidence.append({"field": field, "observed": text, "saved": saved})
            for field in ("board_type", "fin_setup", "tail_shape"):
                saved, observed = board.get(field), observation.get(field)
                if not saved or not observed or canonical(saved) in ("unknown", "other"):
                    continue
                entry = {"field": field, "observed": observed, "saved": saved}
                if canonical(saved) == canonical(observed):
                    evidence.append(entry)
                else:
                    conflicts.append(entry)
            features = note_features(board.get("description"))
            for field, values in (("color", observation["colors"]), ("pattern", observation["patterns"])):
                for value in sorted(set(values) & features):
                    evidence.append({"field": field, "observed": value, "saved": value})
            if not evidence:
                continue
            categories = {e["field"] for e in evidence}
            strength = "multiple" if len(categories) >= 2 and not conflicts and observation["confidence"] == "high" else "limited"
            clues.append({
                "surfer_id": board["surfer_id"], "full_name": board["full_name"], "username": board["username"],
                "board_id": board["board_id"], "board_label": " ".join(filter(None, (board.get("brand"), board.get("model")))) or "Saved board",
                "person_index": observation["person_index"], "relationship": observation["relationship"],
                "strength": strength, "evidence": evidence, "conflicts": conflicts, "requires_manual_review": True,
            })
    # Stable order, shared traits retain every candidate rather than selecting a supposed winner.
    return sorted(clues, key=lambda c: (-len(c["evidence"]), c["surfer_id"], c["board_id"], c["person_index"]))


async def load_board_candidates(db, item, current_user_id):
    gallery = (await db.execute(select(Gallery).where(
        Gallery.id == item.gallery_id, Gallery.photographer_id == current_user_id))).scalar_one_or_none()
    if gallery is None:
        raise HTTPException(404, "Gallery not found or not owned by you")
    # Resolve membership from the database, never from request-supplied surfer IDs or names.
    scopes = []
    if gallery.live_session_id:
        scopes.append(select(LiveSessionParticipant.surfer_id).join(
            LiveSession, LiveSession.id == LiveSessionParticipant.live_session_id).where(
                LiveSession.id == gallery.live_session_id, LiveSession.photographer_id == current_user_id,
                LiveSessionParticipant.photographer_id == current_user_id,
                LiveSessionParticipant.status.in_(("active", "completed", "confirmed")),
                LiveSessionParticipant.participant_role == "participant"))
    elif gallery.booking_id:
        scopes.append(select(BookingParticipant.participant_id).join(Booking).where(
            Booking.id == gallery.booking_id, Booking.photographer_id == current_user_id,
            BookingParticipant.status.in_(("confirmed", "paid", "completed"))))
    elif gallery.dispatch_id:
        scopes.append(select(DispatchRequest.requester_id).where(
            DispatchRequest.id == gallery.dispatch_id, DispatchRequest.photographer_id == current_user_id))
        scopes.append(select(DispatchRequestParticipant.participant_id).join(DispatchRequest).where(
            DispatchRequest.id == gallery.dispatch_id, DispatchRequest.photographer_id == current_user_id,
            DispatchRequestParticipant.status.in_(("confirmed", "paid"))))
    if not scopes:
        return {"status": "no_linked_session", "candidates": [], "truncated": False}
    members = union(*scopes) if len(scopes) > 1 else scopes[0]
    rows = (await db.execute(select(Surfboard, Profile.id, Profile.full_name, Profile.username).join(
        Profile, Profile.id == Surfboard.user_id).where(Surfboard.user_id.in_(members)).order_by(
            Profile.id, Surfboard.id).limit(MAX_BOARDS + 1))).all()
    candidates = [{"surfer_id": sid, "full_name": name, "username": username, "board_id": board.id,
                   **{k: getattr(board, k) for k in ("brand", "model", "board_type", "fin_setup", "tail_shape", "description")}}
                  for board, sid, name, username in rows[:MAX_BOARDS]
                  if any((board.brand, board.model, board.board_type, board.fin_setup, board.tail_shape, board.description))]
    return {"status": "ready" if candidates else "no_saved_boards", "candidates": candidates,
            "truncated": len(rows) > MAX_BOARDS}
