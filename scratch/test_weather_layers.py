import asyncio
import json
import base64
import time
import requests
import os
import sys

ARTIFACTS_DIR = r"C:\Users\dprit\.gemini\antigravity\brain\b983bf55-d87b-4849-864a-6aaf57190485"
LOG_FILE = os.path.join(r"C:\Users\dprit\Raw-Surf\scratch", "visual_test.log")
PORT = 9222

os.makedirs(ARTIFACTS_DIR, exist_ok=True)

cdp_message_counter = 0

def log(msg):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    print(formatted)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(formatted + "\n")

# Clear existing log
if os.path.exists(LOG_FILE):
    try:
        os.remove(LOG_FILE)
    except:
        pass

log("=== STARTING VISUAL TEST ===")

async def send_cdp_command(ws, method, params=None):
    global cdp_message_counter
    if params is None:
        params = {}
    cdp_message_counter += 1
    message_id = cdp_message_counter
    payload = {
        "id": message_id,
        "method": method,
        "params": params
    }
    log(f"Sending CDP Command: {method} (id={message_id})")
    await ws.send(json.dumps(payload))
    
    # Set a timeout for recv to prevent permanent hanging
    while True:
        try:
            response = await asyncio.wait_for(ws.recv(), timeout=5.0)
            log(f"Raw Response: {response[:300]}...")  # Log first 300 chars of raw response
            data = json.loads(response)
            if data.get("id") == message_id:
                log(f"Received response for id={message_id}")
                return data
            if "method" in data:
                # Skip notifications
                continue
        except asyncio.TimeoutError:
            log(f"Timeout waiting for response to {method} (id={message_id})")
            return None
        except Exception as e:
            log(f"Error in recv for {method}: {e}")
            raise e

async def evaluate_js(ws, expression):
    log(f"Evaluating JS expression...")
    res = await send_cdp_command(ws, "Runtime.evaluate", {
        "expression": expression,
        "returnByValue": True
    })
    if not res:
        return None
    result = res.get("result", {})
    if "exceptionDetails" in result:
        log(f"[-] JS Exception: {result['exceptionDetails']}")
        return None
    val = result.get("result", {}).get("value")
    log(f"JS Result: {val}")
    return val

async def capture_screenshot(ws, filename):
    filepath = os.path.join(ARTIFACTS_DIR, filename)
    log(f"Capturing screenshot: {filename}...")
    try:
        res = await send_cdp_command(ws, "Page.captureScreenshot", {"format": "png"})
        if res and "result" in res and "data" in res["result"]:
            img_data = base64.b64decode(res["result"]["data"])
            with open(filepath, "wb") as f:
                f.write(img_data)
            log(f"[+] Screenshot saved successfully: {filename} ({len(img_data)} bytes)")
        else:
            log(f"[-] Failed to capture screenshot {filename}: Invalid response")
    except Exception as e:
        log(f"[-] Screenshot capture error {filename}: {e}")

async def run_automation():
    import websockets
    
    try:
        log("Fetching pages from Chrome...")
        resp = requests.get(f"http://127.0.0.1:{PORT}/json")
        pages = resp.json()
        log(f"Found {len(pages)} pages/tabs")
        
        # Find dev--rawsurf.netlify.app page
        page = None
        for p in pages:
            if "dev--rawsurf.netlify.app" in p.get("url", ""):
                page = p
                break
                
        if not page:
            log("dev--rawsurf.netlify.app tab not found. Creating a new one...")
            resp = requests.put(f"http://127.0.0.1:{PORT}/json/new?url=https://dev--rawsurf.netlify.app")
            page = resp.json()
            log(f"New tab created with ID: {page.get('id')}")
            
        ws_url = page["webSocketDebuggerUrl"]
        log(f"Connecting to WebSocket: {ws_url}")
        
        async with websockets.connect(ws_url) as ws:
            log("WebSocket connected!")
            await send_cdp_command(ws, "Page.enable")
            await send_cdp_command(ws, "Runtime.enable")
            
            log("Overriding device metrics to desktop (1280x800)...")
            await send_cdp_command(ws, "Emulation.setDeviceMetricsOverride", {
                "width": 1280,
                "height": 800,
                "deviceScaleFactor": 1,
                "mobile": False
            })
            
            log("Navigating to https://dev--rawsurf.netlify.app to set origin...")
            await send_cdp_command(ws, "Page.navigate", {"url": "https://dev--rawsurf.netlify.app"})
            await asyncio.sleep(4)
            
            log("Injecting Premium Dev User session and Access Code into localStorage...")
            await evaluate_js(ws, """
                (() => {
                    const mockDevUser = {
                        id: 'dev-mock-user-id',
                        email: 'dev@rawsurf.com',
                        full_name: 'Dev User',
                        username: 'devuser',
                        role: 'user',
                        subscription_tier: 'premium',
                        is_admin: true
                    };
                    localStorage.setItem('raw-surf-user', JSON.stringify(mockDevUser));
                    localStorage.setItem('site_access_code', 'ITS1999AGAIN');
                    console.log('Session and Access Code injected!');
                    return 'Session and Access Code injected';
                })()
            """)
            await asyncio.sleep(1)
            
            log("Navigating to https://dev--rawsurf.netlify.app/map to bootstrap with Premium Dev User session...")
            await send_cdp_command(ws, "Page.navigate", {"url": "https://dev--rawsurf.netlify.app/map"})
            
            log("Waiting up to 20 seconds for map page and GFS button to initialize...")
            gfs_found = False
            for i in range(40):
                await asyncio.sleep(0.5)
                # Try to expand controls if they are collapsed
                expanded = await evaluate_js(ws, """
                    (() => {
                        const isExpanded = Array.from(document.querySelectorAll('span')).some(s => s.textContent.trim() === 'Weather');
                        if (isExpanded) return 'expanded';
                        const expandBtn = document.querySelector('[aria-label="Expand weather controls"]');
                        if (expandBtn) {
                            expandBtn.click();
                            return 'clicked_expand';
                        }
                        return 'not_found';
                    })()
                """)
                
                # Check if GFS button is in DOM
                gfs_btn = await evaluate_js(ws, """
                    (() => {
                        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toUpperCase().includes('GFS'));
                        return btn ? 'found' : 'not_found';
                    })()
                """)
                if gfs_btn == 'found':
                    log("[+] GFS button found!")
                    gfs_found = True
                    break
            
            if not gfs_found:
                log("[-] Warning: GFS button not found after 20 seconds polling.")
            await asyncio.sleep(2)
            
            # ---------------- SCENARIO 1: GFS FOG ----------------
            log("--- Scenario 1: GFS Fog ---")
            log("Clicking GFS model button...")
            await evaluate_js(ws, """
                (() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toUpperCase().includes('GFS'));
                    if (btn) { btn.click(); return 'GFS clicked'; }
                    return 'GFS button not found';
                })()
            """)
            await asyncio.sleep(1)
            
            log("Clicking Fog layer button...")
            await evaluate_js(ws, """
                (() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Fog'));
                    if (btn) { btn.click(); return 'Fog clicked'; }
                    return 'Fog button not found';
                })()
            """)
            await asyncio.sleep(3) # Wait 3 seconds for layer to initialize
            
            await capture_screenshot(ws, "screenshot_gfs_fog_immediate.png")
            
            log("Waiting 30 seconds for GFS Fog stability...")
            await asyncio.sleep(30)
            await capture_screenshot(ws, "screenshot_gfs_fog_30s.png")
            
            # ---------------- SCENARIO 2: EURO WAVES ----------------
            log("--- Scenario 2: EURO Waves ---")
            log("Clicking EURO model button...")
            await evaluate_js(ws, """
                (() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toUpperCase().includes('EURO'));
                    if (btn) { btn.click(); return 'EURO clicked'; }
                    return 'EURO button not found';
                })()
            """)
            await asyncio.sleep(1)
            
            log("Clicking Waves layer button...")
            await evaluate_js(ws, """
                (() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Waves'));
                    if (btn) { btn.click(); return 'Waves clicked'; }
                    return 'Waves button not found';
                })()
            """)
            await asyncio.sleep(3) # Wait for layer render
            
            await capture_screenshot(ws, "screenshot_euro_waves_immediate.png")
            
            log("Waiting 30 seconds for EURO Waves stability...")
            await asyncio.sleep(30)
            await capture_screenshot(ws, "screenshot_euro_waves_30s.png")
            
            # ---------------- SCENARIO 3: ICON PRESSURE ----------------
            log("--- Scenario 3: ICON Pressure ---")
            log("Clicking ICON model button...")
            await evaluate_js(ws, """
                (() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toUpperCase().includes('ICON'));
                    if (btn) { btn.click(); return 'ICON clicked'; }
                    return 'ICON button not found';
                })()
            """)
            await asyncio.sleep(1)
            
            log("Clicking Pressure layer button...")
            await evaluate_js(ws, """
                (() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Pressure'));
                    if (btn) { btn.click(); return 'Pressure clicked'; }
                    return 'Pressure button not found';
                })()
            """)
            await asyncio.sleep(3) # Wait for layer render
            
            await capture_screenshot(ws, "screenshot_icon_pressure_immediate.png")
            
            log("Waiting 30 seconds for ICON Pressure stability...")
            await asyncio.sleep(30)
            await capture_screenshot(ws, "screenshot_icon_pressure_30s.png")
            
            log("=== VISUAL TEST FINISHED SUCCESSFULLY ===")
            
    except Exception as e:
        log(f"[-] Fatal error in automation script: {e}")
        import traceback
        log(traceback.format_exc())

if __name__ == "__main__":
    asyncio.run(run_automation())
