import os
import struct, zlib, sys
import numpy as np

class Node:
    __slots__=('name','props','children')
    def __init__(s,name): s.name=name; s.props=[]; s.children=[]
    def find(s,name): return [c for c in s.children if c.name==name]
    def first(s,name):
        r=s.find(name); return r[0] if r else None

def parse(path):
    d=open(path,'rb').read()
    assert d[:20]==b'Kaydara FBX Binary  '
    ver=struct.unpack_from('<I',d,23)[0]
    wide = ver>=7500
    pos=27
    def read_node(pos):
        if wide:
            end,nprops,plen=struct.unpack_from('<QQQ',d,pos); pos+=24
        else:
            end,nprops,plen=struct.unpack_from('<III',d,pos); pos+=12
        nl=d[pos]; pos+=1
        if end==0: return None,pos
        n=Node(d[pos:pos+nl].decode('latin1')); pos+=nl
        for _ in range(nprops):
            t=chr(d[pos]); pos+=1
            if t in 'YCFDIL':
                fmt={'Y':'<h','C':'<?','F':'<f','D':'<d','I':'<i','L':'<q'}[t]
                v=struct.unpack_from(fmt,d,pos)[0]; pos+=struct.calcsize(fmt)
            elif t in 'fdilb':
                cnt,enc,clen=struct.unpack_from('<III',d,pos); pos+=12
                raw=d[pos:pos+clen]; pos+=clen
                if enc==1: raw=zlib.decompress(raw)
                dt={'f':'<f4','d':'<f8','i':'<i4','l':'<i8','b':'?'}[t]
                v=np.frombuffer(raw,dtype=dt,count=cnt)
            elif t in 'SR':
                l=struct.unpack_from('<I',d,pos)[0]; pos+=4
                raw=d[pos:pos+l]; pos+=l
                v=raw if t=='R' else raw.decode('latin1')
            else: raise ValueError(t)
            n.props.append(v)
        while pos<end:
            c,pos=read_node(pos)
            if c is None: break
            n.children.append(c)
        return n,end
    root=Node('root')
    while pos<len(d)-200:
        n,pos2=read_node(pos)
        if n is None: break
        root.children.append(n); pos=pos2
    return root

if __name__=='__main__':
    r=parse(sys.argv[1])
    def dump(n,ind=0,maxd=3):
        pr=[(p if not isinstance(p,(np.ndarray,bytes)) else f'<{type(p).__name__}{getattr(p,"shape","")}>') for p in n.props[:4]]
        print(' '*ind+n.name,pr)
        if ind//2<maxd:
            for c in n.children[:12]: dump(c,ind+2,maxd)
    for c in r.children: 
        if c.name in('FBXHeaderExtension','GlobalSettings','Objects','Connections','Takes','Definitions'):
            print(c.name,len(c.children))
    g=r.first('GlobalSettings'); dump(g,0,2)
    ob=r.first('Objects')
    from collections import Counter
    print(Counter(c.name+':'+str(c.props[2] if len(c.props)>2 else '') for c in ob.children))
