import os
#!/usr/bin/env python3
"""Bakes the Mixamo locomotion pack (12 FBX) into src/player/figure/assets/clips.json.
   python3 scripts/locomotion/bake_locomotion.py   (needs numpy + scipy; no three.js)
   - same retarget as scripts/bake-character.mjs: Mixamo local rotations copied bone-for-bone (same skeleton), hips position
     scaled to the figure, forward drift of the hips removed (the game moves the character)
   - turn clips: the hips yaw is moved out of the pose into a separate yaw curve (the game rotates the character with it)
   - jump: the hips rise above standing height is removed (the game's physics lifts the character)
   - idle / walk / run replace the old ones; offensive idle, fall pose and seated pose already in clips.json are kept"""
import sys, os, json, base64, re
import numpy as np
from scipy.spatial.transform import Rotation as Rot
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
from fbxconv import clip
from fk import fk, BONES, HIPS_BIND, ASSET_DIR
SRC=os.environ.get('LOCO_SRC', os.path.join(HERE,'..','character-src','locomotion'))
C_Y=94.02046617                      # source hips bind height (cm), as read from the FBX models
U=HIPS_BIND[1]/C_Y

FILES={ 'idle':'idle.fbx','walk':'walking.fbx','run':'running.fbx',
  'strafeWalkL':'left strafe walking.fbx','strafeWalkR':'right strafe walking.fbx',
  'strafeRunL':'left strafe.fbx','strafeRunR':'right strafe.fbx',
  'turn90L':'left turn 90.fbx','turn90R':'right turn 90.fbx','turn180L':'left turn.fbx','turn180R':'right turn.fbx',
  'jump':'jump.fbx'}
q5=lambda x: float(np.round(x,5))
def load(name):
    t,tr,_=clip(os.path.join(SRC,FILES[name]))
    q={k:v['q'].copy() for k,v in tr.items() if k in BONES}
    p=(tr['hips']['p']-np.array([0,C_Y,0]))*U+HIPS_BIND
    # remove forward drift of the hips (linear, first to last key)
    f=(t/t[-1])[:,None]; d=p[-1]-p[0]
    p[:,0]-=d[0]*f[:,0]; p[:,2]-=d[2]*f[:,0]
    return t,q,p
# three's GLTFLoader strips [ ] . : / from node names, and animation tracks bind by those sanitized names ('mixamorig:Hips' -> 'mixamorigHips')
bone_key=lambda k: re.sub(r'[\[\].:/]','',BONES[k]['name'])
def pack(t,q,p):
    out={'duration':q5(t[-1]),'times':[q5(x) for x in t],'q':{},'p':{}}
    for k,a in q.items():
        a=a/np.linalg.norm(a,axis=1,keepdims=True)
        # keep neighbouring quaternions on the same hemisphere
        for i in range(1,len(a)):
            if np.dot(a[i],a[i-1])<0: a[i]=-a[i]
        i16=np.round(a*32767).astype('<i2')
        out['q'][bone_key(k)]=base64.b64encode(i16.tobytes()).decode()
    out['p'][bone_key('hips')]=[float(np.round(x,4)) for x in p.reshape(-1)]
    return out
def hips_yaw(q):
    f=Rot.from_quat(q['hips']).apply([0,0,1]); return np.unwrap(np.arctan2(f[:,0],f[:,2]))

J=json.load(open(os.path.join(ASSET_DIR,'clips.json')))
old=J['clips']; clips={}; meta={'cycleM':{},'phase':{},'turn':{},'jump':{}}
for name in FILES:
    t,q,p=load(name)
    if name.startswith('turn'):
        psi=hips_yaw(q); dpsi=psi-psi[0]
        R=Rot.from_rotvec(np.stack([np.zeros_like(dpsi),-dpsi,np.zeros_like(dpsi)],1))
        p_y=p[:,1].copy()
        q['hips']=(R*Rot.from_quat(q['hips'])).as_quat()
        # rotate the hips offset about the figure's own hips position (not the origin): the turn ends with the pelvis exactly where the idle has it
        p=HIPS_BIND+R.apply(p-HIPS_BIND)
        p[:,1]=p_y
        meta['turn'][name]={'yaw':[q5(x) for x in dpsi],'total':q5(dpsi[-1])}
    if name=='jump':
        stand=p[0,1]; p[:,1]=np.minimum(p[:,1],stand)
        meta['jump']={'start':0.6,'takeoff':0.70,'land':1.35,'end':2.0}
    clips[name]=pack(t,q,p)
    if name in('walk','run','strafeWalkL','strafeWalkR','strafeRunL','strafeRunR'):
        raw_t,raw_q,_=None,None,None
for k in('off','air','sit','carEnter','carDrive','carExit'):
    if k in old: clips[k]=old[k]   # car clips come from bake_car_clips.py
old_car=J.get('meta',{}).get('car')
J['clips']=clips
# gait metrics measured by forward kinematics (see the numbers in the comments of FigureCharacter.ts)
sys.path.insert(0,HERE)
def raw_travel(name):
    t,tr,_=clip(os.path.join(SRC,FILES[name])); p=(tr['hips']['p']*U)
    return float(np.linalg.norm((p[-1]-p[0])[[0,2]]))
for n in('walk','run','strafeWalkL','strafeWalkR','strafeRunL','strafeRunR'): meta['cycleM'][n]=q5(raw_travel(n))
# phase offsets (fraction of a cycle) that line every gait clip's footfalls up with the walk's, from the left-minus-right foot height
def sig(name):
    t,q,p=load(name); W,_=fk(q,p); n=len(t)-1
    return W['leftfoot'][:n,1]-W['rightfoot'][:n,1]
def rs(s,m=240):
    x=np.linspace(0,1,len(s),endpoint=False); return np.interp(np.linspace(0,1,m,endpoint=False),np.r_[x,1],np.r_[s,s[0]])
ref=rs(sig('walk'))
for n in('walk','run','strafeWalkL','strafeWalkR','strafeRunL','strafeRunR'):
    S=rs(sig(n)); k=max(range(240),key=lambda k:np.dot(ref,np.roll(S,-k))); meta['phase'][n]=q5(k/240)
if old_car: meta['car']=old_car
J['meta']=meta
json.dump(J,open(os.path.join(ASSET_DIR,'clips.json'),'w'),separators=(',',':'))
print('clips.json',os.path.getsize(os.path.join(ASSET_DIR,'clips.json')),'bytes')
for k,c in clips.items(): print(f'  {k:12s} {c["duration"]:6.3f}s {len(c["times"]):4d} keys {len(c["q"]):3d} rotation tracks')
print('cycleM',meta['cycleM']); print('phase',meta['phase']); print({k:v['total'] for k,v in meta['turn'].items()})
