"""
Watermark Service for Gallery Items
Generates watermarked versions of images for Standard tier (unpaid) previews

Watermark Types:
1. Default: "RAW SURF" logo text at center with 50% opacity
2. Custom: Photographer-uploaded logo/image overlay
3. Text: Photographer-defined text watermark
"""
import asyncio
import ipaddress
import io
import logging
import os
import socket
from collections import OrderedDict
from urllib.parse import SplitResult, urlsplit, urlunsplit

import httpx
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter
from typing import Optional, Tuple
import base64

logger = logging.getLogger(__name__)

# Default watermark configuration
DEFAULT_WATERMARK_TEXT = "RAW SURF"
DEFAULT_WATERMARK_OPACITY = 0.5  # 50% opacity as user specified
WATERMARK_FONT_SIZE_RATIO = 0.12  # Font size as ratio of image min dimension
WATERMARK_PATTERN_SPACING = 200  # Pixels between watermark repeats

# Remote media is attacker-influenced even when its URL was stored by an authenticated
# photographer. Keep the egress and decode budgets independent of upload limits.
MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024
MAX_REMOTE_LOGO_BYTES = 2 * 1024 * 1024
MAX_REMOTE_IMAGE_PIXELS = 25_000_000
MAX_REMOTE_LOGO_PIXELS = 4_000_000
MAX_REMOTE_MEDIA_URL_LENGTH = 2048
MAX_WATERMARK_FETCHES = 4
MAX_LOGO_CACHE_ENTRIES = 8
MAX_LOGO_CACHE_BYTES = 8 * 1024 * 1024
_SUPPORTED_IMAGE_FORMATS = frozenset({'JPEG', 'PNG', 'WEBP', 'GIF'})
_DEFAULT_MEDIA_ORIGINS = ('https://images.unsplash.com',)
_SUPABASE_PUBLIC_IMAGE_PATHS = (
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
)

# A small, byte-bounded LRU avoids retaining an attacker-selected number of logos.
_watermark_logo_cache: OrderedDict[str, bytes] = OrderedDict()
_watermark_logo_cache_bytes = 0
_watermark_fetch_slots = asyncio.Semaphore(MAX_WATERMARK_FETCHES)


class RemoteImageError(ValueError):
    """The remote reference or image violates the watermark media policy."""


def _origin(url: str) -> Optional[Tuple[str, str, int]]:
    """Return a normalized HTTPS origin, rejecting credentials and malformed ports."""
    try:
        parsed = urlsplit(url)
        hostname = (parsed.hostname or '').rstrip('.').lower()
        port = parsed.port or 443
        hostname.encode('ascii')
    except (UnicodeError, ValueError):
        return None
    if parsed.scheme.lower() != 'https' or not hostname or parsed.username or parsed.password:
        return None
    return ('https', hostname, port)


def _allowed_media_origins() -> set[Tuple[str, str, int]]:
    """Build the exact-origin allowlist from owned storage and explicit operator config."""
    configured = os.environ.get('WATERMARK_MEDIA_ALLOWED_ORIGINS', '').split(',')
    candidates = [os.environ.get('SUPABASE_URL', ''), *_DEFAULT_MEDIA_ORIGINS, *configured]
    allowed = set()
    for candidate in candidates:
        candidate = candidate.strip()
        origin = _origin(candidate)
        if not origin:
            continue
        parsed = urlsplit(candidate)
        if parsed.path not in ('', '/') or parsed.query or parsed.fragment:
            continue
        allowed.add(origin)
    return allowed


def _validate_remote_media_url(url: str) -> Tuple[SplitResult, str, int]:
    """Validate a remote image URL before DNS resolution or any network access."""
    if not isinstance(url, str) or not url or len(url) > MAX_REMOTE_MEDIA_URL_LENGTH:
        raise RemoteImageError('Remote image URL is missing or too long')
    parsed = urlsplit(url)
    origin = _origin(url)
    if origin is None or parsed.fragment:
        raise RemoteImageError('Remote images require a credential-free HTTPS URL')
    if origin not in _allowed_media_origins():
        raise RemoteImageError('Remote image origin is not allowed')
    if not parsed.path.startswith('/'):
        raise RemoteImageError('Remote image path is invalid')
    supabase_origin = _origin(os.environ.get('SUPABASE_URL', '').strip())
    if origin == supabase_origin and not parsed.path.startswith(_SUPABASE_PUBLIC_IMAGE_PATHS):
        raise RemoteImageError('Supabase media must use a public storage image path')
    return parsed, origin[1], origin[2]


async def _resolve_public_address(hostname: str, port: int) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Resolve once and return a public address that can be pinned for the connection."""
    try:
        results = await asyncio.to_thread(
            socket.getaddrinfo,
            hostname,
            port,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
        addresses = {ipaddress.ip_address(result[4][0].split('%', 1)[0]) for result in results}
    except (OSError, ValueError) as exc:
        raise RemoteImageError('Remote image host could not be resolved safely') from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise RemoteImageError('Remote image host resolved to a non-public address')
    return sorted(addresses, key=lambda address: (address.version, int(address)))[0]


async def _read_limited_image_response(response: httpx.Response, max_bytes: int) -> bytes:
    """Read a streamed image response without ever buffering beyond max_bytes."""
    if 300 <= response.status_code < 400:
        raise RemoteImageError('Remote image redirects are not allowed')
    response.raise_for_status()
    content_type = response.headers.get('content-type', '').split(';', 1)[0].strip().lower()
    if not content_type.startswith('image/'):
        raise RemoteImageError('Remote response is not an image')
    try:
        content_length = int(response.headers.get('content-length', '0'))
    except ValueError as exc:
        raise RemoteImageError('Remote image has an invalid content length') from exc
    if content_length < 0 or content_length > max_bytes:
        raise RemoteImageError('Remote image exceeds the byte limit')

    body = bytearray()
    async for chunk in response.aiter_bytes():
        if len(body) + len(chunk) > max_bytes:
            raise RemoteImageError('Remote image exceeds the byte limit')
        body.extend(chunk)
    if not body:
        raise RemoteImageError('Remote image is empty')
    return bytes(body)


def _decode_remote_image(image_bytes: bytes, max_pixels: int) -> Image.Image:
    """Validate image magic, dimensions, and complete decoding before use."""
    with Image.open(io.BytesIO(image_bytes)) as probe:
        if probe.format not in _SUPPORTED_IMAGE_FORMATS:
            raise RemoteImageError('Remote image format is not supported')
        width, height = probe.size
        if width <= 0 or height <= 0 or width * height > max_pixels:
            raise RemoteImageError('Remote image exceeds the pixel limit')
        probe.verify()
    with Image.open(io.BytesIO(image_bytes)) as image:
        width, height = image.size
        if width <= 0 or height <= 0 or width * height > max_pixels:
            raise RemoteImageError('Remote image exceeds the pixel limit')
        image.load()
        return image.copy()


async def _fetch_remote_image(url: str, max_bytes: int, max_pixels: int) -> Tuple[bytes, Image.Image]:
    """Fetch an allowlisted image through a DNS-validated, IP-pinned HTTPS connection."""
    parsed, hostname, port = _validate_remote_media_url(url)
    async with _watermark_fetch_slots:
        address = await _resolve_public_address(hostname, port)
        address_text = f'[{address}]' if address.version == 6 else str(address)
        authority = address_text if port == 443 else f'{address_text}:{port}'
        pinned_url = urlunsplit(('https', authority, parsed.path or '/', parsed.query, ''))
        original_host = f'[{hostname}]' if ':' in hostname else hostname
        host_header = original_host if port == 443 else f'{original_host}:{port}'
        timeout = httpx.Timeout(15.0, connect=5.0, read=10.0, write=5.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
            async with client.stream(
                'GET',
                pinned_url,
                headers={'Accept': 'image/jpeg,image/png,image/webp,image/gif', 'Host': host_header},
                extensions={'sni_hostname': hostname},
            ) as response:
                image_bytes = await _read_limited_image_response(response, max_bytes)
        image = _decode_remote_image(image_bytes, max_pixels)
        return image_bytes, image


def _cache_logo(logo_url: str, image_bytes: bytes) -> None:
    """Insert a validated logo into the byte- and entry-bounded LRU."""
    global _watermark_logo_cache_bytes
    previous = _watermark_logo_cache.pop(logo_url, None)
    if previous is not None:
        _watermark_logo_cache_bytes -= len(previous)
    if len(image_bytes) > MAX_LOGO_CACHE_BYTES:
        return
    while _watermark_logo_cache and (
        len(_watermark_logo_cache) >= MAX_LOGO_CACHE_ENTRIES
        or _watermark_logo_cache_bytes + len(image_bytes) > MAX_LOGO_CACHE_BYTES
    ):
        _, evicted = _watermark_logo_cache.popitem(last=False)
        _watermark_logo_cache_bytes -= len(evicted)
    _watermark_logo_cache[logo_url] = image_bytes
    _watermark_logo_cache_bytes += len(image_bytes)


def get_font(size: int) -> ImageFont.FreeTypeFont:
    """Get a font for watermarking, with fallback to default"""
    # Try common system fonts
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    
    for font_path in font_paths:
        if os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, size)
            except Exception:
                continue
    
    # Fallback to default font
    return ImageFont.load_default()


async def get_custom_logo(logo_url: str) -> Optional[Image.Image]:
    """
    Download and cache a custom watermark logo from URL
    Returns a PIL Image with transparency preserved
    """
    global _watermark_logo_cache_bytes

    if logo_url in _watermark_logo_cache:
        image_bytes = _watermark_logo_cache[logo_url]
        _watermark_logo_cache.move_to_end(logo_url)
        try:
            logo = _decode_remote_image(image_bytes, MAX_REMOTE_LOGO_PIXELS)
            return logo.convert('RGBA') if logo.mode != 'RGBA' else logo
        except Exception:
            _watermark_logo_cache.pop(logo_url, None)
            _watermark_logo_cache_bytes -= len(image_bytes)
    
    try:
        image_bytes, logo = await _fetch_remote_image(
            logo_url,
            max_bytes=MAX_REMOTE_LOGO_BYTES,
            max_pixels=MAX_REMOTE_LOGO_PIXELS,
        )
        _cache_logo(logo_url, image_bytes)
        return logo.convert('RGBA') if logo.mode != 'RGBA' else logo
    except Exception as e:
        logger.warning("Custom watermark logo was rejected: %s", type(e).__name__)
        return None


def create_positioned_watermark(
    width: int, 
    height: int, 
    text: str = DEFAULT_WATERMARK_TEXT,
    opacity: float = DEFAULT_WATERMARK_OPACITY,
    logo_image: Optional[Image.Image] = None,
    position: str = 'center'
) -> Image.Image:
    """
    Create a watermark at a specific position
    
    Positions:
    - center: Single centered watermark
    - bottom-right: Bottom right corner
    - bottom-left: Bottom left corner
    - top-right: Top right corner
    - top-left: Top left corner
    - tiled: Repeating diagonal pattern
    """
    watermark = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    
    # Calculate margin (5% of smaller dimension)
    margin = int(min(width, height) * 0.05)
    
    if position == 'tiled':
        # Use the pattern function for tiled
        return create_watermark_pattern(width, height, text, opacity)
    
    if logo_image:
        # Use custom logo
        logo = logo_image.copy()
        
        # Scale logo based on position
        if position == 'center':
            max_logo_width = int(width * 0.4)
            max_logo_height = int(height * 0.4)
        else:
            # Corner positions - smaller logo
            max_logo_width = int(width * 0.2)
            max_logo_height = int(height * 0.2)
        
        # Calculate scale to fit
        scale = min(max_logo_width / logo.width, max_logo_height / logo.height)
        new_size = (int(logo.width * scale), int(logo.height * scale))
        logo = logo.resize(new_size, Image.Resampling.LANCZOS)
        
        # Apply opacity to logo
        if logo.mode == 'RGBA':
            r, g, b, a = logo.split()
            a = a.point(lambda x: int(x * opacity))
            logo = Image.merge('RGBA', (r, g, b, a))
        
        # Calculate position
        if position == 'center':
            x = (width - logo.width) // 2
            y = (height - logo.height) // 2
        elif position == 'bottom-right':
            x = width - logo.width - margin
            y = height - logo.height - margin
        elif position == 'bottom-left':
            x = margin
            y = height - logo.height - margin
        elif position == 'top-right':
            x = width - logo.width - margin
            y = margin
        elif position == 'top-left':
            x = margin
            y = margin
        else:
            # Default to center
            x = (width - logo.width) // 2
            y = (height - logo.height) // 2
        
        watermark.paste(logo, (x, y), logo)
    else:
        # Create text-based watermark
        draw = ImageDraw.Draw(watermark)
        
        # Font size varies by position
        if position == 'center':
            font_size = max(int(min(width, height) * WATERMARK_FONT_SIZE_RATIO), 30)
        else:
            font_size = max(int(min(width, height) * WATERMARK_FONT_SIZE_RATIO * 0.6), 20)
        
        font = get_font(font_size)
        
        # Get text dimensions
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Calculate position
        if position == 'center':
            x = (width - text_width) // 2
            y = (height - text_height) // 2
        elif position == 'bottom-right':
            x = width - text_width - margin
            y = height - text_height - margin
        elif position == 'bottom-left':
            x = margin
            y = height - text_height - margin
        elif position == 'top-right':
            x = width - text_width - margin
            y = margin
        elif position == 'top-left':
            x = margin
            y = margin
        else:
            # Default to center
            x = (width - text_width) // 2
            y = (height - text_height) // 2
        
        # Draw with opacity
        alpha = int(255 * opacity)
        draw.text((x, y), text, font=font, fill=(255, 255, 255, alpha))
    
    return watermark


def create_center_logo_watermark(
    width: int, 
    height: int, 
    text: str = DEFAULT_WATERMARK_TEXT,
    opacity: float = DEFAULT_WATERMARK_OPACITY,
    logo_image: Optional[Image.Image] = None
) -> Image.Image:
    """
    Create a centered watermark (single logo/text in middle of image)
    This is the default "Raw Surf Logo" style watermark
    Backwards compatible wrapper for create_positioned_watermark
    """
    return create_positioned_watermark(width, height, text, opacity, logo_image, 'center')


def create_watermark_pattern(width: int, height: int, text: str = DEFAULT_WATERMARK_TEXT, opacity: float = DEFAULT_WATERMARK_OPACITY) -> Image.Image:
    """
    Create a diagonal repeating watermark pattern
    Returns an RGBA image with the watermark pattern
    """
    # Create transparent image for watermark
    watermark = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(watermark)
    
    # Calculate font size based on image dimensions
    font_size = max(int(min(width, height) * WATERMARK_FONT_SIZE_RATIO), 20)
    font = get_font(font_size)
    
    # Get text bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Calculate spacing
    spacing_x = text_width + WATERMARK_PATTERN_SPACING
    spacing_y = text_height + WATERMARK_PATTERN_SPACING // 2
    
    # Calculate alpha value
    alpha = int(255 * opacity)
    
    # Draw diagonal pattern
    for y in range(-height, height * 2, spacing_y):
        for x in range(-width, width * 2, spacing_x):
            # Offset every other row for diagonal effect
            offset = (y // spacing_y) * (spacing_x // 2)
            draw.text(
                (x + offset, y),
                text,
                font=font,
                fill=(255, 255, 255, alpha)
            )
    
    # Rotate the watermark layer for diagonal effect
    watermark = watermark.rotate(30, expand=False, resample=Image.Resampling.BICUBIC)
    
    # Crop back to original size (rotation expands the image)
    # Center crop
    w, h = watermark.size
    left = (w - width) // 2
    top = (h - height) // 2
    watermark = watermark.crop((left, top, left + width, top + height))
    
    return watermark


def apply_watermark(
    image: Image.Image,
    text: str = DEFAULT_WATERMARK_TEXT,
    opacity: float = DEFAULT_WATERMARK_OPACITY,
    logo_image: Optional[Image.Image] = None,
    watermark_style: str = 'center'  # 'center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'tiled', 'pattern'
) -> Image.Image:
    """
    Apply a watermark to an image
    
    Args:
        image: PIL Image to watermark
        text: Watermark text (used if no logo)
        opacity: Watermark opacity (0-1)
        logo_image: Optional custom logo image
        watermark_style: Position - 'center', 'bottom-right', 'bottom-left', 
                        'top-right', 'top-left', 'tiled', or 'pattern' (legacy)
    
    Returns:
        Watermarked PIL Image
    """
    # Convert to RGBA for compositing
    if image.mode != 'RGBA':
        image = image.convert('RGBA')
    
    width, height = image.size
    
    # Map 'pattern' to 'tiled' for backwards compatibility
    if watermark_style == 'pattern':
        watermark_style = 'tiled'
    
    # Create watermark based on style/position
    watermark = create_positioned_watermark(width, height, text, opacity, logo_image, watermark_style)
    
    # Composite watermark onto image
    watermarked = Image.alpha_composite(image, watermark)
    
    # Convert back to RGB for JPEG saving
    return watermarked.convert('RGB')


def watermark_image_from_url(
    image_url: str,
    output_format: str = 'JPEG',
    quality: int = 85,
    watermark_text: str = DEFAULT_WATERMARK_TEXT,
    opacity: float = DEFAULT_WATERMARK_OPACITY,
    watermark_style: str = 'center'
) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Download an image from URL and apply watermark
    
    Args:
        image_url: URL of the image to watermark
        output_format: Output format (JPEG, PNG, WEBP)
        quality: Output quality for lossy formats
        watermark_text: Text for watermark
        opacity: Watermark opacity
        watermark_style: 'center' or 'pattern'
    
    Returns:
        Tuple of (watermarked image bytes, content_type) or (None, None) on error
    """
    try:
        # Download image
        with httpx.Client(timeout=30.0) as client:
            response = client.get(image_url)
            response.raise_for_status()
            
        # Open image
        image = Image.open(io.BytesIO(response.content))
        
        # Apply watermark
        watermarked = apply_watermark(
            image, 
            text=watermark_text, 
            opacity=opacity, 
            watermark_style=watermark_style
        )
        
        # Save to bytes
        output = io.BytesIO()
        content_type = f"image/{output_format.lower()}"
        
        if output_format.upper() == 'JPEG':
            watermarked.save(output, format='JPEG', quality=quality, optimize=True)
        elif output_format.upper() == 'PNG':
            watermarked.save(output, format='PNG', optimize=True)
        elif output_format.upper() == 'WEBP':
            watermarked.save(output, format='WEBP', quality=quality)
        else:
            watermarked.save(output, format='JPEG', quality=quality)
            content_type = "image/jpeg"
        
        return output.getvalue(), content_type
        
    except Exception as e:
        logger.error(f"Failed to watermark image: {e}")
        return None, None


def watermark_image_bytes(
    image_bytes: bytes,
    output_format: str = 'JPEG',
    quality: int = 85,
    watermark_text: str = DEFAULT_WATERMARK_TEXT,
    opacity: float = DEFAULT_WATERMARK_OPACITY,
    watermark_style: str = 'center'
) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Apply watermark to image bytes
    
    Args:
        image_bytes: Raw image bytes
        output_format: Output format (JPEG, PNG, WEBP)
        quality: Output quality for lossy formats
        watermark_text: Text for watermark
        opacity: Watermark opacity
        watermark_style: 'center' or 'pattern'
    
    Returns:
        Tuple of (watermarked image bytes, content_type) or (None, None) on error
    """
    try:
        # Open image from bytes
        image = Image.open(io.BytesIO(image_bytes))
        
        # Apply watermark
        watermarked = apply_watermark(
            image, 
            text=watermark_text, 
            opacity=opacity,
            watermark_style=watermark_style
        )
        
        # Save to bytes
        output = io.BytesIO()
        content_type = f"image/{output_format.lower()}"
        
        if output_format.upper() == 'JPEG':
            watermarked.save(output, format='JPEG', quality=quality, optimize=True)
        elif output_format.upper() == 'PNG':
            watermarked.save(output, format='PNG', optimize=True)
        elif output_format.upper() == 'WEBP':
            watermarked.save(output, format='WEBP', quality=quality)
        else:
            watermarked.save(output, format='JPEG', quality=quality)
            content_type = "image/jpeg"
        
        return output.getvalue(), content_type
        
    except Exception as e:
        logger.error(f"Failed to watermark image bytes: {e}")
        return None, None


async def generate_watermarked_preview(
    original_url: str,
    max_dimension: int = 1080,  # 1080p for Standard tier
    watermark_text: str = DEFAULT_WATERMARK_TEXT,
    opacity: float = DEFAULT_WATERMARK_OPACITY,
    custom_logo_url: Optional[str] = None,
    watermark_style: str = 'center'
) -> Optional[bytes]:
    """
    Generate a watermarked preview image for Standard tier
    Resizes to max 1080px on longest edge and applies watermark
    
    Args:
        original_url: URL of the original high-res image
        max_dimension: Maximum dimension for preview (default 1080 for Standard tier)
        watermark_text: Text for text-based watermark
        opacity: Watermark opacity (0-1)
        custom_logo_url: Optional URL to custom watermark logo
        watermark_style: 'center' (single logo) or 'pattern' (repeating)
    
    Returns:
        Watermarked preview image bytes or None on error
    """
    try:
        _, image = await _fetch_remote_image(
            original_url,
            max_bytes=MAX_REMOTE_IMAGE_BYTES,
            max_pixels=MAX_REMOTE_IMAGE_PIXELS,
        )
        
        # Resize if needed (cap at max_dimension)
        width, height = image.size
        if width > max_dimension or height > max_dimension:
            if width > height:
                new_width = max_dimension
                new_height = int(height * (max_dimension / width))
            else:
                new_height = max_dimension
                new_width = int(width * (max_dimension / height))
            
            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        
        # Fetch custom logo if provided
        logo_image = None
        if custom_logo_url:
            logo_image = await get_custom_logo(custom_logo_url)
        
        # Apply watermark
        watermarked = apply_watermark(
            image, 
            text=watermark_text, 
            opacity=opacity,
            logo_image=logo_image,
            watermark_style=watermark_style
        )
        
        # Save to bytes
        output = io.BytesIO()
        watermarked.save(output, format='JPEG', quality=80, optimize=True)
        
        return output.getvalue()
        
    except Exception as e:
        logger.warning("Watermarked preview source was rejected: %s", type(e).__name__)
        return None


async def generate_watermarked_preview_from_bytes(
    image_bytes: bytes,
    max_dimension: int = 1080,
    watermark_text: str = DEFAULT_WATERMARK_TEXT,
    opacity: float = DEFAULT_WATERMARK_OPACITY,
    custom_logo_url: Optional[str] = None,
    watermark_style: str = 'center'
) -> Optional[bytes]:
    """
    Generate watermarked preview from image bytes (for in-memory processing)
    """
    try:
        image = Image.open(io.BytesIO(image_bytes))
        
        # Resize if needed
        width, height = image.size
        if width > max_dimension or height > max_dimension:
            if width > height:
                new_width = max_dimension
                new_height = int(height * (max_dimension / width))
            else:
                new_height = max_dimension
                new_width = int(width * (max_dimension / height))
            
            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        
        # Fetch custom logo if provided
        logo_image = None
        if custom_logo_url:
            logo_image = await get_custom_logo(custom_logo_url)
        
        # Apply watermark
        watermarked = apply_watermark(
            image,
            text=watermark_text,
            opacity=opacity,
            logo_image=logo_image,
            watermark_style=watermark_style
        )
        
        output = io.BytesIO()
        watermarked.save(output, format='JPEG', quality=80, optimize=True)
        return output.getvalue()
        
    except Exception as e:
        logger.error(f"Failed to generate watermarked preview from bytes: {e}")
        return None
