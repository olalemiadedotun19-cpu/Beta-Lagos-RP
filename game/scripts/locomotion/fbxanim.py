import os
import numpy as np, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from fbxparse import parse
KT=46186158000.0

def props(n):
    out={}
    p70=n.first('Properties70')
    if p70:
        for p in p70.children:
            if p.name=='P': out[p.props[0]]=p.props[4:]
    return out

def load(path):
    r=parse(path)
    ob=r.first('Objects'); cn=r.first('Connections')
    models={}; curves={}; cnodes={}
    for n in ob.children:
        if n.name=='Model': models[n.props[0]]=n
        elif n.name=='AnimationCurve': curves[n.props[0]]=n
        elif n.name=='AnimationCurveNode': cnodes[n.props[0]]=n
    # connections: C, 'OO'/'OP', child, parent, [prop]
    parent={}; cn_target={}; curve_of={}
    for c in cn.children:
        if c.name!='C': continue
        t=c.props[0]; a=c.props[1]; b=c.props[2]
        if t=='OO' and a in models and b in models: parent[a]=b
        if t=='OP' and a in cnodes and b in models: cn_target[a]=(b,c.props[3])
        if t=='OP' and a in curves and b in cnodes: curve_of.setdefault(b,{})[c.props[3]]=a
    return dict(models=models,curves=curves,cnodes=cnodes,parent=parent,cn_target=cn_target,curve_of=curve_of)

def bname(n): return n.props[1].split('\x00')[0]

if __name__=='__main__':
    for f in sorted(os.listdir('/home/claude/loco')):
        if not f.endswith('.fbx'): continue
        D=load('/home/claude/loco/'+f)
        names=[bname(m) for m in D['models'].values()]
        t0=1e18;t1=-1e18;nk=set()
        for c in D['curves'].values():
            kt=c.first('KeyTime').props[0]/KT
            t0=min(t0,kt[0]);t1=max(t1,kt[-1]);nk.add(len(kt))
        pm=props(next(iter(D['models'].values())))
        print(f"{f:28s} bones={len(names)} curves={len(D['curves'])} t=[{t0:.3f},{t1:.3f}] keycounts={sorted(nk)} root={names[0]}")
