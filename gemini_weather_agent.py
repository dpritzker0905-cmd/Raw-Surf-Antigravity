import os
import sys
import asyncio
from fastmcp import Client
from google import genai
from google.genai import types

# Workaround for a bug in google-genai 2.7.0 SDK's _mcp_utils.py:
# It assumes all schema values are dictionaries. We monkeypatch it to safely return primitives.
import google.genai._mcp_utils as mcp_utils
original_filter = mcp_utils._filter_to_supported_schema

def patched_filter(schema):
    if not isinstance(schema, dict):
        return schema
    return original_filter(schema)

mcp_utils._filter_to_supported_schema = patched_filter

# Specify the absolute path to our weather simulation FastMCP server
SERVER_PATH = r"c:\Users\dprit\Raw-Surf\weather_sim_mcp.py"

async def run_weather_agent():
    print("=== STARTING GEMINI WEATHER SIMULATION AGENT ===")
    
    # 1. Environment Verification
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[Error] GEMINI_API_KEY environment variable is not active.")
        print("\nTo run this agent, please set your Gemini API key in your terminal session:")
        print("  Windows (PowerShell):")
        print('     $env:GEMINI_API_KEY="your_api_key_here"')
        print("  macOS / Linux (Shell):")
        print('     export GEMINI_API_KEY="your_api_key_here"')
        print("\nGet a free API key at: https://aistudio.google.com/")
        sys.exit(1)
        
    print(f"Target MCP Server Path: {SERVER_PATH}")
    print("Starting FastMCP server subprocess and opening client session...")
    
    try:
        # 2. Spawn and connect to the local weather simulation server via stdio
        async with Client(SERVER_PATH) as mcp_client:
            print("[FastMCP] Connected successfully to local subprocess!")
            
            # Access the underlying FastMCP client session
            mcp_session = mcp_client.session
            
            # 3. Initialize the Google GenAI Client
            print("[Google GenAI] Connecting to Gemini API...")
            gemini_client = genai.Client()
            
            # Define a natural language prompt requiring tool usage
            prompt = (
                "Compare current surf conditions at Montara State Beach, Pacifica State Beach, and Mavericks "
                "based on their forecast datasets. Advise me on which location offers the cleanest shape "
                "and breaking heights, and detail the wind vector (onshore/offshore) at each spot."
            )
            
            print(f"\n[Agent Prompt]: '{prompt}'")
            print("\n[AI Execution] Streaming thoughts and orchestrating tool-use calls...")
            
            # 4. Stream response and pass FastMCP session directly as a Gemini tool
            response = await gemini_client.aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    tools=[mcp_session],  # Passes FastMCP session directly
                ),
            )
            
            print("\n=== GEMINI FORECAST ADVISOR REPORT ===")
            print(response.text)
            print("=======================================")
            
    except Exception as e:
        print("\n[Error] Weather Agent failed to execute:")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(run_weather_agent())
