import httpx
import pytest

from services import gallery_resumable as tus


@pytest.mark.asyncio
async def test_lost_chunk_ack_resumes_from_server_offset(monkeypatch):
    monkeypatch.setattr(tus, "CHUNK_BYTES", 3)
    sent = []

    def storage(request):
        if request.method == "POST":
            return httpx.Response(201, headers={"Location": str(request.url) + "/session"})
        if request.method == "HEAD":
            return httpx.Response(200, headers={"Upload-Offset": "3"})
        assert request.method == "PATCH"
        sent.append((request.headers["Upload-Offset"], request.content))
        if len(sent) == 1:
            raise httpx.ReadTimeout("lost acknowledgement")
        return httpx.Response(204, headers={"Upload-Offset": "5"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(storage)) as client:
        assert await tus.transfer(client, "https://storage.invalid", {}, "unique/master.mp4", b"12345", "video/mp4")
    assert sent == [("0", b"123"), ("3", b"45")]


def test_session_stays_on_storage_origin():
    with pytest.raises(ValueError):
        tus.session_url(httpx.URL("https://storage.invalid/storage/v1/upload/resumable"),
                        "https://unrelated.invalid/storage/v1/upload/resumable/session")
