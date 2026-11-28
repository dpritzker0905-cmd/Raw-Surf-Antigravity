"""Offline rehearsal of the operator CLI's journal, HTTP storage adapter and database switch."""

from pathlib import Path
import json
import os
import sys

import httpx
import pytest
from sqlalchemy import Boolean, Column, MetaData, String, Table, create_engine, select, text

from services.gallery_tiers import PHOTO_FIELDS, VIDEO_FIELDS

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "supabase_scripts"))
from migrate_private_gallery_originals import BUCKET, COLUMNS, Storage, run


@pytest.mark.parametrize("hold", [False, True])
def test_private_gallery_recovery(tmp_path, hold):
    postgres = os.environ.get("GALLERY_REHEARSAL_POSTGRES") == "1"
    database = f"gallery_rehearsal_{int(hold)}"
    url = f"postgresql+psycopg2://postgres@127.0.0.1:5432/{database}" if postgres else f"sqlite:///{tmp_path / 'gallery.db'}"
    engine = create_engine(url)
    meta = MetaData()
    tables = {
        name: Table(
            name,
            meta,
            *(Column(c, Boolean if c in ("is_public","is_for_sale") else String, primary_key=i == 0) for i, c in enumerate(cols)),
        )
        for name, cols in COLUMNS.items()
    }
    meta.create_all(engine)
    origin = "https://fixture.invalid"
    objects = {}
    root = tmp_path / "legacy"
    (root / "owner").mkdir(parents=True)
    calls = []
    fail_after_copy = True

    def request(req):
        nonlocal fail_after_copy
        path = req.url.path
        if path == "/storage/v1/bucket/gallery_originals":
            return httpx.Response(200, json={"public": False, "id": BUCKET})
        assert req.headers["apikey"] == "fixture"
        key = path.removeprefix("/storage/v1/object/")
        if req.method == "GET":
            return (
                httpx.Response(200, content=objects[key])
                if key in objects
                else httpx.Response(404)
            )
        if req.method == "POST":
            assert key not in objects and req.headers["x-upsert"] == "false"
            objects[key] = req.content
            if fail_after_copy:
                fail_after_copy = False
                raise TimeoutError("lost acknowledgement")
            return httpx.Response(201)
        assert req.method == "DELETE" and key == "gallery"
        for name in json.loads(req.content)["prefixes"]:
            del objects["gallery/" + name]
            calls.append(name)
        return httpx.Response(200)

    with engine.begin() as conn:
        for media, fields in (("image", PHOTO_FIELDS), ("video", VIDEO_FIELDS)):
            row = dict(
                id=media,
                media_type=media,
                photographer_id="owner",
                preview_url="/preview",
            )
            for tier, field in fields.items():
                key = f"owner/{media}-{tier}.bin"
                data = f"{media}:{tier}".encode()
                if tier == "web":
                    (root / key).write_bytes(data)
                    row[field] = "/api/uploads/gallery/" + key
                else:
                    objects["gallery/" + key] = data
                    row[field] = origin + "/storage/v1/object/public/gallery/" + key
                conn.execute(
                    tables["gallery_purchases"]
                    .insert()
                    .values(
                        id=media + tier,
                        buyer_id=tier,
                        quality_tier=tier,
                        photographer_id="owner",
                        gallery_item_id=media,
                    )
                )
                conn.execute(
                    tables["user_media"]
                    .insert()
                    .values(
                        id=media + tier,
                        user_id=tier,
                        source_gallery_item_id=media,
                        source_photographer_id="owner",
                        source_type="photographer_transfer",
                        media_url="legacy",
                    )
                )
            conn.execute(tables["gallery_items"].insert().values(**row))
            conn.execute(
                tables["condition_reports"]
                .insert()
                .values(id=media, media_url=row["original_url"])
            )
        conn.execute(
            tables["gallery_original_transfer_grants"]
            .insert()
            .values(purchase_id="imageweb", evidence_ref="fixture-offer")
        )
        if hold:
            conn.execute(
                tables["user_media"]
                .insert()
                .values(
                    id="unmatched",
                    user_id="none",
                    source_gallery_item_id="image",
                    source_photographer_id="owner",
                    source_type="photographer_transfer",
                    media_url="legacy",
                )
            )
    journal = tmp_path / "private.sqlite"
    with httpx.Client(transport=httpx.MockTransport(request)) as client:
        storage = Storage(client, origin, {"apikey": "fixture"}, root)

        def phase(action):
            return run(action, engine, storage, journal, "synthetic")

        assert phase("plan") == {"assets": 6, "held": int(hold)}
        with pytest.raises(TimeoutError):
            phase("stage")
        phase("stage")
        phase("stage")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE user_media ADD CONSTRAINT stop_switch CHECK (media_url NOT LIKE 'supabase://%')" if postgres else
                    "CREATE TRIGGER stop_switch BEFORE UPDATE ON user_media BEGIN SELECT RAISE(ABORT,'interrupted'); END"
                )
            )
        from sqlalchemy.exc import IntegrityError

        with pytest.raises(IntegrityError):
            phase("cutover")
        with engine.begin() as conn:
            assert conn.scalar(
                select(tables["gallery_items"].c.original_url).limit(1)
            ).startswith(origin)
            conn.execute(text("ALTER TABLE user_media DROP CONSTRAINT stop_switch" if postgres else "DROP TRIGGER stop_switch"))
        phase("cutover")
        phase("cutover")
        phase("verify")
        with engine.begin() as conn:
            conn.execute(
                tables["gallery_purchases"]
                .insert()
                .values(
                    id="late",
                    buyer_id="new",
                    gallery_item_id="image",
                    photographer_id="owner",
                    quality_tier="web",
                )
            )
            conn.execute(
                tables["condition_reports"]
                .insert()
                .values(id="late", media_url="/later-preview")
            )
        for action, directory in (
            ("verify", "migrated"),
            ("rollback", "recovery"),
            ("cutover", "migrated"),
        ):
            phase(action)
            with engine.connect() as conn:
                rows = conn.execute(select(tables["user_media"])).mappings()
                for row in rows:
                    if row["id"] == "unmatched":
                        assert row["media_url"] == "/api/gallery/preview-unavailable"
                        continue
                    media, tier = row["source_gallery_item_id"], row["user_id"]
                    expected = "high" if row["id"] == "imageweb" else tier
                    ref = row["media_url"].removeprefix("supabase://")
                    assert f"/{directory}/" in ref
                    assert objects[ref] == f"{media}:{expected}".encode()
                assert set(
                    conn.scalars(select(tables["condition_reports"].c.media_url))
                ) == {"/preview", "/later-preview"}
                assert (
                    conn.scalar(
                        select(tables["gallery_purchases"].c.id).where(
                            tables["gallery_purchases"].c.id == "late"
                        )
                    )
                    == "late"
                )
        if not hold:
            with engine.begin() as conn:
                conn.execute(
                    tables["gallery_items"]
                    .insert()
                    .values(
                        id="unsupported",
                        media_type="image",
                        photographer_id="owner",
                        original_url="https://unknown.invalid/file",
                        is_for_sale=True,
                    )
                )
            special = tmp_path / "unresolved.sqlite"
            assert run("plan", engine, storage, special, "synthetic")["held"] == 1
            with pytest.raises(ValueError, match="source ownership"):
                run("cutover", engine, storage, special, "synthetic")
            with engine.begin() as conn:
                conn.execute(
                    tables["gallery_items"]
                    .delete()
                    .where(tables["gallery_items"].c.id == "unsupported")
                )
        assert not calls
        if hold:
            with pytest.raises(ValueError, match="holds"):
                phase("retire")
        else:
            phase("retire")
            phase("retire")
            phase("rollback")
            assert len(calls) == 5 and not (root / "owner/image-web.bin").exists()
        with engine.begin() as conn:
            conn.execute(
                tables["condition_reports"].update().values(media_url="/newer")
            )
        with pytest.raises(ValueError, match="inventory changed"):
            phase("rollback")
    engine.dispose()
