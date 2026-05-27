import asyncio
import json
import requests
import websockets

PORT = 9222

async def inspect():
    resp = requests.get(f"http://127.0.0.1:{PORT}/json")
    pages = resp.json()
    page = None
    for p in pages:
        if "localhost:3001" in p.get("url", ""):
            page = p
            break
    if not page:
        print("No active localhost:3001 page found")
        return
        
    ws_url = page["webSocketDebuggerUrl"]
    async with websockets.connect(ws_url) as ws:
        payload = {
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {
                "expression": "JSON.stringify({ url: window.location.href, site_access_code: localStorage.getItem('site_access_code'), raw_surf_user: localStorage.getItem('raw-surf-user'), bodyText: document.body.innerText.substring(0, 500) })",
                "returnByValue": True
            }
        }
        await ws.send(json.dumps(payload))
        resp = await ws.recv()
        data = json.loads(resp)
        result = data.get("result", {}).get("result", {}).get("value")
        if result:
            info = json.loads(result)
            print("=== LOCALSTORAGE & DOM INSPECTION ===")
            print(f"URL: {info['url']}")
            print(f"site_access_code in localStorage: {info['site_access_code']}")
            print(f"raw-surf-user in localStorage: {info['raw_surf_user']}")
            print(f"Body text: {info['bodyText']}")
        else:
            print("Failed to evaluate DOM")

if __name__ == "__main__":
    asyncio.run(inspect())
