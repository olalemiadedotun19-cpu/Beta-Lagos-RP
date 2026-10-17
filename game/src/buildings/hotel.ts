// @ts-nocheck
/* Ported from historic-hotel.html (standalone viewer -> game module). Viewer scene/camera/lights/UI removed; geometry untouched.
   Local frame: origin = building centre, +z = front/street side, y up, metres. Removed the viewer drop-shadow backdrop plane. */
import * as THREE from 'three';

export function buildHotel() {
const T=THREE,V=(a,b,c)=>Array.isArray(a)?new T.Vector3(...a):new T.Vector3(a,b,c),$=s=>document.querySelector(s);
const W=22,D=16,HW=18.5,HR=19.2;                      /* width, depth, wall height, roof deck level (metres) */
let seed=12345;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};

const renderer={capabilities:{getMaxAnisotropy:()=>4}};
const scene=new T.Group();
const aniso=Math.min(4,renderer.capabilities.getMaxAnisotropy());

/* ---------- textures ---------- */
const cvs=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c},tex=(c,srgb,rep)=>{const t=new T.CanvasTexture(c);t.anisotropy=aniso;if(srgb)t.colorSpace=T.SRGBColorSpace;if(rep)t.wrapS=t.wrapT=T.RepeatWrapping;return t};
function brick(){const c1=cvs(256,256),c2=cvs(256,256),a=c1.getContext('2d'),b=c2.getContext('2d');a.fillStyle='#a79587';a.fillRect(0,0,256,256);b.fillStyle='#303030';b.fillRect(0,0,256,256);
 for(let r=0;r<13;r++){const rh=256/13,off=(r%2)*32;for(let k=-1;k<5;k++){const x=k*64+off,y=r*rh;a.fillStyle=`hsl(${10+rnd()*14},${32+rnd()*22}%,${26+rnd()*14}%)`;a.fillRect(x+1.5,y+1.5,61,rh-3);const g=150+rnd()*90|0;b.fillStyle=`rgb(${g},${g},${g})`;b.fillRect(x+1.5,y+1.5,61,rh-3)}}
 for(let i=0;i<500;i++){a.fillStyle=`rgba(${rnd()<.5?'0,0,0':'255,230,210'},${.04+rnd()*.06})`;a.fillRect(rnd()*256,rnd()*256,1+rnd()*3,1+rnd()*2)}
 return{map:tex(c1,true,true),bump:tex(c2,false,true)}}
const BR=brick(),brickM=new T.MeshStandardMaterial({map:BR.map,bumpMap:BR.bump,bumpScale:2.2,roughness:.92});
function noiseTex(base,speck,w,h,rep,patch){const c=cvs(w,h),g=c.getContext('2d');g.fillStyle=base;g.fillRect(0,0,w,h);
 for(let i=0;i<w*h/40;i++){g.fillStyle=`rgba(${speck},${.05+rnd()*.12})`;g.fillRect(rnd()*w,rnd()*h,1+rnd()*3,1+rnd()*3)}
 for(let i=0;i<patch;i++){const x=rnd()*w,y=rnd()*h,r=20+rnd()*60,gr=g.createRadialGradient(x,y,2,x,y,r);gr.addColorStop(0,rnd()<.5?'rgba(120,135,155,.35)':'rgba(10,12,16,.35)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2)}
 const t=tex(c,true,true);t.repeat.set(rep[0],rep[1]);return t}

/* ---------- facade overlays (windows, arches, storefront, weathering) drawn per face ---------- */
function facade(w,sp){const c=cvs(1024,1024),g=c.getContext('2d'),sx=1024/w,sy=1024/HW,X=m=>m*sx,Y=m=>1024-m*sy;
 for(let i=0;i<240;i++){const x=rnd()*1024,y=rnd()*820,a=.03+rnd()*.07,gr=g.createLinearGradient(0,y,0,y+360);gr.addColorStop(0,'rgba(25,12,8,0)');gr.addColorStop(.3,`rgba(25,12,8,${a})`);gr.addColorStop(1,'rgba(25,12,8,0)');g.fillStyle=gr;g.fillRect(x,y,3+rnd()*14,360)}
 for(let i=0;i<60;i++){g.fillStyle=`rgba(225,205,190,${.03+rnd()*.05})`;g.fillRect(rnd()*1024,rnd()*1024,10+rnd()*40,4+rnd()*14)}
 const gm=g.createLinearGradient(0,Y(0),0,Y(3));gm.addColorStop(0,'rgba(8,8,10,.6)');gm.addColorStop(1,'rgba(8,8,10,0)');g.fillStyle=gm;g.fillRect(0,Y(3),1024,Y(0)-Y(3));
 const path=(cx,y0,ww,hh,pad,arch)=>{const l=X(cx-ww/2-pad),r=X(cx+ww/2+pad),b=Y(y0-pad);g.beginPath();
  if(arch){const rho=ww/2+pad,cy=Y(y0+hh+pad-rho);g.moveTo(l,b);g.lineTo(l,cy);g.ellipse((l+r)/2,cy,rho*sx,rho*sy,0,Math.PI,2*Math.PI);g.lineTo(r,b)}
  else{g.moveTo(l,b);g.lineTo(l,Y(y0+hh+pad));g.lineTo(r,Y(y0+hh+pad));g.lineTo(r,b)}g.closePath()};
 function win(cx,y0,ww,hh,arch,lit){path(cx,y0,ww,hh,.17,arch);g.fillStyle=arch?'#9a6a5e':'#8f9aa7';g.fill();path(cx,y0,ww,hh,.09,arch);g.fillStyle='#8f9aa7';g.fill();path(cx,y0,ww,hh,.04,arch);g.fillStyle='#14171b';g.fill();
  path(cx,y0,ww,hh,0,arch);const gr=g.createLinearGradient(0,Y(y0+hh),0,Y(y0));gr.addColorStop(0,lit?'#ffd496':'#6f8399');gr.addColorStop(1,lit?'#b8641f':'#2a3545');g.fillStyle=gr;g.fill();
  g.save();path(cx,y0,ww,hh,0,arch);g.clip();g.fillStyle='rgba(0,0,0,.32)';g.fillRect(X(cx-ww/2),Y(y0+hh),X(ww),X(.32));g.fillStyle='rgba(0,0,0,.2)';g.fillRect(X(cx-ww/2),Y(y0+hh),X(.1),Y(y0)-Y(y0+hh));
  g.fillStyle='#101215';g.fillRect(X(cx)-2,Y(y0+hh),4,Y(y0)-Y(y0+hh));g.fillRect(X(cx-ww/2),Y(y0+hh*.58)-2,X(ww),4);g.fillRect(X(cx-ww/2),Y(y0+hh*.3)-1.5,X(ww),3);g.restore();
  g.fillStyle='#aab4bf';g.fillRect(X(cx-ww/2-.24),Y(y0-.02),X(ww+.48),X(.16));g.fillStyle='rgba(0,0,0,.35)';g.fillRect(X(cx-ww/2-.2),Y(y0-.02)+X(.16),X(ww+.4),X(.1));
  if(!arch){g.fillStyle='#8f9aa7';g.fillRect(X(cx-ww/2-.3),Y(y0+hh+.2)-X(.1),X(ww+.6),X(.3))}}
 const door=(cx,ww,hh,y0)=>{path(cx,y0,ww,hh,.2,true);g.fillStyle='#8f9aa7';g.fill();path(cx,y0,ww,hh,0,true);g.fillStyle='#2e1c12';g.fill();g.save();path(cx,y0,ww,hh,0,true);g.clip();
  const gr=g.createLinearGradient(0,Y(y0+hh),0,Y(y0+hh-.9));gr.addColorStop(0,'#ffcf8a');gr.addColorStop(1,'#a85a1c');g.fillStyle=gr;g.fillRect(X(cx-ww/2),Y(y0+hh),X(ww),X(.9));g.fillStyle='#120a06';g.fillRect(X(cx)-2,Y(y0+hh),4,Y(y0)-Y(y0+hh));g.fillRect(X(cx-ww/2),Y(y0+hh-.9)-2,X(ww),4);g.restore()};
 const sills=[5.9,8.9,11.9];
 sp.typ.forEach(cx=>sills.forEach(s=>win(cx,s,1.25,2.5,!sp.rect,rnd()<.08)));
 sp.top.forEach(cx=>win(cx,16.2,.95,1.75,true,false));
 if(sp.gw)sp.gw.forEach(cx=>win(cx,1.3,.9,1.7,true,false));
 if(sp.door)door(sp.door,1.3,2.8,.25);
 if(sp.service){door(sp.service,1.2,2.3,.25);[3.5,7,16,19].forEach(cx=>{g.fillStyle='#262a30';g.fillRect(X(cx-.5),Y(2.2),X(1),X(.7));for(let k=0;k<6;k++){g.fillStyle='#454b54';g.fillRect(X(cx-.5),Y(2.2)+k*X(.11),X(1),2)}})}
 if(sp.store){const x0=3.5,x1=15.2,yb=.45,yt=3.95;g.fillStyle='#0b0b0d';g.fillRect(X(x0-.18),Y(yt+.1),X(x1-x0+.36),Y(yb-.1)-Y(yt+.1));
  const n=3,pw=(x1-x0)/n;for(let i=0;i<n;i++){const l=X(x0+i*pw+.12),r=X(x0+(i+1)*pw-.12),t1=Y(3.05),b1=Y(yb+.55),gr=g.createLinearGradient(0,t1,0,b1);gr.addColorStop(0,'#ffc477');gr.addColorStop(.6,'#c8782e');gr.addColorStop(1,'#4a2410');g.fillStyle=gr;g.fillRect(l,t1,r-l,b1-t1);
   for(let k=0;k<7;k++){g.fillStyle=`rgba(30,14,6,${.35+rnd()*.3})`;g.fillRect(l+rnd()*(r-l-30),b1-X(.2+rnd()*.9)*(sy/sx),12+rnd()*34,X(.3+rnd()*.5)*(sy/sx))}
   for(let k=0;k<3;k++){const lx=l+(r-l)*(.2+k*.3),ly=t1+X(.4),rg=g.createRadialGradient(lx,ly,1,lx,ly,40);rg.addColorStop(0,'rgba(255,240,200,.95)');rg.addColorStop(1,'rgba(255,200,120,0)');g.fillStyle=rg;g.fillRect(lx-40,ly-40,80,80)}
   g.fillStyle='#16110d';g.fillRect(l,Y(3.35),r-l,Y(3.05)-Y(3.35));g.fillStyle='#3d4b5c';g.fillRect(l,Y(3.8),r-l,Y(3.35)-Y(3.8))}
  g.fillStyle='#08080a';g.fillRect(X(x0-.18),Y(yb+.55),X(x1-x0+.36),Y(yb-.1)-Y(yb+.55))}
 return tex(c,true)}

/* ---------- scene: ground, building masses ---------- */
const S=(col,r=.9,m=0)=>new T.MeshStandardMaterial({color:col,roughness:r,metalness:m}),stoneM=S(0x8c97a4,.9),roseM=S(0xb98f86,.9),darkM=S(0x15171a,.6,.3),metalM=S(0xbfc4c9,.5,.6),whiteM=S(0xe6e8ea,.7);
const add=(o,x,y,z,p)=>{o.position.set(x,y,z);(p||scene).add(o);return o},box=(w,h,d,m,x,y,z,p)=>add(new T.Mesh(new T.BoxGeometry(w,h,d),m),x,y,z,p),cyl=(r,h,m,x,y,z,p,s)=>add(new T.Mesh(new T.CylinderGeometry(r,r,h,s||16),m),x,y,z,p);
const walk=noiseTex('#3b3e44','220,225,235',512,512,[7,5],26),sidewalk=box(31,.3,24,new T.MeshStandardMaterial({map:walk,roughness:.55}),.5,-.15,.6);
box(W-.2,HW,D-.2,S(0x7b4a3d),0,HW/2,0);
function face(w,t,x,z,ry){const g=new T.Group();g.position.set(x,HW/2,z);g.rotation.y=ry;const bg=new T.PlaneGeometry(w,HW),uv=bg.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w,uv.getY(i)*HW);g.add(new T.Mesh(bg,brickM));
 const o=new T.Mesh(new T.PlaneGeometry(w,HW),new T.MeshStandardMaterial({map:t,transparent:true,roughness:.85,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,depthWrite:false}));o.position.z=.05;o.renderOrder=2;g.add(o);scene.add(g)}
face(W,facade(W,{typ:[2.6,5.9,9.2,12.5,15.8],top:[1.4,3.5,5.3,7,8.8,10.7,13,16.9],store:true}),0,D/2,0);
face(D,facade(D,{typ:[2,5,8,11,14],top:[1.4,3.3,5.2,7.1,9,10.9,12.8,14.7],gw:[5,8,11,14],door:2}),W/2,0,Math.PI/2);
face(W,facade(W,{typ:[2.5,5.5,8.5,11.5,14.5,17.5,20.5],top:[3,8,14,19],rect:true,service:11.5}),0,-D/2,Math.PI);
face(D,facade(D,{typ:[2,5,8,11,14],top:[1.4,3.3,5.2,7.1,9,10.9,12.8,14.7],gw:[2,5,8,11,14]}),-W/2,0,-Math.PI/2);
box(W+.2,.6,D+.2,S(0x6c727a,.95),0,.3,0);box(W+.3,.5,D+.3,stoneM,0,4.85,0);box(W+.3,.5,D+.3,stoneM,0,15.25,0);
box(W+.5,.35,D+.5,S(0x7e4a3c),0,18.675,0);box(W+.8,.3,D+.8,S(0x8a5546),0,19.0,0);
[[W+.8,.4,0,D/2+.2],[W+.8,.4,0,-D/2-.2]].forEach(([w,t,x,z])=>{box(w,1.1,t-.02,S(0x7e4a3c),x,19.65,z);box(w+.1,.12,t+.1,roseM,x,20.26,z)});
[W/2+.2,-W/2-.2].forEach(x=>{box(.38,1.1,D+.8,S(0x7e4a3c),x,19.65,0);box(.5,.12,D+.9,roseM,x,20.26,0)});
const roofM=new T.MeshStandardMaterial({map:noiseTex('#2e3540','210,220,235',512,512,[5,4],34),roughness:.95});box(W+.4,.1,D+.4,roofM,0,HR-.05,0);

/* ---------- HOTEL sign, awning, entrance ---------- */
{const sx=W/2-1.2,sz=D/2+.18,g=new T.Group();g.position.set(sx,0,sz);scene.add(g);box(1.7,13.4,.3,S(0x0e0f12,.5,.4),0,10.1,0,g);[-.7,.7].forEach(x=>box(.08,13.4,.4,darkM,x,10.1,.02,g));
 for(let i=0;i<14;i++)box(1.7,.05,.34,darkM,0,3.6+i*.95,.02,g);
 [...'HOTEL'].forEach((ch,i)=>{const c=cvs(128,192),x=c.getContext('2d');x.fillStyle='#f2f3f5';x.font='bold 168px "Arial Narrow",Arial,sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(ch,64,100);
  const m=new T.Mesh(new T.PlaneGeometry(1.15,1.72),new T.MeshBasicMaterial({map:tex(c,true),transparent:true}));add(m,0,15.8-i*2.55,.3,g)});
 const aw=add(new T.Mesh(new T.CylinderGeometry(1.5,1.5,.14,28,1,false,0,Math.PI),S(0xd7dadd,.6)),sx-1.4,3.2,D/2+.2);aw.rotation.y=-Math.PI/2;aw.rotation.z=0;
 box(2.4,.18,1.6,stoneM,sx-1.4,.1,D/2+.9);box(2.8,.18,1.9,stoneM,sx-1.4,.0,D/2+1.0)}

/* ---------- rooftop machinery ---------- */
function rail(x0,z0,x1,z1,y){const L=Math.hypot(x1-x0,z1-z0),n=Math.max(1,Math.round(L/.9)),a=Math.atan2(x1-x0,z1-z0);for(let i=0;i<=n;i++)cyl(.03,1.05,darkM,x0+(x1-x0)*i/n,y+.52,z0+(z1-z0)*i/n,scene,6);
 [.5,1.05].forEach(h=>{const r=box(.05,.05,L,darkM,(x0+x1)/2,y+h,(z0+z1)/2);r.rotation.y=a})}
function skylight(x,z,w,d){box(w,.25,d,S(0x6d7580,.8),x,HR+.12,z);const s=new T.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(0,.75);s.closePath();const g=new T.ExtrudeGeometry(s,{depth:d-.2,bevelEnabled:false});g.translate(0,0,-(d-.2)/2);
 add(new T.Mesh(g,new T.MeshStandardMaterial({color:0x9db9cc,roughness:.1,metalness:.6,transparent:true,opacity:.75})),x,HR+.25,z);box(w+.05,.05,.06,metalM,x,HR+.26,z-d/2+.1);box(w+.05,.05,.06,metalM,x,HR+.26,z+d/2-.1)}
const PH={x:2.5,z:-5.3,w:11,d:5.4,h:3.2};
box(PH.w,PH.h,PH.d,S(0x7d4b3d),PH.x,HR+PH.h/2,PH.z);box(PH.w+.4,.2,PH.d+.4,S(0x8c929a),PH.x,HR+PH.h+.1,PH.z);box(PH.w+.45,.12,PH.d+.45,roseM,PH.x,HR+PH.h+.25,PH.z);
[-3.5,0,3.5].forEach(o=>box(.9,1.3,.05,S(0x1d232b,.3,.5),PH.x+o,HR+1.7,PH.z+PH.d/2+.03));
{const x0=PH.x-PH.w/2,x1=PH.x+PH.w/2,z0=PH.z-PH.d/2,z1=PH.z+PH.d/2,y=HR+PH.h+.3;rail(x0,z0,x1,z0,y);rail(x1,z0,x1,z1,y);rail(x1,z1,x0,z1,y);rail(x0,z1,x0,z0,y);
 for(let i=0;i<9;i++)box(.04,.04,.4,metalM,x0-.1,y+.1+i*.11,z1-.8);[-.15,.15].forEach(o=>box(.04,1.3,.04,metalM,x0-.1+o*0,y+.65,z1-.8+o*2));
 [[-1.4,-.6],[.3,-.6],[2.6,.2]].forEach(([dx,dz])=>{box(1.4,.5,1.4,whiteM,PH.x+dx,HR+PH.h+.55,PH.z+dz);cyl(.5,.08,S(0x2a2f36,.4,.7),PH.x+dx,HR+PH.h+.84,PH.z+dz,scene,20)})}
[[-8.3,-6,3.9,2.5],[-9.1,-1,2.1,2.1],[-9.1,1.6,2.1,2.1],[-4.7,.5,2.2,2.5],[-5.6,4.2,1.7,2.7],[-8.6,4.8,1.8,1.8]].forEach(a=>skylight(...a));
for(let i=0;i<5;i++){const x=2.6+i*1.1;box(1,1.15,2,whiteM,x,HR+.6,5.4);cyl(.34,.06,S(0x2a2f36,.4,.7),x,HR+1.2,5.4,scene,20)}
box(1.9,1.5,1.7,S(0xa9afb6,.6,.4),8.2,HR+.8,3.4);box(2.2,1.1,1.5,S(0xa9afb6,.6,.4),7.2,HR+.6,-.6);
{const t=add(new T.Mesh(new T.TorusGeometry(.65,.17,12,20,Math.PI/2),S(0xb9776b,.5,.4)),6.4,HR+.9,-1.2);t.rotation.y=Math.PI/2;box(1.6,.34,.34,S(0xb9776b,.5,.4),5.2,HR+.55,-1.85)}
[[3.2,2.2],[-1.8,5.2],[-2.6,-1.4],[9,6.5]].forEach(([x,z])=>{cyl(.22,.6,S(0xb0b5ba,.6,.4),x,HR+.3,z);cyl(.34,.08,S(0x9aa0a7,.6,.4),x,HR+.63,z)});
box(3.2,1.3,1,whiteM,7.3,HR+.7,1.8);box(3.2,1.3,1,whiteM,7.3,HR+.7,2.9);box(1.2,.9,1.2,S(0x9aa0a7,.6,.3),-7.8,HR+.5,-.2);

/* ---------- street furniture ---------- */
function lamp(x,z){cyl(.14,.5,darkM,x,.25,z);cyl(.05,3.3,darkM,x,1.9,z,scene,8);cyl(.2,.08,darkM,x,3.55,z);const l=cyl(.17,.4,S(0xffd9a0,.3),x,3.8,z);l.material.emissive=new T.Color(0xffc070);l.material.emissiveIntensity=.55;add(new T.Mesh(new T.ConeGeometry(.28,.28,12),darkM),x,4.1,z)}
function bench(x,z,ry){const g=new T.Group();g.position.set(x,0,z);g.rotation.y=ry;scene.add(g);const wood=S(0x6a4528,.8);box(1.6,.06,.45,wood,0,.45,0,g);box(1.6,.5,.06,wood,0,.75,-.22,g);[-.7,.7].forEach(o=>box(.06,.45,.45,darkM,o,.22,0,g))}
[[-12.5,10.5],[-4.5,11],[4.5,11],[12.5,11],[13.5,3],[13.5,-5],[13.5,-9.5],[-12.5,-9.5],[-8,-9.5],[8,-9.5],[-12.8,-2]].forEach(a=>lamp(...a));
[[-2.5,10.2,0],[2.8,10.2,0],[12.9,-1.5,-Math.PI/2],[12.9,5,-Math.PI/2],[-8,10.2,0]].forEach(a=>bench(...a));
[[10.5,10.3],[11.3,10.3],[12.1,10.3],[-11,10.4]].forEach(([x,z])=>cyl(.1,.8,darkM,x,.4,z,scene,10));cyl(.28,.8,S(0x2c3036,.6,.4),9,.4,10.6);
  return { group: scene };
}
