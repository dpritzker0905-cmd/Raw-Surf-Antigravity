import urllib.request
try:
    req = urllib.request.Request('https://raw-surf-backend.onrender.com/api/admin/spots/create?admin_id=fake', method='POST', headers={'User-Agent': 'Mozilla/5.0'})
    res = urllib.request.urlopen(req)
    print(res.read())
except Exception as e:
    print(e)
