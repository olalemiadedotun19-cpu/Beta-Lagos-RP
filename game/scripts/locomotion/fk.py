import os
import json,struct,sys
import numpy as np
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from scipy.spatial.transform import Rotation as Rot
from fbxconv import norm
import os
ASSET_DIR=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','src','player','figure','assets')
b=open(os.path.join(ASSET_DIR,'figure.glb'),'rb').read()
jl=struct.unpack_from('<I',b,12)[0]
G=json.loads(b[20:20+jl]); nodes=G['nodes']
BONES={}  # idx -> info
parent={}
for i,n in enumerate(nodes):
    for c in n.get('children',[]): parent[c]=i
order=[]
def isb(i): return nodes[i].get('name','').startswith('mixamorig')
for i,n in enumerate(nodes):
    if isb(i):
        BONES[norm(n['name'])]=dict(idx=i,T=np.array(n.get('translation',[0,0,0]),float),Q=np.array(n.get('rotation',[0,0,0,1]),float),
            parent=norm(nodes[parent[i]]['name']) if parent.get(i) is not None and isb(parent[i]) else None,name=n['name'])
# topological order
topo=[]; seen=set()
def visit(k):
    if k in seen: return
    p=BONES[k]['parent']
    if p: visit(p)
    seen.add(k); topo.append(k)
for k in BONES: visit(k)
HIPS_BIND=BONES['hips']['T'].copy()

def fk(quats, hips_pos, names=None):
    """quats: dict norm->(N,4 xyzw) ; hips_pos (N,3) metres. returns dict norm->(N,3) world positions and world quats"""
    N=len(hips_pos); W={}; WQ={}
    for k in topo:
        B=BONES[k]
        q=quats.get(k)
        lq=Rot.from_quat(q) if q is not None else Rot.from_quat(np.tile(B['Q'],(N,1)))
        if k=='hips': lt=hips_pos
        else: lt=np.tile(B['T'],(N,1))
        if B['parent'] is None:
            W[k]=lt; WQ[k]=lq
        else:
            pq=WQ[B['parent']]
            W[k]=W[B['parent']]+pq.apply(lt); WQ[k]=pq*lq
    return W,WQ
