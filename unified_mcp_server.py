import re
import uiautomation as auto
from typing import Dict, Any, List
from fastmcp import FastMCP

# Initialize the unified FastMCP server
mcp = FastMCP("Unified Utility Server")

@mcp.tool
def analyze_text(
    text: str,
    max_tokens: int = 100,
    language: str | None = None
) -> dict:
    """Analyze the provided text.
    
    Calculates character, word, and sentence counts, estimates reading time,
    identifies prominent keywords, and returns a summary snippet capped by max_tokens.
    """
    if not text:
        return {
            "error": "No text provided",
            "character_count": 0,
            "word_count": 0,
            "sentence_count": 0,
            "estimated_reading_time_seconds": 0.0,
            "top_keywords": []
        }

    # Counts
    char_count = len(text)
    words = re.findall(r'\b\w+\b', text.lower())
    word_count = len(words)
    sentences = re.split(r'[.!?]+', text)
    sentence_count = len([s for s in sentences if s.strip()])
    
    # Reading time calculation (assuming average reading speed of 200 WPM)
    reading_time_seconds = round((word_count / 200) * 60, 1)
    
    # Extract keywords (ignoring common English stop words and short terms)
    stop_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'in', 'on', 'at', 'to', 'for', 'of', 'by', 'with', 'about', 'as', 'into', 'like', 'through',
        'after', 'before', 'between', 'under', 'over', 'from', 'up', 'down', 'out', 'off', 'this',
        'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'he', 'him', 'his', 'she',
        'her', 'hers', 'we', 'us', 'our', 'you', 'your', 'yours', 'i', 'me', 'my', 'mine'
    }
    
    keywords = {}
    for word in words:
        if len(word) > 3 and word not in stop_words:
            keywords[word] = keywords.get(word, 0) + 1
            
    # Sort and take top 5 keywords
    sorted_keywords = sorted(keywords.items(), key=lambda x: x[1], reverse=True)[:5]
    
    # Generate snippet
    summary_snippet = text[:max_tokens]
    if len(text) > max_tokens:
        summary_snippet += "..."

    return {
        "language_specified": language,
        "character_count": char_count,
        "word_count": word_count,
        "sentence_count": sentence_count,
        "estimated_reading_time_seconds": reading_time_seconds,
        "top_keywords": [kw for kw, count in sorted_keywords],
        "summary_snippet": summary_snippet
    }

@mcp.tool(run_in_thread=False)
def list_windows() -> list[str]:
    """List desktop windows via Windows UI Automation (COM)."""
    try:
        desktop = auto.GetRootControl()
        children = desktop.GetChildren()
        # Cap to top 5 windows to prevent overwhelming the response
        return [w.Name for w in children[:5] if w.Name]
    except Exception as e:
        return [f"Error listing windows: {str(e)}"]

if __name__ == "__main__":
    # Start the unified FastMCP server
    mcp.run()
