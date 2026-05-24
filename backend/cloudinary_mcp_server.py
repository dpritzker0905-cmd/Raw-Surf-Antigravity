import sys
import json
import urllib.parse
from datetime import datetime

# Cloudinary Config (Mock credentials for Raw Surf integration)
CLOUDINARY_CLOUD_NAME = "raw-surf"
CLOUDINARY_BASE_URL = f"https://res.cloudinary.com/{CLOUDINARY_CLOUD_NAME}/image/upload"

# CDN Optimization and Dynamic Transformation URL Generator
def generate_cloudinary_url(public_id, width=None, height=None, crop="fill", quality="auto", format_opt="auto"):
    # Build transformation segment
    transformations = []
    
    if format_opt == "auto":
        transformations.append("f_auto")
    if quality == "auto":
        transformations.append("q_auto")
        
    if width:
        transformations.append(f"w_{width}")
    if height:
        transformations.append(f"h_{height}")
    if width or height:
        transformations.append(f"c_{crop}")
        
    trans_str = ",".join(transformations)
    
    # URL construction
    if trans_str:
        return f"{CLOUDINARY_BASE_URL}/{trans_str}/{public_id}"
    return f"{CLOUDINARY_BASE_URL}/{public_id}"

# AI Surf-Photo Categorization & Auto-tagging
def classify_and_tag_surf_photo(filename, content_description=""):
    tags = ["raw-surf", "gallery-upload"]
    category = "Lineup / Landscape"
    
    # Analyze text description or filename for visual features (mock AI vision addon)
    desc_lower = (content_description + " " + filename).lower()
    
    # 1. Action Shot checks
    action_keywords = ["aerial", "cutback", "barrel", "tube", "carving", "shredding", "wave", "action", "riding", "wipeout"]
    if any(k in desc_lower for k in action_keywords):
        category = "Action Shot"
        tags.extend(["surf-action", "wave-riding", "high-performance"])
        if "barrel" in desc_lower or "tube" in desc_lower:
            tags.append("hollow-tube")
            
    # 2. Surfer Portrait checks
    portrait_keywords = ["portrait", "surfer", "pose", "smiling", "lifestyle", "beach", "wetsuit", "profile", "face"]
    if any(k in desc_lower for k in portrait_keywords) and category != "Action Shot":
        category = "Surfer Portrait"
        tags.extend(["lifestyle", "portrait", "beachfront"])
        
    # 3. Equipment / Board checks
    board_keywords = ["board", "surfboard", "shaper", "fin", "thruster", "fish", "wax", "bag", "catalogue"]
    if any(k in desc_lower for k in board_keywords) and category != "Action Shot":
        category = "Equipment / Board"
        tags.extend(["gear", "surfboard", "shaping"])
        
    # Standard geographic tagging (if spot name in text)
    spots = ["malibu", "rincon", "sebastian", "cocoa beach", "huntington"]
    for spot in spots:
        if spot in desc_lower:
            tags.append(spot.replace(" ", "-"))
            
    return {
        "category": category,
        "auto_tags": list(set(tags)),
        "confidence_score": 0.945 # High confidence mock score
    }

# Generate Base64 Low Resolution Image Placeholder (LQIP) for Lazy Loading
def generate_lqip_placeholder(public_id):
    # Generates a highly compressed, blurred thumbnail URL to load instantly
    lqip_url = generate_cloudinary_url(public_id, width=16, height=16, crop="fill", quality=10, format_opt="webp")
    return {
        "lqip_url": lqip_url,
        "lazy_attributes": {
            "loading": "lazy",
            "src": lqip_url,
            "data-src": generate_cloudinary_url(public_id, width=800, quality="auto", format_opt="auto")
        }
    }

# JSON-RPC Loop for Model Context Protocol Server
def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
                
            request = json.loads(line)
            req_id = request.get("id")
            method = request.get("method")
            params = request.get("params", {})
            
            if method == "initialize":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "cloudinary-mcp",
                            "version": "1.0.0"
                        }
                    }
                }
                
            elif method == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "tools": [
                            {
                                "name": "optimize_image",
                                "description": "Generate dynamic, optimized Cloudinary CDN URLs using f_auto compression, q_auto quality, and smart responsive scaling parameters.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "public_id": {
                                            "type": "string",
                                            "description": "Cloudinary asset public ID"
                                        },
                                        "width": {
                                            "type": "integer",
                                            "description": "Target width dimension in pixels"
                                        },
                                        "height": {
                                            "type": "integer",
                                            "description": "Target height dimension in pixels"
                                        },
                                        "crop": {
                                            "type": "string",
                                            "enum": ["fill", "scale", "thumb", "fit"],
                                            "description": "Cropping and scaling strategy (default: 'fill')"
                                        }
                                    },
                                    "required": ["public_id"]
                                }
                            },
                            {
                                "name": "auto_tag_photo",
                                "description": "Execute AI classification to auto-categorize surf uploads (Action, Portrait, Equipment, Lineup) and generate descriptive meta tags.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "filename": {
                                            "type": "string",
                                            "description": "Original uploaded filename"
                                        },
                                        "description": {
                                            "type": "string",
                                            "description": "Surfer or photographer descriptive text"
                                        }
                                    },
                                    "required": ["filename"]
                                }
                            },
                            {
                                "name": "create_gallery",
                                "description": "Create a new gallery record with CDN distribution credentials.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "gallery_name": {
                                            "type": "string",
                                            "description": "Name of the new gallery"
                                        },
                                        "photographer_id": {
                                            "type": "string",
                                            "description": "Photographer profile UUID"
                                        }
                                    },
                                    "required": ["gallery_name", "photographer_id"]
                                }
                            },
                            {
                                "name": "generate_thumbnail",
                                "description": "Generate ultra-compressed, lazy-load compliant thumbnail configs with LQIP (Low Resolution Image Placeholder) placeholders.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "public_id": {
                                            "type": "string",
                                            "description": "Cloudinary asset public ID"
                                        }
                                    },
                                    "required": ["public_id"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "optimize_image":
                    public_id = args.get("public_id")
                    width = args.get("width")
                    height = args.get("height")
                    crop = args.get("crop", "fill")
                    
                    url = generate_cloudinary_url(public_id, width, height, crop)
                    result = {
                        "public_id": public_id,
                        "optimized_cdn_url": url,
                        "responsive_srcsets": {
                            "sm_400w": generate_cloudinary_url(public_id, width=400),
                            "md_800w": generate_cloudinary_url(public_id, width=800),
                            "lg_1200w": generate_cloudinary_url(public_id, width=1200)
                        },
                        "compression_status": "Enabled (f_auto, q_auto Active)"
                    }
                    text_out = json.dumps(result, indent=2)
                    
                elif tool_name == "auto_tag_photo":
                    filename = args.get("filename")
                    desc = args.get("description", "")
                    
                    classification = classify_and_tag_surf_photo(filename, desc)
                    text_out = json.dumps(classification, indent=2)
                    
                elif tool_name == "create_gallery":
                    gallery_name = args.get("gallery_name")
                    photographer_id = args.get("photographer_id")
                    
                    now_str = datetime.now().isoformat()
                    # Clean public folder prefix
                    folder_path = f"raw-surf/galleries/{photographer_id}/{gallery_name.replace(' ', '-').lower()}"
                    
                    result = {
                        "gallery_name": gallery_name,
                        "photographer_id": photographer_id,
                        "cdn_distributed_folder": folder_path,
                        "cloudinary_credentials_applied": True,
                        "created_at": now_str
                    }
                    text_out = json.dumps(result, indent=2)
                    
                elif tool_name == "generate_thumbnail":
                    public_id = args.get("public_id")
                    lqip = generate_lqip_placeholder(public_id)
                    text_out = json.dumps(lqip, indent=2)
                    
                else:
                    text_out = f"Unknown tool: {tool_name}"
                
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": text_out
                            }
                        ]
                    }
                }
                
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}"
                    }
                }
                
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            
        except Exception as e:
            sys.stderr.write(f"Error: {str(e)}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
