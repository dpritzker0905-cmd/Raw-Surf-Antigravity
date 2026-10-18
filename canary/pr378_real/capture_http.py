"""Bound capture response consumption before buffering a provider body."""


def bounded_body(response, remaining):
    parts = []
    size = 0
    try:
        for part in response.iter_content(chunk_size=64 * 1024):
            size += len(part)
            if size > remaining:
                raise RuntimeError('Capture exceeded 480MiB HTTP budget')
            parts.append(part)
        raw = b''.join(parts)
        response._content = raw
        response._content_consumed = True
        return raw
    finally:
        response.close()
