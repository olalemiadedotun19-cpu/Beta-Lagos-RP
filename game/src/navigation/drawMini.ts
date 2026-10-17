import { MapView, NavSnapshot, headingToScreenAngle, worldToScreen } from './NavMap';
import { drawLandmarkIcon, drawPin, drawPoiIcon, drawRimChevron, getMarkers } from './drawMap';

/**
 * Minimap geometry + flat overlay.
 *
 * The terrain is drawn flat (heading-up) by drawMap(layer: 'world') onto a canvas that is tilted with a CSS 3D
 * transform (GPU-composited: zero per-frame JS cost for the perspective). Because the browser does the
 * perspective, markers cannot ride on that canvas without being squashed, so they are drawn on a second,
 * flat canvas using the SAME projection maths (projectMini below). Icons stay upright and shrink with distance.
 */
export const MINI_TILT_DEG = 42;
const A = (MINI_TILT_DEG * Math.PI) / 180;
const COS = Math.cos(A);
const SIN = Math.sin(A);

export interface MiniGeo {
  /** mask diameter, CSS px */
  d: number;
  /** terrain canvas size (it only has to cover the circle after the tilt) */
  W: number;
  H: number;
  /** the player's point inside the terrain canvas = CSS transform-origin = projection origin */
  ax: number;
  ay: number;
  /** where that point lands inside the mask (below centre, so more road shows ahead of the player) */
  oy: number;
  /** CSS perspective distance */
  P: number;
}

export function makeMiniGeo(d: number): MiniGeo {
  return { d, W: d * 1.16, H: d * 1.6, ax: d * 0.58, ay: d * 1.08, oy: d * 0.6, P: d * 2.3 };
}

/** terrain-canvas point (sx, sy) -> [x, y, scale] in mask pixels. Mirrors CSS `perspective(P) rotateX(a)` about (ax, ay). */
export function projectMini(g: MiniGeo, sx: number, sy: number): [number, number, number] {
  const X = sx - g.ax;
  const Y = sy - g.ay;
  const k = g.P / (g.P - Y * SIN);
  return [g.d / 2 + X * k, g.oy + Y * COS * k, k];
}

/** speed (m/s) -> metres from the player to the minimap rim. Walking sees the street, a sprint a few blocks, a vehicle the district. */
export const ZOOM_MIN_M = 70;
export const ZOOM_MAX_M = 210;
export function radiusForSpeed(speed: number): number {
  const t = Math.min(1, Math.max(0, (speed - 1.5) / 20.5));
  return ZOOM_MIN_M + (ZOOM_MAX_M - ZOOM_MIN_M) * (t * t * (3 - 2 * t));
}

const ACCENT = '#f2c14e';

export function drawMiniOverlay(ctx: CanvasRenderingContext2D, g: MiniGeo, v: MapView, nav: NavSnapshot): void {
  const d = g.d;
  const c = d / 2;
  const rim = d / 2;
  ctx.clearRect(0, 0, d, d);

  // ---- POI / landmark markers (cheap: ~40 candidates, culled to the circle)
  const base = d / 108;
  for (const m of getMarkers()) {
    const [sx, sy] = worldToScreen(v, m.x, m.z);
    const [x, y, k] = projectMini(g, sx, sy);
    if (Math.hypot(x - c, y - c) > rim - 4) continue;
    const r = Math.max(3.8, 5.6 * base * Math.min(1.1, k));
    if (m.kind === 'landmark') drawLandmarkIcon(ctx, x, y, r, false);
    else drawPoiIcon(ctx, m.type, x, y, r, false);
  }

  // ---- waypoint
  if (nav.target) {
    const [sx, sy] = worldToScreen(v, nav.target.x, nav.target.z);
    const [tx, ty, k] = projectMini(g, sx, sy);
    const off = Math.hypot(tx - c, ty - c);
    if (off > rim - 12) {
      const a = Math.atan2(ty - c, tx - c);
      drawRimChevron(ctx, c + Math.cos(a) * (rim - 11), c + Math.sin(a) * (rim - 11), a);
    } else {
      drawPin(ctx, tx, ty, Math.max(5, 8.5 * base * Math.min(1.1, k)));
    }
  }

  // ---- compass ring: tick marks + cardinal letters rotate with the map
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(v.rot);
  ctx.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    if (i % 6 !== 0) { // the four cardinal slots carry letters instead of ticks
      ctx.beginPath();
      ctx.moveTo(0, -(rim - 2));
      ctx.lineTo(0, -(rim - 4.5));
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.rotate(Math.PI / 12);
  }
  ctx.restore();
  const font = Math.max(8, Math.round(9.5 * base));
  ctx.font = `700 ${font}px "Barlow Condensed", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const letters = ['N', 'E', 'S', 'W'];
  for (let i = 0; i < 4; i++) {
    const a = v.rot + (i * Math.PI) / 2;
    const x = c + Math.sin(a) * (rim - font * 0.95);
    const y = c - Math.cos(a) * (rim - font * 0.95);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,8,11,0.85)';
    ctx.strokeText(letters[i], x, y);
    ctx.fillStyle = i === 0 ? '#ff6b6b' : 'rgba(226,232,240,0.8)';
    ctx.fillText(letters[i], x, y);
  }

  // ---- player: camera cone + facing arrow, fixed at the projected origin
  const px = c;
  const py = g.oy;
  const coneA = headingToScreenAngle(v, nav.view) - Math.PI / 2;
  const coneR = 34 * base;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.arc(px, py, coneR, coneA - 0.46, coneA + 0.46);
  ctx.closePath();
  const grd = ctx.createRadialGradient(px, py, 0, px, py, coneR);
  grd.addColorStop(0, 'rgba(255,255,255,0.38)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fill();

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(headingToScreenAngle(v, nav.face));
  const k = 1.05 * base;
  ctx.beginPath();
  ctx.moveTo(0, -8.5 * k);
  ctx.lineTo(6 * k, 6.5 * k);
  ctx.lineTo(0, 3.2 * k);
  ctx.lineTo(-6 * k, 6.5 * k);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(5,8,11,0.9)';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

export { ACCENT as MINI_ACCENT };
