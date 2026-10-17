// @ts-nocheck
/* Ported from french_country_manor_3d.html (standalone viewer -> game module). Viewer scene/camera/lights/UI removed; geometry untouched.
   Local frame: origin = building centre, +z = front/street side, y up, metres. Lawn plane replaces the 420 m ground disc. */
import * as THREE from 'three';
import { buildOaks } from '../procedural/TerrainTrees';
import { getLawnMaterial } from '../procedural/TerrainTextures';

export function buildManor() {
  const scene = new THREE.Group();
/* ============ HELPERS ============ */
function canvasTex(w, h, draw){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
const M = (c, r=.9, m=0, o={}) => new THREE.MeshStandardMaterial({color:c, roughness:r, metalness:m, ...o});

/* Sky dome (equirect): gradient, sun glow, clouds. Also the PMREM reflection environment */


/* ============ TEXTURES & MATERIALS (high-detail procedural maps) ============ */
const rnd = Math.random;
/* Colour map + matching height (bump) map drawn from the same layout */
const pair = (w, h, draw) => ({
  map : canvasTex(w, h, (g, W, H) => draw(g, W, H, false)),
  bump: canvasTex(w, h, (g, W, H) => draw(g, W, H, true))
});

/* Painted plaster / concrete: soft colour mottling + sand-grain relief */
const grainC = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
  for(let i=0; i<420; i++){
    const k = rnd() > .5 ? 255 : 150, r = 4 + rnd()*22, x = rnd()*w, y = rnd()*h;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${k},${k},${k},.09)`); gr.addColorStop(1, `rgba(${k},${k},${k},0)`);
    g.fillStyle = gr; g.fillRect(x-r, y-r, r*2, r*2);
  }
});
const grainB = canvasTex(256, 256, (g, w, h) => {
  const s = document.createElement('canvas'); s.width = s.height = 64;
  const sg = s.getContext('2d'), id = sg.createImageData(64, 64);
  for(let i=0; i<4096; i++){ const v = rnd()*255; id.data.set([v, v, v, 255], i*4); }
  sg.putImageData(id, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(s, 0, 0, w, h);
});

/* Brick paving with recessed joints */
const pave = pair(128, 128, (g, w, h, H) => {
  g.fillStyle = H ? '#000' : '#7d776e'; g.fillRect(0, 0, w, h);
  for(let y=0; y<4; y++) for(let x=-1; x<5; x++){
    if(H){ const v = 170 + rnd()*60; g.fillStyle = `rgb(${v},${v},${v})`; }
    else g.fillStyle = `hsl(${12+rnd()*10},${28+rnd()*10}%,${50+rnd()*12}%)`;
    g.fillRect(x*32+(y%2?16:0)+1, y*32+1, 30, 30);
  }
});
const grassT = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#6a8d4a'; g.fillRect(0, 0, w, h);
  for(let i=0; i<900; i++){ g.fillStyle = `hsla(${85+rnd()*30},35%,${30+rnd()*25}%,.5)`; g.fillRect(rnd()*w, rnd()*h, 2, 3); }
});
grassT.repeat.set(7, 7);

/* Painted/plastered material: grain map + bump; userData.tile = metres per texture tile */
const S = (c, r=.9, tile=1.5, bs=.7) => {
  const x = M(c, r, 0, bs ? {map:grainC, bumpMap:grainB, bumpScale:bs} : {map:grainC}); x.userData.tile = tile; return x;
};
const T = (pr, r, tile, bs) => {
  const x = M(0xffffff, r, 0, {map:pr.map, bumpMap:pr.bump, bumpScale:bs}); x.userData.tile = tile; return x;
};

const mat = {
  white : S(0xf3f1ea, .8, 1.5, 0),               // exterior plaster
  slab  : S(0xe7e5de, .9),
  grey  : S(0x8c8f93, .85),
  dark  : S(0x65686c, .8),
  conc  : S(0xb4b3ae, .95, 1.2, 1.4),
  lobby : S(0xd9d7d1, .9),
  yellow: S(0xf1d58b, .9),
  orange: S(0xe0602b, .7),                // vibrant accent
  roof  : S(0x9a9da0, .95, 1.2, 1.6),
  metal : M(0xf6f6f6, .35, .7),           // white painted steel railing
  steel : M(0x2b2f34, .4, .8),            // window frames
  wood  : M(0x5a3420, .6),
  pave  : T(pave, .95, 2, 2.5),
  glass : new THREE.MeshPhysicalMaterial({color:0x5f93b3, roughness:.04, metalness:.9, clearcoat:1, clearcoatRoughness:.03, envMapIntensity:1.6})
};

/* ============ GEOMETRY HELPERS ============ */
const root = new THREE.Group(); scene.add(root);

/* Scale box UVs so textures tile in metres (t = metres per tile) */
function tileUV(g, w, h, d, t){
  const uv = g.attributes.uv, s = [[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(let i=0; i<24; i++) uv.setXY(i, uv.getX(i)*s[i>>2][0]/t, uv.getY(i)*s[i>>2][1]/t);
}
/* Chamfered box: 6 faces + 12 edge bevels + 8 corner facets. UVs in metres (/ tile size) */
function chamfer(w, h, d, b, t){
  const H = [w/2, h/2, d/2], pos = [], nor = [], uv = [], idx = [];
  const nz = v => { const l = Math.hypot(...v); return v.map(c => c/l); };
  const add = (pts, n) => {
    let q = pts.map(p => p.slice());
    const [p0, p1, p2] = q, ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2], vx = p2[0]-p0[0], vy = p2[1]-p0[1], vz = p2[2]-p0[2];
    if((uy*vz-uz*vy)*n[0] + (uz*vx-ux*vz)*n[1] + (ux*vy-uy*vx)*n[2] < 0) q.reverse();   // outward winding
    const a = n.map(Math.abs), k = pos.length/3, ax = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    q.forEach(p => {
      pos.push(...p); nor.push(...n);
      uv.push((ax === 0 ? p[2]+H[2] : p[0]+H[0])/(t||1), (ax === 1 ? p[2]+H[2] : p[1]+H[1])/(t||1));
    });
    idx.push(k, k+1, k+2); if(q.length === 4) idx.push(k, k+2, k+3);
  };
  for(let a=0; a<3; a++){                                   // main faces
    const c = (a+1)%3, e = (a+2)%3;
    for(const sa of [-1, 1]){
      const face = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([i, j]) => { const p = [0,0,0]; p[a] = sa*H[a]; p[c] = i*(H[c]-b); p[e] = j*(H[e]-b); return p; });
      const n = [0,0,0]; n[a] = sa; add(face, n);
    }
  }
  [[0,1,2],[0,2,1],[1,2,0]].forEach(([a, c, e]) => {        // edge bevels
    for(const sa of [-1, 1]) for(const sc of [-1, 1]){
      const mk = (oa, oc, ie) => { const p = [0,0,0]; p[a] = sa*(H[a]-oa); p[c] = sc*(H[c]-oc); p[e] = ie*(H[e]-b); return p; };
      const n = [0,0,0]; n[a] = sa; n[c] = sc;
      add([mk(0,b,-1), mk(0,b,1), mk(b,0,1), mk(b,0,-1)], nz(n));
    }
  });
  for(const sx of [-1, 1]) for(const sy of [-1, 1]) for(const sz of [-1, 1]){   // corner facets
    const sg = [sx, sy, sz];
    add([0,1,2].map(i => sg.map((v, k) => v*(k === i ? H[k] : H[k]-b))), nz(sg.slice()));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); return g;
}
/* Box by size + centre (edges bevelled so every edge catches light) */
function box(w, h, d, m, x, y, z, o={}){
  const b = Math.min(o.b === undefined ? .03 : o.b, Math.min(w, h, d)*.3);
  const s = new THREE.Mesh(chamfer(w, h, d, b, m.userData.tile || o.t), m); s.position.set(x, y, z);
  s.castShadow = s.receiveShadow = true; (o.p || root).add(s); return s;
}
/* Box by min/max ranges */
const bx = (x0,x1,y0,y1,z0,z1,m,o) => box(x1-x0, y1-y0, z1-z0, m, (x0+x1)/2, (y0+y1)/2, (z0+z1)/2, o);

/* Glass (see-through, reflective) + interior panel with curtains so windows have depth */
mat.glass = new THREE.MeshPhysicalMaterial({color:0x8fbbd8, roughness:.02, metalness:.15, transparent:true, opacity:.5, clearcoat:1, clearcoatRoughness:.02, envMapIntensity:3});
const roomT = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#26313b'); gr.addColorStop(1, '#58626c');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for(let x=0; x<w*.34; x+=6){ g.fillStyle = `rgba(${x%12 ? 195 : 215},${x%12 ? 180 : 200},170,.92)`; g.fillRect(x, 0, 5, h); }
  g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(w*.55, h*.1, w*.25, h*.5);
});
mat.room = M(0xffffff, .9, 0, {map:roomT}); mat.room.userData.tile = 2.5;

/* Window on a facade. r = facade rotation (0 front, PI/2 right, PI rear, -PI/2 left),
   u = offset along facade (viewer's right), y = centre height, n = distance of facade plane from origin */
function win(r, u, y, n, w, h, o={}){
  const g = new THREE.Group();
  g.position.set(n*Math.sin(r)+u*Math.cos(r), y, n*Math.cos(r)-u*Math.sin(r));
  g.rotation.y = r; (o.parent || root).add(g);
  const f = o.frame || mat.steel, c = o.cols || 1, rw = o.rows || 1, P = {p:g}, e = .08;
  box(w+2*e, e, .1, f, 0, h/2+e/2, .03, P); box(w+2*e, e, .1, f, 0, -h/2-e/2, .03, P);   // frame bars
  box(e, h, .1, f, -w/2-e/2, 0, .03, P);    box(e, h, .1, f, w/2+e/2, 0, .03, P);
  box(w, h, .02, mat.room, 0, 0, .02, P);                                                // interior + curtains
  box(w, h, .02, mat.glass, 0, 0, .085, P);                                              // reflective glass
  for(let i=1; i<c; i++) box(.05, h, .1, f, -w/2+w*i/c, 0, .1, P);
  for(let j=1; j<rw; j++) box(w, .05, .1, f, 0, -h/2+h*j/rw, .1, P);
  box(w+.3, .07, .2, mat.white, 0, -h/2-.12, .12, P); if(o.lintel) box(w+.4, .14, .2, mat.white, 0, h/2+.2, .1, P);                                    // sill
}

/* Tubular 3-bar white railing between two plan points at base height y */
function rail(x0, z0, x1, z1, y){
  const dx = x1-x0, dz = z1-z0, L = Math.hypot(dx, dz), a = Math.atan2(dx, dz), n = Math.max(2, Math.round(L/1.1)+1);
  const cyl = (r, len, x, yy, zz, rx, ry) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat.metal);
    m.rotation.order = 'YXZ'; m.rotation.set(rx, ry, 0); m.position.set(x, yy, zz); m.castShadow = true; root.add(m);
  };
  [[.4, .018], [.75, .018], [1.1, .032]].forEach(([h, r]) => cyl(r, L, (x0+x1)/2, y+h, (z0+z1)/2, Math.PI/2, a));
  for(let i=0; i<n; i++){ const t = i/(n-1); cyl(.022, 1.1, x0+dx*t, y+.55, z0+dz*t, 0, 0); }
}

/* ============ SITE & MATERIALS ============ */
const HX = 6.5, HZ = 4.7, PL = .7, EV = 4.6;      // half width, half depth, plinth height, eave height

/* Terracotta clay roof tiles: staggered rows, bevelled bump */
const tileRoof = pair(256, 256, (g, w, h, H) => {
  g.fillStyle = H ? '#000' : '#4a2419'; g.fillRect(0, 0, w, h);
  for(let r=0; r<8; r++) for(let c=-1; c<9; c++){
    const x = c*32 + (r%2 ? 16 : 0), y = r*32;
    if(H){ const v = 180 + rnd()*60, gr = g.createLinearGradient(0, y, 0, y+32); gr.addColorStop(0, `rgb(${v-80},${v-80},${v-80})`); gr.addColorStop(1, `rgb(${v},${v},${v})`); g.fillStyle = gr; }
    else g.fillStyle = `hsl(${10+rnd()*9},${50+rnd()*14}%,${38+rnd()*13}%)`;
    g.fillRect(x+1, y+1, 30, 31);
  }
});
Object.assign(mat, {
  plaster: S(0xF4EAD2, .85, 1.5, 0),            // warm limestone-coloured render
  plinth : S(0xc3bcb0, .95, 1.2, .7),
  gravel : S(0xcfc9bd, 1, 1.5, 1),
  trunk  : S(0x6a5a48, .95, 1, 1.2),
  iron   : M(0x1f2226, .5, .8),
  tiles  : T(tileRoof, .8, 1.6, 1.8),
  brick  : T(pave, .95, 1, 1.5)
});
mat.tiles.side = THREE.DoubleSide;

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 37), getLawnMaterial());   // Terrain Road grass (world-space shader)
ground.rotation.x = -Math.PI/2; ground.position.set(0,.03,-1.5); ground.receiveShadow = true; scene.add(ground);
bx(-3.2, 3.2, 0, .03, HZ+2.2, HZ+10, mat.gravel);            // front approach
bx(-5.8, 5.8, 0, .04, -HZ-6.5, -HZ+.05, mat.gravel);         // rear terrace
bx(-HX-5.5, -HX+.05, 0, .04, -3.8, 3.8, mat.gravel);         // left terrace

/* ============ HELPERS: roof strips, prisms, dormers, fences ============ */
/* Roof side lofted through rings {ax, az, y} (half-extents of the plan rectangle at height y) */
function strip(rings, side){
  const pos = [], uv = [], idx = [], t = 1.6; let v = 0, pm = null;
  rings.forEach((r, k) => {
    const c = [[[-r.ax,r.az],[r.ax,r.az]], [[r.ax,r.az],[r.ax,-r.az]], [[r.ax,-r.az],[-r.ax,-r.az]], [[-r.ax,-r.az],[-r.ax,r.az]]][side];
    const mx = (c[0][0]+c[1][0])/2, mz = (c[0][1]+c[1][1])/2;
    if(pm) v += Math.hypot(mx-pm[0], r.y-pm[1], mz-pm[2]);
    pm = [mx, r.y, mz];
    const len = Math.hypot(c[1][0]-c[0][0], c[1][1]-c[0][1]);
    pos.push(c[0][0], r.y, c[0][1], c[1][0], r.y, c[1][1]); uv.push(-len/2/t, v/t, len/2/t, v/t);
    if(k) idx.push(2*k-2, 2*k-1, 2*k+1, 2*k-2, 2*k+1, 2*k);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.tiles); m.castShadow = m.receiveShadow = true; root.add(m);
}
/* Triangular prism (pediments, dormer gables) extruded along +z */
function prism(w, h, d, m, x, y, z, parent){
  const sh = new THREE.Shape(); sh.moveTo(-w/2, 0); sh.lineTo(w/2, 0); sh.lineTo(0, h); sh.closePath();
  const p = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, {depth:d, bevelEnabled:false}), m);
  p.position.set(x, y, z); p.castShadow = p.receiveShadow = true; (parent || root).add(p); return p;
}
/* Wrought-iron fence: rails + balusters */
function fence(x0, z0, x1, z1, y, H=.95){
  const dx = x1-x0, dz = z1-z0, L = Math.hypot(dx, dz), a = Math.atan2(dx, dz), n = Math.max(2, Math.round(L/.13));
  [H, .08].forEach(h => { const b = box(.05, .04, L, mat.iron, (x0+x1)/2, y+h, (z0+z1)/2, {b:.008}); b.rotation.y = a; });
  for(let i=0; i<=n; i++){ const t = i/n; box(.018, H-.08, .018, mat.iron, x0+dx*t, y+.08+(H-.08)/2, z0+dz*t, {b:.004}); }
}
/* White-framed multi-pane window with lintel */
const mwin = (r, u, y, n, w, h, o={}) => win(r, u, y, n, w, h, {frame:mat.white, cols:2, rows:3, lintel:true, ...o});

/* ============ BUILDING ============ */
/* Plinth, render walls, cornice and soffit */
bx(-HX-.1, HX+.1, 0, PL, -HZ-.1, HZ+.1, mat.plinth);
bx(-HX-.16, HX+.16, PL, PL+.08, -HZ-.16, HZ+.16, mat.white);
bx(-HX, HX, PL, EV, -HZ, HZ, mat.plaster, {b:.01});
bx(-HX-.2, HX+.2, EV-.4, EV-.1, -HZ-.2, HZ+.2, mat.white);
bx(-HX-.6, HX+.6, EV-.14, EV, -HZ-.6, HZ+.6, mat.white);

/* Mansard roof: flared lower slope + low hipped upper roof, terracotta tiles */
const OP = [[.55,0],[.38,.12],[.15,.4],[-.12,.85],[-.42,1.4],[-.75,2.0],[-1.0,2.45],[-1.15,2.7]];
const man = OP.map(([o, h]) => ({ax:HX+o, az:HZ+o, y:EV+h})), mtop = man[man.length-1];
const hip = [mtop, {ax:mtop.ax-mtop.az, az:0, y:mtop.y+mtop.az*.32}];
[man, hip].forEach(rings => { for(let s=0; s<4; s++) strip(rings, s); });
bx(-hip[1].ax-.15, hip[1].ax+.15, hip[1].y-.02, hip[1].y+.14, -.12, .12, mat.tiles);   // ridge cap

/* Chimneys: brick shafts, stone caps, flue pots */
[-1.3, 1.3].forEach(x => {
  bx(x-.4, x+.4, 8.0, 9.9, -.25, .55, mat.brick, {b:.02});
  bx(x-.5, x+.5, 9.9, 10.06, -.35, .65, mat.white);
  [-.17, .17].forEach(dx => { const p = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, .4, 12), mat.brick); p.position.set(x+dx, 10.26, .15); p.castShadow = true; root.add(p); });
});

/* Centre bay with pediment, oculus, balcony and four-column portico (front) */
bx(-2.1, 2.1, PL, 6.9, HZ, HZ+.5, mat.plaster, {b:.01});
bx(-2.1, -1.8, PL, 6.9, HZ+.5, HZ+.62, mat.white); bx(1.8, 2.1, PL, 6.9, HZ+.5, HZ+.62, mat.white);
bx(-2.4, 2.4, 6.75, 6.95, HZ, HZ+.8, mat.white);
prism(5.1, 1.4, .2, mat.white, 0, 6.9, HZ+.2);
prism(4.7, 1.2, .2, mat.plaster, 0, 6.95, HZ+.38);
{ const ring = new THREE.Mesh(new THREE.TorusGeometry(.34, .06, 10, 28), mat.white); ring.position.set(0, 7.5, HZ+.6); ring.castShadow = true; root.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(.34, 28), M(0x22303c, .15, .5, {envMapIntensity:2})); disc.position.set(0, 7.5, HZ+.585); root.add(disc); }
mwin(0, 0, PL+1.25, HZ+.5, 1.5, 2.4, {rows:4});
mwin(0, 0, 5.55, HZ+.5, 1.2, 2.0, {rows:4});
[-1.45, 1.45].forEach(u => mwin(0, u, 5.6, HZ+.5, .95, 1.4));
[-1.95, -.75, .75, 1.95].forEach(x => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(.16, .18, 3.1, 20), mat.white);
  c.position.set(x, PL+.2+1.55, HZ+1.7); c.castShadow = c.receiveShadow = true; root.add(c);
  bx(x-.26, x+.26, PL, PL+.2, HZ+1.44, HZ+1.96, mat.white);
  bx(x-.26, x+.26, PL+3.3, PL+3.5, HZ+1.44, HZ+1.96, mat.white);
});
bx(-2.35, 2.35, 4.2, 4.5, HZ+.5, HZ+1.95, mat.white);
fence(-2.3, HZ+1.9, 2.3, HZ+1.9, 4.5); fence(-2.3, HZ+.55, -2.3, HZ+1.9, 4.5); fence(2.3, HZ+.55, 2.3, HZ+1.9, 4.5);
bx(-2.5, 2.5, 0, PL, HZ+.5, HZ+2.0, mat.plinth);                                   // porch floor
for(let i=0; i<5; i++) bx(-(2.7+.3*i), 2.7+.3*i, 0, PL-.14*(i+1), HZ+2.0+i*.34, HZ+2.0+(i+1)*.34, mat.plinth);

/* Rear entrance with small stair */
mwin(Math.PI, 0, PL+1.25, HZ, 1.2, 2.4, {rows:4});
bx(-1.4, 1.4, 0, PL, -HZ-1.3, -HZ, mat.plinth);
for(let i=0; i<3; i++) bx(-(1.5+.2*i), 1.5+.2*i, 0, PL-.17*(i+1), -HZ-1.3-(i+1)*.35, -HZ-1.3-i*.35, mat.plinth);
fence(-1.4, -HZ-1.25, -1.4, -HZ-.05, PL); fence(1.4, -HZ-1.25, 1.4, -HZ-.05, PL);

/* Ground-floor windows and basement lights on every elevation */
[[0,HZ,[-4.5,4.5]], [Math.PI/2,HX,[-1.8,1.8]], [Math.PI,HZ,[-4.5,4.5]], [-Math.PI/2,HX,[0]]].forEach(([r, n, us]) => us.forEach(u => {
  mwin(r, u, 2.5, n, 1.1, 2.0);
  win(r, u, .35, n+.1, .7, .3, {frame:mat.white});
}));

/* Dormers: white-framed windows with tiled gable roofs set into the mansard */
function dormer(r, u, n, w=.95, h=1.45){
  const g = new THREE.Group(), ww = w+.55, hw = h+.5, P = {p:g}, q = ww/2, th = .5;
  g.position.set((n+.15)*Math.sin(r)+u*Math.cos(r), EV+.35, (n+.15)*Math.cos(r)-u*Math.sin(r)); g.rotation.y = r; root.add(g);
  box(ww, hw, .14, mat.white, 0, hw/2, 0, P);
  win(0, 0, .25+h/2, .07, w, h, {frame:mat.white, cols:2, rows:3, parent:g, lintel:true});
  [-1, 1].forEach(s => box(.1, hw, 1.3, mat.white, s*(q-.05), hw/2, -.65, P));
  const L = Math.hypot(q, Math.tan(th)*q) + .1;
  [-1, 1].forEach(s => { const m = box(L, .07, 1.5, mat.tiles, s*q/2, hw+Math.tan(th)*q/2, -.75, P); m.rotation.z = -s*th; });
  prism(ww+.12, Math.tan(th)*q, .14, mat.white, 0, hw, -.07, g);
}
[[0,HZ,[-4.4,4.4]], [Math.PI/2,HX,[-2.6,0,2.6]], [Math.PI,HZ,[-4.4,0,4.4]], [-Math.PI/2,HX,[0]]].forEach(([r, n, us]) => us.forEach(u => dormer(r, u, n)));

/* Downpipes */
[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx, sz]) => {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, EV-.8, 10), mat.iron);
  p.position.set(sx*(HX+.08), (EV+.8)/2, sz*(HZ-.25)); p.castShadow = true; root.add(p);
});

/* ============ LANDSCAPING ============ */
const leafT = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#2f5a2b'; g.fillRect(0, 0, w, h);
  for(let i=0; i<700; i++){ g.fillStyle = `hsl(${85+rnd()*40},${40+rnd()*20}%,${18+rnd()*30}%)`; g.beginPath(); g.ellipse(rnd()*w, rnd()*h, 2+rnd()*3, 1+rnd()*2, rnd()*3, 0, 7); g.fill(); }
});
leafT.repeat.set(4, 3);
const leafM = M(0xffffff, .95, 0, {map:leafT, bumpMap:leafT, bumpScale:1.2});
function blob(x, y, z, r, sy=.8){                       // lumpy foliage mass
  const geo = new THREE.IcosahedronGeometry(r, 2), p = geo.attributes.position;
  for(let i=0; i<p.count; i++){
    const a = p.getX(i), b = p.getY(i), c = p.getZ(i), k = 1 + .12*Math.sin(a*9/r+c*5/r)*Math.cos(b*8/r-c*6/r);
    p.setXYZ(i, a*k, b*k*sy, c*k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, leafM); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; root.add(m);
}
function tree(x, z, s){
  const t = new THREE.Mesh(new THREE.CylinderGeometry(.18*s, .3*s, 3.6*s, 12), mat.trunk);
  t.position.set(x, 1.8*s, z); t.castShadow = true; root.add(t);
  [[0,4.4,0,1.9],[1.2,3.9,.4,1.4],[-1.1,4.1,-.5,1.5],[.3,5.3,.9,1.3],[-.5,5.0,-1,1.4]].forEach(([a, b, c, r]) => blob(x+a*s, b*s, z+c*s, r*s, .85));
}
/* the estate trees are the Terrain Road oak (instanced, added after bake()) */
const oakSpecs = [[-11,6,1.1],[10.5,7.5,1.3],[-12,-5,1.2],[11.5,-6,1],[0,-HZ-13,1.4],[-17,1,1.2],[17,-1,1.1],[-8,-HZ-9,.9],[8.5,-HZ-9,1],[-9,13,1],[9.5,14,1.1]]
  .map(([x, z, k], i) => ({ x, y: .03, z, s: k*.62, rot: i*2.399, tint: (i*.381966 + .11) % 1 }));
[[-5.6,HZ+.9,.55],[5.6,HZ+.9,.55],[-3.9,HZ+.9,.45],[3.9,HZ+.9,.45],[-HX-.8,-2.2,.6],[-HX-.8,2.2,.6],[HX+.8,-2.6,.6],[HX+.8,2.8,.6],[-HX-.8,0,.5]].forEach(([x, z, r]) => blob(x, r*.55, z, r));
[[-9.5,-3.8,HZ+4.2,HZ+5],[3.8,9.5,HZ+4.2,HZ+5]].forEach(([x0, x1, z0, z1]) => bx(x0, x1, 0, .9, z0, z1, leafM, {b:.2}));   // front hedges
bx(-6.4, 6.4, 0, .9, -HZ-7.8, -HZ-7, leafM, {b:.2}); bx(-HX-6.2, -HX-5.4, 0, .9, -3.8, 3.8, leafM, {b:.2});

/* ============ PERFORMANCE: merge static meshes by material ============ */
function bake(group){
  group.updateMatrixWorld(true);
  const bk = new Map(), dead = [];
  group.traverse(o => {
    if(!o.isMesh) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    let b = bk.get(o.material); if(!b){ b = {p:[], n:[], u:[]}; bk.set(o.material, b); }
    b.p.push(g.attributes.position.array); b.n.push(g.attributes.normal.array); b.u.push(g.attributes.uv.array);
    dead.push(o);
  });
  dead.forEach(o => { o.parent.remove(o); o.geometry.dispose(); });
  const cat = a => { const out = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; a.forEach(x => { out.set(x, i); i += x.length; }); return out; };
  bk.forEach((b, m) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(cat(b.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(cat(b.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(cat(b.u), 2));
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  });
}
bake(root);
  const oaks = buildOaks(oakSpecs, true);
  if (oaks) scene.add(oaks.group);
  return { group: scene };
}
