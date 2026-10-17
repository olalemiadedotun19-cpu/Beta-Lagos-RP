import { BX, BZ, BR_Z0, BR_Z1, BR_HW, ISL_HX, ISL_Z0, ISL_Z1 } from './BarracksLayout';

/**
 * What the minimap / full map draws for the barracks island and its causeway bridge.
 * Pure data (no three.js). The barracks' local frame is rotated by PI: world x = BX - localX, world z = BZ - localZ.
 * Footprints mirror the ones in BarracksScene.ts (roads, plazas, buildings); keep them in step when that layout changes.
 */
export interface MapBox { x0: number; z0: number; x1: number; z1: number }
export interface MapBarracks {
  /** island (sea wall) rectangle */
  island: MapBox;
  /** compound fence rectangle */
  fence: MapBox;
  /** causeway deck: runs along z at x = x, from z0 to z1 (z0 = ground level, z1 = where it lands on the island) */
  bridge: { x: number; z0: number; z1: number; halfWidth: number };
  roads: MapBox[];
  plazas: MapBox[];
  buildings: MapBox[];
  /** round things: helipad, water tower */
  discs: { x: number; z: number; r: number }[];
}

type LocalBox = [number, number, number, number]; // local x0, z0, x1, z1

const box = (b: LocalBox): MapBox => {
  const xa = BX - b[0], xb = BX - b[2], za = BZ - b[1], zb = BZ - b[3];
  return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
};
/** a building: local centre + footprint size along local x / z */
const bld = (cx: number, cz: number, sx: number, sz: number): MapBox => box([cx - sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2]);

let cached: MapBarracks | null = null;

export function getBarracksMapData(): MapBarracks {
  if (cached) return cached;
  const roads: LocalBox[] = [
    [-5, 38, 5, 170], // main avenue (continues onto the bridge)
    [-56, -60, -48, 38], [48, -60, 56, 38], [-56, -60, 56, -52], // parade ring
    [-167, 30, 167, 38], // east-west spine
    [-167, -202, -159, 132], [159, -202, 167, 132], [-167, -202, 167, -194], // perimeter ring
    [-167, 124, -5, 132], [5, 124, 167, 132],
    [-80, -138, -72, 30], [72, -138, 80, 30], // barracks roads
  ];
  const plazas: LocalBox[] = [[-48, -52, 48, 30], [-24, -91, 24, -60], [79, 67, 121, 105], [32, -146, 160, -139]];

  const buildings: MapBox[] = [];
  // 8 barracks blocks, long axis north-south
  for (const x of [-140, -108, 108, 140]) for (const z of [-100, -20]) buildings.push(bld(x, z, 15, 62));
  buildings.push(
    bld(0, -100, 54, 18), // headquarters
    bld(-100, 72, 46, 26), // mess hall
    bld(-40, 80, 34, 18), // medical centre
    bld(34, 84, 46, 28), // gymnasium
    bld(100, 82, 30, 16), // armory
    bld(140, 58, 40, 16), // training wing
    bld(-146, 105, 20, 12), // utilities
  );

  const disc = (lx: number, lz: number, r: number) => ({ x: BX - lx, z: BZ - lz, r });

  cached = {
    island: { x0: BX - ISL_HX, x1: BX + ISL_HX, z0: ISL_Z0, z1: ISL_Z1 },
    fence: box([-175, -210, 175, 140]),
    bridge: { x: BX, z0: BR_Z0, z1: BR_Z1, halfWidth: BR_HW },
    roads: roads.map(box),
    plazas: plazas.map(box),
    buildings,
    discs: [disc(-35, 108, 12), disc(150, 108, 4)],
  };
  return cached;
}
