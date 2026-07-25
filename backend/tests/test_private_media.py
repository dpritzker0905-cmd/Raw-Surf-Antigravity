import pytest

from services import private_media


def test_private_media_references_are_durable_and_bucket_scoped():
    value = private_media.make_private_media_ref("chat_media", "conversation-1/photo.jpg")

    assert value == "supabase://chat_media/conversation-1/photo.jpg"
    assert private_media.parse_private_media_ref(value).object_key == "conversation-1/photo.jpg"
    assert private_media.parse_private_media_ref("supabase://gallery/photo.jpg") is None


def test_legacy_public_url_backfill_preserves_the_object_key():
    legacy = "https://project.supabase.co/storage/v1/object/public/chat_media/chat_media/a%20photo.jpg?cb=1"

    assert private_media.legacy_public_url_to_private_ref(legacy, "chat_media") == (
        "supabase://chat_media/chat_media/a photo.jpg"
    )


@pytest.mark.asyncio
async def test_signed_delivery_url_is_not_persisted_and_uses_bounded_ttl(monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"signedURL": "/object/sign/chat_media/conversation-1/photo.jpg?token=short-lived"}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse()

    monkeypatch.setattr(private_media, "_storage_settings", lambda: ("https://project.supabase.co", "service-key"))
    monkeypatch.setattr(private_media.httpx, "AsyncClient", lambda **kwargs: FakeClient())

    url = await private_media.signed_private_media_url(
        "supabase://chat_media/conversation-1/photo.jpg", expires_in=10
    )

    assert url == "https://project.supabase.co/storage/v1/object/sign/chat_media/conversation-1/photo.jpg?token=short-lived"
    assert calls[0][1]["json"] == {"expiresIn": 60}


@pytest.mark.asyncio
async def test_private_upload_returns_only_an_opaque_reference(monkeypatch):
    calls = []

    class FakeResponse:
        status_code = 201

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse()

    monkeypatch.setattr(private_media, "_storage_settings", lambda: ("https://project.supabase.co", "service-key"))
    monkeypatch.setattr(private_media.httpx, "AsyncClient", lambda **kwargs: FakeClient())

    value = await private_media.upload_private_media(
        bucket="crew_chat",
        object_key="booking-1/voice note.webm",
        content=b"audio-bytes",
        content_type="audio/webm",
    )

    assert value == "supabase://crew_chat/booking-1/voice note.webm"
    assert calls == [
        (
            "https://project.supabase.co/storage/v1/object/crew_chat/booking-1/voice%20note.webm",
            {
                "headers": {
                    "Authorization": "Bearer service-key",
                    "Content-Type": "audio/webm",
                    "x-upsert": "false",
                },
                "content": b"audio-bytes",
            },
        )
    ]
