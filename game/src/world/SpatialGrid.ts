/**
 * 2D Spatial Hash Grid for high-performance collision and proximity queries
 */

export interface BoundingBox2D {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** optional vertical extent: the box only blocks walkers whose body ([feet, feet + 1.8]) overlaps [y0, y1] (bridge parapets, piers) */
  y0?: number;
  y1?: number;
  userData?: any;
}

export class SpatialGrid {
  private cellSize: number;
  private cells: Map<string, BoundingBox2D[]> = new Map();
  private allBoxes: BoundingBox2D[] = [];

  constructor(cellSize: number = 20) {
    this.cellSize = cellSize;
  }

  private getKey(cx: number, cz: number): string {
    return `${cx}:${cz}`;
  }

  clear(): void {
    this.cells.clear();
    this.allBoxes = [];
  }

  insert(box: BoundingBox2D): void {
    this.allBoxes.push(box);
    const minCx = Math.floor(box.minX / this.cellSize);
    const maxCx = Math.floor(box.maxX / this.cellSize);
    const minCz = Math.floor(box.minZ / this.cellSize);
    const maxCz = Math.floor(box.maxZ / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = this.getKey(cx, cz);
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(box);
      }
    }
  }

  /** Remove a previously inserted box (used when streamed world cells unload) */
  remove(box: BoundingBox2D): void {
    const minCx = Math.floor(box.minX / this.cellSize);
    const maxCx = Math.floor(box.maxX / this.cellSize);
    const minCz = Math.floor(box.minZ / this.cellSize);
    const maxCz = Math.floor(box.maxZ / this.cellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = this.getKey(cx, cz);
        const list = this.cells.get(key);
        if (!list) continue;
        const i = list.indexOf(box);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.cells.delete(key);
      }
    }
    const j = this.allBoxes.indexOf(box);
    if (j >= 0) this.allBoxes.splice(j, 1);
  }

  queryRadius(x: number, z: number, radius: number): BoundingBox2D[] {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);

    const candidates = new Set<BoundingBox2D>();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const list = this.cells.get(this.getKey(cx, cz));
        if (list) {
          for (let i = 0; i < list.length; i++) {
            candidates.add(list[i]);
          }
        }
      }
    }

    return Array.from(candidates);
  }

  getAll(): BoundingBox2D[] {
    return this.allBoxes;
  }
}
