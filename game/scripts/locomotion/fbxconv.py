import os
import numpy as np, sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from fbxanim import load, props, bname, KT
from scipy.spatial.transform import Rotation as Rot

def norm(s):
    import re
    s=re.sub(r'[^a-zA-Z0-9]','',s); s=re.sub(r'^mixamorig\d*','',s,flags=re.I); return s.lower()

# FBX euler order index -> scipy sequence (extrinsic, applied in listed order): FBX XYZ = rotate X, then Y, then Z (extrinsic) = matrix Rz*Ry*Rx
ORD={0:'xyz',1:'xzy',2:'yzx',3:'yxz',4:'zxy',5:'zyx'}

def euler_to_quat(deg, order):
    seq=ORD.get(order,'xyz')
    r=Rot.from_euler(seq,np.asarray(deg,float).reshape(-1,3)[:, [ 'xyz'.index(c) for c in seq ]], degrees=True)
    return r.as_quat()  # x,y,z,w  (scipy order)

def convert(path):
    D=load(path)
    models=D['models']
    id2name={i:bname(m) for i,m in models.items()}
    info={}
    for i,m in models.items():
        p=props(m)
        info[i]=dict(name=id2name[i],
            T=np.array(p.get('Lcl Translation',[0,0,0])[:3],float) if 'Lcl Translation' in p else np.zeros(3),
            R=np.array(p.get('Lcl Rotation',[0,0,0])[:3],float) if 'Lcl Rotation' in p else np.zeros(3),
            pre=np.array(p['PreRotation'][:3],float) if 'PreRotation' in p else None,
            order=int(p['RotationOrder'][0]) if 'RotationOrder' in p else 0,
            parent=D['parent'].get(i))
    # animation channels
    chan={}  # (modelid, 'R'|'T') -> {axis: (times, values)}
    for cnid,(mid,prop) in D['cn_target'].items():
        kind={'Lcl Rotation':'R','Lcl Translation':'T'}.get(prop)
        if not kind: continue
        for ax,cid in D['curve_of'].get(cnid,{}).items():
            c=D['curves'][cid]
            t=c.first('KeyTime').props[0]/KT; v=c.first('KeyValueFloat').props[0].astype(float)
            chan.setdefault((mid,kind),{})[ax[-1]]=(t,v)
    return D,info,chan

def sample(chan, mid, kind, default, times):
    out=np.tile(default,(len(times),1)).astype(float)
    ch=chan.get((mid,kind),{})
    for k,ax in enumerate('XYZ'):
        if ax in ch:
            t,v=ch[ax]; out[:,k]=np.interp(times,t,v)
    return out

def clip(path, fps=None):
    D,info,chan=convert(path)
    # master time grid = the densest curve
    best=None
    for (mid,kind),axes in chan.items():
        for ax,(t,v) in axes.items():
            if best is None or len(t)>len(best): best=t
    times=np.array(best)
    tracks={}  # normname -> dict(q=(N,4 xyzw), p=(N,3) for hips)
    for mid,inf in info.items():
        if (mid,'R') not in chan and (mid,'T') not in chan: continue
        R=sample(chan,mid,'R',inf['R'],times)
        q=euler_to_quat(R,inf['order'])
        if inf['pre'] is not None:
            qp=euler_to_quat(inf['pre'][None,:],inf['order'])[0]
            q=(Rot.from_quat(qp)*Rot.from_quat(q)).as_quat()
        e=dict(q=q,name=inf['name'],parent=inf['parent'])
        if (mid,'T') in chan or norm(inf['name'])=='hips':
            e['p']=sample(chan,mid,'T',inf['T'],times)
        tracks[norm(inf['name'])]=e
    return times,tracks,info
if __name__=='__main__':
    t,tr,info=clip(sys.argv[1])
    print(len(t),t[:3],t[-1]); 
    h=tr['hips']; print('hips pos start',h['p'][0],'end',h['p'][-1])
