import { createGroundMaterial } from './TerrainTextures';
import { buildOcean } from './Ocean';
import { WORLD_HALF } from '../world/WorldLayout';
import * as THREE from 'three';
import { DistrictData, BuildingData, PropData, RoadSegment } from '../types/game';
import { SpatialGrid, BoundingBox2D } from '../world/SpatialGrid';
import { RoadBuilder } from './RoadBuilder';
import { StreetFurniture, FurnitureHandle } from './StreetFurniture';
import { buildOaks, OakSpec } from './TerrainTrees';
import { WorldStreamer } from '../world/WorldStreamer';
import { getWorldLayout } from '../world/WorldLayout';

export interface GeneratedDistrictResult {
  rootGroup: THREE.Group;
  collisionGrid: SpatialGrid;
  streetLights: { light: THREE.PointLight; pole: THREE.Object3D }[];
  furniture?: FurnitureHandle;
  streamer?: WorldStreamer;
}

export class CityGenerator {
  public static generateDistrict(districtData: DistrictData): GeneratedDistrictResult {
    const root = new THREE.Group();
    root.name = `district_${districtData.id}`;

    const collisionGrid = new SpatialGrid(15);
    const streetLights: { light: THREE.PointLight; pole: THREE.Object3D }[] = [];

    // 1. Terrain Ground
    const ground = this.buildTerrain(districtData);
    root.add(ground);

    // 1b. the sea: beach, sea floor and water all round the map (the player can wade / swim out to SEA_HALF)
    root.add(buildOcean());

    // 2. Roads and Sidewalks
    const roadGroup = this.buildRoadNetwork(districtData.roads);
    root.add(roadGroup);

    // 2b. Big map: roads, frontage buildings, parks, trees, lamps are streamed in cells around the player
    const streamer = new WorldStreamer(getWorldLayout(), collisionGrid);
    root.add(streamer.group);
    streamer.lights.forEach((light) => streetLights.push({ light, pole: streamer.group }));

    // 3. Buildings
    const buildingsGroup = this.buildBuildings(districtData.buildings, collisionGrid);
    root.add(buildingsGroup);

    // 4. Props & Foliage
    const propsGroup = this.buildProps(districtData.props, collisionGrid, streetLights);
    root.add(propsGroup);

    // 4b. Instanced street furniture (streetlights A/B, utility poles + cables, bus stops, kiosks, rails)
    const furniture = StreetFurniture.build(
      districtData,
      districtData.props.filter((p) => p.type === 'streetlight')
    );
    furniture.colliders.forEach((c) => collisionGrid.insert(c));
    root.add(furniture.group);
    furniture.lights.forEach((light) => streetLights.push({ light, pole: furniture.group }));

    // 5. World boundary perimeter collision walls
    this.addBoundaryCollisions(districtData.worldBounds, collisionGrid);

    return {
      rootGroup: root,
      collisionGrid,
      streetLights,
      furniture,
      streamer,
    };
  }

  private static buildTerrain(data: DistrictData): THREE.Mesh {
    const bounds = data.worldBounds;
    // Every streamed cell builds its own terrain mesh now (rolling ground, river valley, hills: CurvedRoadBuilder). This plane is only
    // the far backdrop under the cells that are not loaded yet - it sits below the deepest river bed so it can never show through.
    void bounds; // the walkable bounds now reach out over the sea; the backdrop only needs to sit under the land
    const x0 = -WORLD_HALF - 20;
    const x1 = WORLD_HALF + 20;
    const z0 = -WORLD_HALF - 20;
    const z1 = WORLD_HALF + 20;
    const shape = new THREE.Shape();
    shape.moveTo(x0, -z1);
    shape.lineTo(x1, -z1);
    shape.lineTo(x1, -z0);
    shape.lineTo(x0, -z0);
    shape.lineTo(x0, -z1);
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    // Terrain Road grass: world-space dual-scale detail + olive meadow tint (no UV tiling needed)
    const mat = createGroundMaterial();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -3.8;
    mesh.receiveShadow = true;
    return mesh;
  }

  private static buildRoadNetwork(roads: RoadSegment[]): THREE.Group {
    // Roads are streamed per cell (WorldStreamer); nothing is built up-front for the whole 1.8 km map.
    void roads;
    void RoadBuilder;
    return new THREE.Group();
  }

  private static buildBuildings(buildings: BuildingData[], collisionGrid: SpatialGrid): THREE.Group {
    const group = new THREE.Group();
    group.name = 'buildings_group';

    buildings.forEach((bldg) => {
      const bldgGroup = new THREE.Group();
      bldgGroup.position.set(bldg.position.x, 0, bldg.position.z);

      const halfW = bldg.size.width / 2;
      const halfD = bldg.size.depth / 2;
      const height = bldg.size.height;

      // Register collision box
      const colBox: BoundingBox2D = {
        id: bldg.id,
        minX: bldg.position.x - halfW,
        maxX: bldg.position.x + halfW,
        minZ: bldg.position.z - halfD,
        maxZ: bldg.position.z + halfD,
        userData: { type: 'building', id: bldg.id, name: bldg.name },
      };
      collisionGrid.insert(colBox);

      // Wall geometry
      const wallMat = new THREE.MeshLambertMaterial({ color: bldg.colorScheme.wall });
      const roofMat = new THREE.MeshLambertMaterial({ color: bldg.colorScheme.roof });
      const trimMat = new THREE.MeshLambertMaterial({ color: bldg.colorScheme.trim });
      const glassMat = new THREE.MeshLambertMaterial({
        color: 0x81e6d9,
        transparent: true,
        opacity: 0.85,
      });

      const bodyGeo = new THREE.BoxGeometry(bldg.size.width, height, bldg.size.depth);
      const bodyMesh = new THREE.Mesh(bodyGeo, wallMat);
      bodyMesh.position.y = height / 2;
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      bldgGroup.add(bodyMesh);

      // Roof details
      if (bldg.category === 'residential' || bldg.category === 'restaurant') {
        // Pitched roof
        const roofGeo = new THREE.ConeGeometry(
          Math.max(bldg.size.width, bldg.size.depth) * 0.72,
          3.2,
          4
        );
        roofGeo.rotateY(Math.PI / 4);
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.position.y = height + 1.6;
        roofMesh.castShadow = true;
        bldgGroup.add(roofMesh);
      } else {
        // Flat parapet commercial roof with AC chiller boxes
        const parapetGeo = new THREE.BoxGeometry(bldg.size.width + 0.6, 0.8, bldg.size.depth + 0.6);
        const parapetMesh = new THREE.Mesh(parapetGeo, trimMat);
        parapetMesh.position.y = height + 0.4;
        bldgGroup.add(parapetMesh);

        // AC Unit boxes on roof
        const acGeo = new THREE.BoxGeometry(2.5, 1.4, 2.0);
        const acMat = new THREE.MeshLambertMaterial({ color: 0x718096 });
        const acMesh = new THREE.Mesh(acGeo, acMat);
        acMesh.position.set(-halfW + 4, height + 1.1, -halfD + 4);
        bldgGroup.add(acMesh);
      }

      // Windows arrays across stories
      const winCols = Math.max(2, Math.floor(bldg.size.width / 4));
      const stories = bldg.stories || 2;
      const winW = 1.4;
      const winH = 1.6;
      const winGeo = new THREE.PlaneGeometry(winW, winH);

      for (let s = 1; s <= stories; s++) {
        const floorY = (height / (stories + 1)) * s;
        for (let c = 0; c < winCols; c++) {
          const posX = -halfW + (bldg.size.width / (winCols + 1)) * (c + 1);

          // Front windows (facing +Z or -Z depending on quadrant)
          const winFront = new THREE.Mesh(winGeo, glassMat);
          winFront.position.set(posX, floorY, halfD + 0.05);
          bldgGroup.add(winFront);

          const winBack = new THREE.Mesh(winGeo, glassMat);
          winBack.position.set(posX, floorY, -halfD - 0.05);
          winBack.rotateY(Math.PI);
          bldgGroup.add(winBack);
        }
      }

      // Entrance Door & Canopy
      const doorGeo = new THREE.BoxGeometry(2.4, 3.2, 0.4);
      const doorMesh = new THREE.Mesh(doorGeo, trimMat);
      doorMesh.position.set(0, 1.6, halfD + 0.15);
      bldgGroup.add(doorMesh);

      const canopyGeo = new THREE.BoxGeometry(3.6, 0.25, 2.0);
      const canopyMesh = new THREE.Mesh(canopyGeo, trimMat);
      canopyMesh.position.set(0, 3.4, halfD + 1.0);
      bldgGroup.add(canopyMesh);

      // Signboard if specified
      if (bldg.signText) {
        const signGeo = new THREE.BoxGeometry(6.0, 1.2, 0.3);
        const signMat = new THREE.MeshLambertMaterial({ color: 0x1a202c });
        const signMesh = new THREE.Mesh(signGeo, signMat);
        signMesh.position.set(0, 4.4, halfD + 0.2);
        bldgGroup.add(signMesh);

        // Canvas sign texture for sharp readable typography
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1a202c';
          ctx.fillRect(0, 0, 512, 128);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 36px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(bldg.signText, 256, 64);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const textFaceMat = new THREE.MeshBasicMaterial({ map: tex });
        const textGeo = new THREE.PlaneGeometry(5.8, 1.1);
        const textMesh = new THREE.Mesh(textGeo, textFaceMat);
        textMesh.position.set(0, 4.4, halfD + 0.36);
        bldgGroup.add(textMesh);
      }

      group.add(bldgGroup);
    });

    return group;
  }

  private static buildProps(
    props: PropData[],
    collisionGrid: SpatialGrid,
    streetLights: { light: THREE.PointLight; pole: THREE.Object3D }[]
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'props_group';
    const oakSpecs: OakSpec[] = [];

    props.forEach((prop) => {
      let obj: THREE.Object3D | null = null;

      switch (prop.type) {
        case 'streetlight':
          // handled by StreetFurniture (instanced variants + pooled lights)
          break;
        case 'tree_palm':
        case 'tree_shade':
          // every tree in the game is the Terrain Road oak (instanced once for the whole prop list, below)
          oakSpecs.push({ x: prop.position.x, y: 0, z: prop.position.z, s: (prop.scale || 1.0) * 0.6, rot: prop.rotationY, tint: (oakSpecs.length * 0.381966 + 0.07) % 1 });
          break;
        case 'danfo_bus':
          obj = this.createDanfoBus();
          // Add collision for parked bus
          collisionGrid.insert({
            id: prop.id,
            minX: prop.position.x - 1.4,
            maxX: prop.position.x + 1.4,
            minZ: prop.position.z - 3.2,
            maxZ: prop.position.z + 3.2,
            userData: { type: 'vehicle', id: prop.id },
          });
          break;
        case 'keke_tricycle':
          obj = this.createKekeTricycle();
          collisionGrid.insert({
            id: prop.id,
            minX: prop.position.x - 1.0,
            maxX: prop.position.x + 1.0,
            minZ: prop.position.z - 1.4,
            maxZ: prop.position.z + 1.4,
            userData: { type: 'vehicle', id: prop.id },
          });
          break;
        case 'car':
          obj = this.createSedanCar();
          collisionGrid.insert({
            id: prop.id,
            minX: prop.position.x - 1.1,
            maxX: prop.position.x + 1.1,
            minZ: prop.position.z - 2.3,
            maxZ: prop.position.z + 2.3,
            userData: { type: 'vehicle', id: prop.id },
          });
          break;
        case 'bench':
          obj = this.createParkBench();
          break;
      }

      if (obj) {
        obj.position.set(prop.position.x, 0, prop.position.z);
        obj.rotation.y = prop.rotationY;
        group.add(obj);
      }
    });

    const oaks = buildOaks(oakSpecs, true);
    if (oaks) group.add(oaks.group);

    return group;
  }

  // Streetlight with warm downward spotlight/pointlight
  private static createStreetlight(): { pole: THREE.Group; light: THREE.PointLight } {
    const poleGroup = new THREE.Group();

    const metalMat = new THREE.MeshLambertMaterial({ color: 0x4a5568 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });

    // Vertical pole
    const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.5, 8);
    postGeo.translate(0, 3.25, 0);
    const postMesh = new THREE.Mesh(postGeo, metalMat);
    postMesh.castShadow = true;
    poleGroup.add(postMesh);

    // Overhang arm
    const armGeo = new THREE.BoxGeometry(0.1, 0.1, 1.8);
    armGeo.translate(0, 6.4, 0.8);
    const armMesh = new THREE.Mesh(armGeo, metalMat);
    poleGroup.add(armMesh);

    // Lamp fixture head
    const lampHeadGeo = new THREE.ConeGeometry(0.35, 0.35, 8);
    lampHeadGeo.rotateX(Math.PI);
    lampHeadGeo.translate(0, 6.25, 1.6);
    const lampHeadMesh = new THREE.Mesh(lampHeadGeo, metalMat);
    poleGroup.add(lampHeadMesh);

    // Glowing bulb mesh
    const bulbGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const bulbMesh = new THREE.Mesh(bulbGeo, bulbMat);
    bulbMesh.position.set(0, 6.15, 1.6);
    poleGroup.add(bulbMesh);

    // Point Light (cast warm street illumination)
    const light = new THREE.PointLight(0xffdf80, 0, 18, 1.8);
    light.position.set(0, 6.0, 1.6);
    light.castShadow = false; // Keep performant
    poleGroup.add(light);

    return { pole: poleGroup, light };
  }

  // Famous Lagos Danfo Yellow Commercial Minibus
  private static createDanfoBus(): THREE.Group {
    const danfo = new THREE.Group();

    const yellowMat = new THREE.MeshLambertMaterial({ color: 0xf6e05e }); // Iconic Danfo canary yellow
    const blackStripeMat = new THREE.MeshLambertMaterial({ color: 0x1a202c });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x2b6cb0, transparent: true, opacity: 0.8 });
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

    // Van Body
    const bodyGeo = new THREE.BoxGeometry(2.2, 1.8, 5.4);
    bodyGeo.translate(0, 1.3, 0);
    const bodyMesh = new THREE.Mesh(bodyGeo, yellowMat);
    bodyMesh.castShadow = true;
    danfo.add(bodyMesh);

    // Twin black stripes along the side
    const stripeGeo = new THREE.BoxGeometry(2.24, 0.16, 5.42);
    stripeGeo.translate(0, 1.15, 0);
    const stripe1 = new THREE.Mesh(stripeGeo, blackStripeMat);
    danfo.add(stripe1);

    const stripe2 = new THREE.Mesh(stripeGeo, blackStripeMat);
    stripe2.position.y = 0.26;
    danfo.add(stripe2);

    // Windshield & Side windows
    const winGeo = new THREE.BoxGeometry(2.22, 0.7, 2.6);
    winGeo.translate(0, 1.6, 0.2);
    const winMesh = new THREE.Mesh(winGeo, glassMat);
    danfo.add(winMesh);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 12);
    wheelGeo.rotateZ(Math.PI / 2);

    [
      { x: -1.05, z: 1.8 },
      { x: 1.05, z: 1.8 },
      { x: -1.05, z: -1.8 },
      { x: 1.05, z: -1.8 },
    ].forEach((pos) => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(pos.x, 0.38, pos.z);
      danfo.add(w);
    });

    return danfo;
  }

  // Lagos Keke Napep (Tricycle Taxi)
  private static createKekeTricycle(): THREE.Group {
    const keke = new THREE.Group();

    const yellowMat = new THREE.MeshLambertMaterial({ color: 0xecc94b });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x2d3748 });
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a202c });

    // Lower cabin
    const cabinGeo = new THREE.BoxGeometry(1.4, 0.8, 2.2);
    cabinGeo.translate(0, 0.7, 0);
    const cabin = new THREE.Mesh(cabinGeo, yellowMat);
    cabin.castShadow = true;
    keke.add(cabin);

    // Canopy roof
    const roofGeo = new THREE.BoxGeometry(1.45, 0.15, 2.0);
    roofGeo.translate(0, 1.65, -0.1);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    keke.add(roof);

    // Front single wheel
    const frontWheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12).rotateZ(Math.PI / 2),
      wheelMat
    );
    frontWheel.position.set(0, 0.28, 0.85);
    keke.add(frontWheel);

    // Rear twin wheels
    [-0.7, 0.7].forEach((x) => {
      const rearWheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12).rotateZ(Math.PI / 2),
        wheelMat
      );
      rearWheel.position.set(x, 0.28, -0.7);
      keke.add(rearWheel);
    });

    return keke;
  }

  // Sedan passenger car
  private static createSedanCar(): THREE.Group {
    const car = new THREE.Group();

    const carMat = new THREE.MeshLambertMaterial({ color: 0x3182ce }); // cobalt blue
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a202c });
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a202c });

    // Chassis
    const baseGeo = new THREE.BoxGeometry(1.8, 0.65, 4.2);
    baseGeo.translate(0, 0.6, 0);
    const base = new THREE.Mesh(baseGeo, carMat);
    base.castShadow = true;
    car.add(base);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.5, 0.65, 2.2);
    cabinGeo.translate(0, 1.25, -0.2);
    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    car.add(cabin);

    // 4 Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 12).rotateZ(Math.PI / 2);
    [
      { x: -0.9, z: 1.3 },
      { x: 0.9, z: 1.3 },
      { x: -0.9, z: -1.3 },
      { x: 0.9, z: -1.3 },
    ].forEach((pos) => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(pos.x, 0.32, pos.z);
      car.add(w);
    });

    return car;
  }

  // Park bench
  private static createParkBench(): THREE.Group {
    const bench = new THREE.Group();
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x7b341e });
    const ironMat = new THREE.MeshLambertMaterial({ color: 0x2d3748 });

    // Seat planks
    const seatGeo = new THREE.BoxGeometry(1.8, 0.08, 0.5);
    seatGeo.translate(0, 0.45, 0);
    bench.add(new THREE.Mesh(seatGeo, woodMat));

    // Backrest
    const backGeo = new THREE.BoxGeometry(1.8, 0.4, 0.08);
    backGeo.translate(0, 0.72, -0.22);
    bench.add(new THREE.Mesh(backGeo, woodMat));

    // Legs
    const legGeo = new THREE.BoxGeometry(0.08, 0.45, 0.45);
    [-0.75, 0.75].forEach((x) => {
      const leg = new THREE.Mesh(legGeo, ironMat);
      leg.position.set(x, 0.22, 0);
      bench.add(leg);
    });

    return bench;
  }

  // District boundaries so player cannot walk off the edge of the world
  private static addBoundaryCollisions(
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    grid: SpatialGrid
  ): void {
    const wallThick = 5.0;

    // West boundary
    grid.insert({
      id: 'border_west',
      minX: bounds.minX - wallThick,
      maxX: bounds.minX,
      minZ: bounds.minZ - 20,
      maxZ: bounds.maxZ + 20,
    });
    // East boundary
    grid.insert({
      id: 'border_east',
      minX: bounds.maxX,
      maxX: bounds.maxX + wallThick,
      minZ: bounds.minZ - 20,
      maxZ: bounds.maxZ + 20,
    });
    // North boundary
    grid.insert({
      id: 'border_north',
      minX: bounds.minX - 20,
      maxX: bounds.maxX + 20,
      minZ: bounds.minZ - wallThick,
      maxZ: bounds.minZ,
    });
    // South boundary
    grid.insert({
      id: 'border_south',
      minX: bounds.minX - 20,
      maxX: bounds.maxX + 20,
      minZ: bounds.maxZ,
      maxZ: bounds.maxZ + wallThick,
    });
  }
}
