import {
  MapView, NavSnapshot, Pt, Route, getMapData, headingToScreenAngle, roadExtent, screenToWorld, worldToScreen,
} from './NavMap';
import { CHUNK_HILLS, CITY_HILL_LIST } from '../world/CurvedRoads';

/**
 * drawMap - the ONE renderer behind the minimap (mini = true, heading-up, small) and the full-screen map
 * (north-up, pan/zoom, labels). Both feed it the same MapView + NavSnapshot, so they cannot disagree.
 */

export interface DrawOpts {
  mini: boolean;
  labels: boolean;
  selectedId?: string | null;
  /**
   * 'all' (default): terrain + screen-space markers, exactly as before (full-screen map).
   * 'world': terrain only. The minimap tilts this layer with a CSS 3D transform and draws the markers
   * on a flat canvas on top (see navigation/drawMini.ts), so icons stay upright and crisp.
   */
  layer?: 'all' | 'world';
}

const FULL = {
  void: '#0a0e13',
  zone: ['#252e38', '#2a384a', '#3b352b', '#23432d'], // residential, commercial/office, market, park
  pond: '#2f7fb5',
  building: '#4a5568',
  landmark: '#6c7a90',
  casing: '#0e1319',
  main: '#dfe5ec',
  secondary: '#b1bac7',
  residential: '#8d97a6',
  route: '#d946ef',
  player: '#34d399',
  text: '#e5e9ef',
  halo: '#0e1319',
  ground: '#1f3a2a',
  freeway: '#f2b44c',
  bridge: '#f8fafc',
  island: '#27382b',
  tint: { crescent: '#2b4030', glass: '#2c4358', park: '#25502f', mews: '#41382c' } as Record<string, string>,
};
/** the minimap palette: darker and desaturated so streets, route and markers carry the picture (console-radar look) */
const MINI: typeof FULL = {
  void: '#0d1117',
  zone: ['#1d2530', '#212d3b', '#2b2720', '#1b3426'],
  pond: '#2a6490',
  building: '#3a4455',
  landmark: '#515e75',
  casing: '#070a0e',
  main: '#d7dde6',
  secondary: '#a3adbb',
  residential: '#737e8e',
  route: '#d946ef',
  player: '#ffffff',
  text: '#e5e9ef',
  halo: '#05080b',
  ground: '#15291e',
  freeway: '#d9a24a',
  bridge: '#e8edf3',
  island: '#1b2a1f',
  tint: { crescent: '#1c2f22', glass: '#1c2f42', park: '#183823', mews: '#2c241c' },
};
let COL: typeof FULL = FULL;


const POI_COLOR: Record<string, string> = {
  restaurant: '#f59e0b',
  office: '#3b82f6',
  commercial: '#10b981',
  market: '#10b981',
  hospital: '#ef4444',
  residential: '#94a3b8',
  park: '#22c55e',
};

export interface MapMarker { kind: 'poi' | 'landmark'; id: string; name: string; type: string; x: number; z: number; entrance: Pt }

export function getMarkers(): MapMarker[] {
  const d = getMapData();
  return [
    ...d.pois.map((p) => ({ kind: 'poi' as const, id: p.id, name: p.name, type: p.type, x: p.x, z: p.z, entrance: p.entrance })),
    ...d.landmarks.map((l) => ({ kind: 'landmark' as const, id: l.id, name: l.name, type: 'landmark', x: l.x, z: l.z, entrance: l.entrance })),
  ];
}

/** nearest marker within `maxPx` of a screen tap, or null */
export function pickMarker(v: MapView, sx: number, sy: number, maxPx = 24): MapMarker | null {
  let best: MapMarker | null = null;
  let bestD = maxPx;
  for (const m of getMarkers()) {
    const [mx, my] = worldToScreen(v, m.x, m.z);
    const dd = Math.hypot(mx - sx, my - sy);
    if (dd < bestD) { bestD = dd; best = m; }
  }
  return best;
}

export function drawMap(ctx: CanvasRenderingContext2D, v: MapView, nav: NavSnapshot, opts: DrawOpts): void {
  const d = getMapData();
  const s = v.scale;
  const mini = opts.mini;
  COL = mini ? MINI : FULL;
  const layer = opts.layer ?? 'all';

  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, v.w, v.h);

  // visible world AABB (rotation aware) for culling
  const cs = [screenToWorld(v, 0, 0), screenToWorld(v, v.w, 0), screenToWorld(v, 0, v.h), screenToWorld(v, v.w, v.h)];
  const minX = Math.min(cs[0].x, cs[1].x, cs[2].x, cs[3].x) - 20;
  const maxX = Math.max(cs[0].x, cs[1].x, cs[2].x, cs[3].x) + 20;
  const minZ = Math.min(cs[0].z, cs[1].z, cs[2].z, cs[3].z) - 20;
  const maxZ = Math.max(cs[0].z, cs[1].z, cs[2].z, cs[3].z) + 20;

  // ---------------------------------------------------------------- world-space layer (metres)
  ctx.save();
  ctx.translate(v.ax ?? v.w / 2, v.ay ?? v.h / 2);
  ctx.rotate(v.rot);
  ctx.scale(s, s);
  ctx.translate(-v.cx, -v.cz);

  for (const b of d.blocks) {
    if (b.x1 < minX || b.x0 > maxX || b.z1 < minZ || b.z0 > maxZ) continue;
    ctx.fillStyle = COL.zone[b.zone];
    ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  }

  // chunk 3: the redesigned city blocks get a tint per style
  const DIST_TINT = COL.tint;
  for (const c of d.cityDistricts) {
    if (c.x1 < minX || c.x0 > maxX || c.z1 < minZ || c.z0 > maxZ) continue;
    ctx.fillStyle = DIST_TINT[c.style] ?? COL.zone[0];
    // the plot is an oriented rectangle (obbCorners convention)
    const cs = Math.cos(c.rot);
    const sn = Math.sin(c.rot);
    ctx.beginPath();
    ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([sx, sz], k) => {
      const px = c.cx + sx * (c.W / 2) * cs + sz * (c.D / 2) * sn;
      const pz = c.cz - sx * (c.W / 2) * sn + sz * (c.D / 2) * cs;
      if (k) ctx.lineTo(px, pz);
      else ctx.moveTo(px, pz);
    });
    ctx.closePath();
    ctx.fill();
  }

  // the city's hills (shaded lighter) and its river
  for (const h of CITY_HILL_LIST) {
    if (h.x + h.r < minX || h.x - h.r > maxX || h.z + h.r < minZ || h.z - h.r > maxZ) continue;
    const g = ctx.createRadialGradient(h.x, h.z, 0, h.x, h.z, h.r);
    const a = Math.min(0.55, 0.16 + h.h / 90);
    g.addColorStop(0, `rgba(190,205,150,${a})`);
    g.addColorStop(1, 'rgba(190,205,150,0)');
    ctx.fillStyle = g;
    ctx.fillRect(h.x - h.r, h.z - h.r, h.r * 2, h.r * 2);
  }

  // curved-road chunks (north-east + north-west): green ground, hills shaded lighter, the streams
  for (const { rect: C, hills } of CHUNK_HILLS) {
    const cw = C.maxX - C.minX;
    const ch = C.maxZ - C.minZ;
    if (C.maxX < minX || C.minX > maxX || C.maxZ < minZ || C.minZ > maxZ) continue;
    ctx.fillStyle = COL.ground;
    ctx.fillRect(C.minX, C.minZ, cw, ch);
    for (const h of hills) {
      const g = ctx.createRadialGradient(h.x, h.z, 0, h.x, h.z, h.r);
      const a = Math.min(0.55, 0.12 + h.h / 110);
      g.addColorStop(0, `rgba(190,205,150,${a})`);
      g.addColorStop(1, 'rgba(190,205,150,0)');
      ctx.fillStyle = g;
      // the gradient fades to 0 at radius r, so only the hill's own square needs filling (was: the whole chunk per hill)
      ctx.fillRect(h.x - h.r, h.z - h.r, h.r * 2, h.r * 2);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineCap = 'butt';
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const st of d.streams) {
    ctx.beginPath();
    st.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
    ctx.strokeStyle = COL.pond;
    ctx.lineWidth = Math.max(st.halfWidth * 1.6, 3 / s);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  ctx.fillStyle = COL.pond;
  for (const p of d.ponds) {
    if (p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.z, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // roads: casing pass, then fills (residential < secondary < main so junctions merge cleanly)
  const lines = [...d.vLines.map((l) => ({ l, vert: true })), ...d.hLines.map((l) => ({ l, vert: false }))].filter(({ l, vert }) =>
    vert ? l.pos >= minX - 10 && l.pos <= maxX + 10 : l.pos >= minZ - 10 && l.pos <= maxZ + 10
  );
  const fillW = (w: number) => Math.max(w * 0.95, 2.6 / s);
  const pathFor = (cls: string) => {
    ctx.beginPath();
    for (const { l, vert } of lines) {
      if (l.cls !== cls) continue;
      const [e0, e1] = roadExtent(l, vert);
      if (vert) { ctx.moveTo(l.pos, e0); ctx.lineTo(l.pos, e1); } else { ctx.moveTo(e0, l.pos); ctx.lineTo(e1, l.pos); }
    }
  };
  ctx.lineCap = 'butt';
  const classes: [string, string, number][] = [['residential', COL.residential, 8], ['secondary', COL.secondary, 9], ['main', COL.main, 14]];
  ctx.strokeStyle = COL.casing;
  for (const [cls, , w] of classes) { pathFor(cls); ctx.lineWidth = fillW(w) + 2.4 / s; ctx.stroke(); }
  for (const [cls, col, w] of classes) { pathFor(cls); ctx.strokeStyle = col; ctx.lineWidth = fillW(w); ctx.stroke(); }
  if (s >= 1.1) {
    pathFor('main');
    ctx.strokeStyle = 'rgba(250,204,21,0.6)';
    ctx.lineWidth = 1 / s;
    ctx.setLineDash([5 / s, 5 / s]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // chunk 3 lanes (crescent lanes, mews, turning circles) and park paths
  {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const lw = (w: number) => Math.max(w * 0.95, 2.2 / s);
    for (const c of d.cityDistricts) {
      if (c.x1 < minX || c.x0 > maxX || c.z1 < minZ || c.z0 > maxZ) continue;
      const trace = (pts: { x: number; z: number }[], closed = false) => {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
        if (closed) ctx.closePath();
      };
      for (const l of c.lanes) { trace(l.pts); ctx.strokeStyle = COL.casing; ctx.lineWidth = lw(l.width) + 2 / s; ctx.stroke(); }
      for (const dc of c.discs) { ctx.beginPath(); ctx.arc(dc.x, dc.z, dc.r + 1 / s, 0, Math.PI * 2); ctx.fillStyle = COL.casing; ctx.fill(); }
      for (const l of c.lanes) { trace(l.pts); ctx.strokeStyle = COL.residential; ctx.lineWidth = lw(l.width); ctx.stroke(); }
      for (const dc of c.discs) { ctx.beginPath(); ctx.arc(dc.x, dc.z, dc.r, 0, Math.PI * 2); ctx.fillStyle = COL.residential; ctx.fill(); }
      if (s >= 0.8) for (const p of c.paths) { trace(p.pts, p.closed); ctx.strokeStyle = 'rgba(214,205,180,0.8)'; ctx.lineWidth = Math.max(p.width * 0.7, 1.4 / s); ctx.stroke(); }
    }
    ctx.lineCap = 'butt';
  }

  // curved roads of the chunk: same casing / fill scheme; bridges get a light casing
  {
    const cls: Record<string, [string, number]> = {
      mountain: [COL.residential, 6.5], rural: [COL.residential, 7], residential: [COL.residential, 8], secondary: [COL.secondary, 9], main: [COL.main, 14], freeway: [COL.freeway, 20],
    };
    const visible = d.curved.filter((r) => r.pts.some((p) => p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ));
    const trace = (r: (typeof d.curved)[number], from = 0, to = r.pts.length - 1) => {
      ctx.beginPath();
      for (let i = from; i <= to; i++) (i === from ? ctx.moveTo(r.pts[i].x, r.pts[i].z) : ctx.lineTo(r.pts[i].x, r.pts[i].z));
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    for (const order of ['mountain', 'rural', 'residential', 'secondary', 'main', 'freeway']) {
      for (const r of visible) {
        if (r.cls !== order) continue;
        trace(r);
        ctx.strokeStyle = COL.casing;
        ctx.lineWidth = fillW(cls[r.cls][1]) + 2.4 / s;
        ctx.stroke();
      }
    }
    for (const order of ['mountain', 'rural', 'residential', 'secondary', 'main', 'freeway']) {
      for (const r of visible) {
        if (r.cls !== order) continue;
        trace(r);
        ctx.strokeStyle = cls[r.cls][0];
        ctx.lineWidth = fillW(cls[r.cls][1]);
        ctx.stroke();
        for (const [i0, i1] of r.bridges) {
          trace(r, i0, i1);
          ctx.strokeStyle = COL.bridge;
          ctx.lineWidth = fillW(cls[r.cls][1]) + 3 / s;
          ctx.stroke();
          trace(r, i0, i1);
          ctx.strokeStyle = cls[r.cls][0];
          ctx.lineWidth = fillW(cls[r.cls][1]) * 0.8;
          ctx.stroke();
        }
      }
    }
    if (s >= 1.1) {
      for (const r of visible) {
        if (r.cls !== 'main') continue;
        trace(r);
        ctx.strokeStyle = 'rgba(250,204,21,0.6)';
        ctx.lineWidth = 1 / s;
        ctx.setLineDash([5 / s, 5 / s]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // buildings sit on top of the blocks
  ctx.fillStyle = COL.building;
  for (const b of d.buildings) {
    if (b.x1 < minX || b.x0 > maxX || b.z1 < minZ || b.z0 > maxZ) continue;
    ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  }
  ctx.fillStyle = COL.landmark;
  for (const l of d.landmarks) for (const r of l.rects) {
    if (r.maxX < minX || r.minX > maxX || r.maxZ < minZ || r.minZ > maxZ) continue;
    ctx.fillRect(r.minX, r.minZ, r.maxX - r.minX, r.maxZ - r.minZ);
  }


  // the barracks island out in the sea (south of the city) and the causeway bridge that leads to it
  drawBarracks(ctx, d.barracks, s, minX, maxX, minZ, maxZ, fillW);

  if (nav.route) strokeRoute(ctx, nav.route, s, mini ? 4 : 5);
  ctx.restore();
  if (layer === 'world') return;

  // ---------------------------------------------------------------- screen-space layer (pixels)
  const R = Math.min(v.w, v.h) / 2;
  const onScreen = (x: number, y: number, m = 20) => x > -m && y > -m && x < v.w + m && y < v.h + m;

  // screen boxes already occupied (icons, labels, pin, player); later labels are skipped instead of overlapping them
  const placed: Box[] = [];

  const iconR = mini ? 7.5 : 11;
  const markers = getMarkers()
    .map((m) => ({ m, p: worldToScreen(v, m.x, m.z) }))
    .filter(({ p }) => onScreen(p[0], p[1]))
    .sort((a, b) => Number(opts.selectedId === b.m.id) - Number(opts.selectedId === a.m.id));
  for (const { m, p: [sx, sy] } of markers) {
    const sel = opts.selectedId === m.id;
    const r = sel ? iconR + 2 : iconR;
    if (m.kind === 'landmark') drawLandmarkIcon(ctx, sx, sy, r, sel);
    else drawPoiIcon(ctx, m.type, sx, sy, r, sel);
    placed.push([sx - r, sy - r, sx + r, sy + r]);
  }
  if (opts.labels && s >= 0.3) {
    for (const { m, p: [sx, sy] } of markers) placeLabel(ctx, placed, m.name, sx, sy + iconR + 9, 10.5);
  }

  // waypoint pin (+ rim chevron on the minimap when it is out of range)
  if (nav.target) {
    const [tx, ty] = worldToScreen(v, nav.target.x, nav.target.z);
    if (mini) {
      const off = Math.hypot(tx - v.w / 2, ty - v.h / 2);
      if (off > R - 12) {
        const a = Math.atan2(ty - v.h / 2, tx - v.w / 2);
        drawRimChevron(ctx, v.w / 2 + Math.cos(a) * (R - 10), v.h / 2 + Math.sin(a) * (R - 10), a);
      } else drawPin(ctx, tx, ty, 9);
    } else if (onScreen(tx, ty, 30)) {
      drawPin(ctx, tx, ty, 13);
      placed.push([tx - 14, ty - 40, tx + 14, ty]);
      if (opts.labels) placeLabel(ctx, placed, nav.targetName, tx, ty + 14, 11, '#f5d0fe');
    }
  }

  // player: view cone (camera) + arrow (character facing)
  const [px, py] = worldToScreen(v, nav.x, nav.z);
  if (onScreen(px, py, 40)) {
    const coneA = headingToScreenAngle(v, nav.view) - Math.PI / 2; // canvas angle 0 = +x, arrow angle 0 = up
    const coneR = mini ? 30 : 38;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, coneR, coneA - 0.5, coneA + 0.5);
    ctx.closePath();
    const g = ctx.createRadialGradient(px, py, 0, px, py, coneR);
    g.addColorStop(0, 'rgba(52,211,153,0.5)');
    g.addColorStop(1, 'rgba(52,211,153,0)');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(headingToScreenAngle(v, nav.face));
    const k = mini ? 1 : 1.25;
    ctx.beginPath();
    ctx.moveTo(0, -9 * k);
    ctx.lineTo(6.5 * k, 7 * k);
    ctx.lineTo(0, 3.5 * k);
    ctx.lineTo(-6.5 * k, 7 * k);
    ctx.closePath();
    ctx.fillStyle = COL.player;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (onScreen(px, py, 40)) placed.push([px - 16, py - 16, px + 16, py + 16]);

  if (opts.labels) drawLabels(ctx, v, d, lines, minX, maxX, minZ, maxZ, placed);

  // north indicator (rim of the minimap, corner of the full map; rotates with the map)
  if (mini) drawNorth(ctx, v.w / 2 + Math.sin(v.rot) * (R - 9), v.h / 2 - Math.cos(v.rot) * (R - 9), 7);
  else drawNorth(ctx, v.w - 24, 24, 11);
}

/** barracks island: ground, compound fence, roads, parade / plazas, buildings, helipad - and the bridge (light-cased like the other bridges) */
function drawBarracks(
  ctx: CanvasRenderingContext2D, b: ReturnType<typeof getMapData>['barracks'], s: number,
  minX: number, maxX: number, minZ: number, maxZ: number, fillW: (w: number) => number
): void {
  const hit = (r: { x0: number; x1: number; z0: number; z1: number }) => !(r.x1 < minX || r.x0 > maxX || r.z1 < minZ || r.z0 > maxZ);
  const rect = (r: { x0: number; x1: number; z0: number; z1: number }) => ctx.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);

  // ---- bridge (drawn first so the island lands on top of its end)
  const br = b.bridge;
  if (hit({ x0: br.x - br.halfWidth, x1: br.x + br.halfWidth, z0: br.z0, z1: br.z1 })) {
    const w = fillW(br.halfWidth * 2);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(br.x, br.z0);
    ctx.lineTo(br.x, br.z1 + 4);
    ctx.strokeStyle = COL.casing;
    ctx.lineWidth = w + 2.4 / s + 3 / s;
    ctx.stroke();
    ctx.strokeStyle = COL.bridge;
    ctx.lineWidth = w + 3 / s;
    ctx.stroke();
    ctx.strokeStyle = COL.secondary;
    ctx.lineWidth = w * 0.8;
    ctx.stroke();
  }

  if (!hit(b.island)) return;
  // ---- island + compound
  ctx.fillStyle = COL.casing;
  ctx.fillRect(b.island.x0 - 2, b.island.z0 - 2, b.island.x1 - b.island.x0 + 4, b.island.z1 - b.island.z0 + 4);
  ctx.fillStyle = COL.island;
  rect(b.island);
  ctx.strokeStyle = COL.residential;
  ctx.lineWidth = Math.max(1.2 / s, 1.5);
  ctx.setLineDash([8 / s, 5 / s]);
  ctx.strokeRect(b.fence.x0, b.fence.z0, b.fence.x1 - b.fence.x0, b.fence.z1 - b.fence.z0);
  ctx.setLineDash([]);

  // ---- parade ground / plazas, then roads
  ctx.fillStyle = COL.zone[1];
  for (const p of b.plazas) rect(p);
  ctx.fillStyle = COL.casing;
  for (const r of b.roads) ctx.fillRect(r.x0 - 1.2 / s, r.z0 - 1.2 / s, r.x1 - r.x0 + 2.4 / s, r.z1 - r.z0 + 2.4 / s);
  ctx.fillStyle = COL.residential;
  for (const r of b.roads) rect(r);
  // the main avenue is the bridge's continuation: draw it in the bridge colour
  ctx.fillStyle = COL.secondary;
  rect(b.roads[0]);

  // ---- buildings, helipad, water tower
  ctx.fillStyle = COL.landmark;
  for (const r of b.buildings) rect(r);
  ctx.fillStyle = COL.building;
  for (const dc of b.discs) {
    ctx.beginPath();
    ctx.arc(dc.x, dc.z, dc.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function strokeRoute(ctx: CanvasRenderingContext2D, r: Route, s: number, px: number): void {
  const w = px / s;
  const pts = r.points;
  const trace = (from: number, to: number) => {
    ctx.beginPath();
    ctx.moveTo(pts[from].x, pts[from].z);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i].x, pts[i].z);
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (r.roadTo > r.roadFrom) {
    trace(r.roadFrom, r.roadTo);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = w + 2.4 / s;
    ctx.stroke();
    ctx.strokeStyle = COL.route;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  // off-road walking legs (to / from the road) are dashed so they are never mistaken for a road
  ctx.setLineDash([6 / s, 5 / s]);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = COL.route;
  ctx.lineWidth = w * 0.8;
  if (r.roadFrom > 0) { trace(0, r.roadFrom); ctx.stroke(); }
  if (r.roadTo < pts.length - 1) { trace(r.roadTo, pts.length - 1); ctx.stroke(); }
  ctx.setLineDash([]);
}

function drawLabels(
  ctx: CanvasRenderingContext2D, v: MapView, d: ReturnType<typeof getMapData>,
  lines: { l: { pos: number; name: string; id: string }; vert: boolean }[],
  minX: number, maxX: number, minZ: number, maxZ: number, placed: Box[]
): void {
  const s = v.scale;
  if (s < 0.42) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (const dn of d.districts) {
      const [x, y] = worldToScreen(v, dn.x, dn.z);
      if (x < -60 || y < -20 || x > v.w + 60 || y > v.h + 20) continue;
      placeLabel(ctx, placed, dn.name.toUpperCase(), x, y, 9.5, '#cbd5e1', null);
    }
    ctx.restore();
    return;
  }
  for (const { l, vert } of lines) {
    // visible stretch of this road, label placed somewhere inside it (offset per road so labels don't stack)
    const ext = roadExtent(l, vert);
    const lo = Math.max(vert ? minZ : minX, ext[0]);
    const hi = Math.min(vert ? maxZ : maxX, ext[1]);
    if (hi - lo < 40) continue;
    const frac = 0.3 + ((l.id.length * 7 + Math.abs(Math.round(l.pos))) % 40) / 100;
    const t = lo + (hi - lo) * frac;
    const a = vert ? worldToScreen(v, l.pos, t - 10) : worldToScreen(v, t - 10, l.pos);
    const b = vert ? worldToScreen(v, l.pos, t + 10) : worldToScreen(v, t + 10, l.pos);
    const [cx, cy] = worldToScreen(v, vert ? l.pos : t, vert ? t : l.pos);
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang <= -Math.PI / 2) ang += Math.PI;
    ctx.font = '600 10px system-ui, sans-serif';
    const tw = ctx.measureText(l.name).width;
    if ((hi - lo) * s < tw + 16) continue;
    if (cx < 0 || cy < 0 || cx > v.w || cy > v.h) continue;
    // bounding box of the rotated label
    const hw = (Math.abs(Math.cos(ang)) * (tw + 4)) / 2 + (Math.abs(Math.sin(ang)) * 12) / 2;
    const hh = (Math.abs(Math.sin(ang)) * (tw + 4)) / 2 + (Math.abs(Math.cos(ang)) * 12) / 2;
    const box: Box = [cx - hw, cy - hh, cx + hw, cy + hh];
    if (!placed.every((p) => box[0] >= p[2] || box[2] <= p[0] || box[1] >= p[3] || box[3] <= p[1])) continue;
    placed.push(box);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    drawText(ctx, l.name, 0, 0, 10);
    ctx.restore();
  }
  // curved roads: one label near the middle of each long road, rotated along it
  for (const r of d.curved) {
    const m = Math.floor(r.pts.length / 2);
    const a0 = r.pts[Math.max(0, m - 3)];
    const b0 = r.pts[Math.min(r.pts.length - 1, m + 3)];
    const a = worldToScreen(v, a0.x, a0.z);
    const b = worldToScreen(v, b0.x, b0.z);
    const [cx, cy] = worldToScreen(v, r.pts[m].x, r.pts[m].z);
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang <= -Math.PI / 2) ang += Math.PI;
    ctx.font = '600 10px system-ui, sans-serif';
    const tw = ctx.measureText(r.name).width;
    if (r.pts.length * 10 * s < tw + 40) continue;
    if (cx < 0 || cy < 0 || cx > v.w || cy > v.h) continue;
    const hw = (Math.abs(Math.cos(ang)) * (tw + 4)) / 2 + (Math.abs(Math.sin(ang)) * 12) / 2;
    const hh = (Math.abs(Math.sin(ang)) * (tw + 4)) / 2 + (Math.abs(Math.cos(ang)) * 12) / 2;
    const box: Box = [cx - hw, cy - hh, cx + hw, cy + hh];
    if (!placed.every((p) => box[0] >= p[2] || box[2] <= p[0] || box[1] >= p[3] || box[3] <= p[1])) continue;
    placed.push(box);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    drawText(ctx, r.name, 0, 0, 10);
    ctx.restore();
  }
}

type Box = [number, number, number, number]; // minX, minY, maxX, maxY in screen px

/** draws a horizontal label unless it would overlap something already placed */
function placeLabel(
  ctx: CanvasRenderingContext2D, placed: Box[], text: string, x: number, y: number, size: number,
  color: string = COL.text, haloColor: string | null = COL.halo
): void {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const hw = ctx.measureText(text).width / 2 + 2;
  const box: Box = [x - hw, y - size / 2 - 1, x + hw, y + size / 2 + 1];
  if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) return;
  placed.push(box);
  drawText(ctx, text, x, y, size, 'center', color, haloColor);
}

function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number,
  align: CanvasTextAlign = 'center', color: string = COL.text, haloColor: string | null = COL.halo
): void {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (haloColor) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = haloColor;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  // teardrop whose tip sits exactly on the target
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - r * 0.15, y - r * 0.9, x - r, y - r * 1.2, x - r, y - r * 1.9);
  ctx.arc(x, y - r * 1.9, r, Math.PI, 0, false);
  ctx.bezierCurveTo(x + r, y - r * 1.2, x + r * 0.15, y - r * 0.9, x, y);
  ctx.closePath();
  ctx.fillStyle = COL.route;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - r * 1.9, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

export function drawRimChevron(ctx: CanvasRenderingContext2D, x: number, y: number, a: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, 6);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-5, -6);
  ctx.closePath();
  ctx.fillStyle = COL.route;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawNorth(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14,19,25,0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = `700 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f87171';
  ctx.fillText('N', x, y + 0.5);
}

export function drawLandmarkIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, sel: boolean): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = '#fbbf24';
  ctx.strokeStyle = sel ? '#ffffff' : '#0e1319';
  ctx.lineWidth = sel ? 2.4 : 1.6;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1319';
  ctx.fill();
}

export function drawPoiIcon(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, r: number, sel: boolean): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = POI_COLOR[type] ?? '#94a3b8';
  ctx.fill();
  ctx.lineWidth = sel ? 2.6 : 1.6;
  ctx.strokeStyle = sel ? '#ffffff' : '#0e1319';
  ctx.stroke();

  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.2, r * 0.16);
  ctx.lineCap = 'round';
  const u = r * 0.5;
  switch (type) {
    case 'hospital':
      ctx.fillRect(-u * 0.3, -u, u * 0.6, u * 2);
      ctx.fillRect(-u, -u * 0.3, u * 2, u * 0.6);
      break;
    case 'restaurant':
      ctx.beginPath();
      ctx.arc(0, -u * 0.35, u * 0.7, 0, Math.PI);
      ctx.moveTo(0, u * 0.35);
      ctx.lineTo(0, u);
      ctx.stroke();
      break;
    case 'commercial':
    case 'market':
      ctx.fillRect(-u, -u * 0.2, u * 2, u * 1.3);
      ctx.beginPath();
      ctx.arc(0, -u * 0.2, u * 0.55, Math.PI, 0);
      ctx.stroke();
      break;
    case 'office':
      ctx.strokeRect(-u, -u * 0.9, u * 2, u * 1.4);
      ctx.beginPath();
      ctx.moveTo(-u * 1.2, u * 0.95);
      ctx.lineTo(u * 1.2, u * 0.95);
      ctx.stroke();
      break;
    case 'park':
      ctx.beginPath();
      ctx.arc(0, -u * 0.25, u * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, u * 0.5);
      ctx.lineTo(0, u * 1.1);
      ctx.stroke();
      break;
    default: // residential
      ctx.beginPath();
      ctx.moveTo(-u * 1.1, -u * 0.1);
      ctx.lineTo(0, -u * 1.05);
      ctx.lineTo(u * 1.1, -u * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-u * 0.7, -u * 0.1, u * 1.4, u * 1.1);
  }
  ctx.restore();
}
