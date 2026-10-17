// @ts-nocheck
/* Ported from Mixed-use_tower_complex___3D_viewer__1_.html (standalone viewer -> game module). Viewer scene/camera/lights/UI removed; geometry untouched.
   Local frame: origin = building centre, +z = front/street side, y up, metres. Plaza slab resized to the complex; ground/sky/sun/AO removed. Exposes setNight(0..1) for the facade lights. */
import * as THREE from 'three';

export function buildTowerComplex() {
/* ================= CONFIG: edit buildings here (metres) ================= */
const FLOOR=4;
const STYLES={ /* g=[hue,sat,light] glass, f=frame, sp=spandrel */
  blue :{g:[214,42,30],f:'#2a2f37',sp:'#3a4350',spH:.2,m:4},
  tall :{g:[208,62,40],f:'#1b2027',sp:'#27303b',spH:.14,m:5},
  light:{g:[212,26,36],f:'#cdd1d6',sp:'#b3b9c1',spH:.26,m:4},
  steel:{g:[216,30,32],f:'#8c949e',sp:'#6f7782',spH:.22,m:4}};
const CFG=[
 {id:'tall',x:-60,z:-10,w:26,d:36,h:208,style:'tall',bay:2,plinth:22,pc:0x3a322d},
 {id:'A',x:-4,z:-12,w:30,d:26,h:88,style:'blue',bay:2.6,tiers:[{dx:0,dz:0,w:30,d:26,h:88},{dx:-9,dz:9.5,w:12,d:10,h:64},{dx:10,dz:-5,w:9,d:12,h:104}]},
 {id:'B',x:24,z:-24,w:24,d:24,h:116,style:'light',bay:2.4,tiers:[{dx:0,dz:0,w:24,d:24,h:116},{dx:-14,dz:10,w:12,d:12,h:100},{dx:11,dz:8.5,w:10,d:13,h:84}]},
 {id:'C',x:42,z:-6,w:18,d:22,h:98,style:'light',bay:2.4,tiers:[{dx:0,dz:0,w:18,d:22,h:98},{dx:-6.5,dz:7,w:7,d:8,h:72}]},
 {id:'D',x:64,z:0,w:22,d:24,h:82,style:'steel',bay:2.5},
 {id:'E',x:88,z:-4,w:24,d:26,h:102,style:'light',bay:2.4,band:true},
 {id:'F',x:110,z:8,w:20,d:20,h:68,style:'blue',bay:2.4,plinth:10}];
const POD={x0:-84,x1:92,z0:6,z1:44,h:16};

/* ================= helpers ================= */
const rng=s=>()=>(s=(s*16807)%2147483647)/2147483647;
const cvs=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};

const T=THREE,isMobile=matchMedia('(pointer:coarse)').matches;
const renderer={capabilities:{getMaxAnisotropy:()=>8}};let night=false;const scene=new T.Group();
const aniso=Math.min(8,renderer.capabilities.getMaxAnisotropy());
const tx=(c,srgb=true,rx=1,ry=1)=>{const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=aniso;if(srgb)t.colorSpace=T.SRGBColorSpace;return t};
const std=(o)=>new T.MeshStandardMaterial(o);

/* ---------- sky, sun, environment (procedural) ---------- */

/* ---------- facade tiles: glass grid with mullions, spandrels, bump + night lights ---------- */
const tiles={},facadeMats=[];
function tile(k){
  if(tiles[k])return tiles[k];
  const s=STYLES[k],r=rng(k.length*977+3),N=512,C=64,cm=cvs(N,N),cb=cvs(N,N),ce=cvs(N,N),m=cm.getContext('2d'),b=cb.getContext('2d'),e=ce.getContext('2d');
  m.fillStyle=s.f;m.fillRect(0,0,N,N);b.fillStyle='#fff';b.fillRect(0,0,N,N);e.fillStyle='#000';e.fillRect(0,0,N,N);
  for(let j=0;j<8;j++)for(let i=0;i<8;i++){
    const x=i*C+s.m,y=j*C+3,w=C-s.m*2,sp=Math.round(C*s.spH),gh=C-sp-3,l=s.g[2]+(r()-.5)*14,h=s.g[0]+(r()-.5)*14;
    const gr=m.createLinearGradient(0,y,0,y+gh);gr.addColorStop(0,`hsl(${h},${s.g[1]}%,${l+14}%)`);gr.addColorStop(1,`hsl(${h},${s.g[1]}%,${l-6}%)`);
    m.fillStyle=gr;m.fillRect(x,y,w,gh);m.fillStyle=s.sp;m.fillRect(x,y+gh,w,sp);
    b.fillStyle='#222';b.fillRect(x,y,w,gh);b.fillStyle='#9a9a9a';b.fillRect(x,y+gh,w,sp);
    if(r()<.2){e.fillStyle=`hsl(${35+r()*15},90%,${58+r()*16}%)`;e.fillRect(x,y,w,gh)}
  }
  return tiles[k]={m:cm,b:cb,e:ce};
}
function facadeMat(k,nC,nR,shade){
  const t=tile(k),mk=(c,srgb)=>tx(c,srgb,nC/8,nR/8);
  const mat=std({map:mk(t.m,true),bumpMap:mk(t.b,false),bumpScale:1.4,emissiveMap:mk(t.e,true),emissive:0xffffff,emissiveIntensity:night?1.5:0,color:new T.Color(shade,shade,shade),roughness:.26,metalness:.55,envMapIntensity:1.15});
  facadeMats.push(mat);return mat;
}
const capSide=std({color:0xb4b9bf,roughness:.7}),capTop=std({color:0x666b72,roughness:.95}),mechM=std({color:0x8b9097,roughness:.6,metalness:.3});
const capMats=[capSide,capSide,capTop,capTop,capSide,capSide];
const stripe=(()=>{const c=cvs(64,64),g=c.getContext('2d');g.fillStyle='#d3d6da';g.fillRect(0,0,64,64);g.fillStyle='#9ea4ab';for(let y=0;y<64;y+=8)g.fillRect(0,y,64,2);return tx(c,true,6,2)})();
const bandM=std({map:stripe,roughness:.6});

/* ---------- towers ---------- */
const dm={};
function addDetail(g,c,t,cx,cz){
  const st=STYLES[c.style],fins=c.style==='tall'||c.style==='blue',m=dm[c.style]||(dm[c.style]=std({color:st.f,roughness:.45,metalness:.55}));
  const nC=Math.max(2,Math.round(t.w/c.bay)),nD=Math.max(2,Math.round(t.d/c.bay)),nR=Math.round(t.h/FLOOR),L=[],add=(...a)=>L.push(a);
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>add(cx+a*t.w/2,t.h/2,cz+b*t.d/2,.9,t.h,.9));
  if(fins){
    for(let i=1;i<nC;i++){const x=cx-t.w/2+i*t.w/nC;add(x,t.h/2,cz+t.d/2+.2,.28,t.h,.45);add(x,t.h/2,cz-t.d/2-.2,.28,t.h,.45)}
    for(let i=1;i<nD;i++){const z=cz-t.d/2+i*t.d/nD;add(cx+t.w/2+.2,t.h/2,z,.45,t.h,.28);add(cx-t.w/2-.2,t.h/2,z,.45,t.h,.28)}
    for(let k=10;k<nR;k+=10){const y=k*FLOOR;add(cx,y,cz+t.d/2+.2,t.w+.8,.9,.7);add(cx,y,cz-t.d/2-.2,t.w+.8,.9,.7);add(cx+t.w/2+.2,y,cz,.7,.9,t.d);add(cx-t.w/2-.2,y,cz,.7,.9,t.d)}
  }else for(let k=1;k<nR;k++){const y=k*FLOOR+.2;
    add(cx,y,cz+t.d/2+.15,t.w+.6,.4,.5);add(cx,y,cz-t.d/2-.15,t.w+.6,.4,.5);add(cx+t.w/2+.15,y,cz,.5,.4,t.d);add(cx-t.w/2-.15,y,cz,.5,.4,t.d)}
  const im=new T.InstancedMesh(new T.BoxGeometry(1,1,1),m,L.length),o=new T.Object3D();
  L.forEach((a,i)=>{o.position.set(a[0],a[1],a[2]);o.scale.set(a[3],a[4],a[5]);o.updateMatrix();im.setMatrixAt(i,o.matrix)});g.add(im);
}
function createSection(c,t){
  const nC=Math.max(2,Math.round(t.w/c.bay)),nD=Math.max(2,Math.round(t.d/c.bay)),nR=Math.round(t.h/FLOOR),f=(n,s)=>facadeMat(c.style,n,nR,s);
  const g=new T.Group(),cx=c.x+t.dx,cz=c.z+t.dz;
  const body=new T.Mesh(new T.BoxGeometry(t.w,t.h,t.d),[f(nD,.9),f(nD,.66),capTop,capTop,f(nC,1),f(nC,.78)]);
  body.position.set(cx,t.h/2,cz);g.add(body);
  const cap=new T.Mesh(new T.BoxGeometry(t.w+.8,1.2,t.d+.8),capMats);cap.position.set(cx,t.h+.6,cz);g.add(cap);
  const mech=new T.Mesh(new T.BoxGeometry(t.w*.36,3.6,t.d*.3),mechM);mech.position.set(cx+t.w*.12,t.h+3,cz-t.d*.1);g.add(mech);
  if(t.w>14){const m2=new T.Mesh(new T.BoxGeometry(t.w*.18,2.2,t.d*.22),mechM);m2.position.set(cx-t.w*.25,t.h+2.3,cz+t.d*.2);g.add(m2)}
  if(c.band&&t.dx===0&&t.dz===0){const b=new T.Mesh(new T.BoxGeometry(t.w+.6,16,t.d+.6),bandM);b.position.set(cx,t.h-8,cz);g.add(b)}
  addDetail(g,c,t,cx,cz);
  return g;
}
function createTower(c){
  const g=new T.Group();
  (c.tiers||[{dx:0,dz:0,w:c.w,d:c.d,h:c.h}]).forEach(t=>g.add(createSection(c,t)));
  const ph=c.plinth||10,pl=new T.Mesh(new T.BoxGeometry(c.w+3,ph,c.d+3),std({color:c.pc||0xa8adb3,roughness:.85}));
  pl.position.set(c.x,ph/2,c.z);g.add(pl);
  return g;
}

/* ---------- retail podium ---------- */
const P=POD,PW=P.x1-P.x0,PD=P.z1-P.z0,rP=rng(11);
const darkM=std({color:0x1c1f23,roughness:.45,metalness:.5}),colM=std({color:0x2b2f34,roughness:.5,metalness:.4});
function panelTex(w,h,base,seed){
  const c=cvs(w,h),g=c.getContext('2d'),r=rng(seed);g.fillStyle=base;g.fillRect(0,0,w,h);
  for(let x=0;x<w;){const pw=40+r()*110,v=Math.floor(r()*3);g.fillStyle=['#33373c','#24272b','#2d3136'][v];g.fillRect(x+1,2,pw-2,h-4);
    if(r()<.22){g.fillStyle='#4b5866';g.fillRect(x+8,h*.3,Math.max(10,pw-16),h*.14)}x+=pw}
  g.fillStyle='rgba(0,0,0,.45)';for(let y=0;y<h;y+=h/4)g.fillRect(0,y,w,2);
  return c;
}
function interior(i){
  const c=cvs(256,192),g=c.getContext('2d'),r=rng(i*31+5),gr=g.createLinearGradient(0,0,0,192);
  gr.addColorStop(0,'#fff6e0');gr.addColorStop(1,['#f3c58f','#efd3a4','#f4bfa0','#e9d3a0'][i%4]);g.fillStyle=gr;g.fillRect(0,0,256,192);
  for(let row=0;row<3;row++){const y=36+row*46;g.fillStyle='rgba(90,60,40,.75)';g.fillRect(8,y+38,240,4);
    for(let x=12;x<236;){const w=10+r()*18,h=14+r()*26;g.fillStyle=`hsl(${r()*360|0},${35+r()*35|0}%,${42+r()*28|0}%)`;g.fillRect(x,y+38-h,w,h);x+=w+3+r()*6}}
  g.fillStyle='rgba(255,255,255,.9)';for(let x=16;x<256;x+=64)g.fillRect(x,5,40,4);return c;
}
function signTex(i){
  const c=cvs(256,64),g=c.getContext('2d'),cols=['#c2185b','#1f6f8b','#2e7d32','#e65100','#37474f','#6a1b9a'],txt=['MODA','CAFÉ','TECH','MART','OPTIC','STYLE'];
  g.fillStyle=cols[i];g.fillRect(0,0,256,64);g.fillStyle='#fff';g.font='bold 34px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(txt[i],128,34);return c;
}
function adTex(c1,c2,c3,label){
  const c=cvs(256,256),g=c.getContext('2d'),gr=g.createLinearGradient(0,0,256,256);gr.addColorStop(0,c1);gr.addColorStop(.55,c2);gr.addColorStop(1,c3);g.fillStyle=gr;g.fillRect(0,0,256,256);
  g.fillStyle='rgba(255,255,255,.22)';g.beginPath();g.arc(170,100,70,0,7);g.fill();g.fillStyle='rgba(20,10,30,.35)';g.beginPath();g.ellipse(150,250,60,110,0,Math.PI,0);g.fill();
  if(label){g.fillStyle='#fff';g.font='bold 30px system-ui,sans-serif';g.textAlign='center';g.fillText(label,128,236)}return c;
}
const basicTex=c=>new T.MeshBasicMaterial({map:tx(c,true),toneMapped:false});
const signMats=[0,1,2,3,4,5].map(i=>basicTex(signTex(i)));
const frameM=std({color:0x14171a,roughness:.35,metalness:.7}),glassM=std({color:0xa9c4d8,roughness:.04,metalness:.3,transparent:true,opacity:.2,depthWrite:false,envMapIntensity:1.6}),winM=std({color:0x30506e,roughness:.12,metalness:.75,envMapIntensity:1.4});
const litM=new T.MeshBasicMaterial({color:0xfff1d0,toneMapped:false}),fxM=new T.MeshBasicMaterial({color:0xffffff,toneMapped:false}),mqM=new T.MeshBasicMaterial({color:0xffffff,toneMapped:false});
const bk=(c)=>new T.MeshBasicMaterial({color:c,toneMapped:false,side:T.BackSide}),sideW=bk(0xf0d9b0),ceilW=bk(0xfff4dc),floorW=bk(0xb98f5e);
const shopBox=[0,1,2,3].map(i=>[sideW,sideW,ceilW,floorW,sideW,new T.MeshBasicMaterial({map:tx(interior(i),true),toneMapped:false,side:T.BackSide})]);
const FR=[],LT=[],FX=[],MN=[],fr=(...a)=>FR.push(a),pal=[0xd96b4a,0x4a8fd9,0xe8c14a,0x6ac08a,0xb36ad9,0xe9e9e9,0xd94a7b];
const ADS=[['#ff3d81','#ff8a3d','#ffd166','NEW SEASON',-52,11,9,8.6],['#00bcd4','#3f51b5','#7e57c2','',-30,13.6,7.5,2.6],['#ff7043','#ffca28','#ef5350','',-14,13.6,7.5,2.6],['#26c6da','#66bb6a','#d4e157','',2,13.6,7.5,2.6],['#ab47bc','#ec407a','#ffa726','',18,13.6,7.5,2.6],['#42a5f5','#26a69a','#9ccc65','',34,13.6,7.5,2.6],['#ef5350','#ffa726','#fff176','',50,13.6,7.5,2.6],['#5c6bc0','#29b6f6','#80deea','',66,13.6,7.5,2.6]];
const inAd=(x,w)=>ADS.some(a=>Math.abs(a[4]-x)<(a[6]+w)/2+.3);
const at=(m,x,y,z)=>{m.position.set(x,y,z);return m};
function createShopfront(g,x,bw,i,rec){
  const iw=bw-.9,zf=rec?P.z1-7:P.z1-4,dp=3,gy=.4,gh=4.7,ns=m=>{m.userData.ns=1;return m};
  g.add(ns(at(new T.Mesh(new T.BoxGeometry(iw,gh,dp),shopBox[i%4]),x,gy+gh/2,zf-dp/2)));
  g.add(ns(at(new T.Mesh(new T.PlaneGeometry(iw,gh),glassM),x,gy+gh/2,zf+.04)));
  /* frame: kick plate, transoms, mullions */
  fr(x,gy+.3,zf+.08,iw,.6,.2);fr(x,gy+gh,zf+.06,iw,.14,.2);fr(x,3.6,zf+.05,iw,.1,.14);
  const n=Math.max(2,Math.round(iw/2.4));for(let k=0;k<=n;k++)fr(x-iw/2+k*iw/n,gy+gh/2,zf+.05,.1,gh,.16);
  /* glazed double door */
  const dx=x+((i*37)%5-2)*iw*.08;
  fr(dx-1,1.7,zf+.09,.1,2.6,.12);fr(dx,1.7,zf+.09,.06,2.6,.12);fr(dx+1,1.7,zf+.09,.1,2.6,.12);fr(dx,3,zf+.09,2.1,.12,.12);fr(dx,.75,zf+.09,2.1,.3,.14);fr(dx-.14,1.5,zf+.17,.05,.6,.05);fr(dx+.14,1.5,zf+.17,.05,.6,.05);
  /* piers / recess walls */
  [-1,1].forEach(s=>{const px=x+s*bw/2;if(rec)fr(px,3,(zf-1+P.z1)/2,.9,6,P.z1-zf+1);else fr(px,3,zf-.35,.9,6,1.3)});
  /* fascia sign + light strips */
  g.add(at(new T.Mesh(new T.BoxGeometry(iw-.4,.9,.35),signMats[i%6]),x,5.6,zf+.2));
  LT.push([x,5.05,zf+.5,iw-.6,.06,.12]);for(let k=-1;k<=1;k++)LT.push([x+k*iw/3,5.97,(zf+P.z1)/2,.4,.04,.4]);
  /* retail fixtures + mannequins */
  FX.push([x-iw*.25,gy+.65,zf-1.9,iw*.35,1.3,.6,pal[(i*3)%7]],[x+iw*.25,gy+.65,zf-1.9,iw*.35,1.3,.6,pal[(i*3+2)%7]],[x,gy+.4,zf-1,iw*.18,.8,1,pal[(i*5+1)%7]]);
  MN.push([x-iw*.34,zf-.8,pal[(i+3)%7]],[x+iw*.34,zf-.8,pal[(i+5)%7]]);
  /* upper facade window strip */
  if(i%3===0&&!inAd(x,bw-2)){const w=bw-2;g.add(ns(at(new T.Mesh(new T.PlaneGeometry(w,1.6),winM),x,11,P.z1+.06)));
    fr(x,11.85,P.z1+.1,w+.2,.16,.24);fr(x,10.15,P.z1+.1,w+.2,.16,.24);fr(x-w/2,11,P.z1+.1,.16,1.7,.24);fr(x+w/2,11,P.z1+.1,.16,1.7,.24);
    const m=Math.round(w/2.5);for(let k=1;k<m;k++)fr(x-w/2+k*w/m,11,P.z1+.09,.08,1.6,.14)}
}
function createRetailPodium(){
  const g=new T.Group(),cx=(P.x0+P.x1)/2,cz=(P.z0+P.z1)/2;
  const front=std({map:tx(panelTex(2048,128,'#25282c',4)),roughness:.55,metalness:.35}),sideT=tx(panelTex(512,128,'#26292d',9),true,PD/20,1),rearT=tx(panelTex(512,128,'#6c7077',13),true,PW/24,1);
  const side=std({map:sideT,roughness:.7}),rear=std({map:rearT,roughness:.85,color:0xbfc3c8}),roof=std({color:0x777c83,roughness:.95});
  const up=new T.Mesh(new T.BoxGeometry(PW,10,PD),[side,side,roof,darkM,front,rear]);up.position.set(cx,11,cz);g.add(up);
  const gb=new T.Mesh(new T.BoxGeometry(PW,6,PD-10),rear);gb.position.set(cx,3,P.z0+(PD-10)/2);g.add(gb);
  fr(P.x0-.4,3,P.z1-5,.8,6,10);fr(P.x1+.4,3,P.z1-5,.8,6,10);
  /* shop bays + clad columns */
  let x=P.x0+1,i=0;
  while(x<P.x1-5){let bw=[8,10,12,7,9][Math.floor(rP()*5)];if(x+bw>P.x1-1)bw=P.x1-1-x;if(bw<5)break;
    createShopfront(g,x+bw/2,bw,i,i%3===1);const col=new T.Mesh(new T.BoxGeometry(.9,6,.9),colM);col.position.set(x,3,P.z1-.6);g.add(col);fr(x,.65,P.z1-.6,1.3,.5,1.3);fr(x,5.85,P.z1-.6,1.3,.3,1.3);x+=bw;i++}
  const lc=new T.Mesh(new T.BoxGeometry(.9,6,.9),colM);lc.position.set(x,3,P.z1-.6);g.add(lc);
  /* facade relief: cornice, base band, ledges, vertical fins */
  fr(cx,15.7,P.z1+.3,PW+.6,.6,1);fr(cx,6.15,P.z1+.15,PW,.3,.4);
  for(let lx=P.x0+4;lx<P.x1;lx+=8)if(!inAd(lx,8))fr(lx,9,P.z1+.2,7.6,.22,.45);
  for(let fx=P.x0+2;fx<P.x1-1;fx+=3.4)if(!inAd(fx,.2))fr(fx,11.2,P.z1+.12,.14,9.2,.3);
  /* advertising screens with bezels */
  ADS.forEach(([a,b,c,l,ax,ay,aw,ah])=>{const m=new T.Mesh(new T.PlaneGeometry(aw,ah),basicTex(adTex(a,b,c,l)));m.position.set(ax,ay,P.z1+.34);m.userData.ns=1;g.add(m);fr(ax,ay,P.z1+.15,aw+.5,ah+.5,.3);LT.push([ax,ay-ah/2-.35,P.z1+.3,aw+.5,.08,.1])});
  /* instanced detail */
  const mk=(arr,mat,noShadow)=>{const im=new T.InstancedMesh(new T.BoxGeometry(1,1,1),mat,arr.length),o=new T.Object3D(),c=new T.Color();
    arr.forEach((a,k)=>{o.position.set(a[0],a[1],a[2]);o.scale.set(a[3],a[4],a[5]);o.updateMatrix();im.setMatrixAt(k,o.matrix);if(a[6]!==undefined)im.setColorAt(k,c.set(a[6]))});im.userData.ns=noShadow;g.add(im)};
  mk(FR,frameM);mk(LT,litM,1);mk(FX,fxM,1);
  const mb=new T.InstancedMesh(new T.CylinderGeometry(.22,.3,1.4,8),mqM,MN.length),mh=new T.InstancedMesh(new T.SphereGeometry(.17,10,8),new T.MeshBasicMaterial({color:0xe8dccd,toneMapped:false}),MN.length),o2=new T.Object3D(),c2=new T.Color();
  MN.forEach((a,k)=>{o2.position.set(a[0],1.1,a[1]);o2.updateMatrix();mb.setMatrixAt(k,o2.matrix);mb.setColorAt(k,c2.set(a[2]));o2.position.y=2.0;o2.updateMatrix();mh.setMatrixAt(k,o2.matrix)});
  mb.userData.ns=mh.userData.ns=1;g.add(mb,mh);
  /* roof parapet + equipment */
  const par=(w,d,px,pz)=>{const b=new T.Mesh(new T.BoxGeometry(w,1,d),colM);b.position.set(px,P.h+.5,pz);g.add(b)};
  par(PW+.4,.4,cx,P.z1-.1);par(PW+.4,.4,cx,P.z0+.1);par(.4,PD-.4,P.x0-.1+.2,cz);par(.4,PD-.4,P.x1+.1-.2,cz);
  for(let k=0;k<7;k++){const m=new T.Mesh(new T.BoxGeometry(5+rP()*5,2+rP()*2,4+rP()*4),mechM);m.position.set(P.x0+14+k*23,P.h+1.5,P.z0+8+rP()*24);g.add(m)}
  const sk=new T.Mesh(new T.BoxGeometry(34,.6,14),std({color:0x9aa7b3,roughness:.2,metalness:.5}));sk.position.set(8,P.h+.3,26);g.add(sk);
  /* forecourt: bollards, planters with shrubs, benches */
  const bx=[];for(let bxx=P.x0+3;bxx<P.x1;bxx+=5.5)bx.push(bxx);
  const bo=new T.InstancedMesh(new T.CylinderGeometry(.13,.13,1,10),std({color:0x2a2e33,roughness:.4,metalness:.6}),bx.length),o3=new T.Object3D();
  bx.forEach((v,k)=>{o3.position.set(v,.9,P.z1+9);o3.updateMatrix();bo.setMatrixAt(k,o3.matrix)});g.add(bo);
  const stone=std({color:0x8d9196,roughness:.8}),leaf=std({color:0x3c6e3a,roughness:1}),wood=std({color:0x8a6a48,roughness:.7}),sg=new T.IcosahedronGeometry(.9,1);
  for(let px=P.x0+14;px<P.x1-8;px+=22){
    const pl=new T.Mesh(new T.BoxGeometry(5,.7,1.6),stone);pl.position.set(px,.75,P.z1+9);g.add(pl);
    for(let k=-1;k<=1;k++){const sh=new T.Mesh(sg,leaf);sh.position.set(px+k*1.5,1.5,P.z1+9);sh.scale.set(1,.8,.9);g.add(sh)}
    const st=new T.Mesh(new T.BoxGeometry(2.4,.12,.6),wood);st.position.set(px+11,1,P.z1+9);g.add(st);
    const bb=new T.Mesh(new T.BoxGeometry(2.4,.5,.1),wood);bb.position.set(px+11,1.35,P.z1+8.7);g.add(bb);
    [-1,1].forEach(s=>{const lg=new T.Mesh(new T.BoxGeometry(.1,.6,.5),frameM);lg.position.set(px+11+s*1,.7,P.z1+9);g.add(lg)})}
  return g;
}

/* ---------- ground, roads, street furniture, background city ---------- */
const ctx=new T.Group(),world=new T.Group();scene.add(world,ctx);
const noiseTex=(base,n,rx,ry,seed)=>{const c=cvs(256,256),g=c.getContext('2d'),r=rng(seed);g.fillStyle=base;g.fillRect(0,0,256,256);for(let k=0;k<n;k++){g.fillStyle=`rgba(${r()<.5?'0,0,0':'255,255,255'},${.03+r()*.05})`;g.fillRect(r()*256,r()*256,2+r()*6,2+r()*6)}return tx(c,true,rx,ry)};
/* plaza slab + soft contact shadow: the only context left */
const plzC=cvs(128,128),pg=plzC.getContext('2d');pg.fillStyle='#b9bcbf';pg.fillRect(0,0,128,128);pg.strokeStyle='#8f9397';pg.lineWidth=2;pg.strokeRect(0,0,128,128);pg.beginPath();pg.moveTo(64,0);pg.lineTo(64,128);pg.moveTo(0,64);pg.lineTo(128,64);pg.lineWidth=1;pg.stroke();
const plz=new T.Mesh(new T.BoxGeometry(214,.4,88),std({map:tx(plzC,true,214/8,88/8),roughness:.8}));plz.position.set(18.75,.2,4.5);plz.receiveShadow=true;ctx.add(plz);

/* ---------- assemble ---------- */
CFG.forEach(c=>world.add(createTower(c)));
world.add(createRetailPodium());
world.traverse(o=>{if(o.isMesh&&!o.userData.ns){o.castShadow=true;o.receiveShadow=true}});
const setNight=(n)=>{night=n>0.5;facadeMats.forEach(m=>m.emissiveIntensity=1.5*n)};
return { group: world, setNight };
}
