import json, netCDF4, numpy as np, os
B = __import__('os').environ.get('JAC1_MOP_DIR', 'jac1_mop_work/')
T0=1640995200  # 2022-01-01
T1=1743465600  # 2025-04-01
spots=json.load(open(B+'spots.json'))
spots=[s for s in spots if s['name']!="Cowell's Beach"]
buoy={'Ocean Beach SF':'029p1','Pacifica - Linda Mar':'029p1','Capitola':'157p1','Pleasure Point':'157p1','Steamer Lane':'157p1','Carmel Beach':'157p1','Leadbetter Beach':'071p1','Sands Beach':'071p1','Rincon':'071p1','Mondos':'071p1','C Street Ventura':'071p1'}
for s in spots: s['buoy']=buoy.get(s['name'],'067p1')
json.dump(spots,open(B+'spots.json','w'),indent=1)
def bsearch(t,val):
    lo,hi=0,len(t)
    while lo<hi:
        m=(lo+hi)//2
        if int(t[m])<val: lo=m+1
        else: hi=m
    return lo
os.makedirs(B+'dl/npz',exist_ok=True)
for b in sorted(set(s['buoy'] for s in spots)):
    f=B+f'dl/npz/{b}.npz'
    if os.path.exists(f): continue
    d=netCDF4.Dataset(f'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/{b}/{b}_historic.nc')
    t=d['waveTime']; i0=bsearch(t,T0); i1=bsearch(t,T1)
    print(b,len(t),i0,i1)
    np.savez(f,t=np.asarray(t[i0:i1]),hs=np.ma.filled(d['waveHs'][i0:i1],np.nan),dp=np.ma.filled(d['waveDp'][i0:i1],np.nan),tp=np.ma.filled(d['waveTp'][i0:i1],np.nan),fl=np.ma.filled(d['waveFlagPrimary'][i0:i1],9))
    lat=float(d['metaStationLatitude'][:]) if 'metaStationLatitude' in d.variables else None
    lon=float(d['metaStationLongitude'][:]) if 'metaStationLongitude' in d.variables else None
    print(b,'loc',lat,lon,d['metaStationName'][:].tobytes().decode(errors='ignore').strip('\x00 ') if 'metaStationName' in d.variables else '')
for s in spots:
    m=s['mop']; f=B+f'dl/npz/{m}.npz'
    if os.path.exists(f): continue
    d=netCDF4.Dataset(f'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/{m}_hindcast.nc')
    i0=192864; sl=slice(i0,None,2)
    t=np.asarray(d['waveTime'][sl])
    np.savez(f,t=t,hs=np.ma.filled(d['waveHs'][sl],np.nan),dp=np.ma.filled(d['waveDp'][sl],np.nan),tp=np.ma.filled(d['waveTp'][sl],np.nan))
    print(m,len(t))
