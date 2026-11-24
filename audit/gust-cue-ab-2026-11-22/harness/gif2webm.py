"""GIF clip -> VP8 WebM via Playwright's bundled ffmpeg (concatenated JPEGs read as image2pipe from a file; vp8 out).
Usage: gif2webm.py <ffmpeg> <in.gif> <out.webm>"""
import io
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageSequence

ff, src, dst = sys.argv[1:4]
im = Image.open(src)
dur = im.info.get('duration', 66) or 66
fps = max(1, round(1000 / dur))
tmp = Path(dst).with_suffix('.mjpg')
with open(tmp, 'wb') as f:
    for fr in ImageSequence.Iterator(im):
        b = io.BytesIO(); fr.convert('RGB').save(b, 'JPEG', quality=92); f.write(b.getvalue())
r = subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', str(fps),
                    '-i', str(tmp), '-c:v', 'vp8', '-b:v', '1200k', '-auto-alt-ref', '0', dst])
tmp.unlink()
print(dst, fps, r.returncode)
