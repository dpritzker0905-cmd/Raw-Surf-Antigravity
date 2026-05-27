import shutil
import os
from PIL import Image

src_1 = r"C:\Users\dprit\AppData\Local\Temp\chrome-devtools-mcp-qMzhLt\screenshot.png"
src_2 = r"C:\Users\dprit\AppData\Local\Temp\chrome-devtools-mcp-Sn2mju\screenshot.png"

dest_dir = r"C:\Users\dprit\.gemini\antigravity\brain\b983bf55-d87b-4849-864a-6aaf57190485"

dest_1 = os.path.join(dest_dir, "screenshot_with_mask.png")
dest_2 = os.path.join(dest_dir, "screenshot_without_mask.png")

# Copy the screenshots
if os.path.exists(src_1):
    shutil.copy(src_1, dest_1)
    print(f"Copied screenshot 1 to {dest_1}")
if os.path.exists(src_2):
    shutil.copy(src_2, dest_2)
    print(f"Copied screenshot 2 to {dest_2}")

# Analyze color distribution in the screenshots
def analyze_image(path):
    if not os.path.exists(path):
        print(f"File {path} does not exist for analysis.")
        return
    img = Image.open(path).convert("RGB")
    width, height = img.size
    print(f"Image {os.path.basename(path)} size: {width}x{height}")
    
    # Get pixel data and count colors
    colors = img.getcolors(width * height)
    if colors:
        print(f"Unique colors count: {len(colors)}")
        sorted_colors = sorted(colors, key=lambda x: x[0], reverse=True)
        print("Top 10 dominant colors (Count, (R, G, B)):")
        for count, color in sorted_colors[:10]:
            print(f"  {count}: {color}")
            
analyze_image(dest_1)
print("\n--- Screenshot 2 (No Mask, Forced Opacity) ---")
analyze_image(dest_2)
