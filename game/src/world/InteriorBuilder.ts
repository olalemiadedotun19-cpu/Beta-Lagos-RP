import * as THREE from 'three';
import { LocationDefinition } from './LocationDefinition';
import { ProceduralBuildingModules } from './ProceduralBuildingModules';
import { SpatialGrid } from './SpatialGrid';

export interface GeneratedInteriorResult {
  rootGroup: THREE.Group;
  collisionGrid: SpatialGrid;
  accentLights: THREE.Light[];
  spawnPoint: { x: number; y: number; z: number };
}

/**
 * Procedural Interior Builder
 * Generates unique visual identities for restaurants, hospitals, banks/tech hubs, residential, and malls
 */
export class InteriorBuilder {
  public static buildInterior(location: LocationDefinition): GeneratedInteriorResult {
    const root = new THREE.Group();
    root.name = `interior_${location.locationId}`;

    const collisionGrid = new SpatialGrid(6);
    const accentLights: THREE.Light[] = [];

    // Base room dimensions: 18m wide x 20m deep x 4.2m ceiling
    const width = 18;
    const length = 20;
    const height = 4.2;

    switch (location.category) {
      case 'restaurant':
        this.buildRestaurantInterior(root, width, length, height, collisionGrid, accentLights);
        break;
      case 'hospital':
        this.buildHospitalInterior(root, width, length, height, collisionGrid, accentLights);
        break;
      case 'office':
      case 'bank':
        this.buildTechHubInterior(root, width, length, height, collisionGrid, accentLights);
        break;
      case 'residential':
        this.buildResidentialInterior(root, width, length, height, collisionGrid, accentLights);
        break;
      case 'commercial':
      default:
        this.buildCommercialMallInterior(root, width, length, height, collisionGrid, accentLights);
        break;
    }

    // Add room perimeter collision walls
    const hw = width / 2;
    const hl = length / 2;
    collisionGrid.insert({ id: 'wall_n', minX: -hw, maxX: hw, minZ: -hl - 0.5, maxZ: -hl + 0.2 });
    collisionGrid.insert({ id: 'wall_w', minX: -hw - 0.5, maxX: -hw + 0.2, minZ: -hl, maxZ: hl });
    collisionGrid.insert({ id: 'wall_e', minX: hw - 0.2, maxX: hw + 0.5, minZ: -hl, maxZ: hl });
    // South wall with doorway in center (X between -1.8 and 1.8 is clear)
    collisionGrid.insert({ id: 'wall_s_left', minX: -hw, maxX: -1.8, minZ: hl - 0.2, maxZ: hl + 0.5 });
    collisionGrid.insert({ id: 'wall_s_right', minX: 1.8, maxX: hw, minZ: hl - 0.2, maxZ: hl + 0.5 });

    // Spawn point inside near the entrance
    const spawnPoint = location.arrivalPoints.interiorSpawn || { x: 0, y: 0, z: hl - 3 };

    return {
      rootGroup: root,
      collisionGrid,
      accentLights,
      spawnPoint,
    };
  }

  // 1. RESTAURANT INTERIOR (Buka & Grill)
  private static buildRestaurantInterior(
    root: THREE.Group,
    width: number,
    length: number,
    height: number,
    grid: SpatialGrid,
    lights: THREE.Light[]
  ) {
    // Warm terracotta floor and ivory walls
    const room = ProceduralBuildingModules.createRoom(width, length, height, 0xfef3c7, 0x5c2c16, 0xffedd5);
    root.add(room);

    // Warm chandelier / amber ceiling panels
    [-4, 4].forEach((x) => {
      [-4, 2].forEach((z) => {
        const lightFixture = ProceduralBuildingModules.createCeilingLightPanel(1.8, 1.8);
        lightFixture.position.set(x, height - 0.05, z);
        root.add(lightFixture);

        const ptLight = new THREE.PointLight(0xf59e0b, 1.2, 10);
        ptLight.position.set(x, height - 0.4, z);
        root.add(ptLight);
        lights.push(ptLight);
      });
    });

    // Kitchen Counter & Food Service Buffet Area across the back (Z = -length/2 + 3)
    const counterZ = -length / 2 + 3.2;
    const counter = ProceduralBuildingModules.createServiceCounter(10, 1.1, 1.15, 0x7c2d12, 0xfef08a);
    counter.position.set(0, 0, counterZ);
    root.add(counter);
    grid.insert({ id: 'buka_counter', minX: -5.2, maxX: 5.2, minZ: counterZ - 0.6, maxZ: counterZ + 0.6 });

    // Menu Blackboard behind counter
    const boardMat = new THREE.MeshBasicMaterial({ color: 0x18181b });
    const board = new THREE.Mesh(new THREE.BoxGeometry(7, 1.6, 0.05), boardMat);
    board.position.set(0, 2.6, -length / 2 + 0.2);
    root.add(board);

    // Dining Table Sets (4 sets arranged symmetrically)
    const tableCoords = [
      { x: -5, z: -1 },
      { x: 5, z: -1 },
      { x: -5, z: 4 },
      { x: 5, z: 4 },
    ];
    tableCoords.forEach((pos, idx) => {
      const tableSet = ProceduralBuildingModules.createTableSet('square', 4, 0x78350f, 0x991b1b);
      tableSet.position.set(pos.x, 0, pos.z);
      root.add(tableSet);
      grid.insert({ id: `table_${idx}`, minX: pos.x - 1.2, maxX: pos.x + 1.2, minZ: pos.z - 1.2, maxZ: pos.z + 1.2 });
    });

    // Decorative Tropical Potted Plants
    [-width / 2 + 1.2, width / 2 - 1.2].forEach((px) => {
      const plant = ProceduralBuildingModules.createIndoorPlant();
      plant.position.set(px, 0, length / 2 - 2);
      root.add(plant);
    });
  }

  // 2. HOSPITAL INTERIOR (Clinic & Emergency Triage)
  private static buildHospitalInterior(
    root: THREE.Group,
    width: number,
    length: number,
    height: number,
    grid: SpatialGrid,
    lights: THREE.Light[]
  ) {
    // Ultra-clean bright white walls and surgical teal floor
    const room = ProceduralBuildingModules.createRoom(width, length, height, 0xf0fdf4, 0x0f766e, 0xffffff);
    root.add(room);

    // Bright daylight LED panels
    [-4, 4].forEach((x) => {
      [-5, 0, 5].forEach((z) => {
        const fixture = ProceduralBuildingModules.createCeilingLightPanel(2.0, 1.2);
        fixture.position.set(x, height - 0.05, z);
        root.add(fixture);

        const ptLight = new THREE.PointLight(0xe0f2fe, 1.4, 12);
        ptLight.position.set(x, height - 0.3, z);
        root.add(ptLight);
        lights.push(ptLight);
      });
    });

    // Central Triage Nurse Counter
    const counterZ = -length / 2 + 4.5;
    const reception = ProceduralBuildingModules.createServiceCounter(7, 1.2, 1.15, 0x134e4a, 0xf8fafc);
    reception.position.set(0, 0, counterZ);
    root.add(reception);
    grid.insert({ id: 'hosp_counter', minX: -3.8, maxX: 3.8, minZ: counterZ - 0.7, maxZ: counterZ + 0.7 });

    // Hospital Recovery Beds with monitors along the West wall
    [-4, 2].forEach((bz, idx) => {
      const bed = ProceduralBuildingModules.createHospitalBed();
      bed.position.set(-width / 2 + 2.5, 0, bz);
      bed.rotation.y = Math.PI / 2;
      root.add(bed);
      grid.insert({ id: `bed_${idx}`, minX: -width / 2 + 1.0, maxX: -width / 2 + 3.8, minZ: bz - 0.8, maxZ: bz + 0.8 });
    });

    // Waiting Area Chairs along the East wall
    [-3, -1, 1, 3].forEach((cz) => {
      const chair = ProceduralBuildingModules.createChair(
        new THREE.MeshLambertMaterial({ color: 0x0284c7 }),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7 })
      );
      chair.position.set(width / 2 - 1.5, 0, cz);
      chair.rotation.y = -Math.PI / 2;
      root.add(chair);
      grid.insert({ id: `wait_chair_${cz}`, minX: width / 2 - 2.0, maxX: width / 2 - 0.8, minZ: cz - 0.4, maxZ: cz + 0.4 });
    });
  }

  // 3. TECH HUB & BANKING INTERIOR
  private static buildTechHubInterior(
    root: THREE.Group,
    width: number,
    length: number,
    height: number,
    grid: SpatialGrid,
    lights: THREE.Light[]
  ) {
    // Modern industrial slate walls and dark marble floor
    const room = ProceduralBuildingModules.createRoom(width, length, height, 0x1e293b, 0x0f172a, 0x334155);
    root.add(room);

    // Modern neon accent strips and LED lights
    const blueNeon = new THREE.PointLight(0x0ea5e9, 2.0, 14);
    blueNeon.position.set(0, height - 0.5, 0);
    root.add(blueNeon);
    lights.push(blueNeon);

    // ATM Kiosks along East wall
    [1, 3.5].forEach((az, idx) => {
      const atm = ProceduralBuildingModules.createATM();
      atm.position.set(width / 2 - 1.2, 0, az);
      atm.rotation.y = -Math.PI / 2;
      root.add(atm);
      grid.insert({ id: `atm_${idx}`, minX: width / 2 - 2.0, maxX: width / 2 - 0.5, minZ: az - 0.5, maxZ: az + 0.5 });
    });

    // Double Developer Workstation Desks
    [-3, 3].forEach((dx) => {
      const desk = ProceduralBuildingModules.createOfficeDesk();
      desk.position.set(dx, 0, -3);
      root.add(desk);
      grid.insert({ id: `desk_${dx}`, minX: dx - 1.0, maxX: dx + 1.0, minZ: -3.6, maxZ: -2.4 });
    });

    // Glass Whiteboard / Code Wall at the back
    const glassMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
    const glassWall = new THREE.Mesh(new THREE.BoxGeometry(8, 2.4, 0.1), glassMat);
    glassWall.position.set(0, 1.8, -length / 2 + 0.2);
    root.add(glassWall);

    // Indoor architectural greenery
    [-width / 2 + 1.5, width / 2 - 1.5].forEach((px) => {
      const plant = ProceduralBuildingModules.createIndoorPlant();
      plant.position.set(px, 0, -length / 2 + 2);
      root.add(plant);
    });
  }

  // 4. RESIDENTIAL HOME INTERIOR
  private static buildResidentialInterior(
    root: THREE.Group,
    width: number,
    length: number,
    height: number,
    grid: SpatialGrid,
    lights: THREE.Light[]
  ) {
    // Warm beige walls and dark rich parquet flooring
    const room = ProceduralBuildingModules.createRoom(width, length, height, 0xf5efe6, 0x3d2314, 0xffffff);
    root.add(room);

    // Warm soft domestic lamps
    const warmLight = new THREE.PointLight(0xfde047, 1.4, 12);
    warmLight.position.set(0, height - 0.5, 0);
    root.add(warmLight);
    lights.push(warmLight);

    // King Size Bed in Bedroom Wing (North-West)
    const bed = ProceduralBuildingModules.createHospitalBed(); // reuse comfortable bed geometry
    bed.position.set(-width / 2 + 3, 0, -length / 2 + 3.5);
    root.add(bed);
    grid.insert({ id: 'home_bed', minX: -width / 2 + 1.5, maxX: -width / 2 + 4.5, minZ: -length / 2 + 2, maxZ: -length / 2 + 5 });

    // Living Room Sofa / Lounge Couch
    const couchMat = new THREE.MeshLambertMaterial({ color: 0x1e3a8a });
    const couch = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 1.2), couchMat);
    couch.position.set(4, 0.35, 1);
    root.add(couch);
    grid.insert({ id: 'home_couch', minX: 2.4, maxX: 5.6, minZ: 0.3, maxZ: 1.7 });

    // Coffee Table in front of Couch
    const coffeeTable = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.8), new THREE.MeshStandardMaterial({ color: 0x78350f }));
    coffeeTable.position.set(4, 0.2, -0.6);
    root.add(coffeeTable);
    grid.insert({ id: 'coffee_table', minX: 3.0, maxX: 5.0, minZ: -1.1, maxZ: -0.1 });

    // TV Entertainment Unit on Wall
    const tvScreen = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 0.05), new THREE.MeshBasicMaterial({ color: 0x0284c7 }));
    tvScreen.position.set(4, 1.8, -length / 2 + 0.15);
    root.add(tvScreen);
  }

  // 5. COMMERCIAL MALL PROMENADE
  private static buildCommercialMallInterior(
    root: THREE.Group,
    width: number,
    length: number,
    height: number,
    grid: SpatialGrid,
    lights: THREE.Light[]
  ) {
    // Marble floor with sleek modern retail storefront facade
    const room = ProceduralBuildingModules.createRoom(width, length, height, 0xf1f5f9, 0xe2e8f0, 0xffffff);
    root.add(room);

    // Bright commercial floodlights
    const flood = new THREE.PointLight(0xffffff, 1.6, 16);
    flood.position.set(0, height - 0.4, 0);
    root.add(flood);
    lights.push(flood);

    // Central Promo Display Island
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.2 });
    const island = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.8, 16), islandMat);
    island.position.set(0, 0.4, 0);
    root.add(island);
    grid.insert({ id: 'mall_island', minX: -2.4, maxX: 2.4, minZ: -2.4, maxZ: 2.4 });

    // Storefront counters along North Wall
    const storeCounter = ProceduralBuildingModules.createServiceCounter(8, 1.1, 1.15, 0x0f172a, 0xf43f5e);
    storeCounter.position.set(0, 0, -length / 2 + 3);
    root.add(storeCounter);
    grid.insert({ id: 'mall_counter', minX: -4.2, maxX: 4.2, minZ: -length / 2 + 2.3, maxZ: -length / 2 + 3.7 });
  }
}
