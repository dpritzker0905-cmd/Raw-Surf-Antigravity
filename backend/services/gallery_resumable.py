"""Transfer large gallery masters to Supabase Storage using tus 1.0."""
import asyncio
from base64 import b64encode
from urllib.parse import quote

import httpx


CHUNK_BYTES = 6 * 1024 * 1024
TRANSIENT = {408, 409, 423, 429, 500, 502, 503, 504}


def session_url(endpoint, location):
    if not location:
        raise ValueError("Missing upload location")
    target = endpoint.join(location)
    if ((target.scheme, target.host, target.port) != (endpoint.scheme, endpoint.host, endpoint.port)
            or target.userinfo or not target.path.startswith(endpoint.path + "/")):
        raise ValueError("Unexpected upload location")
    return target


async def transfer(client, origin, auth, key, content, mime):
    endpoint = httpx.URL(origin + "/storage/v1/upload/resumable")
    headers = {**auth, "Tus-Resumable": "1.0.0"}
    metadata = {"bucketName": "gallery_originals", "objectName": key, "contentType": mime}
    encoded = ",".join(f"{k} {b64encode(v.encode()).decode()}" for k, v in metadata.items())
    created = await client.post(endpoint, headers={
        **headers, "Upload-Metadata": encoded, "Upload-Length": str(len(content)),
    })
    if created.status_code != 201:
        return False
    url = session_url(endpoint, created.headers.get("Location"))
    offset = 0
    failures = 0
    try:
        while offset < len(content):
            end = min(offset + CHUNK_BYTES, len(content))
            try:
                response = await client.patch(url, headers={
                    **headers, "Content-Type": "application/offset+octet-stream",
                    "Upload-Offset": str(offset),
                }, content=content[offset:end])
                if response.status_code == 204 and response.headers.get("Upload-Offset") == str(end):
                    offset = end
                    failures = 0
                    continue
                if response.status_code != 204 and response.status_code not in TRANSIENT:
                    return False
            except httpx.TransportError:
                pass
            # A lost response can mean the server already committed this chunk.
            for _ in range(3 - failures):
                failures += 1
                await asyncio.sleep(0.5 * failures)
                try:
                    state = await client.head(url, headers=headers)
                    if state.status_code in (404, 410) and end == len(content):
                        # Supabase can retire a finished session. This master key is
                        # freshly allocated per gallery set, and never overwritten.
                        master = origin + "/storage/v1/object/authenticated/gallery_originals/" + quote(key, safe="/")
                        saved = await client.head(master, headers=auth)
                        if saved.status_code == 200 and saved.headers.get("Content-Length") == str(end):
                            offset = end
                            return True
                        return False
                    if state.status_code in TRANSIENT:
                        continue
                    if state.status_code not in (200, 204):
                        return False
                    confirmed = int(state.headers.get("Upload-Offset", "-1"))
                    if not offset <= confirmed <= end:
                        return False
                    if confirmed > offset:
                        failures = 0
                    offset = confirmed
                    break
                except httpx.TransportError:
                    continue
            else:
                return False
        return True
    finally:
        if offset < len(content):
            try:
                await client.delete(url, headers=headers)
            except httpx.TransportError:
                pass  # Incomplete tus sessions also expire on the server.
