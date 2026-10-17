import * as THREE from 'three';
import { WorldCoordinate } from '../types/game';

/**
 * Reusable procedural architectural building blocks for high-detail interiors & exteriors
 */
export class ProceduralBuildingModules {
  // Reusable Shared Materials Cache
  private static materialsCache: Map<string, THREE.Material> = new Map();

  private static getMaterial(key: string, createFn: () => THREE.Material): THREE.Material {
    if (!this.materialsCache.has(key)) {
      this.materialsCache.set(key, createFn());
    }
    return this.materialsCache.get(key)!;
  }

  /**
   * Shell Room: Floor, ceiling, and customizable 4 perimeter walls with optional door openings
   */
  public static createRoom(
    width: number,
    length: number,
    height: number,
    wallColor: number = 0xf0ede6,
    floorColor: number = 0x2b2520, // warm hardwood/tile
    ceilingColor: number = 0xffffff
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'room_shell';

    const wallMat = this.getMaterial(`wall_${wallColor.toString(16)}`, () =>
      new THREE.MeshLambertMaterial({ color: wallColor })
    );
    const floorMat = this.getMaterial(`floor_${floorColor.toString(16)}`, () =>
      new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.35, metalness: 0.1 })
    );
    const ceilingMat = this.getMaterial(`ceil_${ceilingColor.toString(16)}`, () =>
      new THREE.MeshLambertMaterial({ color: ceilingColor })
    );

    // Floor
    const floorGeo = new THREE.PlaneGeometry(width, length);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = 0;
    floor.receiveShadow = true;
    group.add(floor);

    // Ceiling
    const ceilGeo = new THREE.PlaneGeometry(width, length);
    ceilGeo.rotateX(Math.PI / 2);
    const ceil = new THREE.Mesh(ceilGeo, ceilingMat);
    ceil.position.y = height;
    group.add(ceil);

    // North wall (Z = -length/2)
    const nWall = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.3), wallMat);
    nWall.position.set(0, height / 2, -length / 2);
    group.add(nWall);

    // South wall (Z = length/2) with centered entrance doorway (width 3, height 2.5)
    const sideW = (width - 3.2) / 2;
    if (sideW > 0.5) {
      const sWallLeft = new THREE.Mesh(new THREE.BoxGeometry(sideW, height, 0.3), wallMat);
      sWallLeft.position.set(-width / 2 + sideW / 2, height / 2, length / 2);
      group.add(sWallLeft);

      const sWallRight = new THREE.Mesh(new THREE.BoxGeometry(sideW, height, 0.3), wallMat);
      sWallRight.position.set(width / 2 - sideW / 2, height / 2, length / 2);
      group.add(sWallRight);

      // Top lintel over door
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.2, height - 2.5, 0.3), wallMat);
      lintel.position.set(0, 2.5 + (height - 2.5) / 2, length / 2);
      group.add(lintel);
    }

    // West wall (X = -width/2)
    const wWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, height, length), wallMat);
    wWall.position.set(-width / 2, height / 2, 0);
    group.add(wWall);

    // East wall (X = width/2)
    const eWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, height, length), wallMat);
    eWall.position.set(width / 2, height / 2, 0);
    group.add(eWall);

    // Skirting baseboards
    const baseboardMat = this.getMaterial('baseboard_dark', () =>
      new THREE.MeshLambertMaterial({ color: 0x1f242d })
    );
    const bbN = new THREE.Mesh(new THREE.BoxGeometry(width, 0.15, 0.35), baseboardMat);
    bbN.position.set(0, 0.075, -length / 2 + 0.05);
    group.add(bbN);

    return group;
  }

  /**
   * Service Counter / Bar / Reception Desk
   */
  public static createServiceCounter(
    length: number = 4,
    depth: number = 0.9,
    height: number = 1.1,
    counterColor: number = 0x1a202c,
    topColor: number = 0xedf2f7
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'service_counter';

    const baseMat = new THREE.MeshLambertMaterial({ color: counterColor });
    const topMat = new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.2, metalness: 0.1 });

    // Counter body
    const base = new THREE.Mesh(new THREE.BoxGeometry(length, height - 0.08, depth), baseMat);
    base.position.y = (height - 0.08) / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Polished Countertop with slight overhang
    const top = new THREE.Mesh(new THREE.BoxGeometry(length + 0.15, 0.08, depth + 0.15), topMat);
    top.position.y = height - 0.04;
    top.castShadow = true;
    group.add(top);

    // Front Kickplate LED accent strip
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(length * 0.9, 0.03, 0.02), ledMat);
    led.position.set(0, 0.1, depth / 2 + 0.01);
    group.add(led);

    return group;
  }

  /**
   * Dining / Cafe Table Set: Table + 2 to 4 Chairs
   */
  public static createTableSet(
    tableType: 'square' | 'round' = 'square',
    numChairs: number = 4,
    tableColor: number = 0x5c4033,
    chairColor: number = 0x2d3748
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'table_set';

    const tMat = new THREE.MeshStandardMaterial({ color: tableColor, roughness: 0.4 });
    const cMat = new THREE.MeshLambertMaterial({ color: chairColor });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1a202c, metalness: 0.6 });

    // Tabletop
    let tabletop: THREE.Mesh;
    if (tableType === 'round') {
      const geo = new THREE.CylinderGeometry(0.7, 0.7, 0.06, 16);
      tabletop = new THREE.Mesh(geo, tMat);
    } else {
      const geo = new THREE.BoxGeometry(1.2, 0.06, 1.2);
      tabletop = new THREE.Mesh(geo, tMat);
    }
    tabletop.position.y = 0.75;
    tabletop.castShadow = true;
    group.add(tabletop);

    // Center table pillar base
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.72, 8), legMat);
    stem.position.y = 0.36;
    group.add(stem);
    const baseDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 16), legMat);
    baseDisk.position.y = 0.02;
    group.add(baseDisk);

    // Place chairs around table
    const chairDist = 0.85;
    for (let i = 0; i < numChairs; i++) {
      const angle = (i * (Math.PI * 2)) / numChairs;
      const chair = this.createChair(cMat, legMat);
      chair.position.set(Math.cos(angle) * chairDist, 0, Math.sin(angle) * chairDist);
      chair.rotation.y = -angle - Math.PI / 2;
      group.add(chair);
    }

    return group;
  }

  /**
   * Single ergonomic chair
   */
  public static createChair(
    seatMat?: THREE.Material,
    legMat?: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'chair';

    const sMat = seatMat || new THREE.MeshLambertMaterial({ color: 0x3b82f6 });
    const lMat = legMat || new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.5 });

    // Seat cushion
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.44), sMat);
    seat.position.y = 0.45;
    seat.castShadow = true;
    group.add(seat);

    // Backrest
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.04), sMat);
    back.position.set(0, 0.7, -0.2);
    back.castShadow = true;
    group.add(back);

    // 4 Legs
    const legGeo = new THREE.CylinderGeometry(0.02, 0.015, 0.45, 6);
    const legOffsets = [
      [-0.18, -0.18],
      [0.18, -0.18],
      [-0.18, 0.18],
      [0.18, 0.18],
    ];
    legOffsets.forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, lMat);
      leg.position.set(lx, 0.225, lz);
      group.add(leg);
    });

    return group;
  }

  /**
   * Automatic Teller Machine (ATM)
   */
  public static createATM(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'atm_kiosk';

    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const keypadMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
    const slotMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

    // Main cabinet
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.7), bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);

    // Glowing screen
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.35), screenMat);
    screen.position.set(0, 1.35, 0.355);
    group.add(screen);

    // Keypad shelf
    const keypad = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.18), keypadMat);
    keypad.position.set(0, 1.05, 0.38);
    keypad.rotation.x = 0.2;
    group.add(keypad);

    // Cash dispenser slot
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.01), slotMat);
    slot.position.set(0, 0.85, 0.355);
    group.add(slot);

    // Top signage
    const signMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.02), signMat);
    sign.position.set(0, 1.68, 0.355);
    group.add(sign);

    return group;
  }

  /**
   * Hospital Bed with monitors and IV drip pole
   */
  public static createHospitalBed(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'hospital_bed';

    const frameMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.4 });
    const mattressMat = new THREE.MeshLambertMaterial({ color: 0x0284c7 });
    const linenMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

    // Bed frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 2.2), frameMat);
    frame.position.y = 0.45;
    group.add(frame);

    // Mattress
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 2.1), mattressMat);
    mattress.position.y = 0.65;
    group.add(mattress);

    // Blanket / Sheet
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.12, 1.4), linenMat);
    sheet.position.set(0, 0.72, 0.3);
    group.add(sheet);

    // Pillow
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.4), linenMat);
    pillow.position.set(0, 0.75, -0.75);
    group.add(pillow);

    // Headboard & Footboard rails
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.05), frameMat);
    headboard.position.set(0, 0.8, -1.1);
    group.add(headboard);

    // Vital signs monitor side-cart
    const monitorPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 8), frameMat);
    monitorPole.position.set(-0.8, 0.8, -0.6);
    group.add(monitorPole);

    const monBox = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.12), new THREE.MeshLambertMaterial({ color: 0x1e293b }));
    monBox.position.set(-0.8, 1.45, -0.6);
    group.add(monBox);

    const monScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), screenMat);
    monScreen.position.set(-0.8, 1.45, -0.53);
    group.add(monScreen);

    return group;
  }

  /**
   * Office / Bank Workstation Desk with Monitor & Keyboard
   */
  public static createOfficeDesk(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'office_desk';

    const deskMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3 });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const pcMat = new THREE.MeshLambertMaterial({ color: 0x0f172a });

    // Desk Base
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.72, 0.8), deskMat);
    desk.position.y = 0.36;
    desk.castShadow = true;
    group.add(desk);

    // Desktop surface
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.9), topMat);
    top.position.y = 0.74;
    group.add(top);

    // PC Monitor
    const monStand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 6), pcMat);
    monStand.position.set(0, 0.84, -0.15);
    group.add(monStand);

    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.38, 0.03), pcMat);
    monitor.position.set(0, 1.05, -0.15);
    group.add(monitor);

    const monScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), screenMat);
    monScreen.position.set(0, 1.05, -0.13);
    group.add(monScreen);

    // Keyboard
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.14), pcMat);
    kb.position.set(0, 0.77, 0.15);
    group.add(kb);

    return group;
  }

  /**
   * Decorative Potted Indoor Plant (Palm / Monstera)
   */
  public static createIndoorPlant(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'indoor_plant';

    const potMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x3f2e18 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x15803d });

    // Ceramic pot
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.55, 12), potMat);
    pot.position.y = 0.275;
    pot.castShadow = true;
    group.add(pot);

    // Soil
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 12), new THREE.MeshLambertMaterial({ color: 0x271c10 }));
    soil.position.y = 0.52;
    group.add(soil);

    // Palm leaves spreading outwards
    for (let i = 0; i < 7; i++) {
      const angle = (i * Math.PI * 2) / 7;
      const leafGeo = new THREE.ConeGeometry(0.18, 0.85, 5);
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(angle) * 0.22, 0.9, Math.sin(angle) * 0.22);
      leaf.rotation.x = Math.sin(angle) * 0.6;
      leaf.rotation.z = -Math.cos(angle) * 0.6;
      group.add(leaf);
    }

    return group;
  }

  /**
   * Modern Ceiling LED Panel Light fixture
   */
  public static createCeilingLightPanel(width: number = 1.2, length: number = 1.2): THREE.Group {
    const group = new THREE.Group();
    group.name = 'ceiling_light';

    const frameMat = new THREE.MeshLambertMaterial({ color: 0xd1d5db });
    const emissiveMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });

    const frame = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, length), frameMat);
    group.add(frame);

    const emitter = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.1, length - 0.1), emissiveMat);
    emitter.rotateX(Math.PI / 2);
    emitter.position.y = -0.026;
    group.add(emitter);

    return group;
  }
}
