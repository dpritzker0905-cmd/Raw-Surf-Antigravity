"""Lay out tiled text on stored gallery previews."""
from PIL import Image, ImageDraw


def tile_upload_text(image, overlay, text, font, bbox, opacity):
    left, top, right, bottom = bbox
    width, height = right - left, bottom - top
    ink = (255, 255, 255, int(opacity * 255))
    if not width or not height:
        raise ValueError("Watermark text needs visible lettering")

    if 40 + right <= image.width and 40 + bottom <= image.height:
        draw = ImageDraw.Draw(overlay)
        for y in range(40, image.height, height * 4):
            for x in range(40, image.width, width + 80):
                draw.text((x, y), text, font=font, fill=ink)
        return image, overlay

    # Use the long axis of a strip for the label. Rasterize once, even for many repeats.
    stamp = Image.new("RGBA", (min(4096, width), min(4096, height)))
    ImageDraw.Draw(stamp).text((-left, -top), text, font=font, fill=ink)
    vertical = image.width < width and image.height > image.width
    if vertical:
        stamp = stamp.transpose(Image.Transpose.ROTATE_90)
    size = (max(image.width, stamp.width), max(image.height, stamp.height))
    if size != image.size:
        padded = Image.new("RGBA", size, "black")
        padded.paste(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
        image = padded
        overlay = Image.new("RGBA", size)

    start_x = min(40, (image.width - stamp.width) // 2)
    start_y = min(40, (image.height - stamp.height) // 2)
    step_x = stamp.width * 4 if vertical else stamp.width + 80
    step_y = stamp.height + 80 if vertical else stamp.height * 4
    for y in range(start_y, image.height, step_y):
        for x in range(start_x, image.width, step_x):
            overlay.paste(stamp, (x, y))
    return image, overlay
