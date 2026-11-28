"""Build private sale editions before acknowledging a newly uploaded gallery master."""

import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from PIL import Image, ImageOps

from services.media_metadata import check_decode_size
from utils.video_processor import transcode_video


def build_editions(directory, content, content_type):
    source = directory / "source"
    source.write_bytes(content)
    if content_type.startswith("video/"):
        for tier, width, height in (("720p", 1280, 720), ("1080p", 1920, 1080)):
            ok, _ = transcode_video(
                str(source), str(directory / (tier + ".mp4")), width, height
            )
            if not ok:
                raise ValueError("Could not build a purchased video edition")
        return ("720p.mp4", "1080p.mp4")
    with Image.open(source) as photo:
        check_decode_size(photo)
        rgb = ImageOps.exif_transpose(photo).convert("RGB")
        for tier, size in (("standard", 1920), ("web", 800)):
            rgb.thumbnail((size, size), Image.Resampling.LANCZOS)
            rgb.save(directory / (tier + ".jpg"), "JPEG", quality=88)
    return ("standard.jpg", "web.jpg")


async def upload_gallery_set(
    bucket, object_key, content, content_type, put, put_stream, discard
):
    owner, _, name = object_key.partition("/")
    if not owner or not name:
        raise ValueError("Gallery uploads need an owner")
    folder = f"{owner}/editions-v1/{uuid4().hex}"
    completed = []
    master_saved = False
    try:
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            editions = await asyncio.to_thread(
                build_editions, directory, content, content_type
            )
            for filename in editions:
                key = f"{folder}/{filename}"
                with (directory / filename).open("rb") as handle:

                    async def chunks():
                        while chunk := await asyncio.to_thread(
                            handle.read, 1024 * 1024
                        ):
                            yield chunk

                    ref = await put_stream(
                        bucket=bucket,
                        object_key=key,
                        content=chunks(),
                        content_type="video/mp4"
                        if filename.endswith(".mp4")
                        else "image/jpeg",
                    )
                if not ref:
                    return None
                completed.append(key)
            key = f"{folder}/master{Path(name).suffix}"
            ref = await put(
                bucket=bucket,
                object_key=key,
                content=content,
                content_type=content_type,
            )
            master_saved = bool(ref)
            return ref
    except (ValueError, OSError):
        return None
    finally:
        if completed and not master_saved:
            await discard(bucket, completed)
