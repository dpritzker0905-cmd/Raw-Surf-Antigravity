import urllib.request, json, time

url = 'https://raw-surf-antigravity.onrender.com/api/social-live/active?t=' + str(int(time.time()))
req = urllib.request.Request(url)
req.add_header('Cache-Control', 'no-cache')
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read())
    print('Active streams count:', data['count'])
    for s in data['streams']:
        print('  broadcaster:', s['broadcaster_name'], '  started:', s['started_at'], '  status:', s['status'])
