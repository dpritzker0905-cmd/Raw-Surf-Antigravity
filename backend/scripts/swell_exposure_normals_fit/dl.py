import json, os, sys, time, numpy as np
from concurrent.futures import ProcessPoolExecutor, as_completed
S = __import__('os').environ.get('SEN_WORK_DIR', 'sen_work/').rstrip('/') + '/'   # work dir (keep out of git)
OLD=S+'jac1_mop/dl/npz/'; NEW=S+'normals/ext/npz/'
T0=1640995200; T1=1743465600
def bsearch(t,val):
    lo,hi=0,len(t)
    while lo<hi:
        m=(lo+hi)//2
        if int(t[m])<val: lo=m+1
        else: hi=m
    return lo
def get(kind,id_):
    import netCDF4
    f=NEW+f'{id_}.npz'
    for att in range(5):
        try:
            if kind=='buoy':
                d=netCDF4.Dataset(f'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/{id_}/{id_}_historic.nc')
                t=d['waveTime']; i0=bsearch(t,T0); i1=bsearch(t,T1)
                np.savez(f,t=np.asarray(t[i0:i1]),hs=np.ma.filled(d['waveHs'][i0:i1],np.nan),dp=np.ma.filled(d['waveDp'][i0:i1],np.nan),tp=np.ma.filled(d['waveTp'][i0:i1],np.nan),fl=np.ma.filled(d['waveFlagPrimary'][i0:i1],9))
            else:
                d=netCDF4.Dataset(f'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/{id_}_hindcast.nc')
                sl=slice(192864,None,2); t=np.asarray(d['waveTime'][sl])
                np.savez(f,t=t,hs=np.ma.filled(d['waveHs'][sl],np.nan),dp=np.ma.filled(d['waveDp'][sl],np.nan),tp=np.ma.filled(d['waveTp'][sl],np.nan))
            d.close(); return id_,'ok',att
        except Exception as e:
            err=str(e)[:120]; time.sleep(5*(att+1))
    return id_,'FAIL '+err,5
if __name__=='__main__':
    n=json.load(open(S+'normals/work/normals.json'))
    jobs=[('buoy',b) for b in ('094p1','168p1')]+[('mop',m) for m in sorted(set(x['mop'] for x in n))]
    jobs=[j for j in jobs if not os.path.exists(OLD+j[1]+'.npz') and not os.path.exists(NEW+j[1]+'.npz')]
    print(len(jobs),'to fetch',flush=True)
    with ProcessPoolExecutor(6) as ex:
        for fu in as_completed([ex.submit(get,*j) for j in jobs]): print(*fu.result(),flush=True)
