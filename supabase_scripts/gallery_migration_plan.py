"""Build a deterministic database inventory and private forward/recovery mappings."""

from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

from services.gallery_tiers import highest_tier, tier_reference

FIELDS = ("original_url", "url_web", "url_standard", "url_720p", "url_1080p")
COLUMNS = {
    "gallery_items": (
        "id",
        "photographer_id",
        "media_type",
        "is_public",
        "is_for_sale",
        "preview_url",
        "thumbnail_url",
        *FIELDS,
    ),
    "gallery_purchases": (
        "id",
        "gallery_item_id",
        "photographer_id",
        "buyer_id",
        "quality_tier",
    ),
    "gallery_original_transfer_grants": ("purchase_id", "evidence_ref"),
    "user_media": (
        "id",
        "user_id",
        "source_gallery_item_id",
        "source_photographer_id",
        "source_type",
        "media_url",
        "thumbnail_url",
    ),
    "surfer_gallery_items": (
        "id",
        "gallery_item_id",
        "photographer_id",
        "preserved_original_url",
        "preserved_preview_url",
        "preserved_thumbnail_url",
    ),
    "condition_reports": ("id", "media_url", "thumbnail_url"),
    "galleries": ("id", "cover_image_url"),
}
UNAVAILABLE = "/api/gallery/preview-unavailable"


def make_plan(before, storage):
    assets = {}
    aliases = {}
    holds = set()
    for item in before["gallery_items"]:
        owner = item["photographer_id"]
        for field in FIELDS:
            value = item[field]
            if not value:
                continue
            source = storage.source(value)
            if source is None:
                if not storage.private_for(value, owner):
                    holds.add(("gallery_items", item["id"], field))
                continue
            if not source[1].startswith(owner + "/"):
                holds.add(("gallery_items", item["id"], field))
                continue
            if source not in assets:
                key = f"{owner}/migrated/{uuid4().hex}"
                assets[source] = dict(
                    source=source,
                    primary=key,
                    recovery=f"{owner}/recovery/{uuid4().hex}",
                )
            aliases[value] = source

    def project(target):
        after = deepcopy(before)
        items = {row["id"]: row for row in after["gallery_items"]}
        sensitive = {v for r in before["gallery_items"] for f in FIELDS if (v := r[f])}
        sensitive_sources = {s for v in sensitive if (s := storage.source(v))}

        def protected(value):
            return bool(
                value
                and (
                    value in sensitive
                    or storage.source(value) in sensitive_sources
                    or value.startswith("supabase://")
                )
            )

        public = {}
        for row in after["gallery_items"]:
            originals = [row[f] for f in FIELDS if row[f]]
            for f in FIELDS:
                source = aliases.get(row[f])
                if source and source[1].startswith(row["photographer_id"] + "/"):
                    row[f] = storage.ref(assets[source][target])
            # A lower tier may not alias the master, including URL spelling variants.
            for f in FIELDS[1:]:
                if row[f] and row[f] == row["original_url"]:
                    row[f] = None
            if protected(row["thumbnail_url"]):
                row["thumbnail_url"] = None
            if protected(row["preview_url"]):
                row["preview_url"] = row["thumbnail_url"] or UNAVAILABLE
                if row["preview_url"] == UNAVAILABLE:
                    row["is_public"] = False
            for value in originals:
                key = storage.source(value) or value
                preview = row["preview_url"] or UNAVAILABLE
                public[key] = (
                    preview if public.get(key, preview) == preview else UNAVAILABLE
                )

        grants = {
            r["purchase_id"]
            for r in before["gallery_original_transfer_grants"]
            if r["evidence_ref"].strip()
        }
        receipts = {}
        for r in before["gallery_purchases"]:
            receipts.setdefault(
                (r["buyer_id"], r["gallery_item_id"], r["photographer_id"]), []
            ).append(r)
        for row in after["user_media"]:
            if row["source_type"] != "photographer_transfer":
                continue
            item = items.get(row["source_gallery_item_id"])
            matches = receipts.get(
                (
                    row["user_id"],
                    row["source_gallery_item_id"],
                    row["source_photographer_id"],
                ),
                [],
            )
            ref = None
            if (
                item
                and item["photographer_id"] == row["source_photographer_id"]
                and matches
            ):
                tier = highest_tier(
                    item["media_type"], {r["quality_tier"] for r in matches}
                )
                ref = (
                    item["original_url"]
                    if any(r["id"] in grants for r in matches)
                    else tier_reference(SimpleNamespace(**item), tier)
                )
            if ref and storage.private_for(ref, item["photographer_id"]):
                row["media_url"] = ref
            else:
                holds.add(("user_media", row["id"], "entitlement or variant"))
                row["media_url"] = UNAVAILABLE
            if protected(row["thumbnail_url"]):
                row["thumbnail_url"] = None
        for row in after["surfer_gallery_items"]:
            item = items.get(row["gallery_item_id"])
            old = row["preserved_original_url"]
            if old:
                # Preserve this existing locker object's identity, never upgrade it.
                source = storage.source(old)
                if (
                    item
                    and item["photographer_id"] == row["photographer_id"]
                    and source in assets
                    and source[1].startswith(row["photographer_id"] + "/")
                ):
                    row["preserved_original_url"] = storage.ref(assets[source][target])
                elif not storage.private_for(old, row["photographer_id"]):
                    holds.add(
                        ("surfer_gallery_items", row["id"], "preserved_original_url")
                    )
                    row["preserved_original_url"] = None
        for table, fields in (
            ("condition_reports", ("media_url", "thumbnail_url")),
            ("galleries", ("cover_image_url",)),
            (
                "surfer_gallery_items",
                ("preserved_preview_url", "preserved_thumbnail_url"),
            ),
        ):
            for row in after[table]:
                for field in fields:
                    if protected(row[field]):
                        row[field] = public.get(
                            storage.source(row[field]) or row[field], UNAVAILABLE
                        )
        return after

    primary = project("primary")
    recovery = project("recovery")
    return dict(
        before=before,
        primary=primary,
        recovery=recovery,
        assets=list(assets.values()),
        holds=sorted(holds),
    )
