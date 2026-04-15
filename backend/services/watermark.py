"""
Watermark Service for Gallery Items
Generates watermarked versions of images for Standard tier (unpaid) previews

Watermark Types:
1. Default: "RAW SURF" logo text at center with 50% opacity
2. Custom: Photographer-uploaded logo/image overlay
3. Text: Photographer-defined text watermark
"""
import os
import io
import logging
import httpx
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter
from typing import Optional, Tuple, Dict
import base64

logger = logging.getLogger(__name__)

# Default watermark configuration
DEFAULT_WATERMARK_TEXT = "RAW SURF"
DEFAULT_WATERMARK_OPACITY = 0.5  # 50% opacity as user specified
WATERMARK_FONT_SIZE_RATIO = 0.12  # Font size as ratio of image min dimension
WATERMARK_PATTERN_SPACING = 200  # Pixels between watermark repeats

# Cache for downloaded watermark logos
_watermark_logo_cache: Dict[str, bytes] = {}


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
    global _watermark_logo_cache
    
    if logo_url in _watermark_logo_cache:
        return Image.open(io.BytesIO(_watermark_logo_cache[logo_url]))
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(logo_url)
            response.raise_for_status()
            
            image_bytes = response.content
            _watermark_logo_cache[logo_url] = image_bytes
            
            logo = Image.open(io.BytesIO(image_bytes))
            # Ensure RGBA for transparency
            if logo.mode != 'RGBA':
                logo = logo.convert('RGBA')
            return logo
    except Exception as e:
        logger.error(f"Failed to fetch custom logo: {e}")
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
        # Download original
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(original_url)
            response.raise_for_status()
        
        # Open image
        image = Image.open(io.BytesIO(response.content))
        
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
        logger.error(f"Failed to generate watermarked preview: {e}")
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
