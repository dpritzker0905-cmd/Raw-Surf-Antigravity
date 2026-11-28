"""Boundary checks for new saleable gallery uploads, including legacy accounts without a tier."""
import pytest
from fastapi import HTTPException, UploadFile

from routes.uploads.media_gallery import read_gallery_original


@pytest.mark.asyncio
@pytest.mark.parametrize(("tier", "mib"), [(None, 50), ("free", 50), ("basic", 100), ("premium", 200)])
async def test_gallery_video_boundary(tmp_path, tier, mib):
    limit = mib * 1024 * 1024
    with (tmp_path / "clip.mp4").open("w+b") as stream:
        file = UploadFile(file=stream, filename="clip.mp4")
        stream.truncate(limit)
        assert len(await read_gallery_original(file, True, tier)) == limit
        stream.truncate(limit + 1)
        await file.seek(0)
        with pytest.raises(HTTPException) as failure:
            await read_gallery_original(file, True, tier)
        assert failure.value.status_code == 413
