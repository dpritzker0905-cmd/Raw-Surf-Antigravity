"""A stop on the old one-off spot scripts that find a spot by NAME and then write its position.

Owner, 2026-11-18: "I know we don't want to lose the current pins we have before starting to add more spots".

`global_expansion_phase3/4/5.py` look a spot up by name alone and, when their hard-coded coordinate is more than 30 m
from the stored one, overwrite the stored one and mark it a verified peak. `spot_sync_april_2026.py` rewrites
coordinates by name and country. Run today, any of them would move pins that a person has since placed (the precision
pin tool, the admin editor, the 2026-11-18 Maldives fix), with no audit row, and the phase scripts stop with an error
as soon as two spots share a name.

They are kept as a record of where rows came from. Running one now needs an explicit, per-script opt-in:

    RAW_ALLOW_LEGACY_SPOT_SCRIPT=global_expansion_phase3.py python scripts/global_expansion_phase3.py

New spots go through review by a person, never through these.
"""
import os

ENV = "RAW_ALLOW_LEGACY_SPOT_SCRIPT"


# What each kind of retired script does, in the words the refusal prints.
OVERWRITES = ("it finds spots by name and overwrites their coordinates, which would move pins people have placed "
              "since", "It overwrites spot coordinates by name.")
# Added 2026-11-18 (director's instruction): the bulk ADDERS. They do not move an existing pin; they insert a spot
# whenever a name is not found, with no duplicate tiers, no review and no audit row, which is exactly what the
# holding table exists to prevent.
BULK_ADDS = ("it adds spots in bulk whenever a name is not found, with no duplicate check, no review and no audit "
             "row; new spots go through the holding table and a person's promotion",
             "It adds spots in bulk with no duplicate check or review.")
# The command-line copy of the hard-delete merge tool. It keeps its own hand-written list of referencing tables.
HARD_DELETES = ("it DELETES duplicate spot rows using its own hand-kept list of referencing tables, without the "
                "guards the admin merge route has", "It deletes spot rows.")


def refuse_legacy_spot_write(script: str, kind=OVERWRITES) -> None:
    """Exit unless this exact script was named in RAW_ALLOW_LEGACY_SPOT_SCRIPT."""
    why, running = kind
    if os.environ.get(ENV, "").strip() == script:
        print(f"[{script}] running because {ENV} names it. {running}")
        return
    raise SystemExit(f"{script} is a retired one-off: {why}. Nothing was changed. To run it anyway, set {ENV}={script}.")
