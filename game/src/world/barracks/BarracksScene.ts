// @ts-nocheck
/* The Independence Barracks cantonment, ported from the standalone barracks scene to the game's three.js.
 * Local frame: origin = compound centre, main gate on +z at z~134, approach road leaves along +z. Everything is built into one group. */
import * as THREE from 'three';
import { saveBakedPixels, takeBakedPixels } from '../../cache/BakeCache';

export function createBarracks() {
const scene = new THREE.Group();
scene.name = 'barracks';
const camera = { position: new THREE.Vector3(), projectionMatrix: new THREE.Matrix4(), matrixWorldInverse: new THREE.Matrix4(), updateMatrixWorld() {} };
'use strict';
const TAU=Math.PI*2;
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let rng=mulberry32(90711); // let: heavy textures swap in their own seeded rng while they paint (see device texture cache)
const R=(a,b)=>a+(b-a)*rng();
const clamp=(x,a,b)=>x<a?a:x>b?b:x;
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const C=hex=>new THREE.Color(hex);

function makeNoise(seed){
  const r=mulberry32(seed),p=[];for(let i=0;i<256;i++)p.push(i);
  for(let i=255;i>0;i--){const j=Math.floor(r()*(i+1));const t=p[i];p[i]=p[j];p[j]=t;}
  const perm=new Uint8Array(512);for(let i=0;i<512;i++)perm[i]=p[i&255];
  const gx=[1,-1,1,-1,1,-1,0,0],gy=[1,1,-1,-1,0,0,1,-1];
  const fade=t=>t*t*t*(t*(t*6-15)+10);
  return function(x,y){
    const xi=Math.floor(x),yi=Math.floor(y),X=xi&255,Y=yi&255,xf=x-xi,yf=y-yi;
    const aa=perm[perm[X]+Y]&7,ab=perm[perm[X]+Y+1]&7,ba=perm[perm[X+1]+Y]&7,bb=perm[perm[X+1]+Y+1]&7;
    const u=fade(xf),v=fade(yf);
    const x1=lerp(gx[aa]*xf+gy[aa]*yf,gx[ba]*(xf-1)+gy[ba]*yf,u);
    const x2=lerp(gx[ab]*xf+gy[ab]*(yf-1),gx[bb]*(xf-1)+gy[bb]*(yf-1),u);
    return lerp(x1,x2,v);
  };
}
const noise=makeNoise(4242);
function fbm(x,y,o){let s=0,a=.5,f=1,n=0;for(let i=0;i<o;i++){s+=a*noise(x*f+i*13.7,y*f-i*7.1);n+=a;a*=.5;f*=2.03;}return s/n*1.5;}

/* ====================== canvas texture helpers ====================== */
function mk(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')];}
function tex(c,o){o=o||{};const t=new THREE.CanvasTexture(c);
  if(o.repeat!==false)t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=o.aniso||8;if(o.srgb!==false)t.colorSpace=THREE.SRGBColorSpace;if(o.flipY===false)t.flipY=false;return t;}
function wrapFn(S,x,y,fn){for(const dx of [-S,0,S])for(const dy of [-S,0,S])fn(x+dx,y+dy);}

/* ====================== device texture cache ======================
 * The heavy canvas textures (ground, asphalt, concrete, stucco, roof tiles, doors, facades, bark, leaves ...) are painted ONCE,
 * during the loading screen on the first launch, and saved on the device (cache/BakeCache.ts). Every later launch restores the
 * saved pixels instead of painting, and the scene is prepared during loading too (world/barracks/BarracksPreload.ts), so nothing
 * is generated when the player reaches the island.
 * Each baked texture paints with its OWN seeded rng, so the layout (trees, lit windows ...) is identical whether a texture was
 * painted or restored. Bump BAR_V when a barracks texture or the road layout changes, so old saved pixels are not reused. */
const BAR_V='b1';
const BK_KEYS=['wrapS','wrapT','anisotropy','colorSpace','flipY','minFilter','magFilter'];
const bkCount={};
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function withSeed(key,fn){const keep=rng;rng=mulberry32(hashStr(key));try{return fn();}finally{rng=keep;}}
function bakedResult(key,build){ // build() returns a CanvasTexture (its options are saved too) or a plain canvas
  const hit=takeBakedPixels(key);
  if(hit){
    const c=document.createElement('canvas');c.width=hit.w;c.height=hit.h;
    c.getContext('2d').putImageData(new ImageData(hit.data,hit.w,hit.h),0,0);
    if(!hit.opts)return c;
    const t=new THREE.CanvasTexture(c);
    for(const k of BK_KEYS)if(hit.opts[k]!==undefined)t[k]=hit.opts[k];
    return t;
  }
  const out=withSeed(key,build);
  if(out&&out.isTexture){const o={};for(const k of BK_KEYS)o[k]=out[k];saveBakedPixels(key,out.image,o);}
  else saveBakedPixels(key,out,null);
  return out;
}
function baked(name,fn){ // same texture function, but saved to / restored from the device
  return function(){
    const a=Array.prototype.slice.call(arguments),n=bkCount[name]=(bkCount[name]||0)+1;
    return bakedResult('bar|'+BAR_V+'|'+name+(a.length?'|'+a.join(','):'')+'#'+n,()=>fn.apply(null,a));
  };
}
texGrassDetail=baked('grass',texGrassDetail);texHue=baked('hue',texHue);
texAsphalt=baked('asphalt',texAsphalt);texAsphaltFine=baked('asphaltFine',texAsphaltFine);texAsphaltMacro=baked('asphaltMacro',texAsphaltMacro);
texConcrete=baked('concrete',texConcrete);texConcreteFine=baked('concreteFine',texConcreteFine);texConcreteJoint=baked('concreteJoint',texConcreteJoint);
texDirt=baked('dirt',texDirt);paintWear=baked('wear',paintWear);
texShingle=baked('shingle',texShingle);texMetal=baked('metal',texMetal);texTiles=baked('tiles',texTiles);
texPaintMask=baked('paintMask',texPaintMask);texStucco=baked('stucco',texStucco);
texDoor=baked('door',texDoor);texBrick=baked('brick',texBrick);texStone=baked('stone',texStone);
texHelipad=baked('helipad',texHelipad);makeBark=baked('bark',makeBark);makeLeaf=baked('leaf',makeLeaf);

function texGrassDetail(){ // neutral grey blades (from terrain-road-3): the hue comes from the hue map / vertex tint
  const S=256,[c,g]=mk(S,S);g.fillStyle='#808080';g.fillRect(0,0,S,S);
  for(let n=0;n<70;n++){const x=R(0,S),y=R(0,S),r=R(10,30),v=R(70,95)|0;wrapFn(S,x,y,(px,py)=>{g.fillStyle=`rgba(${v},${v+4},${v-4},0.28)`;g.beginPath();g.arc(px,py,r,0,TAU);g.fill();});}
  for(let n=0;n<5200;n++){
    const x=R(0,S),y=R(0,S),a=-1.5708+R(-.7,.7),l=R(5,15),v=R(55,215)|0,al=R(.35,.7),lw=R(.8,1.6);
    wrapFn(S,x,y,(px,py)=>{g.beginPath();g.moveTo(px,py);g.lineTo(px+Math.cos(a)*l,py+Math.sin(a)*l);g.strokeStyle=`rgba(${v},${v+6},${v-8},${al})`;g.lineWidth=lw;g.stroke();});
  }
  for(let n=0;n<1200;n++){const v=R(30,70)|0;g.fillStyle=`rgba(${v},${v},${v},0.5)`;g.fillRect(R(0,S),R(0,S),R(1,2),R(1,3));}
  return tex(c,{srgb:false});
}
function hexRGB(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}
function texHue(){ // lawn colour variation: fresh green, olive, sun-dried straw, shaded dark green, bare earth (same palette as the terrain file)
  const S=512,[c,g]=mk(S,S);g.fillStyle='#506629';g.fillRect(0,0,S,S);
  const sets=[['#718239',.55,26,40,110],['#5f7a33',.5,22,40,120],['#9b9657',.4,16,30,90],['#3c4b27',.5,18,40,110],['#6e5a3c',.3,9,20,60]];
  sets.forEach(([col,al,cnt,r0,r1])=>{const rgb=hexRGB(col);
    for(let n=0;n<cnt;n++){const x=R(0,S),y=R(0,S),r=R(r0,r1);
      wrapFn(S,x,y,(px,py)=>{const gr=g.createRadialGradient(px,py,0,px,py,r);gr.addColorStop(0,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${al})`);gr.addColorStop(1,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);g.fillStyle=gr;g.fillRect(px-r,py-r,r*2,r*2);});}});
  return tex(c);
}
function texAsphalt(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#3d3e42';g.fillRect(0,0,S,S);
  for(let n=0;n<14000;n++){const v=R(30,112)|0;g.fillStyle=`rgba(${v},${v},${v+3},${R(.3,.75)})`;g.fillRect(R(0,S),R(0,S),R(.6,1.6),R(.6,1.6));}
  for(let n=0;n<900;n++){const v=R(110,170)|0;g.fillStyle=`rgba(${v},${v},${v},${R(.25,.5)})`;g.fillRect(R(0,S),R(0,S),R(1,2),R(1,2));}
  g.lineCap='round';
  for(let n=0;n<5;n++){const x=R(0,S),y=R(0,S),a=R(0,6.28);
    wrapFn(S,0,0,(ox,oy)=>{g.beginPath();let X=x+ox,Y=y+oy,A=a;g.moveTo(X,Y);for(let s=0;s<14;s++){A+=R(-.4,.4);X+=Math.cos(A)*8;Y+=Math.sin(A)*8;g.lineTo(X,Y);}g.strokeStyle='rgba(8,8,9,.5)';g.lineWidth=1;g.stroke();});}
  return tex(c);
}
function texConcrete(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#a5a49e';g.fillRect(0,0,S,S);
  for(let n=0;n<40;n++){const x=R(0,S),y=R(0,S),r=R(14,50),v=R(-14,10)|0;
    wrapFn(S,x,y,(px,py)=>{g.fillStyle=`rgba(${150+v},${150+v},${146+v},.22)`;g.beginPath();g.arc(px,py,r,0,TAU);g.fill();});}
  for(let n=0;n<9000;n++){const v=R(110,205)|0;g.fillStyle=`rgba(${v},${v},${v-3},${R(.2,.5)})`;g.fillRect(R(0,S),R(0,S),R(.6,1.6),R(.6,1.6));}
  g.fillStyle='rgba(35,35,35,.55)';g.fillRect(0,0,S,2.5);g.fillRect(0,0,2.5,S);
  g.fillStyle='rgba(255,255,255,.08)';g.fillRect(0,2.5,S,2);g.fillRect(2.5,0,2,S);
  for(let n=0;n<3;n++){const x=R(0,S),y=R(0,S),a=R(0,6.28);
    wrapFn(S,0,0,(ox,oy)=>{g.beginPath();let X=x+ox,Y=y+oy,A=a;g.moveTo(X,Y);for(let s=0;s<10;s++){A+=R(-.5,.5);X+=Math.cos(A)*7;Y+=Math.sin(A)*7;g.lineTo(X,Y);}g.strokeStyle='rgba(30,30,30,.4)';g.lineWidth=1;g.stroke();});}
  return tex(c);
}
function texDirt(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#8c7b5d';g.fillRect(0,0,S,S);
  for(let n=0;n<50;n++){const x=R(0,S),y=R(0,S),r=R(14,40),v=R(-20,20)|0;
    wrapFn(S,x,y,(px,py)=>{g.fillStyle=`rgba(${140+v},${122+v},${92+v},.28)`;g.beginPath();g.arc(px,py,r,0,TAU);g.fill();});}
  for(let n=0;n<2400;n++){const x=R(0,S),y=R(0,S),r=R(.8,3),v=R(80,200)|0;
    wrapFn(S,x,y,(px,py)=>{g.beginPath();g.arc(px,py,r,0,TAU);g.fillStyle=`rgba(${v},${v-14},${v-40},.75)`;g.fill();g.strokeStyle='rgba(30,24,16,.4)';g.lineWidth=.7;g.stroke();});}
  return tex(c);
}
function texAsphaltFine(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#3a3b3f';g.fillRect(0,0,S,S);
  for(let n=0;n<2600;n++){const v=R(38,125)|0,rw=R(1,3.4),rh=R(1,2.7),a=R(0,3.14),al=R(.45,.9);
    wrapFn(S,R(0,S),R(0,S),(px,py)=>{g.fillStyle=`rgba(${v},${v},${v+2},${al})`;g.beginPath();g.ellipse(px,py,rw,rh,a,0,TAU);g.fill();});}
  for(let n=0;n<1500;n++){const v=R(120,195)|0;g.fillStyle=`rgba(${v},${v},${v-4},${R(.3,.6)})`;g.fillRect(R(0,S),R(0,S),R(.8,1.8),R(.8,1.8));}
  for(let n=0;n<2600;n++){const v=R(8,34)|0;g.fillStyle=`rgba(${v},${v},${v},${R(.4,.8)})`;g.fillRect(R(0,S),R(0,S),R(1,2.4),R(1,2.4));}
  return tex(c);
}
function texAsphaltMacro(){ // neutral grey multiplier: blotchy wear, repair patches, sealed cracks (16 m tile)
  const S=512,[c,g]=mk(S,S);g.fillStyle='#808080';g.fillRect(0,0,S,S);
  for(let n=0;n<70;n++){const x=R(0,S),y=R(0,S),r=R(30,110),v=R(95,165)|0,a=R(.12,.3);
    wrapFn(S,x,y,(px,py)=>{const gr=g.createRadialGradient(px,py,0,px,py,r);gr.addColorStop(0,`rgba(${v},${v},${v},${a})`);gr.addColorStop(1,`rgba(${v},${v},${v},0)`);g.fillStyle=gr;g.fillRect(px-r,py-r,r*2,r*2);});}
  for(let n=0;n<5;n++){const w=R(60,160),h=R(40,110),x=R(0,S),y=R(0,S),v=R(92,112)|0;
    wrapFn(S,x,y,(px,py)=>{g.fillStyle=`rgba(${v},${v},${v},.85)`;g.fillRect(px,py,w,h);g.strokeStyle='rgba(20,20,20,.7)';g.lineWidth=2.4;g.strokeRect(px,py,w,h);g.strokeStyle='rgba(200,200,200,.18)';g.lineWidth=1;g.strokeRect(px+3,py+3,w-6,h-6);});}
  g.lineCap='round';g.lineJoin='round';
  for(let n=0;n<12;n++){
    let X=R(0,S),Y=R(0,S),A=R(0,6.28);const steps=(R(8,22))|0,th=R(1.2,3.2),pts=[[X,Y]];
    for(let k=0;k<steps;k++){A+=R(-.45,.45);X+=Math.cos(A)*11;Y+=Math.sin(A)*11;pts.push([X,Y]);}
    wrapFn(S,0,0,(ox,oy)=>{
      g.beginPath();pts.forEach((p,k)=>k?g.lineTo(p[0]+ox,p[1]+oy):g.moveTo(p[0]+ox,p[1]+oy));g.strokeStyle='rgba(215,215,215,.12)';g.lineWidth=th+3;g.stroke();
      g.beginPath();pts.forEach((p,k)=>k?g.lineTo(p[0]+ox,p[1]+oy):g.moveTo(p[0]+ox,p[1]+oy));g.strokeStyle='rgba(6,6,7,.8)';g.lineWidth=th;g.stroke();});
  }
  return tex(c,{srgb:false});
}
function texConcreteFine(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#a8a7a1';g.fillRect(0,0,S,S);
  for(let n=0;n<40;n++){const x=R(0,S),y=R(0,S),r=R(14,55),v=R(-16,12)|0;
    wrapFn(S,x,y,(px,py)=>{g.fillStyle=`rgba(${150+v},${150+v},${146+v},.22)`;g.beginPath();g.arc(px,py,r,0,TAU);g.fill();});}
  for(let n=0;n<7000;n++){const v=R(105,210)|0;g.fillStyle=`rgba(${v},${v},${v-3},${R(.2,.5)})`;g.fillRect(R(0,S),R(0,S),R(.6,1.6),R(.6,1.6));}
  for(let n=0;n<900;n++){g.fillStyle=`rgba(40,40,38,${R(.25,.6)})`;g.beginPath();g.arc(R(0,S),R(0,S),R(.5,1.5),0,TAU);g.fill();}
  for(let n=0;n<28;n++){const y=R(0,S),l=R(60,200),x=R(0,S);g.fillStyle=`rgba(255,255,255,${R(.015,.05)})`;g.fillRect(x,y,l,R(.6,1.4));}
  return tex(c);
}
function texConcreteJoint(){ // 4 m slab: joint line + dirt in the joint (multiplier, white = no change)
  const S=256,[c,g]=mk(S,S);g.fillStyle='#ffffff';g.fillRect(0,0,S,S);
  const lines=(w,col)=>{g.fillStyle=col;g.fillRect(0,0,S,w);g.fillRect(0,0,w,S);g.fillRect(0,S-w/2,S,w/2);g.fillRect(S-w/2,0,w/2,S);};
  lines(7,'rgba(150,150,150,.35)');lines(3.2,'rgba(55,55,55,.85)');lines(1.2,'rgba(15,15,15,.9)');
  for(let n=0;n<14;n++){let x=R(0,S),y=R(0,S),a=R(0,6.28);g.strokeStyle='rgba(60,60,60,.45)';g.lineWidth=1;g.beginPath();g.moveTo(x,y);for(let k=0;k<8;k++){a+=R(-.5,.5);x+=Math.cos(a)*6;y+=Math.sin(a)*6;g.lineTo(x,y);}g.stroke();}
  return tex(c,{srgb:false});
}
function paintWear(){ // R: polished wheel tracks, G: dust blown to the edges, B: oil stains
  const P=1024,[c,g]=mk(P,P);g.fillStyle='#000';g.fillRect(0,0,P,P);g.globalCompositeOperation='lighter';
  const K=P/SPL.s,X=x=>(x-SPL.x)*K,Z=z=>(z-SPL.z)*K;
  const strip=(horiz,a,b,pos,w,rgb,al)=>{
    const gr=horiz?g.createLinearGradient(0,Z(pos-w/2),0,Z(pos+w/2)):g.createLinearGradient(X(pos-w/2),0,X(pos+w/2),0);
    gr.addColorStop(0,`rgba(${rgb},0)`);gr.addColorStop(.5,`rgba(${rgb},${al})`);gr.addColorStop(1,`rgba(${rgb},0)`);g.fillStyle=gr;
    if(horiz)g.fillRect(X(a),Z(pos-w/2),(b-a)*K,w*K);else g.fillRect(X(pos-w/2),Z(a),w*K,(b-a)*K);};
  const edge=(horiz,a,b,pos,w,dir,rgb,al)=>{
    const p1=pos+dir*w,gr=horiz?g.createLinearGradient(0,Z(pos),0,Z(p1)):g.createLinearGradient(X(pos),0,X(p1),0);
    gr.addColorStop(0,`rgba(${rgb},${al})`);gr.addColorStop(1,`rgba(${rgb},0)`);g.fillStyle=gr;const lo=Math.min(pos,p1);
    if(horiz)g.fillRect(X(a),Z(lo),(b-a)*K,w*K);else g.fillRect(X(lo),Z(a),w*K,(b-a)*K);};
  ROADS.forEach(r=>{
    const horiz=(r[2]-r[0])>(r[3]-r[1]),a=horiz?r[0]:r[1],b=horiz?r[2]:r[3],cp=horiz?(r[1]+r[3])/2:(r[0]+r[2])/2,wd=horiz?r[3]-r[1]:r[2]-r[0];
    edge(horiz,a,b,cp-wd/2,1.3,1,'0,255,0',.9);edge(horiz,a,b,cp+wd/2,1.3,-1,'0,255,0',.9);
    if(wd>=7)for(const lc of [cp-wd/4,cp+wd/4]){strip(horiz,a,b,lc-.9,1.0,'255,0,0',.8);strip(horiz,a,b,lc+.9,1.0,'255,0,0',.8);}
    const n=Math.round((b-a)/14);
    for(let k=0;k<n;k++){const t=R(a,b),lc=cp+(rng()<.5?-1:1)*wd/4+R(-1.3,1.3),rad=R(.35,1.0)*K,x=horiz?X(t):X(lc),y=horiz?Z(lc):Z(t);
      const gr=g.createRadialGradient(x,y,0,x,y,rad);gr.addColorStop(0,'rgba(0,0,255,.7)');gr.addColorStop(1,'rgba(0,0,255,0)');g.fillStyle=gr;g.fillRect(x-rad,y-rad,rad*2,rad*2);}
  });
  const t=new THREE.CanvasTexture(c);t.flipY=false;t.anisotropy=8;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return t;
}
function texShingle(hex){
  const S=128,[c,g]=mk(S,S);g.fillStyle=hex;g.fillRect(0,0,S,S);
  const rows=16,rh=S/rows;
  for(let r=0;r<rows;r++){const n=8,sw=S/n,off=(r%2)*sw/2;
    for(let i=-1;i<=n;i++){const v=R(-1,1);g.fillStyle=v>0?`rgba(255,255,255,${v*.1})`:`rgba(0,0,0,${-v*.16})`;g.fillRect(i*sw+off,r*rh,sw-1,rh-1);}
    g.fillStyle='rgba(0,0,0,.4)';g.fillRect(0,r*rh+rh-2,S,2);}
  for(let n=0;n<1500;n++){const v=R(0,1)<.5?0:255;g.fillStyle=`rgba(${v},${v},${v},${R(.03,.09)})`;g.fillRect(R(0,S),R(0,S),1,1);}
  return tex(c);
}
function texMetal(hex){
  const S=128,[c,g]=mk(S,S);g.fillStyle=hex;g.fillRect(0,0,S,S);
  for(let x=0;x<S;x+=16){const gr=g.createLinearGradient(x,0,x+16,0);gr.addColorStop(0,'rgba(255,255,255,.18)');gr.addColorStop(.5,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,.28)');g.fillStyle=gr;g.fillRect(x,0,16,S);}
  for(let n=0;n<40;n++){const x=R(0,S),l=R(20,90);const gr=g.createLinearGradient(0,0,0,l);gr.addColorStop(0,'rgba(60,40,20,.14)');gr.addColorStop(1,'rgba(60,40,20,0)');g.save();g.translate(x,R(0,S*.5));g.fillStyle=gr;g.fillRect(0,0,R(1,3),l);g.restore();}
  return tex(c);
}
function texFence(){
  const S=64,[c,g]=mk(S,S);g.strokeStyle='rgba(185,190,196,1)';g.lineWidth=2.2;
  for(let i=-S;i<=2*S;i+=16){g.beginPath();g.moveTo(i,0);g.lineTo(i+S,S);g.stroke();g.beginPath();g.moveTo(i,S);g.lineTo(i+S,0);g.stroke();}
  return tex(c);
}
function texStripes(){
  const S=64,[c,g]=mk(S,16);g.fillStyle='#e8e8e2';g.fillRect(0,0,S,16);g.fillStyle='#b32018';
  for(let i=0;i<4;i++)g.fillRect(i*16,0,8,16);
  return tex(c);
}
function texGlow(){
  const S=64,[c,g]=mk(S,S);const gr=g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
  gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.25,'rgba(255,255,255,.55)');gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=gr;g.fillRect(0,0,S,S);return tex(c,{repeat:false,srgb:false});
}
function texSign(text,sub,w,h,bg,fg){
  w=w||512;h=h||128;const [c,g]=mk(w,h);
  g.fillStyle=bg||'#1f3a2a';g.fillRect(0,0,w,h);
  g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=4;g.strokeRect(6,6,w-12,h-12);
  g.fillStyle=fg||'#f2f0e4';g.textAlign='center';g.textBaseline='middle';
  const fit=(str,size,bold)=>{g.font=(bold?'bold ':'')+size+'px sans-serif';const mw=g.measureText(str).width;if(typeof mw==='number'&&mw>w-36)size*=(w-36)/mw;g.font=(bold?'bold ':'')+size+'px sans-serif';};
  fit(text,sub?h*.42:h*.5,true);g.fillText(text,w/2,sub?h*.38:h*.52);
  if(sub){fit(sub,h*.2,false);g.fillText(sub,w/2,h*.76);}
  return tex(c,{repeat:false});
}
function texFlag(){
  const [c,g]=mk(384,192);g.fillStyle='#008751';g.fillRect(0,0,384,192);
  g.fillStyle='#ffffff';g.fillRect(128,0,128,192);
  return tex(c,{repeat:false});
}
function texTarget(){
  const [c,g]=mk(128,192);g.clearRect(0,0,128,192);g.fillStyle='#cdbb8f';g.fillRect(18,0,92,192);
  g.fillStyle='#1c1d1a';g.beginPath();g.arc(64,44,22,0,TAU);g.fill();
  g.beginPath();g.moveTo(24,192);g.lineTo(28,94);g.quadraticCurveTo(64,66,100,94);g.lineTo(104,192);g.closePath();g.fill();
  g.strokeStyle='rgba(235,235,225,.7)';g.lineWidth=2;g.beginPath();g.arc(64,120,26,0,TAU);g.stroke();g.beginPath();g.arc(64,120,12,0,TAU);g.stroke();
  return tex(c,{repeat:false});
}
function texEmblem(){
  const S=512,[c,g]=mk(S,S);g.strokeStyle='rgba(240,240,232,.9)';g.lineWidth=14;g.beginPath();g.arc(S/2,S/2,230,0,TAU);g.stroke();
  g.lineWidth=5;g.beginPath();g.arc(S/2,S/2,206,0,TAU);g.stroke();
  g.fillStyle='rgba(240,240,232,.92)';g.beginPath();
  for(let i=0;i<10;i++){const r=i%2?58:150,a=-Math.PI/2+i*Math.PI/5;g.lineTo(S/2+Math.cos(a)*r,S/2+Math.sin(a)*r);}
  g.closePath();g.fill();
  return tex(c,{repeat:false});
}
function texCross(){
  const [c,g]=mk(128,128);g.fillStyle='#f1f1ec';g.fillRect(0,0,128,128);g.fillStyle='#2f8a4a';g.fillRect(48,16,32,96);g.fillRect(16,48,96,32);
  return tex(c,{repeat:false});
}

/* ====================== materials ====================== */
const nightEmis=[];
const std=(hex,r,m,extra)=>new THREE.MeshStandardMaterial(Object.assign({color:C(hex),roughness:r===undefined?.9:r,metalness:m||0},extra||{}));
const MAT={
  conc:std('#a9a8a2',.95),concDark:std('#807f7a',.95),concLight:std('#c9c7bd',.9),
  steel:std('#5d646b',.5,.6),steelLight:std('#a2abb2',.4,.75),wood:std('#6b4f33',.9),log:std('#5a4128',.95),
  sandbag:std('#a99a72',1),olive:std('#4c5a3e',.85),red:std('#8a1f1a',.7),white:std('#e9e9e4',.8),
  black:std('#1b1c1e',.8),glass:std('#22313e',.15,.6),rubber:std('#1a1a1a',.95),earth:std('#6e6144',1),
  ac:std('#a8adb0',.6,.3),dumpster:std('#2f4a35',.7,.2),hydrant:std('#a3201a',.5,.2),stone:std('#d3cbb8',.9),
  paintW:stdPaint('#ecece6'),paintY:stdPaint('#d8bc3c'),tileCap:std('#8f4f39',.8),
  barrierStripe:null
};
const lampHeadMat=new THREE.MeshStandardMaterial({color:C('#fff2cf'),emissive:C('#ffd9a0'),emissiveIntensity:.1,roughness:.5});
nightEmis.push({mat:lampHeadMat,base:.1,max:2.4});
const lampSmall=new THREE.MeshStandardMaterial({color:C('#fff2cf'),emissive:C('#ffd9a0'),emissiveIntensity:.1,roughness:.5});
nightEmis.push({mat:lampSmall,base:.1,max:2.4});

function texPaintMask(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#f6f6f2';g.fillRect(0,0,S,S);
  for(let n=0;n<70;n++){const x=R(0,S),y=R(0,S),r=R(10,50),v=R(110,200)|0;
    wrapFn(S,x,y,(px,py)=>{const gr=g.createRadialGradient(px,py,0,px,py,r);gr.addColorStop(0,`rgba(${v},${v},${v-8},.4)`);gr.addColorStop(1,`rgba(${v},${v},${v-8},0)`);g.fillStyle=gr;g.fillRect(px-r,py-r,r*2,r*2);});}
  for(let n=0;n<900;n++){const v=R(8,60)|0;g.fillStyle=`rgba(${v},${v},${v},${R(.4,.9)})`;g.beginPath();g.arc(R(0,S),R(0,S),R(.6,2.8),0,TAU);g.fill();}
  g.lineCap='round';
  for(let n=0;n<16;n++){const x=R(0,S),y=R(0,S),a=Math.PI/2+R(-.35,.35),l=R(30,100),lw=R(2,7),al=R(.25,.6);
    wrapFn(S,x,y,(px,py)=>{g.strokeStyle=`rgba(14,14,14,${al})`;g.lineWidth=lw;g.beginPath();g.moveTo(px,py);g.lineTo(px+Math.cos(a)*l,py+Math.sin(a)*l);g.stroke();});}
  g.globalCompositeOperation='destination-out';
  for(let n=0;n<170;n++){const x=R(0,S),y=R(0,S),sz=R(1.5,9),k=(4+rng()*4)|0,rot=R(0,6.28);
    wrapFn(S,x,y,(px,py)=>{g.fillStyle='#000';g.beginPath();for(let i=0;i<k;i++){const a=rot+i/k*TAU,rr=sz*(.5+((i*7+k)%5)/6);g.lineTo(px+Math.cos(a)*rr,py+Math.sin(a)*rr*.7);}g.closePath();g.fill();});}
  for(let n=0;n<20;n++){const x=R(0,S),y=R(0,S),l=R(10,60),a=R(0,6.28);g.strokeStyle='#000';g.lineWidth=R(.8,2.2);wrapFn(S,x,y,(px,py)=>{g.beginPath();g.moveTo(px,py);g.lineTo(px+Math.cos(a)*l,py+Math.sin(a)*l);g.stroke();});}
  return tex(c);
}
function stdPaint(hex){
  const m=new THREE.MeshStandardMaterial({color:new THREE.Color(hex),map:texPaintMask(),alphaTest:.5,roughness:.75,metalness:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  m.customProgramCacheKey=()=>'paintworld';
  m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <uv_vertex>','#ifdef USE_MAP\nvMapUv=position.xz*0.55;\n#endif');};
  return m;
}

/* ---- surface relief: screen-space bump from a tiled height map or from the albedo ---- */
const PERT='vec3 perturbNormalArb2(vec3 surf_pos,vec3 surf_norm,vec2 dHdxy){vec3 vSigmaX=vec3(dFdx(surf_pos.x),dFdx(surf_pos.y),dFdx(surf_pos.z));vec3 vSigmaY=vec3(dFdy(surf_pos.x),dFdy(surf_pos.y),dFdy(surf_pos.z));vec3 vN=surf_norm;vec3 R1=cross(vSigmaY,vN);vec3 R2=cross(vN,vSigmaX);float fDet=dot(vSigmaX,R1);fDet*=(float(gl_FrontFacing)*2.0-1.0);vec3 vGrad=sign(fDet)*(dHdxy.x*R1+dHdxy.y*R2);return normalize(abs(fDet)*surf_norm-vGrad);}\n';
function texStucco(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#808080';g.fillRect(0,0,S,S);
  for(let n=0;n<26000;n++){const v=R(40,215)|0;g.fillStyle=`rgba(${v},${v},${v},${R(.3,.8)})`;g.fillRect(R(0,S),R(0,S),R(1,3),R(1,3));}
  for(let n=0;n<50;n++){const x=R(0,S),y=R(0,S),r=R(8,34),v=R(90,170)|0;wrapFn(S,x,y,(px,py)=>{const gr=g.createRadialGradient(px,py,0,px,py,r);gr.addColorStop(0,`rgba(${v},${v},${v},.35)`);gr.addColorStop(1,`rgba(${v},${v},${v},0)`);g.fillStyle=gr;g.fillRect(px-r,py-r,r*2,r*2);});}
  return tex(c,{srgb:false});
}
const STUCCO=texStucco();
function addBump(mat,bumpTex,tu,tv,k,albedo){
  mat.extensions=Object.assign(mat.extensions||{},{derivatives:true});
  mat.customProgramCacheKey=()=>albedo?'bumpA':'bumpT';
  mat.onBeforeCompile=sh=>{
    sh.uniforms.tBump={value:bumpTex||STUCCO};sh.uniforms.uBT={value:new THREE.Vector3(tu||1,tv||1,k)};
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D tBump;\nuniform vec3 uBT;\n'+PERT)
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+(albedo?'float bh=dot(sampledDiffuseColor.rgb,vec3(0.333));':'float bh=texture2D(tBump,vMapUv*uBT.xy).r;')+'\nnormal=perturbNormalArb2(-vViewPosition,normal,vec2(dFdx(bh),dFdy(bh))*uBT.z);');
  };
}
function texTiles(hex){ // semi-barrel clay roof tiles
  const S=256,[c,g]=mk(S,S),base=hexRGB(hex);g.fillStyle=hex;g.fillRect(0,0,S,S);
  const rows=8,rh=S/rows,cols=8,cw=S/cols,cl=v=>clamp(v,0,255)|0;
  for(let r=0;r<rows;r++)for(let k=-1;k<=cols;k++){
    const x=k*cw+(r%2)*cw/2,y=r*rh,v=R(-24,24);
    g.fillStyle=`rgb(${cl(base[0]+v)},${cl(base[1]+v*.8)},${cl(base[2]+v*.7)})`;g.fillRect(x+1,y,cw-1,rh);
    const gr=g.createLinearGradient(x,0,x+cw,0);gr.addColorStop(0,'rgba(0,0,0,.3)');gr.addColorStop(.4,'rgba(255,255,255,.14)');gr.addColorStop(1,'rgba(0,0,0,.32)');g.fillStyle=gr;g.fillRect(x+1,y,cw-1,rh);
    const gy=g.createLinearGradient(0,y,0,y+rh);gy.addColorStop(0,'rgba(255,255,255,.08)');gy.addColorStop(.72,'rgba(0,0,0,0)');gy.addColorStop(1,'rgba(0,0,0,.55)');g.fillStyle=gy;g.fillRect(x+1,y,cw-1,rh);
  }
  for(let n=0;n<300;n++){g.fillStyle=rng()<.6?`rgba(70,82,40,${R(.05,.16)})`:`rgba(0,0,0,${R(.04,.1)})`;g.fillRect(R(0,S),R(0,S),R(1,5),R(1,4));}
  return tex(c);
}
function texDoor(){
  const W=128,H=256,[c,g]=mk(W,H);g.fillStyle='#3f5a45';g.fillRect(0,0,W,H);
  for(let n=0;n<1600;n++){const v=rng()<.5?0:255;g.fillStyle=`rgba(${v},${v},${v},${R(.02,.07)})`;g.fillRect(R(0,W),R(0,H),R(1,2),R(1,3));}
  g.fillStyle='#2c4232';g.fillRect(0,0,W,6);g.fillRect(0,0,6,H);g.fillRect(W-6,0,6,H);g.fillRect(0,H-6,W,6);
  g.fillStyle='#22352a';g.fillRect(14,16,W-28,118);
  const gr=g.createLinearGradient(20,22,W-20,128);gr.addColorStop(0,'#7c9bb3');gr.addColorStop(.5,'#2f4659');gr.addColorStop(1,'#16222d');g.fillStyle=gr;g.fillRect(20,22,W-40,106);
  g.fillStyle='rgba(255,255,255,.14)';g.beginPath();g.moveTo(30,128);g.lineTo(62,22);g.lineTo(80,22);g.lineTo(48,128);g.closePath();g.fill();
  g.fillStyle='#22352a';g.fillRect(W/2-1.5,22,3,106);g.fillRect(20,72,W-40,3);
  const panel=(y,h)=>{g.fillStyle='#4f7458';g.fillRect(18,y,W-36,h);g.fillStyle='rgba(255,255,255,.2)';g.fillRect(18,y,W-36,3);g.fillRect(18,y,3,h);g.fillStyle='rgba(0,0,0,.4)';g.fillRect(18,y+h-3,W-36,3);g.fillRect(W-21,y,3,h);g.fillStyle='#3a5a42';g.fillRect(28,y+9,W-56,h-18);};
  panel(144,44);panel(196,38);
  g.fillStyle='#9aa4ab';g.fillRect(8,H-24,W-16,18);g.fillStyle='rgba(0,0,0,.4)';g.fillRect(8,H-9,W-16,3);
  return tex(c,{repeat:false});
}
function texBrick(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#8a5a48';g.fillRect(0,0,S,S);
  const rh=16,bw=44;
  for(let r=0;r<S/rh;r++){const off=(r%2)*bw/2;for(let x=-bw;x<S+bw;x+=bw){const v=R(-26,22)|0;g.fillStyle=`rgb(${150+v},${88+v*.7|0},${68+v*.6|0})`;g.fillRect(x+off+1.5,r*rh+1.5,bw-3,rh-3);}}
  g.fillStyle='rgba(0,0,0,.35)';for(let n=0;n<500;n++)g.fillRect(R(0,S),R(0,S),R(1,3),R(1,2));
  return tex(c);
}
function texStone(){
  const S=256,[c,g]=mk(S,S);g.fillStyle='#8f8a7e';g.fillRect(0,0,S,S);
  const rh=42;
  for(let r=0;r<Math.ceil(S/rh);r++){const bw=r%2?82:64,off=(r%3)*21;for(let x=-bw;x<S+bw;x+=bw){const v=R(-18,18)|0;g.fillStyle=`rgb(${176+v},${170+v},${156+v})`;g.fillRect(x+off+2,r*rh+2,bw-4,rh-4);
    const gr=g.createLinearGradient(0,r*rh,0,r*rh+rh);gr.addColorStop(0,'rgba(255,255,255,.12)');gr.addColorStop(1,'rgba(0,0,0,.18)');g.fillStyle=gr;g.fillRect(x+off+2,r*rh+2,bw-4,rh-4);}}
  for(let n=0;n<4000;n++){const v=rng()<.5?0:255;g.fillStyle=`rgba(${v},${v},${v},${R(.03,.1)})`;g.fillRect(R(0,S),R(0,S),R(1,3),R(1,3));}
  return tex(c);
}
const doorTexMat=new THREE.MeshStandardMaterial({map:texDoor(),roughness:.45,metalness:.2});
addBump(doorTexMat,null,1,1,.018,true);
MAT.brick=new THREE.MeshStandardMaterial({map:(function(){const t=texBrick();t.repeat.set(1,2);return t;})(),roughness:.95});addBump(MAT.brick,null,1,1,.02,true);
MAT.stone2=new THREE.MeshStandardMaterial({map:(function(){const t=texStone();t.repeat.set(1.2,2.4);return t;})(),roughness:.9});addBump(MAT.stone2,null,1,1,.02,true);
let bushTexCache=null,bushMat=null,bushBucket=null,_bush=null;
function bushGeo(){
  if(_bush)return _bush;
  const P=[],N=[],U=[],Cc=[],I=[],q=new THREE.Quaternion(),e=new THREE.Euler(),corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
  for(let i=0;i<46;i++){
    const th=R(0,TAU),ph=Math.acos(R(-.25,1)),rr=R(.2,.46),cx=Math.sin(ph)*Math.cos(th)*rr,cy=.42+Math.cos(ph)*rr*.9,cz=Math.sin(ph)*Math.sin(th)*rr;
    e.set(R(0,TAU),R(0,TAU),R(0,TAU));q.setFromEuler(e);const sz=R(.24,.4),sh=R(.7,1.2)+.15*cy,base=P.length/3;
    const nr=V(cx,cy-.42,cz).normalize();
    corners.forEach(cn=>{const v=V(cn[0]*sz,cn[1]*sz,0).applyQuaternion(q);P.push(v.x+cx,v.y+cy,v.z+cz);N.push(nr.x,nr.y,nr.z);U.push(cn[0]+.5,cn[1]+.5);Cc.push(sh*.55,sh*.85,sh*.5);});
    I.push(base,base+1,base+2,base,base+2,base+3);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));g.setAttribute('color',new THREE.Float32BufferAttribute(Cc,3));g.setIndex(I);
  return _bush=g;
}
function addBush(m){
  if(!bushMat){bushMat=new THREE.MeshLambertMaterial({map:makeLeaf(),alphaTest:.42,side:THREE.DoubleSide,vertexColors:true});bushBucket=newBucket();}
  addTo(bushBucket,bushGeo(),m);
}
function texGlass(){
  const [c,g]=mk(64,128),gr=g.createLinearGradient(0,0,0,128);
  gr.addColorStop(0,'#9dc0dd');gr.addColorStop(.42,'#628aaa');gr.addColorStop(.55,'#324a5c');gr.addColorStop(1,'#1a2733');g.fillStyle=gr;g.fillRect(0,0,64,128);
  g.fillStyle='rgba(255,255,255,.2)';g.beginPath();g.moveTo(0,128);g.lineTo(26,0);g.lineTo(44,0);g.lineTo(18,128);g.closePath();g.fill();
  g.fillStyle='rgba(255,255,255,.08)';g.beginPath();g.moveTo(34,128);g.lineTo(52,0);g.lineTo(58,0);g.lineTo(40,128);g.closePath();g.fill();
  return tex(c,{repeat:false});
}
/* ---- reflection cube (sky / horizon / ground) for bare metal ---- */
const ENV=(function(){
  const side=()=>{const [c,g]=mk(64,64);const gr=g.createLinearGradient(0,0,0,64);gr.addColorStop(0,'#5f93d0');gr.addColorStop(.42,'#c9dbe8');gr.addColorStop(.5,'#a6a692');gr.addColorStop(1,'#6b6a58');g.fillStyle=gr;g.fillRect(0,0,64,64);return c;};
  const flat=col=>{const [c,g]=mk(64,64);g.fillStyle=col;g.fillRect(0,0,64,64);return c;};
  const t=new THREE.CubeTexture([side(),side(),flat('#4f86cc'),flat('#6b6a58'),side(),side()]);
  t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;
})();
const GL={
  glass:new THREE.MeshBasicMaterial({map:texGlass(),color:0xffffff,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),
  curtain:new THREE.MeshStandardMaterial({color:C('#ffffff'),roughness:.95,metalness:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),
  lit:new THREE.MeshStandardMaterial({color:C('#ffe3a8'),emissive:C('#ffc870'),emissiveIntensity:.05,roughness:.6,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2})
};
nightEmis.push({mat:GL.lit,base:.05,max:1.7});
const doorLit=new THREE.MeshStandardMaterial({color:C('#ffe3a8'),emissive:C('#ffc870'),emissiveIntensity:.05,roughness:.6});
nightEmis.push({mat:doorLit,base:.05,max:1.5});
const envMats=[];
[MAT.steel,MAT.steelLight,MAT.ac].forEach(m=>{m.envMap=ENV;m.envMapIntensity=.9;envMats.push(m);});
const doorMat=std('#3f5240',.45,.25,{envMap:ENV,envMapIntensity:.6});envMats.push(doorMat);

/* ====================== geometry batching ====================== */
const _p=new THREE.Vector3(),_q=new THREE.Quaternion(),_s=new THREE.Vector3(1,1,1),_e=new THREE.Euler();
function TM(x,y,z,ry,rx,rz,sx,sy,sz){_e.set(rx||0,ry||0,rz||0,'YXZ');_q.setFromEuler(_e);_p.set(x,y,z);_s.set(sx||1,sy||1,sz||1);return new THREE.Matrix4().compose(_p,_q,_s);}
const _v=new THREE.Vector3(),_n=new THREE.Vector3(),_nm=new THREE.Matrix3();
function newBucket(){return {p:[],n:[],u:[],i:[],c:[]};}
function addTo(b,geo,m,col){
  const pos=geo.attributes.position,nor=geo.attributes.normal,uv=geo.attributes.uv,ca=geo.attributes.color;
  _nm.getNormalMatrix(m);const base=b.p.length/3;
  for(let i=0;i<pos.count;i++){
    _v.fromBufferAttribute(pos,i).applyMatrix4(m);b.p.push(_v.x,_v.y,_v.z);
    _n.fromBufferAttribute(nor,i).applyMatrix3(_nm).normalize();b.n.push(_n.x,_n.y,_n.z);
    if(uv)b.u.push(uv.getX(i),uv.getY(i));else b.u.push(0,0);
    if(col)b.c.push(col[0],col[1],col[2]);else if(ca)b.c.push(ca.getX(i),ca.getY(i),ca.getZ(i));
  }
  if(geo.index){const ix=geo.index.array;for(let i=0;i<ix.length;i++)b.i.push(base+ix[i]);}
  else for(let i=0;i<pos.count;i++)b.i.push(base+i);
}
function bucketGeo(b){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(b.u,2));
  if(b.c.length)g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));
  g.setIndex(b.p.length/3>65535?new THREE.Uint32BufferAttribute(b.i,1):new THREE.Uint16BufferAttribute(b.i,1));
  return g;
}
const batch=new Map(),CHUNK=150;
const NOCAST=new Set([MAT.paintW,MAT.paintY,MAT.rubber,MAT.glass,MAT.black,MAT.ac,MAT.hydrant,GL.glass]);
function addGeo(mat,geo,m){
  const e=m.elements,key=Math.floor(e[12]/CHUNK)+'_'+Math.floor(e[14]/CHUNK);
  let mm=batch.get(mat);if(!mm){mm=new Map();batch.set(mat,mm);}
  let b=mm.get(key);if(!b){b=newBucket();mm.set(key,b);}addTo(b,geo,m);
}
function flush(){
  batch.forEach((mm,mat)=>{mm.forEach(b=>{if(!b.p.length)return;const me=new THREE.Mesh(bucketGeo(b),mat);me.castShadow=!NOCAST.has(mat);me.receiveShadow=true;scene.add(me);});});
  batch.clear();
  if(bushBucket&&bushBucket.p.length){const bm=new THREE.Mesh(bucketGeo(bushBucket),bushMat);bm.receiveShadow=true;scene.add(bm);}
}
const _bg={},_cg={};
function boxGeo(w,h,d){const k=w+'|'+h+'|'+d;return _bg[k]||(_bg[k]=new THREE.BoxGeometry(w,h,d));}
function cylGeo(rt,rb,h,seg,open){const k=[rt,rb,h,seg,open].join('|');return _cg[k]||(_cg[k]=new THREE.CylinderGeometry(rt,rb,h,seg,1,!!open));}
const bx=(mat,w,h,d,x,y,z,ry)=>addGeo(mat,boxGeo(w,h,d),TM(x,y,z,ry||0));
const cyl=(mat,rt,rb,h,seg,x,y,z,rx,rz,ry,open)=>addGeo(mat,cylGeo(rt,rb,h,seg,open),TM(x,y,z,ry||0,rx||0,rz||0));

/* ====================== layout registries ====================== */
const ROADS=[],PATHS=[],PLAZA=[],DIRT=[],FOOT=[],colliders=[],lampRoads=[];
const glowPts=[];const labels=[];
const flags=[],socks=[];
const LAYOUT={x0:-175,x1:175,z0:-210,z1:140};
function addRoad(x1,z1,x2,z2,lamps){ROADS.push([x1,z1,x2,z2]);if(lamps)lampRoads.push([x1,z1,x2,z2]);}

/* ---- terrain height (flat inside the compound, hills outside, flat corridor on the approach road) ---- */
function terrH(x,z){return 0;

  const dx=Math.max(Math.abs(x)-190,0),dz=Math.max(Math.abs(z+35)-200,0);
  let a=smooth(0,260,Math.hypot(dx,dz));
  if(z>140)a*=smooth(18,70,Math.abs(x));
  const n=fbm(x*.0028+3,z*.0028-7,4),m=Math.max(0,n+.15);
  return a*(m*140+fbm(x*.012,z*.012,3)*18);
}

/* ====================== facades / buildings ====================== */
const facCache={};
const S_PX=34;
let grainPat=null;
function layoutFor(W,o,doors){
  const bays=Math.max(1,Math.round(W/o.bay)),bw=W/bays,db=[];
  doors.forEach(f=>{const b=clamp(Math.round(f*bays-.5),0,bays-1);if(db.indexOf(b)<0)db.push(b);});
  const wins=[],doorX=[];
  for(let f=0;f<o.floors;f++)for(let b=0;b<bays;b++){const x=(b+.5)*bw;if(f===0&&db.indexOf(b)>=0){doorX.push(x);continue;}wins.push([x,f]);}
  return {bays,bw,wins,doorX};
}
function drawFacade(W,H,o,lay){
  const S=S_PX,w=Math.max(64,Math.round(W*S)),h=Math.max(64,Math.round(H*S)),[c,g]=mk(w,h);
  const ym=m=>h-m*S;
  if(!grainPat)grainPat=withSeed('bar|grain',()=>{const [gc,gg]=mk(256,256);for(let n=0;n<9000;n++){const v=rng()<.5?0:255;gg.fillStyle=`rgba(${v},${v},${v},${R(.04,.16)})`;gg.fillRect(R(0,256),R(0,256),R(1,2.5),R(1,2.5));}return gc;});
  g.fillStyle=o.color;g.fillRect(0,0,w,h);
  for(let n=0;n<Math.round(w*h/9000);n++){const x=R(0,w),y=R(0,h),r=R(30,140),lt=rng()<.5,gr=g.createRadialGradient(x,y,0,x,y,r);
    gr.addColorStop(0,lt?'rgba(255,250,235,.10)':'rgba(40,32,22,.10)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2);}
  g.fillStyle=g.createPattern(grainPat,'repeat');g.fillRect(0,0,w,h);
  for(let n=0;n<Math.round(W*1.6);n++){const x=R(0,w),l=R(h*.15,h*.75),wd=R(1.5,7),gr=g.createLinearGradient(0,0,0,l);
    gr.addColorStop(0,'rgba(45,38,28,.14)');gr.addColorStop(1,'rgba(45,38,28,0)');g.save();g.translate(x,R(0,h*.4));g.fillStyle=gr;g.fillRect(0,0,wd,l);g.restore();}
  g.fillStyle=o.plinth;g.fillRect(0,ym(.9),w,.9*S);
  for(let n=0;n<Math.round(W*14);n++){g.fillStyle=rng()<.5?'rgba(255,255,255,.14)':'rgba(0,0,0,.2)';g.fillRect(R(0,w),R(h-.9*S,h),R(2,9),R(2,6));}
  g.fillStyle='rgba(0,0,0,.3)';g.fillRect(0,ym(.9)-2,w,3);
  if(o.stone){
    const bh=.36*S,py=h-1.15*S;g.fillStyle='#8b857a';g.fillRect(0,py,w,1.15*S);
    for(let r=0;r<3;r++){const bw=(r%2?.9:.7)*S,off=(r%2)*.35*S;
      for(let x=-bw;x<w+bw;x+=bw){const v=R(-14,14)|0;g.fillStyle=`rgb(${176+v},${170+v},${156+v})`;g.fillRect(x+off+1.5,py+r*bh+1.5,bw-3,bh-3);
        const gr=g.createLinearGradient(0,py+r*bh,0,py+(r+1)*bh);gr.addColorStop(0,'rgba(255,255,255,.1)');gr.addColorStop(1,'rgba(0,0,0,.2)');g.fillStyle=gr;g.fillRect(x+off+1.5,py+r*bh+1.5,bw-3,bh-3);}}
    g.fillStyle='rgba(0,0,0,.3)';g.fillRect(0,py,w,3);
  }
  const dg=g.createLinearGradient(0,h,0,h-1.6*S);dg.addColorStop(0,'rgba(70,52,34,.6)');dg.addColorStop(1,'rgba(70,52,34,0)');g.fillStyle=dg;g.fillRect(0,h-1.6*S,w,1.6*S);
  for(let f=1;f<o.floors;f++){g.fillStyle='rgba(0,0,0,.2)';g.fillRect(0,ym(f*o.fh)+.12*S,w,.14*S);}
  lay.wins.forEach(a=>{
    const cx=a[0]*S,cy=ym(a[1]*o.fh+o.sill+o.winH/2),ww=o.winW*S,wh=o.winH*S,rx=ww/2+.55*S,ry=wh/2+.55*S;
    const gr=g.createRadialGradient(cx,cy,Math.min(ww,wh)*.3,cx,cy,Math.max(rx,ry));gr.addColorStop(0,'rgba(25,18,10,.30)');gr.addColorStop(1,'rgba(25,18,10,0)');
    g.fillStyle=gr;g.fillRect(cx-rx,cy-ry,rx*2,ry*2);
    const sy=cy+wh/2+.12*S,sg=g.createLinearGradient(0,sy,0,sy+1.7*S);sg.addColorStop(0,'rgba(40,32,22,.30)');sg.addColorStop(1,'rgba(40,32,22,0)');
    g.fillStyle=sg;g.fillRect(cx-ww*.42,sy,ww*.84,1.7*S);
  });
  lay.doorX.forEach(x=>{const cx=x*S,cy=ym(1.9),rx=1.7*S,ry=2.2*S,gr=g.createRadialGradient(cx,cy,S*.8,cx,cy,ry);gr.addColorStop(0,'rgba(20,14,8,.30)');gr.addColorStop(1,'rgba(20,14,8,0)');g.fillStyle=gr;g.fillRect(cx-rx,cy-ry,rx*2,ry*2);});
  for(let n=0;n<Math.max(2,Math.round(W/3));n++){
    const x=R(0,w),y=R(h*.1,h*.8),pw=R(.3,1.1)*S,ph=R(.2,.8)*S;g.fillStyle=rng()<.5?'rgba(255,248,230,.13)':'rgba(30,24,16,.12)';
    g.beginPath();g.moveTo(x,y);for(let k=1;k<=7;k++){const a=k/7*TAU;g.lineTo(x+Math.cos(a)*pw*R(.5,1),y+Math.sin(a)*ph*R(.5,1));}g.closePath();g.fill();
  }
  return c;
}
function facadeSet(W,H,o,doors){
  const key=[W.toFixed(1),H.toFixed(1),o.stone?1:0,o.color,o.plinth,o.floors,o.fh,o.winW,o.winH,o.sill,o.bay,doors.join('_')].join('|');
  if(facCache[key])return facCache[key];
  const lay=layoutFor(W,o,doors);
  const mat=new THREE.MeshStandardMaterial({map:tex(bakedResult('bar|'+BAR_V+'|facade|'+key,()=>drawFacade(W,H,o,lay)),{repeat:false}),roughness:.95,metalness:0});
  addBump(mat,STUCCO,W/1.6,H/1.6,.035,false);
  return facCache[key]={mat,lay};
}
const winReg=new Map(),frameMats={},CURT=['#d9cfb4','#c7d1d6','#d8b9a0','#bfc9b0','#e6e2d8','#b9c4d0'].map(h=>C(h).toArray());
function frameMatFor(hex){return frameMats[hex]||(frameMats[hex]=std(hex,.6,0));}
function winSet(ww,wh,bars,fh,bid){const k=[ww,wh,bars?1:0,fh,bid].join('|');let r=winReg.get(k);if(!r){r={ww,wh,bars,fh,glass:[],curtain:[],lit:[]};winReg.set(k,r);}return r;}
function boxFaces(b,w,h,d,x,y,z,mask){
  const hx=w/2,hy=h/2,hz=d/2;
  const F=[[[1,0,0],[[hx,-hy,hz],[hx,-hy,-hz],[hx,hy,-hz],[hx,hy,hz]]],[[-1,0,0],[[-hx,-hy,-hz],[-hx,-hy,hz],[-hx,hy,hz],[-hx,hy,-hz]]],
    [[0,1,0],[[-hx,hy,hz],[hx,hy,hz],[hx,hy,-hz],[-hx,hy,-hz]]],[[0,-1,0],[[-hx,-hy,-hz],[hx,-hy,-hz],[hx,-hy,hz],[-hx,-hy,hz]]],
    [[0,0,1],[[-hx,-hy,hz],[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz]]],[[0,0,-1],[[hx,-hy,-hz],[-hx,-hy,-hz],[-hx,hy,-hz],[hx,hy,-hz]]]];
  const uvs=[0,0,1,0,1,1,0,1];
  for(let f=0;f<6;f++){if(mask[f]!=='1')continue;const base=b.p.length/3,n=F[f][0];
    F[f][1].forEach((p,k)=>{b.p.push(p[0]+x,p[1]+y,p[2]+z);b.n.push(n[0],n[1],n[2]);b.u.push(uvs[k*2],uvs[k*2+1]);});
    b.i.push(base,base+1,base+2,base,base+2,base+3);}
}
function winFrameGeo(ww,wh,bars){
  const b=newBucket(),t=.07,d=.1,F=(w,h,dd,x,y,z,m)=>boxFaces(b,w,h,dd,x,y,z,m);
  F(ww+2*t,t,d,0,wh/2+t/2,d/2,'001110');F(ww+2*t,t,d,0,-wh/2-t/2,d/2,'001110');
  F(t,wh+2*t,d,-(ww/2+t/2),0,d/2,'110010');F(t,wh+2*t,d,ww/2+t/2,0,d/2,'110010');
  F(.035,wh,.06,0,0,.05,'110010');F(ww,.035,.06,0,wh*.1,.05,'001110');
  F(ww+.34,.07,.24,0,-wh/2-t-.035,.12,'111110');F(ww+.26,.14,.16,0,wh/2+t+.07,.08,'111110');
  if(bars){for(let i=1;i<5;i++)F(.022,wh,.022,-ww/2+i*ww/5,0,.14,'110010');F(ww,.022,.022,0,0,.14,'001110');}
  return bucketGeo(b);
}
const winLod=[];
function buildWindows(){
  winReg.forEach(r=>{
    const all=[].concat(r.glass,r.curtain,r.lit);if(!all.length)return;
    const c=new THREE.Vector3();all.forEach(m=>{c.x+=m.elements[12];c.y+=m.elements[13];c.z+=m.elements[14];});c.multiplyScalar(1/all.length);
    let rad=0;all.forEach(m=>{rad=Math.max(rad,Math.hypot(m.elements[12]-c.x,m.elements[13]-c.y,m.elements[14]-c.z));});rad+=4;
    const fm=new THREE.InstancedMesh(winFrameGeo(r.ww,r.wh,r.bars),frameMatFor(r.fh),all.length);
    all.forEach((m,i)=>fm.setMatrixAt(i,m));fm.frustumCulled=false;fm.receiveShadow=true;scene.add(fm);
    const pg=new THREE.PlaneGeometry(r.ww,r.wh);pg.translate(0,0,.02);const gl=[];
    ['glass','curtain','lit'].forEach(k=>{
      const arr=r[k];if(!arr.length)return;
      const im=new THREE.InstancedMesh(pg,GL[k],arr.length),col=new THREE.Color();
      arr.forEach((m,i)=>{im.setMatrixAt(i,m);
        if(k==='curtain'){const p=CURT[(rng()*CURT.length)|0];col.setRGB(p[0]*R(.85,1.1),p[1]*R(.85,1.1),p[2]*R(.85,1.1));im.setColorAt(i,col);}
        else if(k==='glass'){const t=R(.8,1.15);col.setRGB(t,t,t*R(1,1.08));im.setColorAt(i,col);}});
      if(im.instanceColor)im.instanceColor.needsUpdate=true;im.frustumCulled=false;scene.add(im);gl.push(im);
    });
    winLod.push({fr:fm,gl,sph:new THREE.Sphere(c,rad)});
  });
  winReg.clear();
}
function updateWinLod(cam,FR){
  for(const w of winLod){const d=cam.distanceTo(w.sph.center)-w.sph.radius,inF=FR.intersectsSphere(w.sph);
    w.fr.visible=inF&&d<230;for(const m of w.gl)m.visible=inF&&d<430;}
}
function texRail(){const [c,g]=mk(32,64);g.fillStyle='#fff';g.fillRect(13,0,5,64);g.fillRect(0,56,32,8);return tex(c,{srgb:false});}
let railMat=null;
const solidCache={};
function solid(hex,r,m){const k=hex+'|'+r+'|'+m;return solidCache[k]||(solidCache[k]=std(hex,r===undefined?.9:r,m||0));}
const roofCache={};
function roofMaterial(kind,hex){
  const k=kind+hex;if(roofCache[k])return roofCache[k];
  const map=kind==='metal'?texMetal(hex):kind==='tile'?texTiles(hex):texShingle(hex);
  const m=new THREE.MeshStandardMaterial({map,roughness:kind==='metal'?.55:.9,metalness:kind==='metal'?.35:0,side:THREE.DoubleSide});
  addBump(m,null,1,1,kind==='tile'?.03:.022,true);
  return roofCache[k]=m;
}
function hipRoof(w,d,h,ov,tile){
  const hw=w/2+ov,hd=d/2+ov,inset=Math.min(hd,hw*.999),rx=Math.max(hw-inset,0);
  const A=[-hw,0,hd],B=[hw,0,hd],Cc=[hw,0,-hd],D=[-hw,0,-hd],E=[-rx,h,0],F=[rx,h,0];
  const slopeFB=Math.hypot(h,hd),slopeLR=Math.hypot(h,hw-rx);
  const P=[],U=[];
  const tri=(a,b,c,uvf)=>{[a,b,c].forEach(p=>{P.push(p[0],p[1],p[2]);const uv=uvf(p);U.push(uv[0]/tile,uv[1]/tile);});};
  const fb=p=>[p[0],p[1]/h*slopeFB],lr=p=>[p[2],p[1]/h*slopeLR];
  tri(A,B,F,fb);tri(A,F,E,fb);tri(Cc,D,E,fb);tri(Cc,E,F,fb);tri(B,Cc,F,lr);tri(D,A,E,lr);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
  g.computeVertexNormals();return g;
}
const signMats={};
function signMesh(text,sub,w,h,bg,fg){
  const m=new THREE.MeshStandardMaterial({map:texSign(text,sub,512,Math.round(512*h/w),bg,fg),roughness:.7,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  nightEmis.push({mat:m,base:0,max:0});
  return new THREE.Mesh(new THREE.PlaneGeometry(w,h),m);
}

let noticeMat=null;
function makeNoticeMat(){
  const [c,g]=mk(128,96);g.fillStyle='#3c5a3e';g.fillRect(0,0,128,96);g.strokeStyle='#8b6b43';g.lineWidth=6;g.strokeRect(3,3,122,90);
  for(let n=0;n<7;n++){const x=10+R(0,86),y=10+R(0,56);g.fillStyle=rng()<.7?'#f1efe4':'#e9d98a';g.fillRect(x,y,R(18,30),R(18,26));g.fillStyle='rgba(0,0,0,.35)';for(let k=0;k<4;k++)g.fillRect(x+3,y+4+k*5,R(10,18),1.4);}
  return new THREE.MeshStandardMaterial({map:tex(c,{repeat:false}),roughness:.9});
}
const potMat=std('#7a4a35',.9),shrubMat=std('#2f5a2a',1);
let _shr=null;function shrubGeo(){if(_shr)return _shr;const g=new THREE.IcosahedronGeometry(.5,1);const a=g.attributes.position;for(let i=0;i<a.count;i++){const x=a.getX(i),y=a.getY(i),z=a.getZ(i),k=1+.12*Math.sin(x*9+y*7)*Math.cos(z*8);a.setXYZ(i,x*k,y*k,z*k);}g.computeVertexNormals();return _shr=g;}
let bidCount=0;
function building(o){
  o=Object.assign({rot:0,floors:2,fh:3.4,color:'#b8a98a',trim:'#d2cab4',frame:'#e6e3d9',plinth:'#77746b',winW:1.3,winH:1.6,sill:1.0,bay:3.4,
    doors:[.5],endDoors:[],pitch:.2,roofKind:'shingle',roofColor:'#52565b',stair:false,ac:false,porch:true,veranda:false,bars:false,name:'',sub:'',lit:.45,over:.7},o);
  if(!railMat)railMat=new THREE.MeshStandardMaterial({map:texRail(),color:C('#e8e4d6'),alphaTest:.5,side:THREE.DoubleSide,roughness:.7});
  const W=o.w,D=o.d,H=o.floors*o.fh,vw=o.veranda?2.3:0,over=o.veranda?2.6:o.over;
  const lf=facadeSet(W,H,o,o.doors),ef=facadeSet(D,H,o,o.endDoors),lay=lf.lay,layE=ef.lay;
  const bgeo=new THREE.BoxGeometry(W,H,D);bgeo.clearGroups();bgeo.addGroup(0,12,0);bgeo.addGroup(12,12,1);bgeo.addGroup(24,12,2);
  const mesh=new THREE.Mesh(bgeo,[ef.mat,MAT.concDark,lf.mat]);
  mesh.position.set(o.x,H/2,o.z);mesh.rotation.y=o.rot;mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);
  const rh=Math.max(.6,D*o.pitch),cr=Math.cos(o.rot),sr=Math.sin(o.rot);
  const toW=(lx,lz)=>[o.x+lx*cr+lz*sr,o.z-lx*sr+lz*cr];
  const roofMat=roofMaterial(o.roofKind,o.roofColor),rg=hipRoof(W,D,rh,over,2.2);
  addGeo(roofMat,rg,TM(o.x,H,o.z,o.rot));rg.dispose();
  const B=(mat,w,h,d,lx,ly,lz,lry)=>{const p=toW(lx,lz);addGeo(mat,boxGeo(w,h,d),TM(p[0],ly,p[1],o.rot+(lry||0)));};
  const Cy=(mat,rt,rb,h,seg,lx,ly,lz,rx,rz)=>{const p=toW(lx,lz);addGeo(mat,cylGeo(rt,rb,h,seg),TM(p[0],ly,p[1],o.rot,rx||0,rz||0));};
  const trimMat=solid(o.trim,.9,0),plinthMat=solid(o.plinth,.95,0),fasciaMat=solid('#d9d4c4',.8,0);
  const sw=Math.abs(Math.sin(o.rot)),cw=Math.abs(Math.cos(o.rot)),Dv=D+vw;
  const ex=(cw*W+sw*Dv)/2,ez=(sw*W+cw*Dv)/2,bx0=(cw*W+sw*D)/2,bz0=(sw*W+cw*D)/2;
  colliders.push([o.x-bx0-.3,o.z-bz0-.3,o.x+bx0+.3,o.z+bz0+.3]);
  FOOT.push([o.x-ex,o.z-ez,o.x+ex,o.z+ez]);

  if(o.stone){
    B(trimMat,.3,.12,D+.3,W/2,1.12,0);B(trimMat,.3,.12,D+.3,-W/2,1.12,0);
    for(const fc of [1,-1]){
      const gaps=lay.doorX.map(d=>(fc>0?-W/2+d:W/2-d)).sort((a,b)=>a-b);let cur=-W/2;
      const seg=(a,b)=>{if(b-a>.1)B(trimMat,b-a,.12,.3,(a+b)/2,1.12,fc*D/2);};
      gaps.forEach(gx=>{seg(cur,gx-1.5);cur=gx+1.5;});seg(cur,W/2);
    }
  }else B(plinthMat,W+.2,.8,D+.2,0,.4,0);
  [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(a=>B(trimMat,.42,H,.42,a[0]*(W/2),H/2,a[1]*(D/2)));
  for(let f=1;f<o.floors;f++)B(trimMat,W+.16,.2,D+.16,0,f*o.fh,0);
  B(trimMat,W+.34,.32,D+.34,0,H-.16,0);
  B(MAT.concLight,W+2*over,.06,D+2*over,0,H-.03,0);
  B(fasciaMat,W+2*over,.26,.07,0,H+.05,D/2+over);B(fasciaMat,W+2*over,.26,.07,0,H+.05,-D/2-over);
  B(fasciaMat,.07,.26,D+2*over,W/2+over,H+.05,0);B(fasciaMat,.07,.26,D+2*over,-W/2-over,H+.05,0);
  const W3=(lx,ly,lz)=>{const p=toW(lx,lz);return V(p[0],ly,p[1]);};
  const capBetween=(P0,P1,r)=>{const d=new THREE.Vector3().subVectors(P1,P0),len=d.length();if(len<.05)return;d.normalize();const q=new THREE.Quaternion().setFromUnitVectors(V(0,1,0),d);addGeo(MAT.tileCap,cylGeo(r,r,len,8),new THREE.Matrix4().compose(P0.clone().add(P1).multiplyScalar(.5),q,V(1,1,1)));};
  if(o.roofKind==='tile'){
    const hw=W/2+over,hd=D/2+over,rx=Math.max(hw-Math.min(hd,hw*.999),0);
    if(rx>.2)capBetween(W3(-rx,H+rh,0),W3(rx,H+rh,0),.2);
    [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(a=>capBetween(W3(a[0]*hw,H,a[1]*hd),W3(a[0]*rx,H+rh,0),.14));
    const gy=H-.02,gA=toW(0,D/2+over+.1),gB=toW(0,-D/2-over-.1),gC=toW(W/2+over+.1,0),gD=toW(-W/2-over-.1,0);
    addGeo(MAT.steelLight,cylGeo(.065,.065,W+2*over,8),TM(gA[0],gy,gA[1],o.rot,0,Math.PI/2));addGeo(MAT.steelLight,cylGeo(.065,.065,W+2*over,8),TM(gB[0],gy,gB[1],o.rot,0,Math.PI/2));
    addGeo(MAT.steelLight,cylGeo(.065,.065,D+2*over,8),TM(gC[0],gy,gC[1],o.rot,Math.PI/2,0));addGeo(MAT.steelLight,cylGeo(.065,.065,D+2*over,8),TM(gD[0],gy,gD[1],o.rot,Math.PI/2,0));
    for(let t=-W/2+.4;t<W/2;t+=.55){B(fasciaMat,.1,.14,.5,t,H-.12,D/2+over-.2);B(fasciaMat,.1,.14,.5,t,H-.12,-D/2-over+.2);}
  }else if(W>D+1)B(MAT.steel,W-D+.6,.2,.5,0,H+rh+.1,0);

  const wset=winSet(o.winW,o.winH,o.bars,o.frame,++bidCount);
  const addWin=(lx,lz,ry,y)=>{const p=toW(lx,lz),r=rng(),kind=r<o.lit?'lit':(r<o.lit+.3?'curtain':'glass');wset[kind].push(TM(p[0],y,p[1],o.rot+ry));};
  lay.wins.forEach(a=>{const y=a[1]*o.fh+o.sill+o.winH/2;addWin(-W/2+a[0],D/2,0,y);addWin(W/2-a[0],-D/2,Math.PI,y);});
  layE.wins.forEach(a=>{const y=a[1]*o.fh+o.sill+o.winH/2;addWin(W/2,D/2-a[0],Math.PI/2,y);addWin(-W/2,-D/2+a[0],-Math.PI/2,y);});

  if(o.veranda){
    const zc=D/2+vw/2,zE=D/2+vw;
    B(MAT.conc,W+.4,.18,vw,0,.09,zc);
    for(let f=1;f<o.floors;f++){
      B(trimMat,W+.4,.22,vw,0,f*o.fh-.11,zc);
      B(trimMat,W+.4,.07,.12,0,f*o.fh+1.0,zE-.06);
      const rgeo=new THREE.PlaneGeometry(W,.95),uv=rgeo.attributes.uv;for(let k=0;k<uv.count;k++)uv.setX(k,uv.getX(k)*W/.14);
      const p=toW(0,zE-.06);addGeo(railMat,rgeo,TM(p[0],f*o.fh+.52,p[1],o.rot));rgeo.dispose();
    }
    for(let i=0;i<=lay.bays;i++){
      const lx=-W/2+i*lay.bw;B(trimMat,.34,H,.34,lx,H/2,zE-.17);
      const p=toW(lx,zE-.17);colliders.push([p[0]-.22,p[1]-.22,p[0]+.22,p[1]+.22]);
    }
  }

  const doorGeo=(lx,zf,face,yb)=>{
    const z0=zf+face*.02;
    B(trimMat,.13,3.0,.17,lx-1.05,yb+1.5,z0+face*.04);B(trimMat,.13,3.0,.17,lx+1.05,yb+1.5,z0+face*.04);B(trimMat,2.3,.15,.17,lx,yb+3.0,z0+face*.04);
    for(const sx of [-1,1]){
      B(doorTexMat,.92,2.4,.07,lx+sx*.47,yb+1.2,z0+face*.045);
      B(MAT.steelLight,.05,.32,.05,lx+sx*.1,yb+1.1,z0+face*.1);
    }
    B(doorLit,1.9,.5,.05,lx,yb+2.7,z0+face*.035);B(trimMat,.04,.5,.06,lx,yb+2.7,z0+face*.05);
  };
  const portico=(lx,zf,face)=>{
    const pw=4.8,zc=zf+face*2.05;
    B(MAT.conc,pw,.45,2.5,lx,.225,zf+face*1.25);
    B(MAT.concLight,pw-.3,.3,.5,lx,.15,zf+face*2.75);B(MAT.concLight,pw-.1,.04,.58,lx,.32,zf+face*2.75);
    B(MAT.concLight,pw+.3,.15,.5,lx,.075,zf+face*3.2);B(MAT.concLight,pw+.5,.04,.58,lx,.17,zf+face*3.2);
    for(const sx of [-1,1]){
      B(MAT.concLight,.38,1.0,3.6,lx+sx*(pw/2+.19),.5,zf+face*1.8);B(MAT.concDark,.5,.08,3.7,lx+sx*(pw/2+.19),1.04,zf+face*1.8);
      const cp=toW(lx+sx*1.9,zc);
      addGeo(trimMat,boxGeo(.74,.2,.74),TM(cp[0],.55,cp[1],o.rot));addGeo(trimMat,cylGeo(.32,.34,.14,16),TM(cp[0],.72,cp[1],0));
      addGeo(trimMat,cylGeo(.2,.25,2.55,18),TM(cp[0],2.07,cp[1],0));addGeo(trimMat,cylGeo(.34,.21,.24,16),TM(cp[0],3.46,cp[1],0));addGeo(trimMat,boxGeo(.76,.12,.76),TM(cp[0],3.64,cp[1],o.rot));
      colliders.push([cp[0]-.3,cp[1]-.3,cp[0]+.3,cp[1]+.3]);
    }
    B(trimMat,pw+.7,.38,.62,lx,3.88,zc);B(MAT.concLight,pw+.8,.1,.7,lx,4.1,zc);B(trimMat,pw+.7,.06,2.9,lx,3.75,zf+face*1.6);
    const rg2=hipRoof(pw+.9,2.9,1.0,.3,2.2),pr=toW(lx,zf+face*1.6);addGeo(roofMaterial('tile',o.roofColor),rg2,TM(pr[0],4.1,pr[1],o.rot));rg2.dispose();
    capBetween(W3(lx-(pw+.9)/2+1.45,5.1,zf+face*1.6),W3(lx+(pw+.9)/2-1.45,5.1,zf+face*1.6),.14);
    const lp2=toW(lx,zf+face*2.0);addGeo(lampSmall,cylGeo(.13,.1,.34,10),TM(lp2[0],3.5,lp2[1],0));addGeo(MAT.black,cylGeo(.02,.02,.4,6),TM(lp2[0],3.75,lp2[1],0));glowPts.push(lp2[0],3.45,lp2[1]);
  };
  for(const face of [1,-1]){
    lay.doorX.forEach((dxm,idx)=>{
      const lx=face>0?-W/2+dxm:W/2-dxm,zf=face*D/2,ver=(face>0&&o.veranda),ext=ver?vw:0;
      doorGeo(lx,zf,face,ver?.18:.45);
      if(o.portico&&face>0)portico(lx,zf,face);
      if(!ver&&o.porch&&!(o.portico&&face>0)){
        B(MAT.conc,3.2,.45,1.4,lx,.225,zf+face*.7);B(MAT.conc,3.2,.22,.5,lx,.11,zf+face*1.65);
        B(MAT.concLight,3.7,.16,1.9,lx,3.4,zf+face*.95);
        B(MAT.steel,.12,2.95,.12,lx-1.65,1.9,zf+face*1.75);B(MAT.steel,.12,2.95,.12,lx+1.65,1.9,zf+face*1.75);
      }
      if(ver)B(MAT.conc,3.2,.09,.5,lx,.045,zf+ext+.25);
      { // entrance detail: notice board, door mat, extinguisher, potted shrubs, step handrails
        const onPlat=(o.portico&&face>0),yb=ver?.18:.45,zw=zf+face*.03;
        if(!noticeMat)noticeMat=makeNoticeMat();
        B(noticeMat,.85,.6,.035,lx-1.75,yb+1.55,zw);B(trimMat,.95,.05,.05,lx-1.75,yb+1.88,zw+face*.01);
        B(MAT.red,.2,.52,.17,lx+1.45,yb+.95,zw+face*.09);B(MAT.steel,.1,.08,.1,lx+1.45,yb+1.26,zw+face*.09);
        B(MAT.rubber,1.7,.02,.95,lx,yb+.01,zf+face*(ver?.75:.62));
        for(const sx of [-1,1]){
          const pz=zf+face*(ver?ext-.7:(onPlat?.95:1.15)),pxl=lx+sx*(ver?2.0:(onPlat?2.05:2.45));
          const p=toW(pxl,pz),by=(ver?.18:(onPlat?.45:0));
          addGeo(potMat,cylGeo(.3,.21,.5,16),TM(p[0],by+.25,p[1],0));addGeo(potMat,cylGeo(.34,.34,.07,16),TM(p[0],by+.52,p[1],0));addGeo(MAT.earth,cylGeo(.28,.28,.02,12),TM(p[0],by+.54,p[1],0));
          addBush(TM(p[0],by+.5,p[1],R(0,TAU),0,0,(onPlat?.8:1.05)+(idx%2)*.1,onPlat?.9:1,(onPlat?.8:1.05)));
        }
        if(!ver&&o.porch&&!onPlat)for(const sx of [-1,1])B(MAT.steel,.05,.05,1.9,lx+sx*1.58,1.05,zf+face*1.0);
      }
      const lp=toW(lx+1.25,zf+face*.12);B(lampSmall,.3,.14,.2,lx+1.25,2.95,zf+face*.12);glowPts.push(lp[0],2.9,lp[1]);
      const p0=toW(lx,zf+face*(ext+1.2)),p1=toW(lx,zf+face*(ext+11));
      if(Math.abs(p1[0]-p0[0])>Math.abs(p1[1]-p0[1]))PATHS.push([Math.min(p0[0],p1[0]),Math.min(p0[1],p1[1])-1.6,Math.max(p0[0],p1[0]),Math.max(p0[1],p1[1])+1.6]);
      else PATHS.push([Math.min(p0[0],p1[0])-1.6,Math.min(p0[1],p1[1]),Math.max(p0[0],p1[0])+1.6,Math.max(p0[1],p1[1])]);
      if(face>0&&idx===0&&o.name){
        const sm=signMesh(o.name,o.sub,3.2,.8),sp=ver?toW(lx,D/2+vw-.1):toW(lx,zf+.06);
        sm.position.set(sp[0],ver?o.fh+.6:(o.fh>=3.4?3.78:3.8),sp[1]);sm.rotation.y=o.rot;scene.add(sm);
      }
    });
  }
  [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(a=>Cy(MAT.steel,.07,.07,H,6,a[0]*(W/2+.3),H/2,a[1]*(D/2+.3)));
  for(let i=-1;i<=1;i++){const vp=toW(i*W/4,0);addGeo(MAT.steelLight,cylGeo(.2,.23,.5,14),TM(vp[0],H+rh+.25,vp[1],0));addGeo(MAT.steelLight,cylGeo(.26,.26,.07,14),TM(vp[0],H+rh+.56,vp[1],0));addGeo(MAT.steelLight,new THREE.ConeGeometry(.36,.34,14),TM(vp[0],H+rh+.78,vp[1],0));}
  (o.chimney||[]).forEach(f=>{const cx=W*f,cp=toW(cx,0);addGeo(MAT.brick,boxGeo(1.1,2.9,1.1),TM(cp[0],H+rh+.6,cp[1],o.rot));addGeo(MAT.concLight,boxGeo(1.45,.22,1.45),TM(cp[0],H+rh+2.15,cp[1],o.rot));for(const dx of [-.28,.28])addGeo(MAT.tileCap,cylGeo(.14,.18,.55,10),TM(cp[0]+dx*cr,H+rh+2.55,cp[1]-dx*sr,0));});
  if(o.stair){
    B(MAT.conc,4.2,H-.2,2.6,0,(H-.2)/2,-D/2-1.3);B(MAT.concDark,4.6,.25,3,0,H-.3,-D/2-1.3);
    for(let f=0;f<o.floors;f++){B(MAT.glass,.5,1.9,.06,-1.1,f*o.fh+2,-D/2-2.62);B(MAT.glass,.5,1.9,.06,1.1,f*o.fh+2,-D/2-2.62);}
    B(MAT.steel,1.8,2.4,.14,0,1.65,-D/2-2.62);
  }
  if(o.ac)for(let f=0;f<o.floors;f++)for(const x of [-W/3,-W/6,W/6,W/3]){
    B(MAT.ac,.9,.65,.5,x,f*o.fh+.9,-D/2-.3);B(MAT.black,.5,.5,.04,x,f*o.fh+.9,-D/2-.58);B(MAT.steel,.06,.06,.4,x+.2,f*o.fh+.5,-D/2-.2);
  }
  if(o.name)labels.push([o.name+(o.sub?' - '+o.sub:''),o.x,H+rh+9,o.z]);
  return {x:o.x,z:o.z,W,D,H,rh,B,Cy,toW,rot:o.rot};
}

/* ====================== perimeter, towers, gate ====================== */
const fenceTex=texFence();
const fenceMat=new THREE.MeshStandardMaterial({map:fenceTex,color:C('#c9ced3'),alphaTest:.4,side:THREE.DoubleSide,roughness:.6,metalness:.5});
const coilPos=[];
function fenceLine(x1,z1,x2,z2,h,coil){
  const dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz),th=Math.atan2(-dz,dx),mx=(x1+x2)/2,mz=(z1+z2)/2;
  const g=new THREE.PlaneGeometry(len,h),uv=g.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*len/.7,uv.getY(i)*h/.7);
  const m=new THREE.Mesh(g,fenceMat);m.position.set(mx,h/2,mz);m.rotation.y=th;scene.add(m);
  bx(MAT.steelLight,len,.07,.07,mx,h,mz,th);
  const n=Math.max(1,Math.round(len/4));
  for(let i=0;i<=n;i++){const t=i/n;cyl(MAT.steelLight,.05,.05,h+.5,6,x1+dx*t,(h+.5)/2,z1+dz*t);}
  if(coil){
    const ux=dx/len,uz=dz/len,r=.24,cy=h+.3,steps=Math.floor(len/.05);
    let px=x1,py=cy+r,pz=z1;
    for(let i=1;i<=steps;i++){
      const s=i*.05,ph=s/.4*TAU,nx=x1+ux*s+(-uz)*Math.sin(ph)*r,ny=cy+Math.cos(ph)*r,nz=z1+uz*s+ux*Math.sin(ph)*r;
      coilPos.push(px,py,pz,nx,ny,nz);px=nx;py=ny;pz=nz;
    }
  }
}
function sandbags(x,z,len,rows,ry){
  const ux=Math.cos(ry),uz=-Math.sin(ry);
  for(let r=0;r<rows;r++){const off=(r%2)*.27;
    for(let s=0;s<len;s+=.55){bx(MAT.sandbag,.55,.22,.34,x+ux*(s+off),.11+r*.22,z+uz*(s+off),ry);}}
}
function tower(x,z){
  const hg=7;
  [[-1.4,-1.4],[1.4,-1.4],[1.4,1.4],[-1.4,1.4]].forEach(a=>bx(MAT.steel,.3,hg,.3,x+a[0],hg/2,z+a[1]));
  for(const yy of [2.3,4.6]){bx(MAT.steel,3.1,.12,.12,x,yy,z-1.4);bx(MAT.steel,3.1,.12,.12,x,yy,z+1.4);bx(MAT.steel,.12,.12,3.1,x-1.4,yy,z);bx(MAT.steel,.12,.12,3.1,x+1.4,yy,z);}
  bx(MAT.concDark,4.4,.3,4.4,x,hg+.15,z);
  bx(MAT.olive,3.8,2.3,3.8,x,hg+1.45,z);
  bx(MAT.glass,3.9,.95,3.9,x,hg+1.7,z);
  bx(MAT.steel,4.7,.1,.1,x,hg+.75,z-2.3);bx(MAT.steel,4.7,.1,.1,x,hg+.75,z+2.3);bx(MAT.steel,.1,.1,4.7,x-2.3,hg+.75,z);bx(MAT.steel,.1,.1,4.7,x+2.3,hg+.75,z);
  addGeo(MAT.concDark,new THREE.ConeGeometry(3.7,1.5,4),TM(x,hg+2.6+.75,z,Math.PI/4));
  bx(MAT.steel,.06,hg,.06,x-.3,hg/2,z+1.9);bx(MAT.steel,.06,hg,.06,x+.3,hg/2,z+1.9);
  for(let y=.5;y<hg;y+=.5)bx(MAT.steel,.6,.04,.04,x,y,z+1.9);
  bx(lampSmall,.5,.3,.4,x,hg+2.35,z+2.0);glowPts.push(x,hg+2.35,z+2.0);
  colliders.push([x-2.3,z-2.3,x+2.3,z+2.3]);
  sandbags(x-2.2,z+3.0,4.4,3,0);
}
function buildPerimeter(){
  const L=LAYOUT;
  fenceLine(L.x0,L.z0,L.x1,L.z0,2.4,true);fenceLine(L.x1,L.z0,L.x1,L.z1,2.4,true);fenceLine(L.x1,L.z1,9,L.z1,2.4,true);
  fenceLine(-9,L.z1,L.x0,L.z1,2.4,true);fenceLine(L.x0,L.z1,L.x0,L.z0,2.4,true);
  colliders.push([L.x0-1,L.z0-1,L.x1+1,L.z0+.4],[L.x1-.4,L.z0,L.x1+1,L.z1],[L.x0-1,L.z0,L.x0+.4,L.z1],[9,L.z1-.4,L.x1,L.z1+1],[L.x0,L.z1-.4,-9,L.z1+1]);
  [[-170,-205],[170,-205],[-170,135],[170,135],[-172,-35],[172,-35],[0,-205]].forEach(t=>tower(t[0],t[1]));
}
function texRoadText(txt){
  const [c,g]=mk(512,192);g.fillStyle='#e8e8e2';g.font='bold 150px sans-serif';g.textAlign='center';g.textBaseline='middle';
  g.save();g.translate(256,96);g.scale(1,1.7);g.fillText(txt,0,0);g.restore();
  g.globalCompositeOperation='destination-out';
  for(let n=0;n<1100;n++){g.fillStyle=`rgba(0,0,0,${R(.1,.55)})`;g.fillRect(R(0,512),R(0,192),R(1,4),R(1,3));}
  return tex(c,{repeat:false});
}
function roadText(txt,x,z,w,h){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:texRoadText(txt),transparent:true,roughness:.8,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
  m.rotation.x=-Math.PI/2;m.position.set(x,.06,z);m.receiveShadow=true;scene.add(m);
}
let _jer=null;
function jerseyGeo(){
  if(_jer)return _jer;const sh=new THREE.Shape();
  sh.moveTo(-.3,0);sh.lineTo(.3,0);sh.lineTo(.3,.18);sh.lineTo(.13,.78);sh.lineTo(-.13,.78);sh.lineTo(-.3,.18);sh.lineTo(-.3,0);
  const g=new THREE.ExtrudeGeometry(sh,{depth:3,bevelEnabled:false});g.translate(0,0,-1.5);return _jer=g;
}
function addCoil(x1,z1,x2,z2,cy){
  const dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz),ux=dx/len,uz=dz/len,r=.22,steps=Math.floor(len/.05);let px=x1,py=cy+r,pz=z1;
  for(let i=1;i<=steps;i++){const t=i*.05,ph=t/.4*TAU,nx=x1+ux*t+(-uz)*Math.sin(ph)*r,ny=cy+Math.cos(ph)*r,nz=z1+uz*t+ux*Math.sin(ph)*r;coilPos.push(px,py,pz,nx,ny,nz);px=nx;py=ny;pz=nz;}
}
function gateLeaf(hx,hz,dx,dz,len){
  const ry=Math.atan2(-dz,dx),mx=hx+dx*len/2,mz=hz+dz*len/2,h=2.5;
  bx(MAT.steel,len,.12,.08,mx,.35,mz,ry);bx(MAT.steel,len,.12,.08,mx,h,mz,ry);bx(MAT.steel,len,.1,.06,mx,h*.5,mz,ry);
  bx(MAT.steel,.1,h,.1,hx+dx*.05,h/2+.1,hz+dz*.05);bx(MAT.steel,.1,h,.1,hx+dx*(len-.05),h/2+.1,hz+dz*(len-.05));
  for(let t=.28;t<len-.1;t+=.26)bx(MAT.steel,.04,h-.4,.04,hx+dx*t,h/2+.1,hz+dz*t);
  const ex=hx+dx*len,ez=hz+dz*len;
  bx(MAT.steelLight,len*1.05,.06,.06,mx,h*.5,mz,ry+.38);
  addCoil(hx,hz,ex,ez,h+.25);
}
function buildGate(){
  const z=134,CW=22,CD=10,CY=5.2;
  const barMat=new THREE.MeshStandardMaterial({map:texStripes(),roughness:.5,metalness:.1});barMat.map.repeat.set(5,1);
  const yel=solid('#d8bc3c',.7,0),fr=frameMatFor('#d9d6c8');
  PLAZA.push([-17,120,17,150]);
  // ---- overhead canopy: deck, edge beams, cross beams, fluorescent lighting, round columns with bases and capitals ----
  bx(MAT.concLight,CW,.3,CD,0,CY+.45,z);
  bx(MAT.white,CW+.6,.6,.35,0,CY+.3,z+CD/2);bx(MAT.white,CW+.6,.6,.35,0,CY+.3,z-CD/2);bx(MAT.white,.35,.6,CD,CW/2,CY+.3,z);bx(MAT.white,.35,.6,CD,-CW/2,CY+.3,z);
  bx(MAT.concDark,CW+.7,.1,.45,0,CY+.62,z+CD/2);bx(MAT.concDark,CW+.7,.1,.45,0,CY+.62,z-CD/2);
  for(const x of [-7.8,-3.9,0,3.9,7.8])bx(MAT.concLight,.5,.42,CD-.4,x,CY,z);
  for(const dz of [-2.6,2.6])for(const dx of [-7.8,-3.9,0,3.9,7.8]){bx(MAT.steelLight,2.3,.09,.34,dx,CY-.26,z+dz);bx(lampHeadMat,2.1,.04,.24,dx,CY-.31,z+dz);glowPts.push(dx,CY-.4,z+dz);}
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const cx=sx*10.6,cz=z+sz*4.2;
    bx(MAT.stone2,1.0,.4,1.0,cx,.2,cz);cyl(MAT.stone2,.4,.44,.2,18,cx,.5,cz);
    cyl(MAT.concLight,.33,.37,4.4,20,cx,2.8,cz);
    cyl(yel,.385,.385,.28,20,cx,1.15,cz);cyl(MAT.black,.385,.385,.28,20,cx,1.45,cz);cyl(yel,.385,.385,.28,20,cx,1.75,cz);
    cyl(MAT.concLight,.56,.35,.32,20,cx,5.14,cz);bx(MAT.concLight,1.15,.18,1.15,cx,5.4,cz);
    colliders.push([cx-.5,cz-.5,cx+.5,cz+.5]);
  }
  // ---- name boards on steel frames standing on the deck, with floodlights ----
  for(const sd of [1,-1]){
    const zz=z+sd*(CD/2-.55);
    for(const x of [-7.4,-3.7,0,3.7,7.4])bx(MAT.steel,.16,1.3,.16,x,CY+.6+.65+.0,zz);
    bx(MAT.steel,16.5,3.3,.16,0,CY+.6+1.3+1.65,zz);
    const sg=signMesh('NIGERIAN ARMY',sd>0?'INDEPENDENCE BARRACKS - AUTHORISED PERSONNEL ONLY':'ALL VISITORS REPORT TO THE GUARDROOM',16,3.0,'#1f3a2a','#f2f0e4');
    sg.position.set(0,CY+.6+1.3+1.65,zz+sd*.1);sg.rotation.y=sd>0?0:Math.PI;scene.add(sg);
    for(const x of [-6,0,6]){bx(MAT.steel,.5,.18,.3,x,CY+.6+1.3+3.45,zz+sd*.45);bx(lampHeadMat,.4,.06,.22,x,CY+.6+1.3+3.35,zz+sd*.5);glowPts.push(x,CY+.6+1.3+3.3,zz+sd*.55);}
  }
  // ---- median island with a fully glazed sentry kiosk ----
  bx(MAT.concLight,1.7,.22,24,0,.11,z+1);for(let t=-10;t<=12;t+=2)bx(yel,.25,.02,.9,0,.225,z+1+t);
  bx(MAT.stone2,2.7,.35,3.0,0,.4,z);bx(MAT.olive,2.3,.9,2.6,0,1.02,z);
  for(const sx of [-1,1])for(const sz of [-1,1])bx(MAT.olive,.16,1.35,.16,sx*1.07,1.9,z+sz*1.22);
  addGeo(fr,winFrameGeo(2.0,1.05,false),TM(0,1.9,z+1.28,0));addGeo(fr,winFrameGeo(2.0,1.05,false),TM(0,1.9,z-1.28,Math.PI));
  addGeo(fr,winFrameGeo(2.2,1.05,false),TM(1.15,1.9,z,Math.PI/2));addGeo(fr,winFrameGeo(2.2,1.05,false),TM(-1.15,1.9,z,-Math.PI/2));
  addGeo(GL.glass,new THREE.PlaneGeometry(2.0,1.05),TM(0,1.9,z+1.3,0));addGeo(GL.glass,new THREE.PlaneGeometry(2.0,1.05),TM(0,1.9,z-1.3,Math.PI));
  addGeo(GL.glass,new THREE.PlaneGeometry(2.2,1.05),TM(1.17,1.9,z,Math.PI/2));addGeo(GL.glass,new THREE.PlaneGeometry(2.2,1.05),TM(-1.17,1.9,z,-Math.PI/2));
  bx(MAT.concLight,3.2,.14,3.4,0,2.75,z);bx(MAT.white,3.3,.16,.1,0,2.72,z+1.7);bx(MAT.white,3.3,.16,.1,0,2.72,z-1.7);bx(MAT.white,.1,.16,3.4,1.65,2.72,z);bx(MAT.white,.1,.16,3.4,-1.65,2.72,z);
  bx(MAT.ac,.9,.5,.7,.5,2.95,z-.4);cyl(MAT.steelLight,.03,.03,1.4,6,-1.0,3.5,z+.6);bx(lampSmall,.7,.08,.2,0,2.6,z+1.45);glowPts.push(0,2.55,z+1.5);
  colliders.push([-1.35,z-1.5,1.35,z+1.5]);
  const ks=signMesh('SENTRY','Stop - await instructions',1.6,.5,'#1f3a2a','#f2f0e4');ks.position.set(0,2.35,z+1.33);scene.add(ks);
  // ---- boom barriers with housings, rests, lamps; intercom posts ----
  for(const s of [-1,1]){
    const bz=z-2.6;
    bx(MAT.red,.5,1.15,.5,s*1.2,.58,bz);bx(MAT.black,.52,.12,.52,s*1.2,1.2,bz);bx(lampSmall,.16,.12,.16,s*1.2,1.3,bz);glowPts.push(s*1.2,1.32,bz);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(4.0,.13,.13),barMat);arm.position.set(s*3.3,1.05,bz);arm.castShadow=true;scene.add(arm);
    bx(MAT.steel,.1,.9,.1,s*5.4,.45,bz);bx(MAT.steel,.3,.08,.18,s*5.4,.92,bz);
    bx(MAT.steelLight,.2,1.3,.2,s*2.7,.65,z+3.3);bx(MAT.black,.3,.42,.14,s*2.7,1.5,z+3.3);bx(lampSmall,.1,.1,.05,s*2.7,1.6,z+3.4);
  }
  // ---- guardroom + pass office: stone plinth, tile roofs with caps and gutters, chimneys, columned porches ----
  const g0={floors:1,fh:3.6,color:'#d7cfae',trim:'#efe8d2',frame:'#f1eee2',plinth:'#8b857a',stone:true,portico:true,roofKind:'tile',roofColor:'#a65a3c',chimney:[.3],w:9,d:6,winW:1.3,winH:1.3,sill:.95,bay:3,doors:[.5],pitch:.3,over:.9};
  building(Object.assign({},g0,{x:-14.5,z:z,rot:Math.PI/2,name:'GUARDROOM',sub:'Main gate',lit:.8}));
  building(Object.assign({},g0,{x:14.5,z:z,rot:-Math.PI/2,name:'PASS OFFICE',sub:'Visitors',lit:.7}));
  // ---- stone gate pillars with lanterns and plaques, plus open steel gate leaves ----
  for(const s of [-1,1]){
    const px=s*10.8,pz=LAYOUT.z1;
    bx(MAT.stone2,2.0,4.4,2.0,px,2.2,pz);bx(MAT.concDark,2.3,.3,2.3,px,4.55,pz);bx(MAT.concLight,1.6,.3,1.6,px,4.85,pz);bx(MAT.concDark,.9,.5,.9,px,5.25,pz);
    bx(lampSmall,.55,.5,.55,px,5.7,pz);bx(MAT.concDark,.7,.14,.7,px,6.0,pz);glowPts.push(px,5.7,pz);colliders.push([px-1.1,pz-1.1,px+1.1,pz+1.1]);
    const pl=signMesh('INDEPENDENCE','BARRACKS',1.5,.9,'#2a3a2e','#efe6c9');pl.position.set(px,3.2,pz+1.02);scene.add(pl);
    gateLeaf(s*9.4,LAYOUT.z1,-s*.22,-.975,4.6);
  }
  // ---- road markings, text, humps, crossing ----
  bx(MAT.paintW,10,.03,.45,0,.05,146);roadText('STOP',2.5,152,4.4,1.9);
  for(let x=-4.5;x<=4.5;x+=1)if(Math.abs(x)>.4)bx(MAT.paintW,.5,.03,3,x,.05,143);
  for(const hz of [160,172]){bx(MAT.rubber,10,.1,1.6,0,.05,hz);for(let x=-4.5;x<=4.5;x+=1.5)bx(MAT.paintY,.75,.012,1.62,x,.1,hz);}
  [[-3.4,182],[3.4,190],[-3.4,198]].forEach(a=>{addGeo(MAT.conc,jerseyGeo(),TM(a[0],0,a[1],0));bx(MAT.red,.62,.12,3.0,a[0],.55,a[1]);bx(yel,.14,.14,.05,a[0]+.28,.62,a[1]-1.5);bx(yel,.14,.14,.05,a[0]-.28,.62,a[1]+1.5);});
  const post=(x,zz,mesh)=>{bx(MAT.steel,.08,2.6,.08,x-.5,1.3,zz);bx(MAT.steel,.08,2.6,.08,x+.5,1.3,zz);mesh.position.set(x,2.15,zz+.06);scene.add(mesh);};
  post(7.6,150,signMesh('HALT','SECURITY CHECKPOINT',1.6,.9,'#8a1f1a','#f4f1e4'));
  post(-7.6,152,signMesh('NO PHOTOGRAPHY','Restricted military area',1.8,.9,'#222','#f4f1e4'));
  post(7.6,168,signMesh('20 km/h','Speed limit - speed humps',1.6,.9,'#f4f1e4','#8a1f1a'));
  for(const s of [-1,1]){
    bx(MAT.steelLight,.1,5.5,.1,s*8.2,2.75,z+5.6);bx(MAT.black,.25,.2,.55,s*8.2,5.55,z+5.8);bx(MAT.glass,.05,.1,.04,s*8.2,5.55,z+6.1);
    bx(MAT.steelLight,.14,9,.14,s*16.5,4.5,z+13);bx(MAT.steel,2.2,.2,.5,s*16.5,9.1,z+13);bx(lampHeadMat,.8,.14,.4,s*16.5-.7,8.95,z+13);bx(lampHeadMat,.8,.14,.4,s*16.5+.7,8.95,z+13);
    glowPts.push(s*16.5-.7,8.9,z+13,s*16.5+.7,8.9,z+13);lampPools.push([s*12,z+13,22]);
  }
  for(let x=-10;x<=10;x+=2.2)if(Math.abs(x)>6.2&&Math.abs(x)<9.5){cyl(MAT.steelLight,.12,.12,1,8,x,.5,z+10);cyl(MAT.red,.125,.125,.18,8,x,.85,z+10);}
  sandbags(-19,z+6,6,3,0);sandbags(13,z+9,5,3,0);
  flagPole(-13,123,10);flagPole(13,123,10);
}

/* ====================== medevac helipad ====================== */
const HP={x:-35,z:108};
function texHelipad(){
  const S=1024,K=S/26,cx=S/2,[c,g]=mk(S,S);
  const disc=()=>{g.beginPath();g.arc(cx,cx,12.2*K,0,TAU);};
  g.fillStyle='#4e5054';disc();g.fill();
  g.save();disc();g.clip();
  for(let n=0;n<16000;n++){const v=R(55,125)|0;g.fillStyle=`rgba(${v},${v},${v+2},${R(.2,.55)})`;g.fillRect(R(0,S),R(0,S),R(1,3),R(1,3));}
  for(let n=0;n<40;n++){const x=R(cx-12*K,cx+12*K),y=R(cx-12*K,cx+12*K),r=R(20,90),gr=g.createRadialGradient(x,y,0,x,y,r),dk=rng()<.5;
    gr.addColorStop(0,dk?'rgba(15,15,15,.28)':'rgba(190,190,185,.12)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2);}
  g.restore();
  g.strokeStyle='#eeeee6';g.lineWidth=.45*K;g.beginPath();g.arc(cx,cx,11.3*K,0,TAU);g.stroke();
  g.lineWidth=.22*K;g.beginPath();g.arc(cx,cx,7.6*K,0,TAU);g.stroke();
  g.strokeStyle='#d9bd3c';g.lineWidth=.38*K;g.setLineDash([1.3*K,.8*K]);g.beginPath();g.arc(cx,cx,11.95*K,0,TAU);g.stroke();g.setLineDash([]);
  g.fillStyle='#eeeee6';const hh=6.2*K,hw=4.6*K,t=1.0*K;
  g.fillRect(cx-hw/2,cx-hh/2,t,hh);g.fillRect(cx+hw/2-t,cx-hh/2,t,hh);g.fillRect(cx-hw/2,cx-t/2,hw,t);
  g.textAlign='center';g.textBaseline='middle';g.font='bold '+(1.2*K)+'px sans-serif';g.fillText('MEDEVAC',cx,cx+hh/2+1.7*K);
  g.font='bold '+(.9*K)+'px sans-serif';g.fillText('12 T',cx,cx-hh/2-1.5*K);
  g.globalCompositeOperation='source-atop';
  for(let n=0;n<3200;n++){g.fillStyle=`rgba(${R(70,95)|0},${R(72,96)|0},${R(74,98)|0},${R(.35,.9)})`;g.fillRect(R(0,S),R(0,S),R(1,9),R(1,6));}
  for(let n=0;n<800;n++){g.fillStyle=`rgba(14,14,14,${R(.3,.85)})`;g.beginPath();g.arc(R(0,S),R(0,S),R(.8,3.4),0,TAU);g.fill();}
  g.lineCap='round';
  for(let n=0;n<22;n++){const x=R(cx-8*K,cx+8*K),y=R(cx-8*K,cx+8*K),a=R(0,TAU),l=R(40,170);g.strokeStyle=`rgba(10,10,10,${R(.2,.5)})`;g.lineWidth=R(3,9);
    g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+Math.cos(a)*l*.5+R(-20,20),y+Math.sin(a)*l*.5+R(-20,20),x+Math.cos(a)*l,y+Math.sin(a)*l);g.stroke();}
  g.globalCompositeOperation='source-over';
  return tex(c,{repeat:false});
}
function texSock(){
  const [c,g]=mk(16,128);for(let i=0;i<8;i++){g.fillStyle=i%2?'#f2f0e6':'#e8641c';g.fillRect(0,i*16,16,16);}
  return tex(c,{repeat:false});
}
function buildHelipad(){
  const cx=HP.x,cz=HP.z;
  PLAZA.push([cx-15,cz-13,cx+15,cz+13]);PATHS.push([cx-2,cz+13,cx+2,cz+16.5],[cx-2,cz-19,cx+2,cz-13]);
  lampPools.push([cx,cz,40]);
  cyl(MAT.concLight,12.95,12.95,.12,64,cx,.06,cz);cyl(MAT.concDark,12.6,12.6,.3,64,cx,.15,cz);
  const pm=new THREE.Mesh(new THREE.PlaneGeometry(26,26),new THREE.MeshStandardMaterial({map:texHelipad(),transparent:true,alphaTest:.02,roughness:.85,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));
  pm.rotation.x=-Math.PI/2;pm.position.set(cx,.32,cz);pm.receiveShadow=true;scene.add(pm);
  for(let i=0;i<24;i++){const a=i/24*TAU,x=cx+Math.cos(a)*12.35,zz=cz+Math.sin(a)*12.35;cyl(lampSmall,.13,.13,.1,10,x,.34,zz);glowPts.push(x,.45,zz);}
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const x=cx+sx*13.8,zz=cz+sz*11.8;
    cyl(MAT.steelLight,.14,.2,12,10,x,6,zz);bx(MAT.steel,2.4,.2,.5,x,12.1,zz);bx(lampHeadMat,.8,.14,.4,x-.7,11.95,zz);bx(lampHeadMat,.8,.14,.4,x+.7,11.95,zz);
    glowPts.push(x-.7,11.9,zz,x+.7,11.9,zz);colliders.push([x-.4,zz-.4,x+.4,zz+.4]);
  }
  // windsock on a pole
  const wx=cx+16.5,wz=cz+9;cyl(MAT.steelLight,.07,.1,7,8,wx,3.5,wz);cyl(MAT.concDark,.35,.45,.25,10,wx,.12,wz);
  const piv=new THREE.Group();piv.position.set(wx,7,wz);scene.add(piv);
  const sg=new THREE.CylinderGeometry(.13,.34,2.4,14,1,true);sg.rotateZ(-Math.PI/2);sg.translate(1.2,0,0);
  const sm=new THREE.Mesh(sg,new THREE.MeshStandardMaterial({map:texSock(),side:THREE.DoubleSide,roughness:.9}));piv.add(sm);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.35,.03,6,16),MAT.steelLight);ring.rotation.y=Math.PI/2;piv.add(ring);
  socks.push({p:piv,m:sm,base:.8,ph:rng()*6});
  // signage, fire post, extinguisher cart, bollards
  const hs=signMesh('HELIPAD','NO SMOKING - AUTHORISED PERSONNEL ONLY',2.4,1.2,'#8a1f1a','#f4f1e4');hs.position.set(cx+4.5,2.1,cz+16.5);scene.add(hs);
  bx(MAT.steel,.08,2.6,.08,cx+3.4,1.3,cz+16.45);bx(MAT.steel,.08,2.6,.08,cx+5.6,1.3,cz+16.45);
  building({x:cx-24,z:cz-6,w:7,d:5,floors:1,fh:3.4,rot:Math.PI/2,color:'#c9402e',trim:'#e8e4d6',frame:'#e8e4d6',plinth:'#7a3b30',winW:1.0,winH:1.0,sill:1.2,bay:3.5,doors:[.5],roofKind:'metal',roofColor:'#555a5e',pitch:.12,name:'CRASH POST',sub:'Fire & rescue',lit:.5,over:.8});
  bx(MAT.red,.7,.9,.5,cx+11,.45,cz+14.8);cyl(MAT.steel,.22,.22,.08,12,cx+10.8,.9,cz+14.8);bx(MAT.hydrant,.4,.9,.4,cx-11,.45,cz+14.8);
  for(let x=-3;x<=3;x+=3)cyl(MAT.steelLight,.1,.1,.9,8,cx+x,.45,cz+17.2);
}
function flagPole(x,z,h){
  cyl(MAT.steelLight,.07,.11,h,8,x,h/2,z);cyl(MAT.steelLight,.2,.2,.4,8,x,h+.2,z);
  cyl(MAT.concDark,.35,.45,.3,8,x,.15,z);
  const g=new THREE.PlaneGeometry(3.2,1.6,14,6);g.translate(1.6,0,0);
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:texFlag(),side:THREE.DoubleSide,roughness:.85}));
  m.position.set(x,h-.95,z);m.castShadow=true;scene.add(m);
  flags.push({m,base:g.attributes.position.array.slice(),ph:rng()*6});
}

/* ====================== parade ground, stands, plazas ====================== */
function buildParade(){
  const e=new THREE.Mesh(new THREE.PlaneGeometry(14,14),new THREE.MeshBasicMaterial({map:texEmblem(),transparent:true,opacity:.9,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));
  e.rotation.x=-Math.PI/2;e.position.set(0,.06,-11);scene.add(e);
  for(let x=-40;x<=40;x+=8)bx(MAT.paintW,.14,.03,80,x,.05,-11);
  for(let z=-48;z<=26;z+=8)bx(MAT.paintW,92,.03,.14,0,.05,z);
  bx(MAT.paintW,96,.03,.3,0,.05,-52);bx(MAT.paintW,96,.03,.3,0,.05,30);bx(MAT.paintW,.3,.03,82,-48,.05,-11);bx(MAT.paintW,.3,.03,82,48,.05,-11);
  // reviewing stand
  bx(MAT.concLight,22,1.1,6,0,.55,-49);bx(MAT.conc,22,.2,.8,0,.1,-45.4);
  for(let i=0;i<3;i++)bx(MAT.conc,6,.35,.55,0,.17+i*.37,-45.9+i*.3);
  [[-10,-51],[10,-51],[-10,-46.4],[10,-46.4]].forEach(a=>bx(MAT.steel,.25,4.4,.25,a[0],3.3,a[1]));
  bx(MAT.olive,22.6,.35,7,0,5.6,-49);bx(MAT.red,22.6,.1,7.05,0,5.4,-49);
  bx(MAT.olive,22,3.2,.2,0,3.9,-52);
  for(let x=-8;x<=8;x+=4)bx(MAT.wood,2.6,.45,.9,x,1.3,-47.5);
  colliders.push([-11,-52,11,-46]);
  // benches around the parade
  for(let x=-30;x<=30;x+=15){bx(MAT.wood,3,.1,.5,x,.5,38.3);bx(MAT.steel,.1,.5,.4,x-1.3,.25,38.3);bx(MAT.steel,.1,.5,.4,x+1.3,.25,38.3);}
  // flagpoles on the HQ forecourt
  flagPole(-9,-78,14);flagPole(0,-78,17);flagPole(9,-78,14);
  // parade floodlights
  for(const p of [[-62,-58],[62,-58],[-62,36],[62,36]]){
    cyl(MAT.steelLight,.16,.26,16,8,p[0],8,p[1]);bx(MAT.steel,3.2,.3,.6,p[0],16.1,p[1]);
    for(let i=-1;i<=1;i++){bx(lampHeadMat,.8,.3,.5,p[0]+i*1.1,15.8,p[1]);glowPts.push(p[0]+i*1.1,15.8,p[1]);}
    lampPools.push([p[0]*.7,p[1]>0?p[1]-8:p[1]+8,34]);
  }
}
const lampPools=[];

/* ====================== training: obstacle course + rifle range ====================== */
function buildCourse(){
  const z0=-165;
  DIRT.push([-152,-190,-32,-140]);
  // tire run
  for(let i=0;i<7;i++)for(let j=0;j<2;j++)addGeo(MAT.rubber,new THREE.TorusGeometry(.55,.17,6,12),TM(-148+i*2.2,.18,z0+6+j*1.9,0,Math.PI/2));
  // crawl net
  [[-128,z0+3],[-112,z0+3],[-128,z0+8],[-112,z0+8]].forEach(a=>bx(MAT.log,.2,.95,.2,a[0],.47,a[1]));
  const net=new THREE.Mesh(new THREE.PlaneGeometry(16,5),new THREE.MeshStandardMaterial({map:fenceTex.clone(),color:C('#6c7a55'),alphaTest:.4,side:THREE.DoubleSide,roughness:1}));
  net.material.map.needsUpdate=true;net.material.map.repeat.set(24,8);net.rotation.x=-Math.PI/2;net.position.set(-120,.95,z0+5.5);scene.add(net);
  // log hurdles
  for(let i=0;i<3;i++){const x=-100+i*5;
    bx(MAT.wood,.25,1.1+i*.15,.25,x,.55+i*.07,z0-2);bx(MAT.wood,.25,1.1+i*.15,.25,x,.55+i*.07,z0+2.6);
    cyl(MAT.log,.22,.22,5,8,x,1.0+i*.15,z0+.3,Math.PI/2,0);}
  // walls
  [[-84,1.8],[-78,2.4],[-72,3.0],[-66,3.6]].forEach(a=>{bx(MAT.wood,.35,a[1],4.6,a[0],a[1]/2,z0);bx(MAT.log,.2,a[1]*.9,.2,a[0]+.8,a[1]*.45,z0-2);bx(MAT.log,.2,a[1]*.9,.2,a[0]+.8,a[1]*.45,z0+2);bx(MAT.log,.3,.3,4.6,a[0],a[1]+.05,z0);});
  // rope climb
  bx(MAT.log,.4,7,.4,-56,3.5,z0-2);bx(MAT.log,.4,7,.4,-56,3.5,z0+2);bx(MAT.log,.4,.4,5,-56,7.1,z0);
  for(let i=-1;i<=1;i++)cyl(MAT.sandbag,.04,.04,6.8,6,-56,3.7,z0+i*1.2);
  // monkey bars
  for(let i=0;i<5;i++){bx(MAT.steel,.15,2.5,.15,-48+i*3,1.25,z0-1.1);bx(MAT.steel,.15,2.5,.15,-48+i*3,1.25,z0+1.1);}
  bx(MAT.steel,12.2,.12,.12,-42,2.5,z0-1.1);bx(MAT.steel,12.2,.12,.12,-42,2.5,z0+1.1);
  for(let i=0;i<24;i++)cyl(MAT.steelLight,.03,.03,2.2,5,-47.7+i*.5,2.45,z0,Math.PI/2,0);
  // balance logs + A-frame
  for(let i=0;i<3;i++)cyl(MAT.log,.17,.17,6,8,-146+i*5,.45,z0-8,Math.PI/2,0);
  bx(MAT.wood,.3,6,5,-36,3,z0+5,0);
  // concrete tunnels
  for(let i=0;i<2;i++)addGeo(MAT.concLight,new THREE.CylinderGeometry(.9,.9,3,14,1,true),TM(-120+i*3.1,.9,z0-9,0,0,Math.PI/2));
  MAT.concLight.side=THREE.DoubleSide;
  // sign
  const sg=signMesh('ASSAULT COURSE','NO UNSUPERVISED USE',6,1.5,'#4a3b24','#f2efe0');sg.position.set(-100,2.6,z0+14);scene.add(sg);
  bx(MAT.steel,.15,2.8,.15,-102.5,1.4,z0+13.95);bx(MAT.steel,.15,2.8,.15,-97.5,1.4,z0+13.95);
}
function buildRange(){
  const x0=36,lanes=10,lw=12,fz=-143;
  PLAZA.push([32,-146,160,-139]);
  for(let i=0;i<lanes;i++)DIRT.push([x0+i*lw+3,-191,x0+i*lw+9,-146]);
  // firing line canopy
  bx(MAT.olive,130,.25,7,96,3.4,-142.5);
  for(let x=33;x<=159;x+=12.6){bx(MAT.steel,.25,3.4,.25,x,1.7,-146);bx(MAT.steel,.25,3.4,.25,x,1.7,-139);}
  for(let i=0;i<lanes;i++){
    const cx=x0+i*lw+6;
    bx(MAT.wood,2.2,.9,.8,cx,.45,-141.2);
    for(const d of [-160,-171,-182]){
      bx(MAT.wood,.12,2.2,.12,cx-.5,1.1,d);bx(MAT.wood,.12,2.2,.12,cx+.5,1.1,d);
      const t=new THREE.Mesh(new THREE.PlaneGeometry(.9,1.4),targetMat);t.position.set(cx,1.35,d+.08);scene.add(t);
    }
    bx(MAT.white,.3,.01,48,cx-3.2,.04,-168);
  }
  // earth berm
  const sh=new THREE.Shape();sh.moveTo(194,0);sh.lineTo(194,5);sh.lineTo(191,5.4);sh.lineTo(183,0);sh.lineTo(194,0);
  const bg=new THREE.ExtrudeGeometry(sh,{depth:132,bevelEnabled:false});bg.rotateY(Math.PI/2);bg.translate(32,0,0);
  const bm=new THREE.Mesh(bg,new THREE.MeshStandardMaterial({color:C('#6e6144'),roughness:1}));bm.castShadow=bm.receiveShadow=true;scene.add(bm);
  // range tower
  bx(MAT.steel,.3,7,.3,166,3.5,-145);bx(MAT.steel,.3,7,.3,170,3.5,-145);bx(MAT.steel,.3,7,.3,166,3.5,-149);bx(MAT.steel,.3,7,.3,170,3.5,-149);
  bx(MAT.olive,5,2.4,5,168,8.2,-147);bx(MAT.glass,5.05,.9,5.05,168,8.5,-147);bx(MAT.concDark,5.8,.3,5.8,168,9.5,-147);
  colliders.push([165,-150,171,-144]);
  const sg=signMesh('RIFLE RANGE','CEASE FIRE ON RED FLAG',7,1.6,'#6b1f1a','#f2efe0');sg.position.set(96,2.2,-139.1);sg.rotation.y=Math.PI;scene.add(sg);
}
const targetMat=new THREE.MeshStandardMaterial({map:texTarget(),alphaTest:.4,side:THREE.DoubleSide,roughness:1});

/* ====================== misc structures ====================== */
function waterTower(x,z){
  [[-3,-3],[3,-3],[3,3],[-3,3]].forEach(a=>bx(MAT.steel,.4,14,.4,x+a[0],7,z+a[1]));
  for(const y of [4,8,12]){bx(MAT.steel,6.4,.18,.18,x,y,z-3);bx(MAT.steel,6.4,.18,.18,x,y,z+3);bx(MAT.steel,.18,.18,6.4,x-3,y,z);bx(MAT.steel,.18,.18,6.4,x+3,y,z);}
  cyl(MAT.steelLight,4.2,4.2,6,20,x,17,z);addGeo(MAT.steelLight,new THREE.ConeGeometry(4.4,2.6,20),TM(x,21.3,z));
  cyl(MAT.steel,.15,.15,7,6,x+4.5,3.5,z);
  colliders.push([x-3.6,z-3.6,x+3.6,z+3.6]);
  labels.push(['Water Tower',x,29,z]);
}
function sheds(){
  const b=building({x:-146,z:105,w:20,d:12,floors:1,fh:4.5,rot:0,color:'#8a8c86',trim:'#aaa',winW:.9,winH:.9,sill:2.2,bay:4,doors:[.3],roofKind:'metal',roofColor:'#59606a',pitch:.12,name:'UTILITIES',sub:'Power & water',lit:.2});
  // generator units and a stack
  for(let i=0;i<3;i++){bx(MAT.olive,3,2,1.6,-152+i*4.2,1,117);bx(MAT.steel,.6,1.2,.6,-152+i*4.2,2.6,117);}
  cyl(MAT.steel,.5,.5,8,10,-136,4,100);
  colliders.push([-154,115.5,-139,118.5]);
}
function armoryYard(){
  const x=100,z=82;
  fenceLine(78,66,122,66,2.4,true);fenceLine(122,66,122,106,2.4,true);fenceLine(122,106,78,106,2.4,true);fenceLine(78,106,78,66,2.4,true);
  colliders.push([77.6,65.6,122.4,66.4],[121.6,65.6,122.4,106.4],[77.6,105.6,122.4,106.4],[77.6,65.6,78.4,106.4]);
  PLAZA.push([79,67,121,105]);
  sandbags(110,70,4,3,0);
  bx(MAT.steel,.15,4,.15,84,2,70);bx(MAT.steel,1.4,.3,.4,84,4.1,70);glowPts.push(84,4,70);
}
function trainingWing(){
  building({x:140,z:58,w:40,d:16,floors:2,fh:3.8,rot:Math.PI,color:'#c3bba2',doors:[.5],pitch:.18,name:'TRAINING WING',sub:'Classrooms',winW:1.4,winH:1.8,sill:1.1,bay:4,roofColor:'#5a5e60'});
}

/* ====================== oak trees, grass tufts, wind (ported from terrain-road-3) ====================== */
const UP=V(0,1,0);
const uTime={value:0};
function addGrassWind(mat){
  mat.customProgramCacheKey=()=>'grasswind';
  mat.onBeforeCompile=sh=>{
    sh.uniforms.uTime=uTime;
    sh.vertexShader=sh.vertexShader
      .replace('#include <common>','#include <common>\nuniform float uTime;')
      .replace('#include <project_vertex>',`
        float gs=1.0;
        #ifdef USE_INSTANCING
          gs=1.0-smoothstep(70.0,115.0,-(modelViewMatrix*vec4(instanceMatrix[3].xyz,1.0)).z);
        #endif
        vec4 mvPosition=vec4(transformed*gs,1.0);
        #ifdef USE_INSTANCING
          mvPosition=instanceMatrix*mvPosition;
        #endif
        float ph=uTime*1.7+mvPosition.x*0.12+mvPosition.z*0.1;
        float amp=0.4*position.y*position.y;
        mvPosition.x+=(sin(ph)+0.4*sin(ph*2.3))*amp;
        mvPosition.z+=cos(ph*0.8)*amp*0.5;
        mvPosition=modelViewMatrix*mvPosition;
        gl_Position=projectionMatrix*mvPosition;
      `);
  };
}

function addTreeWind(mat,flutter){
  mat.customProgramCacheKey=()=>'treewind'+(flutter?'L':'B');
  mat.onBeforeCompile=sh=>{
    sh.uniforms.uTime=uTime;
    sh.vertexShader=sh.vertexShader
      .replace('#include <common>','#include <common>\nuniform float uTime;')
      .replace('#include <project_vertex>',`
        vec4 mvPosition=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          mvPosition=instanceMatrix*mvPosition;
        #endif
        float hh=max(position.y,0.0);
        float ph=uTime*1.2+mvPosition.x*0.05+mvPosition.z*0.04;
        float amp=0.0035*hh*hh;
        mvPosition.x+=(sin(ph)+0.4*sin(ph*2.3))*amp;
        mvPosition.z+=cos(ph*0.9)*amp*0.6;
        ${flutter?'mvPosition.xyz+=vec3(sin(uTime*3.5+mvPosition.x*2.0+mvPosition.y),sin(uTime*3.0+mvPosition.z*2.0),cos(uTime*3.3+mvPosition.y*2.0))*0.05;':''}
        mvPosition=modelViewMatrix*mvPosition;
        gl_Position=projectionMatrix*mvPosition;
      `);
  };
}


function wrapDraw(w,h,x,y,fn){for(const dx of [-w,0,w])for(const dy of [-h,0,h])fn(x+dx,y+dy);}

function makeBark(){
  const W=256,H=512,c=document.createElement('canvas');c.width=W;c.height=H;
  const g=c.getContext('2d');
  g.fillStyle='#5d4c3c';g.fillRect(0,0,W,H);
  const cols=['#2a1f17','#3a2c20','#4b3a2a','#6b573f','#7f6c52'];
  g.lineCap='round';
  for(let n=0;n<380;n++){
    const x=Math.random()*W,y=Math.random()*H,len=70+Math.random()*190,wd=2+Math.random()*7;
    const col=cols[(Math.random()*cols.length)|0],a=0.35+Math.random()*0.55;
    const ph=Math.random()*6,amp=1+Math.random()*4;
    wrapDraw(W,H,x,y,(px0,py0)=>{
      g.beginPath();g.strokeStyle=col;g.globalAlpha=a;g.lineWidth=wd;
      for(let s=0;s<=12;s++){const t=s/12;const px=px0+Math.sin(ph+t*5)*amp,py=py0+t*len;s?g.lineTo(px,py):g.moveTo(px,py);}
      g.stroke();
    });
  }
  // deep cracks
  for(let n=0;n<240;n++){
    const x=Math.random()*W,y=Math.random()*H,len=40+Math.random()*150;
    const ph=Math.random()*6,amp=1+Math.random()*3;
    wrapDraw(W,H,x,y,(px0,py0)=>{
      g.beginPath();g.strokeStyle='#150e09';g.globalAlpha=0.7;g.lineWidth=1+Math.random()*2;
      for(let s=0;s<=10;s++){const t=s/10;const px=px0+Math.sin(ph+t*6)*amp,py=py0+t*len;s?g.lineTo(px,py):g.moveTo(px,py);}
      g.stroke();
    });
  }
  // cross fissures
  for(let n=0;n<160;n++){
    const x=Math.random()*W,y=Math.random()*H,l=6+Math.random()*18;
    wrapDraw(W,H,x,y,(px,py)=>{g.beginPath();g.strokeStyle='#1c130d';g.globalAlpha=0.5;g.lineWidth=1.2;g.moveTo(px,py);g.lineTo(px+l,py+(Math.random()-.5)*4);g.stroke();});
  }
  // highlights on ridges
  for(let n=0;n<160;n++){
    const x=Math.random()*W,y=Math.random()*H,len=30+Math.random()*100;
    wrapDraw(W,H,x,y,(px,py)=>{g.beginPath();g.strokeStyle='#9a8666';g.globalAlpha=0.22;g.lineWidth=1.5;g.moveTo(px,py);g.lineTo(px+(Math.random()-.5)*4,py+len);g.stroke();});
  }
  // lichen / moss specks
  for(let n=0;n<28;n++){
    const x=Math.random()*W,y=Math.random()*H,r=6+Math.random()*20;
    wrapDraw(W,H,x,y,(px,py)=>{g.beginPath();g.fillStyle='#6f7d4a';g.globalAlpha=0.13;g.arc(px,py,r,0,6.283);g.fill();});
  }
  g.globalAlpha=1;
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;t.colorSpace=THREE.SRGBColorSpace;
  return t;
}

function makeLeaf(){
  const S=256,c=document.createElement('canvas');c.width=c.height=S;
  const g=c.getContext('2d');
  const leaves=[];
  for(let i=0;i<18;i++){
    const a=Math.random()*6.283,rr=Math.random()*52;
    leaves.push({x:128+Math.cos(a+1.3)*rr,y:128+Math.sin(a+1.3)*rr,ang:Math.random()*6.283,L:56+Math.random()*34,W:15+Math.random()*10,v:140+Math.random()*115});
  }
  leaves.forEach(l=>{
    g.save();g.translate(l.x,l.y);g.rotate(l.ang);
    g.beginPath();g.moveTo(0,0);
    g.quadraticCurveTo(l.W,-l.L*0.5,0,-l.L);
    g.quadraticCurveTo(-l.W,-l.L*0.5,0,0);
    const gr=g.createLinearGradient(0,0,0,-l.L);
    const a=Math.round(l.v*0.72),b=Math.round(Math.min(255,l.v*1.05));
    gr.addColorStop(0,`rgb(${a},${a},${a})`);gr.addColorStop(1,`rgb(${b},${b},${b})`);
    g.fillStyle=gr;g.fill();
    g.strokeStyle='rgba(0,0,0,0.22)';g.lineWidth=1;g.stroke();
    g.beginPath();g.moveTo(0,0);g.lineTo(0,-l.L*0.88);g.strokeStyle='rgba(0,0,0,0.3)';g.lineWidth=1.4;g.stroke();
    g.restore();
  });
  const t=new THREE.CanvasTexture(c);t.anisotropy=4;t.colorSpace=THREE.SRGBColorSpace;
  return t;
}


const perpTo=t=>new THREE.Vector3().crossVectors(t,Math.abs(t.y)<0.98?UP:V(1,0,0)).normalize();
const OAK_DEPTH=[
  {R:8,step:0.55,bend:0.03,up:0.02,taper:0.72,wob:0.05},
  {R:5,step:0.95,bend:0.10,up:0.06,taper:0.42,wob:0.03,kids:[2,3]},
  {R:4,step:0.85,bend:0.20,up:0.05,taper:0.25,wob:0,kids:[0,0]}
];
function makeOak(seed){
  const rng=mulberry32(seed),rand=(a,b)=>a+(b-a)*rng();
  const randUnit=()=>V(rng()*2-1,rng()*2-1,rng()*2-1).normalize();
  const P=[],U=[],I=[],rings=[],leafPts=[];

  function tube(pts,radii,R,uRep,wob,flare){
    const n0=pts.length,last=pts[n0-1],rl=radii[n0-1];
    const dl=last.clone().sub(pts[n0-2]).normalize();
    const PP=pts.slice(),RR=radii.slice();
    (rl<0.2?[[.8,.3],[1.1,.02]]:[[.5,.75],[.9,.35],[1.15,.02]]).forEach(a=>{PP.push(last.clone().addScaledVector(dl,a[0]*rl));RR.push(Math.max(rl*a[1],0.003));});
    const n=PP.length,base=P.length/3,ph=rng()*6.283,ph2=rng()*6.283;
    const r0=Math.max(radii[0],0.03),vStep=1/(2*6.283*r0/uRep);
    let prevN=null,vAcc=0;
    for(let i=0;i<n;i++){
      const a=PP[Math.max(i-1,0)],b=PP[Math.min(i+1,n-1)];
      const t=b.clone().sub(a).normalize();
      const nn=prevN?prevN.clone().addScaledVector(t,-prevN.dot(t)).normalize():perpTo(t);
      prevN=nn;
      const bb=new THREE.Vector3().crossVectors(t,nn);
      if(i>0)vAcc+=PP[i].distanceTo(PP[i-1])*vStep;
      rings.push([base+i*(R+1),R]);
      const hy=Math.max(PP[i].y,0);
      for(let k=0;k<=R;k++){
        const th=k/R*6.283185307;
        let r=RR[i];
        if(wob)r*=1+wob*(0.6*Math.sin(3*th+ph+PP[i].y*0.8)+0.4*Math.sin(5*th+ph2-PP[i].y*1.3));
        if(flare)r*=1+flare*Math.exp(-hy*1.5)*(0.35+0.65*Math.pow(0.5+0.5*Math.cos(5*th+ph),1.5));
        const cx=Math.cos(th),sx=Math.sin(th);
        P.push(PP[i].x+(nn.x*cx+bb.x*sx)*r,PP[i].y+(nn.y*cx+bb.y*sx)*r,PP[i].z+(nn.z*cx+bb.z*sx)*r);
        U.push(k/R*uRep,vAcc);
      }
    }
    for(let i=0;i<n-1;i++)for(let k=0;k<R;k++){
      const a=base+i*(R+1)+k,b=a+1,c=a+R+1,d=c+1;
      I.push(a,b,c,b,d,c);
    }
  }

  function grow(start,dir,len,r0,depth){
    r0=Math.max(r0,0.02);
    const cfg=OAK_DEPTH[depth];
    const steps=Math.max(3,Math.round(len/cfg.step));
    const pts=[start.clone()],radii=[r0];
    const d=dir.clone().normalize(),p=start.clone();
    for(let i=1;i<=steps;i++){
      d.addScaledVector(randUnit(),cfg.bend).addScaledVector(UP,cfg.up).normalize();
      p.addScaledVector(d,len/steps);
      pts.push(p.clone());
      radii.push(r0*(1-(1-cfg.taper)*(i/steps)));
    }
    tube(pts,radii,cfg.R,Math.max(1,Math.round(r0*3)),cfg.wob,depth===0?1.3:0);
    if(depth===2){
      for(let i=1;i<=steps;i++)leafPts.push([pts[i].x+rand(-.25,.25),pts[i].y+rand(-.25,.25),pts[i].z+rand(-.25,.25)]);
    }else if(depth===1){
      for(let i=Math.ceil(steps*0.6);i<=steps;i++)if(rng()<0.6)leafPts.push([pts[i].x,pts[i].y,pts[i].z]);
    }
    if(cfg.kids&&cfg.kids[1]>0){
      const nk=cfg.kids[0]+Math.floor(rng()*(cfg.kids[1]-cfg.kids[0]+1));
      const az0=rng()*6.283;
      for(let k=0;k<nk;k++){
        const idx=Math.min(steps-1,Math.floor(rand(0.3,1.0)*steps));
        const dl=pts[idx+1].clone().sub(pts[idx]).normalize();
        const axis=perpTo(dl).applyAxisAngle(dl,az0+k*2.4+rand(-.4,.4));
        const nd=dl.clone().applyAxisAngle(axis,rand(0.5,1.0)).addScaledVector(UP,0.15);
        grow(pts[idx].clone(),nd,len*rand(0.55,0.78),radii[idx]*rand(0.5,0.7),depth+1);
      }
    }
    return {pts,radii};
  }

  // trunk, central leader, crown limbs, heavy low limbs, buttress roots
  const lean=V(rand(-.1,.1),1,rand(-.1,.1)).normalize();
  const trunk=grow(V(0,-0.4,0),lean,4.2,1.2,0);
  const tp=trunk.pts,tr=trunk.radii,ts=tp.length-1;
  const at=t=>{const i=Math.min(ts-1,Math.floor(t*ts));return {p:tp[i],r:tr[i]};};
  grow(tp[ts-1].clone(),V(rand(-.15,.15),1,rand(-.15,.15)),rand(4.2,5.2),tr[ts-1]*0.72,1);
  const az0=rng()*6.283;
  for(let k=0;k<4;k++){
    const az=az0+k/4*6.283+rand(-.3,.3),el=rand(.7,1.1);
    const a=at(rand(.88,1));
    grow(a.p.clone(),V(Math.cos(az)*Math.cos(el),Math.sin(el),Math.sin(az)*Math.cos(el)),rand(4,5.2),a.r*rand(.58,.68),1);
  }
  for(let k=0;k<2;k++){
    const az=az0+0.9+k*3.1+rand(-.3,.3),el=rand(.25,.55);
    const a=at(rand(.5,.78));
    grow(a.p.clone(),V(Math.cos(az)*Math.cos(el),Math.sin(el),Math.sin(az)*Math.cos(el)),rand(4.6,5.6),a.r*rand(.45,.55),1);
  }
  for(let k=0;k<3;k++){
    const a=k/3*6.283+rand(-.3,.3),L=rand(2.4,3.2),rs=0.45*rand(.9,1.2),rp=[],rr=[];
    for(let i=0;i<=5;i++){
      const t=i/5,dist=0.5+L*t;
      rp.push(V(Math.cos(a)*dist,0.7-1.0*Math.pow(t,0.8),Math.sin(a)*dist));
      rr.push(rs*(1-0.85*t));
    }
    tube(rp,rr,5,2,0,0);
  }

  // bark geometry
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(I),1));
  g.computeVertexNormals();
  const nA=g.attributes.normal.array;
  for(const ring of rings){
    const s=ring[0],R=ring[1],a=s*3,b=(s+R)*3;
    let x=nA[a]+nA[b],y=nA[a+1]+nA[b+1],z=nA[a+2]+nA[b+2];
    const l=Math.hypot(x,y,z)||1;x/=l;y/=l;z/=l;
    nA[a]=nA[b]=x;nA[a+1]=nA[b+1]=y;nA[a+2]=nA[b+2]=z;
  }

  // leaf geometry: clumps of cards with baked orientation, normals pushed outward for a soft round canopy
  let cx=0,cy=0,cz=0,maxY=1;
  leafPts.forEach(p=>{cx+=p[0];cy+=p[1];cz+=p[2];maxY=Math.max(maxY,p[1]);});
  const nl=Math.max(1,leafPts.length);cx/=nl;cy/=nl;cz/=nl;
  const lp=[],ln=[],lu=[],lc=[],li=[];
  const q=new THREE.Quaternion(),e=new THREE.Euler();
  const corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
  leafPts.forEach(pt=>{
    for(let c=0;c<4;c++){
      const pos=V(pt[0],pt[1],pt[2]).addScaledVector(randUnit(),0.8);
      e.set(rng()*6.283,rng()*6.283,rng()*6.283);q.setFromEuler(e);
      const size=rand(2.4,3.4);
      const n0=V(0,0,1).applyQuaternion(q);
      const rad=pos.clone().sub(V(cx,cy,cz)).normalize();
      if(n0.dot(rad)<0)n0.negate();
      const nrm=rad.multiplyScalar(0.7).addScaledVector(n0,0.3).normalize();
      const shade=rand(0.75,1.1)+0.15*(pos.y/maxY);
      const base=lp.length/3;
      corners.forEach((cn,k)=>{
        const v=V(cn[0]*size,cn[1]*size,0).applyQuaternion(q).add(pos);
        lp.push(v.x,v.y,v.z);ln.push(nrm.x,nrm.y,nrm.z);
        lu.push(cn[0]+.5,cn[1]+.5);lc.push(shade,shade,shade);
      });
      li.push(base,base+1,base+2,base,base+2,base+3);
    }
  });
  const lg=new THREE.BufferGeometry();
  lg.setAttribute('position',new THREE.Float32BufferAttribute(lp,3));
  lg.setAttribute('normal',new THREE.Float32BufferAttribute(ln,3));
  lg.setAttribute('uv',new THREE.Float32BufferAttribute(lu,2));
  lg.setAttribute('color',new THREE.Float32BufferAttribute(lc,3));
  lg.setIndex(new THREE.BufferAttribute(new Uint32Array(li),1));
  return {bark:g,leaf:lg};
}

const tuftGeo=(function(){
  const pos=[],col=[];
  for(let b=0;b<2;b++){
    const a=b*Math.PI/2+0.4,c=Math.cos(a),sn=Math.sin(a),w=0.13,bend=0.07;
    pos.push(-c*w,0,-sn*w, c*w,0,sn*w, sn*bend,0.5,-c*bend);
    col.push(.6,.6,.6, .6,.6,.6, 1,1,1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  g.computeVertexNormals();
  return g;
})();

function blocked(x,z,pad){
  for(const c of colliders)if(x>c[0]-pad&&x<c[2]+pad&&z>c[1]-pad&&z<c[3]+pad)return true;
  for(const r of ROADS)if(x>r[0]-pad&&x<r[2]+pad&&z>r[1]-pad&&z<r[3]+pad)return true;
  for(const r of PLAZA)if(x>r[0]-pad&&x<r[2]+pad&&z>r[1]-pad&&z<r[3]+pad)return true;
  for(const r of DIRT)if(x>r[0]-pad&&x<r[2]+pad&&z>r[1]-pad&&z<r[3]+pad)return true;
  for(const r of PATHS)if(x>r[0]-pad&&x<r[2]+pad&&z>r[1]-pad&&z<r[3]+pad)return true;
  for(const r of FOOT)if(x>r[0]-pad-4&&x<r[2]+pad+4&&z>r[1]-pad-4&&z<r[3]+pad+4)return true;
  return false;
}

let updateTrees=null,grassMesh=null,TREE_HI=240;
function buildGrass(){
  const grassMat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});addGrassWind(grassMat);
  const MAXG=30000,gm=[];
  for(let t=0;t<MAXG*5&&gm.length<MAXG;t++){
    let x,z,rs=false;
    if(rng()<.5){const r=ROADS[(rng()*ROADS.length)|0];x=R(r[0]-11,r[2]+11);z=R(r[1]-11,r[3]+11);rs=true;}
    else{x=R(-215,215);z=R(-250,165);}
    if(blocked(x,z,1.8))continue;
    if(z>140&&Math.abs(x)<12)continue;
    gm.push([x,terrH(x,z),z,rs]);
  }
  const grass=new THREE.InstancedMesh(tuftGeo,grassMat,gm.length);grass.frustumCulled=false;grassMesh=grass;
  const cols=['#506629','#718239','#5f7a33','#6b8a36','#8a8a4a','#46602a'].map(h=>C(h)),gc=new THREE.Color();
  gm.forEach((p,i)=>{
    const s=R(.6,1.2)*(p[3]?.7:1);
    grass.setMatrixAt(i,TM(p[0],p[1]-.03,p[2],R(0,TAU),0,0,s,s*R(.8,1.25),s));
    const k=R(.9,1.2),b=cols[(rng()*cols.length)|0];gc.setRGB(Math.min(1.6,b.r*k*1.5),Math.min(1.6,b.g*k*1.5),Math.min(1.6,b.b*k*1.5));grass.setColorAt(i,gc);
  });
  if(grass.instanceColor)grass.instanceColor.needsUpdate=true;
  scene.add(grass);
}
function buildTrees(){
  const barkMat=new THREE.MeshLambertMaterial({map:makeBark()});
  const leafTex=makeLeaf();
  const leafMat=new THREE.MeshLambertMaterial({map:leafTex,alphaTest:.42,side:THREE.DoubleSide,vertexColors:true});
  const leafDepth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map:leafTex,alphaTest:.42});
  addTreeWind(barkMat,false);addTreeWind(leafMat,true);
  const proxyLeafMat=new THREE.MeshLambertMaterial({vertexColors:true}),proxyBarkMat=new THREE.MeshLambertMaterial({color:C('#5a4330')});
  const oaks=[1,2,3,4].map(k=>makeOak(7919*k+13));
  // positions: avenue + parade ring lines, lawn trees between the buildings, forest outside the fence
  const pts=[];
  for(let z=52;z<=118;z+=26)pts.push([-12.5,z,1],[12.5,z,1]);
  for(let z=-56;z<=34;z+=30)pts.push([-69,z,1],[69,z,1]);
  const far=(x,z,d)=>{for(const p of pts){if(Math.abs(p[0]-x)<d&&Math.abs(p[1]-z)<d&&Math.hypot(p[0]-x,p[1]-z)<d)return false;}return true;};
  for(let t=0,n=0;t<8000&&n<16;t++){const x=R(-170,170),z=R(-200,135);if(blocked(x,z,7)||!far(x,z,13))continue;pts.push([x,z,1]);n++;}
  for(let t=0,n=0;t<12000&&n<48;t++){
    const x=R(-208,208),z=R(-245,162);
    if(x>-180&&x<180&&z>-214&&z<146)continue;
    if(z>140&&Math.abs(x)<28)continue;
    if(terrH(x,z)>60)continue;
    const f=fbm(x*.004+60,z*.004-20,3);if(f<-.05&&rng()>.15)continue;
    if(!far(x,z,11))continue;
    pts.push([x,z,0]);n++;
  }
  const leafCols=['#4a8a2e','#3f7d2a','#5a9a34','#6aa83a','#3a7426'];
  const trees=[],cnt=[0,0,0,0];
  pts.filter((_,i)=>i%20===0).forEach((p,i)=>{ // keep 1 tree in 20 (95% removed)
    const s=R(.75,1.15),y=terrH(p[0],p[1]),vi=i%4;cnt[vi]++;
    trees.push({vi,x:p[0],y,z:p[1],m:TM(p[0],y,p[1],R(0,TAU),0,0,s,s*R(.95,1.1),s),col:C(leafCols[(rng()*leafCols.length)|0]).multiplyScalar(1.4*R(.9,1.1))});
    if(p[2])colliders.push([p[0]-.9*s,p[1]-.9*s,p[0]+.9*s,p[1]+.9*s]);
  });
  const barkM=[],leafM=[];
  oaks.forEach((oak,vi)=>{
    const n=Math.max(1,cnt[vi]);
    const bm=new THREE.InstancedMesh(oak.bark,barkMat,n),lm=new THREE.InstancedMesh(oak.leaf,leafMat,n);
    lm.customDepthMaterial=leafDepth;lm.setColorAt(0,new THREE.Color(0x4a8a2e));
    [bm,lm].forEach(m=>{m.frustumCulled=false;m.castShadow=true;m.receiveShadow=true;m.count=0;scene.add(m);});
    barkM.push(bm);leafM.push(lm);
  });
  // far LOD: round proxy oaks
  const blobs=[[4.6,0,7.4,0,1,.9,1],[3.2,3.2,6.2,.8,1,1,1],[3.2,-2.8,6.0,-1.4,1,1,1],[2.8,.6,9.6,-1.8,1,1,1]];
  const cArr=[],nArr=[],pcArr=[];
  blobs.forEach(b=>{
    const g=new THREE.IcosahedronGeometry(b[0],1);g.scale(b[4],b[5],b[6]);g.translate(b[1],b[2],b[3]);
    const a=g.attributes.position.array;
    for(let i=0;i<a.length;i+=3){const nx=a[i]-b[1],ny=a[i+1]-b[2],nz=a[i+2]-b[3],l=Math.hypot(nx,ny,nz)||1,sh=.7+.4*Math.min(1,Math.max(0,(a[i+1]-3)/8));cArr.push(a[i],a[i+1],a[i+2]);nArr.push(nx/l,ny/l,nz/l);pcArr.push(sh,sh,sh);}
    g.dispose();
  });
  const canopyG=new THREE.BufferGeometry();
  canopyG.setAttribute('position',new THREE.Float32BufferAttribute(cArr,3));canopyG.setAttribute('normal',new THREE.Float32BufferAttribute(nArr,3));canopyG.setAttribute('color',new THREE.Float32BufferAttribute(pcArr,3));
  const trunkG=new THREE.CylinderGeometry(.8,1.4,6,5,1);trunkG.translate(0,2.6,0);
  const NT=Math.max(1,trees.length);
  const pcm=new THREE.InstancedMesh(canopyG,proxyLeafMat,NT),ptm=new THREE.InstancedMesh(trunkG,proxyBarkMat,NT);
  pcm.setColorAt(0,new THREE.Color(0x4a8a2e));
  [pcm,ptm].forEach(m=>{m.frustumCulled=false;m.count=0;scene.add(m);});
  const LO=1300,fr=new THREE.Frustum(),pm4=new THREE.Matrix4(),sph=new THREE.Sphere(new THREE.Vector3(),11);
  const lastV=new THREE.Matrix4(),lastC=new THREE.Vector3(1e9,0,0);let lastHi=-1;
  updateTrees=function(cam,focus){
    camera.updateMatrixWorld();
    // the lists only change when the view does: skip the loop and the buffer upload while the camera is (nearly) still
    if(TREE_HI===lastHi&&lastC.distanceToSquared(cam)<.25*.25){let same=true;const a=camera.matrixWorldInverse.elements,b=lastV.elements;for(let i=0;i<16;i++)if(Math.abs(a[i]-b[i])>1e-4){same=false;break;}if(same)return;}
    lastHi=TREE_HI;lastC.copy(cam);lastV.copy(camera.matrixWorldInverse);
    fr.setFromProjectionMatrix(pm4.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const nh=[0,0,0,0];let nf=0;
    for(let i=0;i<trees.length;i++){
      const t=trees[i],dx=t.x-cam.x,dz=t.z-cam.z,d2=dx*dx+dz*dz;
      if(d2>=LO*LO)continue;
      sph.center.set(t.x,t.y+6,t.z);
      const vis=fr.intersectsSphere(sph);
      if(d2<TREE_HI*TREE_HI){
        const fx=t.x-focus.x,fz=t.z-focus.z;
        if(!vis&&fx*fx+fz*fz>85*85)continue;
        const k=t.vi,j=nh[k]++;barkM[k].setMatrixAt(j,t.m);leafM[k].setMatrixAt(j,t.m);leafM[k].setColorAt(j,t.col);
      }else if(vis){pcm.setMatrixAt(nf,t.m);pcm.setColorAt(nf,t.col);ptm.setMatrixAt(nf,t.m);nf++;}
    }
    for(let k=0;k<4;k++){barkM[k].count=leafM[k].count=nh[k];barkM[k].instanceMatrix.needsUpdate=leafM[k].instanceMatrix.needsUpdate=true;if(leafM[k].instanceColor)leafM[k].instanceColor.needsUpdate=true;}
    pcm.count=ptm.count=nf;pcm.instanceMatrix.needsUpdate=ptm.instanceMatrix.needsUpdate=true;if(pcm.instanceColor)pcm.instanceColor.needsUpdate=true;
  };
  updateTrees(camera.position,camera.position);
}

/* ====================== ground ====================== */
const SPL={x:-200,z:-235,s:400,px:2048};
function paintSplat(){
  const [c,g]=mk(SPL.px,SPL.px);g.fillStyle='#000';g.fillRect(0,0,SPL.px,SPL.px);
  const K=SPL.px/SPL.s;
  const rect=(col,x1,z1,x2,z2,gr)=>{gr=gr||0;g.fillStyle=col;g.fillRect((x1-gr-SPL.x)*K,(z1-gr-SPL.z)*K,(x2-x1+2*gr)*K,(z2-z1+2*gr)*K);};
  ROADS.forEach(r=>rect('#0000ff',r[0],r[1],r[2],r[3],1.4));
  DIRT.forEach(r=>rect('#0000ff',r[0],r[1],r[2],r[3]));
  PLAZA.forEach(r=>rect('#00ff00',r[0],r[1],r[2],r[3]));
  FOOT.forEach(r=>rect('#00ff00',r[0],r[1],r[2],r[3],3.2));
  PATHS.forEach(r=>rect('#00ff00',r[0],r[1],r[2],r[3]));
  ROADS.forEach(r=>rect('#ff0000',r[0],r[1],r[2],r[3]));
  const t=new THREE.CanvasTexture(c);t.flipY=false;t.anisotropy=8;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return t;
}
function buildGround(){
  const splat=paintSplat(),wear=paintWear();
  const tG=texGrassDetail(),tH=texHue(),tA=texAsphaltFine(),tAM=texAsphaltMacro(),tC=texConcreteFine(),tJ=texConcreteJoint(),tD=texDirt();
  const g=new THREE.PlaneGeometry(430,420,86,84);g.rotateX(-Math.PI/2);g.translate(0,0,-40);
  const P=g.attributes.position,tint=new Float32Array(P.count*3);
  for(let i=0;i<P.count;i++){
    const x=P.getX(i),z=P.getZ(i);P.setY(i,terrH(x,z));
    const n=fbm(x*.01+9,z*.01-4,2),n2=fbm(x*.05,z*.05,2);
    tint[i*3]=1+.12*n+.03*n2;tint[i*3+1]=1+.05*n;tint[i*3+2]=1-.16*Math.max(0,n);
  }
  g.setAttribute('gtint',new THREE.BufferAttribute(tint,3));g.computeVertexNormals();
  const mat=new THREE.MeshStandardMaterial({roughness:1,metalness:0});
  mat.extensions={derivatives:true};
  mat.customProgramCacheKey=()=>'fh-ground4';
  mat.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,{tSplat:{value:splat},tWear:{value:wear},tGrass:{value:tG},tHue:{value:tH},tAsph:{value:tA},tAMac:{value:tAM},tConc:{value:tC},tJoint:{value:tJ},tDirt:{value:tD},uSp:{value:new THREE.Vector3(SPL.x,SPL.z,SPL.s)}});
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 gtint;\nvarying vec3 vTint;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvWP=transformed;vTint=gtint;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D tSplat;\nuniform sampler2D tWear;\nuniform sampler2D tGrass;\nuniform sampler2D tHue;\nuniform sampler2D tAsph;\nuniform sampler2D tAMac;\nuniform sampler2D tConc;\nuniform sampler2D tJoint;\nuniform sampler2D tDirt;\nuniform vec3 uSp;\nvarying vec3 vTint;\nvarying vec3 vWP;\n'+PERT)
      .replace('#include <map_fragment>',`
        vec2 sUV=(vWP.xz-uSp.xy)/uSp.z;
        vec3 spR=vec3(0.0),wr=vec3(0.0);
        if(sUV.x>0.0&&sUV.y>0.0&&sUV.x<1.0&&sUV.y<1.0){spR=texture2D(tSplat,sUV).rgb;wr=texture2D(tWear,sUV).rgb;}
        vec2 pp=vWP.xz;
        vec4 g1=texture2D(tGrass,pp*0.42);
        vec3 th=vec3(0.5+(g1.r-0.5)*0.55);
        vec3 sp=smoothstep(th-vec3(0.09),th+vec3(0.09),spR);
        float tot=sp.r+sp.g+sp.b;
        float fadeD=smoothstep(45.0,170.0,length(vViewPosition));
        vec3 hue=texture2D(tHue,pp/90.0).rgb;
        vec3 gd=g1.rgb*texture2D(tGrass,pp*0.047+vec2(0.37,0.11)).rgb*4.0;
        gd=mix(gd,vec3(1.0),fadeD);
        float inC=step(abs(pp.x),178.0)*step(pp.y,142.0)*step(-212.0,pp.y);
        float mow=1.0+inC*0.05*sin(pp.x*1.9+sin(pp.y*0.04)*1.6);
        // the colour textures are sRGB-tagged, so the sampler already hands back LINEAR values: no extra pow(2.2) (that doubled the decode and made the whole ground, road and lawn far too dark)
        vec3 grLin=hue*vTint*gd*mow;
        vec3 af=texture2D(tAsph,pp/2.2).rgb;
        vec3 am=texture2D(tAMac,pp/16.0).rgb*2.0;
        vec3 asp=af*am;
        asp*=1.0-0.30*wr.r;
        asp*=1.0-0.42*wr.b;
        asp=mix(asp,vec3(0.5,0.45,0.36)*0.85,wr.g*0.6);
        vec3 cF=texture2D(tConc,pp/2.4).rgb;
        vec2 slab=floor(pp/4.0);
        float sh=fract(sin(dot(slab,vec2(12.9898,78.233)))*43758.5453);
        vec3 con=cF*texture2D(tJoint,pp/4.0).rgb*(0.86+0.28*sh)*(0.8+0.4*am.g*0.5);
        vec3 drt=texture2D(tDirt,pp/3.0).rgb;
        vec3 ng=(asp*1.25*sp.r+con*sp.g+drt*sp.b)/max(tot,1.0);
        diffuseColor.rgb=grLin*(1.0-min(tot,1.0))+ng;
      `)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=mix(1.0,0.84,min(sp.r,1.0));
        roughnessFactor=mix(roughnessFactor,0.68,clamp(wr.r*sp.r,0.0,1.0));
        roughnessFactor=mix(roughnessFactor,0.9,min(sp.g,1.0));
      `)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        float bh=(dot(af,vec3(0.333))*sp.r+dot(cF,vec3(0.333))*sp.g+dot(drt,vec3(0.333))*sp.b+g1.r*0.4*(1.0-min(tot,1.0)))*(1.0-fadeD);
        normal=perturbNormalArb2(-vViewPosition,normal,vec2(dFdx(bh),dFdy(bh))*0.05);
      `);
  };
  const m=new THREE.Mesh(g,mat);m.receiveShadow=true;scene.add(m);
  const rg=new THREE.PlaneGeometry(10,300),uv=rg.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*10/2.2,uv.getY(i)*300/2.2);
  const rm=new THREE.Mesh(rg,new THREE.MeshStandardMaterial({map:tA,roughness:.85,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  
}

/* ====================== lamps, pools, glow, stars, sky ====================== */
let skyMesh=null,lampsMesh=null,poolsMesh=null,glowPoints=null,stars=null,skyMat=null;
function buildLamps(){
  const pts=[];
  lampRoads.forEach(r=>{
    const horiz=(r[2]-r[0])>(r[3]-r[1]),len=horiz?r[2]-r[0]:r[3]-r[1],cnt=Math.max(1,Math.round(len/32));
    for(let i=0;i<cnt;i++){
      const t=(i+.5)*len/cnt,s=i%2?1:-1;let x,z,dx=0,dz=0;
      if(horiz){x=r[0]+t;z=s>0?r[3]+.9:r[1]-.9;dz=-s;}else{z=r[1]+t;x=s>0?r[2]+.9:r[0]-.9;dx=-s;}
      if(blocked(x,z,1.5)&&!(x>r[0]-2&&x<r[2]+2&&z>r[1]-2&&z<r[3]+2)){continue;}
      let bad=false;for(const c of colliders)if(x>c[0]-1&&x<c[2]+1&&z>c[1]-1&&z<c[3]+1){bad=true;break;}
      for(const pz of PLAZA)if(x>pz[0]&&x<pz[2]&&z>pz[1]&&z<pz[3]&&Math.abs(pz[2]-pz[0])>60&&Math.abs(pz[3]-pz[1])>60){bad=true;break;}
      if(bad)continue;
      pts.push([x,z,dx,dz]);
    }
  });
  const pb=newBucket();
  addTo(pb,cylGeo(.1,.15,9,8),TM(0,4.5,0));addTo(pb,boxGeo(2.4,.12,.12),TM(1.2,8.95,0));
  const poleGeo=bucketGeo(pb);
  lampsMesh=new THREE.InstancedMesh(poleGeo,MAT.steel,pts.length);
  const heads=new THREE.InstancedMesh(boxGeo(1.0,.16,.45),lampHeadMat,pts.length);
  pts.forEach((p,i)=>{
    const th=Math.atan2(-p[3],p[2]);
    lampsMesh.setMatrixAt(i,TM(p[0],0,p[1],th));
    heads.setMatrixAt(i,TM(p[0]+p[2]*2.3,8.8,p[1]+p[3]*2.3,th));
    glowPts.push(p[0]+p[2]*2.3,8.75,p[1]+p[3]*2.3);
    lampPools.push([p[0]+p[2]*2.6,p[1]+p[3]*2.6,15]);
  });
  [lampsMesh,heads].forEach(m=>{m.castShadow=false;m.frustumCulled=false;scene.add(m);});
  // light pools on the ground
  const glowTex=texGlow();
  poolsMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:glowTex,color:0xffd49a,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,fog:false}),lampPools.length);
  lampPools.forEach((p,i)=>{poolsMesh.setMatrixAt(i,TM(p[0],.08,p[1],0,-Math.PI/2,0,p[2],p[2],1));});
  poolsMesh.frustumCulled=false;poolsMesh.renderOrder=3;scene.add(poolsMesh);
  // glow sprites
  const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(glowPts,3));
  glowPoints=new THREE.Points(gg,new THREE.PointsMaterial({map:glowTex,color:0xffd9a8,size:5,sizeAttenuation:true,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
  glowPoints.frustumCulled=false;scene.add(glowPoints);
}
function buildSky(){
  skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
    uniforms:{uTop:{value:new THREE.Color(0x3f78c4)},uHor:{value:new THREE.Color(0xc4d6e4)},uSunDir:{value:new THREE.Vector3(-.4,.7,.4).normalize()},uSunCol:{value:new THREE.Color(1,.93,.78)},uNight:{value:0}},
    vertexShader:'varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'uniform vec3 uTop;uniform vec3 uHor;uniform vec3 uSunDir;uniform vec3 uSunCol;uniform float uNight;varying vec3 vD;void main(){float h=clamp(vD.y,0.0,1.0);vec3 c=mix(uHor,uTop,pow(h,0.5));float s=max(dot(normalize(vD),uSunDir),0.0);c+=uSunCol*(pow(s,420.0)*2.0+pow(s,10.0)*0.12)*(1.0-0.6*uNight);if(vD.y<0.0)c=uHor;gl_FragColor=vec4(c,1.0);}'});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(3300,24,16),skyMat);sky.renderOrder=-10;sky.frustumCulled=false;sky.userData.sky=true;skyMesh=sky;scene.add(sky);
  const sp=[];for(let i=0;i<700;i++){const a=R(0,TAU),b=Math.acos(R(.05,1)),r=3100;sp.push(Math.sin(b)*Math.cos(a)*r,Math.cos(b)*r,Math.sin(b)*Math.sin(a)*r);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
  stars=new THREE.Points(g,new THREE.PointsMaterial({color:0xffffff,size:2.2,sizeAttenuation:false,transparent:true,opacity:0,fog:false,depthWrite:false}));
  stars.frustumCulled=false;scene.add(stars);
}

/* ====================== world assembly ====================== */
function noMark(x,z){return x>-18&&x<18&&z>118&&z<150;}
function markRoads(){
  const inOther=(x,z,self)=>ROADS.some(r=>r!==self&&x>r[0]-.8&&x<r[2]+.8&&z>r[1]-.8&&z<r[3]+.8);
  ROADS.forEach(r=>{
    const horiz=(r[2]-r[0])>(r[3]-r[1]),a=horiz?r[0]:r[1],b=horiz?r[2]:r[3],cp=horiz?(r[1]+r[3])/2:(r[0]+r[2])/2,wd=horiz?r[3]-r[1]:r[2]-r[0];
    if(wd<6)return;
    for(let t=a+3;t<b-3;t+=9){const m=t+1.6,x=horiz?m:cp,z=horiz?cp:m;if(inOther(x,z,r)||noMark(x,z))continue;
      if(horiz)bx(MAT.paintY,3.2,.03,.15,x,.05,z);else bx(MAT.paintY,.15,.03,3.2,x,.05,z);}
    for(let t=a+1;t<b-1;t+=4){const L=Math.min(4,b-1-t),m=t+L/2;
      for(const sd of [-1,1]){const off=sd*(wd/2-.28),x=horiz?m:cp+off,z=horiz?cp+off:m;if(inOther(x,z,r)||noMark(x,z))continue;
        if(horiz)bx(MAT.paintW,L,.03,.14,x,.05,z);else bx(MAT.paintW,.14,.03,L,x,.05,z);}}
  });
}
function curb(x1,z1,x2,z2){
  const horiz=Math.abs(x2-x1)>Math.abs(z2-z1),L=horiz?Math.abs(x2-x1):Math.abs(z2-z1),mx=(x1+x2)/2,mz=(z1+z2)/2;
  if(horiz){bx(MAT.concLight,L,.16,.22,mx,.08,mz);bx(MAT.paintW,L,.01,.05,mx,.165,mz);}else{bx(MAT.concLight,.22,.16,L,mx,.08,mz);bx(MAT.paintW,.05,.01,L,mx,.165,mz);}
}
function manholes(){
  ROADS.forEach(r=>{
    const horiz=(r[2]-r[0])>(r[3]-r[1]),a=horiz?r[0]:r[1],b=horiz?r[2]:r[3],cp=horiz?(r[1]+r[3])/2:(r[0]+r[2])/2,wd=horiz?r[3]-r[1]:r[2]-r[0];
    for(let t=a+20;t<b-20;t+=R(55,90)){const off=R(-wd/2+1.2,wd/2-1.2),x=horiz?t:cp+off,z=horiz?cp+off:t;
      if(noMark(x,z)||ROADS.some(q=>q!==r&&x>q[0]-3&&x<q[2]+3&&z>q[1]-3&&z<q[3]+3))continue;
      cyl(MAT.concDark,.38,.38,.02,16,x,.045,z);cyl(MAT.black,.3,.3,.022,16,x,.047,z);}
  });
}
const BUILD_STEPS=10; // = number of yield points in buildSteps() + 1
function buildWorld(){for(const _ of buildSteps());}
/* The same build, cut into pieces: the loading screen runs one piece per frame so its bar moves and the phone never freezes. */
function* buildSteps(){
  // roads (lamps = true on the ones that get street lighting)
  addRoad(-5,38,5,165,true);                                   // main avenue
  addRoad(-56,-60,-48,38,true);addRoad(48,-60,56,38,true);addRoad(-56,-60,56,-52,true);   // parade ring
  addRoad(-167,30,167,38,true);                                // east-west spine
  addRoad(-167,-202,-159,132,true);addRoad(159,-202,167,132,true);addRoad(-167,-202,167,-194,true);
  addRoad(-167,124,-5,132,true);addRoad(5,124,167,132,true);   // perimeter ring
  addRoad(-80,-138,-72,30,true);addRoad(72,-138,80,30,true);   // barracks roads
  PLAZA.push([-48,-52,48,30]);PLAZA.push([-24,-91,24,-60]);PATHS.push([-3,-62,3,-58]);

  // barracks: 8 blocks, long axis north-south
  const names=['A','B','C','D','E','F','G','H'];let ni=0;
  [-140,-108,108,140].forEach((x,xi)=>[-100,-20].forEach(z=>{
    building({x,z,w:62,d:15,floors:3,fh:3.4,rot:x<0?Math.PI/2:-Math.PI/2,color:x<0?'#b9aa88':'#a9ae8e',doors:[.25,.75],stair:true,ac:true,
      name:'BLOCK '+names[ni],sub:x<0?'West Barracks':'East Barracks',roofKind:'metal',roofColor:x<0?'#7a3f2f':'#46606a',veranda:true,lit:.5});ni++;
  }));
  yield;
  // headquarters
  const hq=building({x:0,z:-100,w:54,d:18,floors:2,fh:4.4,rot:0,color:'#d3cbb4',trim:'#efe9d8',frame:'#f4f1e8',winW:1.5,winH:2.2,sill:1.1,bay:4.2,doors:[.5],pitch:.14,roofKind:'tile',roofColor:'#9c5238',chimney:[-.3,.3],porch:false,name:'',lit:.45});
  labels.push(['HEADQUARTERS',0,hq.H+hq.rh+10,-100]);
  {
    const B=hq.B,H=hq.H;
    B(MAT.stone,30,.3,6.2,0,.15,13.3);B(MAT.stone,28,.3,5.2,0,.45,13.8);B(MAT.stone,26,.3,4.2,0,.75,14.3);
    for(let i=-2;i<=2;i+=1){B(MAT.stone,.8,.8,.8,i*5,.8,11.0);}
    for(let i=0;i<6;i++){const lx=-10+i*4;const p=hq.toW(lx,11.2);cyl(MAT.stone,.45,.5,7.4,12,p[0],.9+3.7,p[1]);B(MAT.stone,1.4,.35,1.4,lx,.9+.17,11.2);B(MAT.stone,1.2,.3,1.2,lx,8.15,11.2);}
    B(MAT.stone,23,1.2,3.4,0,8.9,11.2);
    const pg=new THREE.ExtrudeGeometry((()=>{const s=new THREE.Shape();s.moveTo(-11.5,0);s.lineTo(11.5,0);s.lineTo(0,3.4);s.lineTo(-11.5,0);return s;})(),{depth:3.2,bevelEnabled:false});
    addGeo(MAT.stone,pg,TM(hq.x,9.5,hq.z+9.6,0));
    const sg=signMesh('HEADQUARTERS','NIGERIAN ARMY - INDEPENDENCE BARRACKS',9,1.6,'#2a3a2e','#efe6c9');sg.position.set(hq.x,7.8,hq.z+12.9);scene.add(sg);
  }
  yield;
  // mess hall, medical, gym, armory
  building({x:-100,z:72,w:46,d:26,floors:1,fh:6.6,rot:Math.PI,color:'#c2b79a',winW:2.4,winH:2.4,sill:1.5,bay:5,doors:[.5],roofKind:'metal',roofColor:'#5c6b5a',pitch:.16,name:'MESS HALL',sub:'Dining facility',lit:.7});
  {const mx=-100,mz=72;bx(MAT.concDark,1.8,6,1.8,mx+10,10,mz-6);bx(MAT.concDark,2.2,.3,2.2,mx+10,13.1,mz-6);bx(MAT.steel,1.6,1.2,1.6,mx-8,8,mz-4);
   bx(MAT.dumpster,2.4,1.3,1.4,mx-12,.65,mz-17);bx(MAT.dumpster,2.4,1.3,1.4,mx-8.6,.65,mz-17);bx(MAT.conc,8,.9,3,mx+10,.45,mz-14.5);colliders.push([mx+6,mz-16,mx+14,mz-13]);}
  const med=building({x:-40,z:80,w:34,d:18,floors:2,fh:3.8,rot:Math.PI,color:'#e0ddd2',trim:'#bfc7c0',doors:[.5],pitch:.16,roofKind:'tile',roofColor:'#8f5a45',chimney:[.25],name:'MEDICAL CENTRE',sub:'Clinic & dispensary',winW:1.5,winH:1.7,bay:3.8,lit:.5});
  {const cs=new THREE.Mesh(new THREE.PlaneGeometry(2.4,2.4),new THREE.MeshStandardMaterial({map:texCross(),roughness:.7,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
   cs.position.set(-40+9,5.4,80-9.06);cs.rotation.y=Math.PI;scene.add(cs);}
  building({x:34,z:84,w:46,d:28,floors:1,fh:9.5,rot:Math.PI,color:'#9ba1a6',trim:'#b6bcc0',frame:'#d5d9dc',plinth:'#6d7176',winW:3,winH:1.4,sill:6.4,bay:6,doors:[.5],roofKind:'metal',roofColor:'#4e545a',pitch:.1,name:'GYMNASIUM',sub:'Physical training',lit:.4});
  {const gx=34,gz=62;for(let i=0;i<3;i++){bx(MAT.steel,.1,2.6,.1,gx-12+i*4,1.3,gz);bx(MAT.steel,.1,2.6,.1,gx-10+i*4,1.3,gz);bx(MAT.steel,2.2,.08,.08,gx-11+i*4,2.6,gz);}}
  building({x:100,z:82,w:30,d:16,floors:1,fh:4.6,rot:Math.PI,color:'#8d8f8a',trim:'#a3a59f',frame:'#444',plinth:'#5c5d59',winW:.7,winH:.8,sill:2.4,bay:3,doors:[.5],bars:true,roofKind:'metal',roofColor:'#555a5e',pitch:.04,name:'ARMORY',sub:'Restricted access',lit:.25});
  armoryYard();trainingWing();sheds();waterTower(150,108);
  yield;
  // road markings on every road (broken at junctions), the approach road, curbs, crossings, manholes
  markRoads();
  for(let zz=165;zz<=420;zz+=9)bx(MAT.paintY,.15,.03,3.2,0,.05,zz);
  bx(MAT.paintW,.15,.03,255,-4.6,.05,292);bx(MAT.paintW,.15,.03,255,4.6,.05,292);
  for(let x=-4.5;x<=4.5;x+=1)if(Math.abs(x)>.3)bx(MAT.paintW,.5,.03,3,x,.05,110);
  curb(-5.12,40,-5.12,118);curb(5.12,40,5.12,118);
  curb(-56.12,-60,-56.12,30);curb(56.12,-60,56.12,30);curb(-48.1,-52,-48.1,30);curb(48.1,-52,48.1,30);
  curb(-56,-60.12,56,-60.12);curb(-48,-52.1,48,-52.1);
  manholes();
  yield;
  buildParade();buildCourse();buildRange();buildPerimeter();buildGate();buildHelipad();
  yield;
  // hydrants + a few bins for detail
  [[-6,-60],[6,60],[-70,28],[70,28],[-30,60],[30,60],[-100,45],[100,45]].forEach(p=>{cyl(MAT.hydrant,.14,.16,.7,8,p[0],.35,p[1]);cyl(MAT.hydrant,.2,.2,.1,8,p[0],.72,p[1]);});
  yield;
  buildWindows();flush();
  // coil of razor wire (one draw call)
  const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(coilPos,3));
  scene.add(new THREE.LineSegments(cg,new THREE.LineBasicMaterial({color:0xaab0b8})));
  yield;
  buildGround();yield;buildTrees();yield;buildLamps();
}

/* ====================== game hooks ====================== */
const _fr=new THREE.Frustum(),_pm=new THREE.Matrix4(),_inv=new THREE.Matrix4(),_lp=new THREE.Vector3();
function setNight(k){
  nightEmis.forEach(e=>{e.mat.emissiveIntensity=e.base+e.max*k;});
  envMats.forEach(m=>{m.envMapIntensity=.9*lerp(1,.1,k);});GL.glass.color.setScalar(lerp(1,.13,k));
  if(glowPoints){glowPoints.material.opacity=k;glowPoints.visible=k>.01;}
  if(poolsMesh){poolsMesh.material.opacity=.5*k;poolsMesh.visible=k>.01;}
}
let tt=0,flagT=0;const _fs=new THREE.Sphere(new THREE.Vector3(),5);
function update(cam,dt){
  tt+=dt;uTime.value+=dt;
  scene.updateMatrixWorld();_inv.copy(scene.matrixWorld).invert();
  camera.position.copy(cam.position).applyMatrix4(_inv);
  camera.matrixWorldInverse.multiplyMatrices(cam.matrixWorldInverse,scene.matrixWorld);camera.projectionMatrix.copy(cam.projectionMatrix);
  TREE_HI=125;
  if(updateTrees)updateTrees(camera.position,camera.position);
  if(grassMesh)grassMesh.visible=camera.position.y<70;
  _fr.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  updateWinLod(camera.position,_fr);
  const t=tt;
  socks.forEach(k=>{k.p.rotation.y=k.base+Math.sin(t*.6+k.ph)*.28;k.m.rotation.z=-.12+Math.sin(t*2.3+k.ph)*.08;});
  flagT+=dt;const doFlags=flagT>=1/60;if(doFlags)flagT=0; // flag cloth: at most 60 updates a second ...
  flags.forEach(f=>{
    if(!doFlags)return;
    if(camera.position.distanceToSquared(f.m.position)>250*250)return;
    _fs.center.copy(f.m.position);if(!_fr.intersectsSphere(_fs))return; // ... and only the ones on screen
    const a=f.m.geometry.attributes.position,bb=f.base;
    for(let i=0;i<a.count;i++){const x=bb[i*3],w=x/3.2;a.setZ(i,Math.sin(x*2.1-t*3.2+f.ph)*.22*w+Math.sin(x*4.3-t*5+f.ph)*.06*w);a.setY(i,bb[i*3+1]+Math.sin(x*1.6-t*2.6+f.ph)*.05*w);}
    a.needsUpdate=true;f.m.geometry.computeVertexNormals();
  });
}
// the barracks' own road surface (fine asphalt + the 16 m wear/patch multiplier), shared with the causeway bridge so it looks the same
const roadTextures=()=>({fine:texAsphaltFine(),macro:texAsphaltMacro()});
return { group: scene, colliders, build: buildWorld, buildSteps, steps: BUILD_STEPS, update, setNight, terrH, roadTextures };
}
