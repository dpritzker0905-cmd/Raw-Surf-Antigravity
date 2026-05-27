import sys
import os
import time

# Set up dummy environment variables so database.py imports successfully
os.environ["DATABASE_URL"] = "postgresql://localhost/dummy"

# Add backend directory to sys.path to allow imports
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from PIL import Image, ImageDraw

try:
    from routes.uploads.core import add_watermark
    print("SUCCESS: Successfully imported add_watermark from routes.uploads.core")
except ImportError as e:
    print(f"ERROR: Failed to import add_watermark: {e}")
    sys.exit(1)

def run_validation():
    # 1. Create a dummy original image (e.g. 1000x1000 pixels)
    img_path = "test_original.jpg"
    img = Image.new("RGB", (1000, 1000), color=(135, 206, 235)) # Sky blue background
    draw = ImageDraw.Draw(img)
    # Draw some patterns to represent a real photo
    draw.rectangle([200, 200, 800, 800], fill=(255, 105, 180)) # Pink square
    draw.ellipse([400, 400, 600, 600], fill=(255, 255, 0)) # Yellow circle
    img.save(img_path, "JPEG")
    print(f"Created dummy original image at {img_path}")

    # 2. Create a dummy logo image with transparency (e.g. 200x200 pixels)
    logo_path = "test_logo.png"
    logo = Image.new("RGBA", (200, 200), color=(0, 0, 0, 0))
    logo_draw = ImageDraw.Draw(logo)
    # Draw a simple white circle with alpha/transparency
    logo_draw.ellipse([20, 20, 180, 180], fill=(255, 255, 255, 200))
    logo_draw.text((60, 90), "LOGO", fill=(0, 0, 0, 255))
    logo.save(logo_path, "PNG")
    print(f"Created dummy logo image at {logo_path}")

    # 3. Test watermark styles
    styles_to_test = [
        {"style": "text", "position": "center", "desc": "Center text watermark"},
        {"style": "logo", "position": "bottom-right", "desc": "Bottom-right logo watermark"},
        {"style": "both", "position": "tiled", "desc": "Tiled text + logo watermark"}
    ]

    all_passed = True
    for test in styles_to_test:
        out_path = f"test_watermarked_{test['style']}_{test['position']}.jpg"
        if os.path.exists(out_path):
            os.remove(out_path)
            
        print(f"\n--- Testing: {test['desc']} ---")
        try:
            # We want to catch stdout/stderr logging if any, or exceptions
            start = time.time()
            res_path, duration = add_watermark(
                image_path=img_path,
                output_path=out_path,
                text="TEST WATERMARK",
                logo_path=logo_path if test['style'] in ['logo', 'both'] else None,
                position=test['position'],
                opacity=0.3,
                style=test['style']
            )
            elapsed = (time.time() - start) * 1000
            
            # Check if output file exists and is indeed watermarked (or did it just fallback/fail?)
            if os.path.exists(out_path):
                print(f"Result: Watermark function returned successfully in {duration:.1f}ms (wall time: {elapsed:.1f}ms)")
                print(f"Output file size: {os.path.getsize(out_path)} bytes")
                
                # Check if it was a fallback copy by looking at size or checking logs.
                # Let's inspect the image mode/size
                with Image.open(out_path) as out_img:
                    print(f"Output image dimensions: {out_img.size}, mode: {out_img.mode}")
            else:
                print("ERROR: Output file was not created!")
                all_passed = False
        except Exception as ex:
            print(f"CRITICAL EXCEPTION running add_watermark: {ex}")
            all_passed = False

    # Cleanup temp files
    for p in [img_path, logo_path]:
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass
                
    if all_passed:
        print("\nValidation completed. Look above to verify if any silent errors occurred.")

if __name__ == "__main__":
    run_validation()
