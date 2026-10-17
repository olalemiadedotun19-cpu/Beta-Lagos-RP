<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/2081220b-5aa8-476c-ba25-c80d56cae755

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## The curved city (chunk 4: the whole map restructured)

The straight 1.8 km grid is gone. Only the hand-built downtown (|x|, |z| <= 105: Allen Avenue, Awolowo Way, the links, Kodesoh St, Commercial Ave
and every hand-built building / interior) keeps its straight roads. Everything else - including the two corner chunks you bent earlier, which are
untouched - is now one curved world with rolling terrain, a river, hills, **bridges, flyovers, an elevated expressway on a viaduct, ramps that land
on other streets, and streets that pass underneath them**. No cars, no people: only the city.

**Layout** (`src/world/CityPlan.ts`, pure data, deterministic):

| Piece | What it is |
| --- | --- |
| Inner Ring | a 14 m loop (r ~ 300-340 m) joined to the four main arms with T-junctions (an aligned pair = a 4-way) |
| 12 arms | the downtown roads continue as curved radials and meet the ring (Kodesoh St runs straight to the Tower Complex, East Link S straight past the Historic Hotel, Manor Road passes the French Manor - the three landmarks keep their street frontage) |
| Beltway | the outer ring: the east chunk's Bypass Highway -> south, over the river -> south arc -> over the river -> the west chunk's Bypass |
| **Ikeja Expressway** | an **elevated freeway** (20 m, 6 lanes, median barrier, jersey barriers, T-piers, 8 m above the plain) with the **Allen Interchange**: four ramps peel off the viaduct and land on Allen Avenue South |
| **Flyovers** | *Marina Flyover* climbs from Kodesoh St West, hops **over the Inner Ring** and lands on Ikosi Road; *Oregun Flyover* leaves the ring, hops **over Awolowo Way** and runs on to the Beltway |
| River + 5 bridges | a 28 m river with raised, pier-supported decks (Allen S, Ikorodu Bridge Rd, Mile 12 Bridge Rd, Beltway x2) |
| Hills | *Omole Heights* and *Oregun Ridge*: winding summit roads ending in lookout circles, forest |
| Grown streets | ~90 collectors, residential streets and cul-de-sacs sprout from the backbone and T-join their neighbours; a hole-filling pass keeps every buildable spot within ~64 m of a road. A street may pass **under** the expressway where the deck stands >= 5.2 m clear |
| Gates | all nine roads that leave the corner chunks at z = -450 continue into the city |

**Roads / elevation** (`src/world/CurvedRoads.ts`): roads get a `lift` profile (height above the terrain). Where the surface stands > 1 m clear it becomes a
viaduct: no terrain bed, concrete deck with an underside, parapets / barriers, piers placed so that **no column ever stands on a road passing beneath**.
Ramps start tangentially (`merge`) from the host's edge. Kerbed pavements are cut at junction mouths and rounded with kerb returns; zebra crossings on side
roads; dead ends finish in turning circles. `groundHeightAt(x, z, refY)` is level-aware (a deck only counts when you are up on it).

**Buildings** (`src/world/CityBuildings.ts`): district plots (Crescent Villas, Glass Quarter, Sky Garden Park, The Mews - now *oriented* plots reserved along
the backbone before the streets grow), then frontage rows along every kerbed street following its curve, then second-row houses facing the nearest street.
Every footprint is an oriented rectangle validated against all road edges, the river, hills, the core, landmark lots, plots and other footprints
(`npm run verify:districts` proves it: 0 touching a road, 0 overlaps).

**Walking under / over**: colliders carry a vertical extent (`y0`/`y1`), so bridge rails and piers only block walkers at their own level;
the camera no longer hops onto a deck passing overhead.

**Map / navigation**: the minimap and world map draw the freeway, hills, river and rotated district plots; routing uses a binary-heap Dijkstra over the
curved graph (roads that meet end-to-end are one road) so a route anywhere on the map takes a few ms.

**Dev tools** (all headless - no browser, no WebGL needed):

- `npm run verify:city` - every crossing is grade separated with real clearance, radii / grades, walking height = road surface, terrain meets the chunks at 0
- `npm run verify:districts` - district contents inside their plots; building placement
- `npm run verify:roads` - the two corner chunks
- `npx tsx scripts/plan-render.ts out.png [cx cz half px] [--bld]` - top-down plan PNG (roads by class, decks in yellow, buildings, plots)
- `npx tsx scripts/relief-render.ts out.png` - shaded relief of the real terrain function (needs the global `sharp` package like plan-render)

Notes: the city network + building plan are generated once at start-up (~2 s on a desktop; deterministic, so they could be baked into a data file if load
time ever matters). `src/world/RoadMath.ts` / `RoadTypes.ts` hold the shared math and types. The old grid frontage / block code in `CellBuilder.ts` is gone.
A pre-existing syntax error in `src/ui/MapModal.tsx` (an import inside another import) was fixed.

## Getting around (no transit, no teleporting)

You walk everywhere. There is no transport picker, no Transit app and no instant travel.

Flow: Map -> tap a location or landmark -> **SET WAYPOINT** -> follow the route / beacon on foot -> **ENTER** at the door.

- Waypoints and routes are described in the "Minimap, world map & navigation" section below.
- `src/travel/TransportModes.ts`, `Vehicles.ts`, `BuildingKit.ts`, `Geo.ts` and `TravelMaterials.ts` are kept only because the street/building generators use them (parked vehicles, facades, geometry helpers).

## Roads (`src/procedural/RoadBuilder.ts`)

The district road network is baked into 4 merged meshes (asphalt, pavements, markings, wear decals) with two tiny tiled canvas textures (`RoadTextures.ts`): ~3k triangles for the whole map.

- Real junctions: pavements cut at crossings, rounded kerb corners, raised pavements with kerb faces and paver texture, dusty verge.
- Markings: double-yellow centre, dashed lane dividers, edge lines (stopped before junctions), zebra crossings and stop lines on every arm.
- Wear: tyre tracks, patched asphalt, oil stains, potholes (narrow streets), manholes, storm drains, speed bumps on residential streets.


## Curved-road chunks (`src/world/CurvedRoads.ts`, `src/procedural/CurvedRoadBuilder.ts`)

The grid is being replaced by hills and curved roads one 450 m corner (3 x 3 streamed cells) at a time. Done: **chunk 1** (north-east: mountain with switchbacks, stream) and **chunk 2** (north-west: wooded Western Heights with a spiral road, a river, a bypass and a small hill-side neighbourhood). The grid roads stop at the chunk borders (x = +-450 / z = -450) and each curved road continues from the old centreline at the old width.

- `CurvedRoads.ts` is pure data (no THREE): hills, water courses, roads (spline centrelines, grade-limited elevation profiles, bridges, T-junctions) and `groundHeightAt()`. To add a chunk: add its rect to `CHUNKS`, its hills to `HILLS_*`/`baseHeight`, water to `STREAM_DEFS`, roads to `DEFS`, and teach `inChunk`/`rectInChunk`/`WorldLayout` about the new rectangle.
- `entry` = a curved road that starts on a cut grid road; `exit` = one that ends on a border (the nav graph links both to the grid); `join`/`from` = T-junctions between curved roads.
- `npm run verify:roads` runs the headless checks (grades, radii, crossings, water, bridges, border alignment, cut/fill).

## Chunk 3: the city itself (`src/world/CityDistricts.ts`, `src/procedural/DistrictBuilder.ts`)

The middle ring of the grid city keeps its straight roads, the hand-built core and the three landmarks (French Manor, Historic Hotel, Tower Complex). What changes is the INSIDE of 17 blocks (centre within 310 m of the origin, outside the core, not a park, not touching a lot), each redesigned in one of four modern styles. Streets and frontage next to a district block are unchanged on the other side; frontage buildings are skipped on the district side because the district brings its own.

| Style | What it is |
|---|---|
| Crescent Villas | curved cul-de-sac lane (asphalt, kerbs, pavements, lamps) with cantilevered flat-roof villas: cube / wing (timber wing, roof terrace, pool) / three-storey terrace |
| Glass Quarter | paved plaza with a fountain, 3 glass towers fanned round it (podium, stepped crown, red beacon), canopy cafe, seating cubes |
| Sky Garden Park | looping path, two ponds, timber pavilion, playground, cafe, oak groves, grass tufts, benches |
| The Mews | two rows of colour-blocked 3-storey townhouses (roof gardens, balconies) either side of a lane with a turning circle |

- `CityDistricts.ts` is pure data: block selection, the four layouts in a local frame (u across, v inward from the street it faces), and validation while generating (inside the block, no overlaps via SAT, clear of lanes / ponds / lots). `rotatedColliders()` turns a rotated footprint into several exact-AABB slices for the axis-aligned collision grid.
- `DistrictBuilder.ts` draws one district into the cell's existing batches (kit / lawn / ponds / oaks / tufts / colliders / lamps) plus one merged flat geometry for lanes, pavements and paths. Far cells skip small props.
- `CellBuilder.ts`: block loop calls `buildDistrict`; frontage skips district sides. Minimap + full map tint the districts and draw lanes / paths; HUD names use `areaNameAt()`.
- `npm run verify:districts` runs the headless checks. To add a style: write a `layoutX` in `CityDistricts.ts`, a `drawX` per new building type in `DistrictBuilder.ts`.

## Minimap, world map & navigation (`src/navigation`, `src/ui/Minimap.tsx`, `src/ui/MapCanvas.tsx`)

One navigation system, two views. `NavMap.ts` holds the map data (roads/zones/parks from `WorldLayout`, core buildings + POIs from `worldData`, landmarks from `buildings/lots.ts`, park ponds re-derived with CellBuilder's seeded RNG), the world<->screen transform and the router. `drawMap.ts` is the only renderer: the minimap (heading-up, circular, bottom-left above the joystick) and the full map (north-up, pan/pinch/zoom, tap-to-waypoint) both call it with a `MapView` + the engine's `getNavSnapshot()`.

- Coordinates: world metres, map x = world x, map y = world z (north = -z).
- Waypoints: `engine.setWaypointAt(x, z, name)` or `engine.startWalkRoute(poi)`. Routes are Dijkstra over the real road grid (`computeRoute`); off-road legs are <= 60 m and drawn dashed. The pill arrow aims at the next route point.
- Integration point for a different road model (curved roads, one-ways, closures): replace the graph inside `computeRoute`; both maps and the pill follow automatically.
- `?debug` publishes the full map's view on the canvas (`data-view`) for automated tests.


## HUD upgrade (console-style open-world HUD)

- **Minimap** (`src/ui/Minimap.tsx`, `src/navigation/drawMini.ts`): heading-up radar with a perspective tilt (flat terrain from `drawMap(layer: 'world')`
  tilted by CSS `perspective + rotateX`, so it costs nothing per frame; markers, compass and player are drawn flat on top with the same projection maths).
  Zoom follows real ground speed (`NavSnapshot.speed`, measured in `GameEngine.getNavSnapshot`): ~70 m to the rim standing, ~110 m sprinting, up to 210 m at vehicle speed, eased over ~0.6 s.
  Tune `MINI_TILT_DEG`, `ZOOM_MIN_M`, `ZOOM_MAX_M`, `radiusForSpeed()` and `makeMiniGeo()` in `drawMini.ts`.
- **Icons**: `src/ui/hud/icons.tsx` (custom 24px set, no lucide in the HUD).
- **Typeface**: Barlow Condensed, self-hosted through `@fontsource/barlow-condensed` (imported at the top of `src/index.css`).
- **Look**: all HUD tokens (accent, panel, cash colour) are CSS variables on `.hud-layer` in `src/index.css`.
- Install with `npm install --legacy-peer-deps` (the existing dependency set has a peer-range conflict unrelated to the HUD).

## Ground look (`src/procedural/GroundDetail.ts`, `src/procedural/TerrainTextures.ts`)

The grass / rock / dirt of the terrain and lawns is no longer a flat tint with a few painted lines:

- `GroundDetail.ts` builds three tileable RGBA maps in plain typed arrays (R albedo, G height, B dry-blade mask): layered curved grass blades
  (undergrowth / body / sunlit tips, each occluding the last), warped-Voronoi weathered stone with cracks, and lumpy soil with pebbles.
- `applyTerrainShader` (TerrainTextures.ts) uses them two ways: albedo detail at two scales (the large one rotated, so no grid shows) and
  **per-pixel bump lighting** from the height channel, so sun and sky light pick out individual tufts and stones within ~75 m.
  Colour is desaturated and patchy (dry straw, damp dark, lush) with per-blade yellow / green variation, and a metre-scale mottling stays on at any
  distance so the ground never fades to a flat fill.
- Tunables: the colour constants (`GRASS_A/B/DRY/DARK`, `ROCK_*`, `DIRT`), bump strengths (the `0.028` / `0.022` / `0.12` height scales in metres),
  and `nearK` / `fadeD` distances in the fragment shader. Texture sizes are `GRASS_TEX` / `ROCK_TEX` / `DIRT_TEX` (generation costs ~0.3 s once at start-up).

## Crosswalks / road paint and turning-circle kerbs

- **Paint** (`src/procedural/PaintDetail.ts`, `getPaintTexture` / `getPaintBumpTexture` in `RoadTextures.ts`, `marksMat` in `RoadBuilder.ts`): all markings
  (zebras, lane lines, stop lines, arrows) share one worn-thermoplastic material. The map has a thickness layer (bump), grit, hairline cracks, thin patches
  and chips that are real **holes** (alpha test), so the asphalt shows through where the paint has come off. About 7 % of the surface is chipped;
  change `thr` in `buildPaintMaps` for more / less wear. Curved-world zebra bars each get their own tone.
- **Turning circles**: dead-end streets and hill roads end in an asphalt disc, a 16 cm kerbed paving ring and a sloping gravel apron. `groundHeightAt`
  now knows them (`culGrid` in `CurvedRoads.ts`, radii `TURN_APRON` / `TURN_PAVING` / `TURN_GRAVEL` shared with `CurvedRoadBuilder`), so characters stand on
  the ring instead of sinking into it. `npm run verify:city` checks it.

## Sidewalks (one shared texture + walkable verge)

- **Texture**: every pavement - downtown grid and curved city - uses `getPaverTexture()` / `getPaverBumpTexture()` (`src/procedural/RoadTextures.ts`),
  generated by `src/procedural/ConcretePaving.ts`: cast-concrete slabs (2 x 2 per 2.4 m tile) with saw-cut joints, per-slab tone, broom finish, sand grain,
  hairline cracks, damp / dust / oil stains and a matching bump map. Edit that one file to re-texture all sidewalks at once. It is pure maths, so it can be
  rendered headless (`tsx` + a few lines to dump `buildConcretePaving().color`).
- **Curved city**: the slabs now run with the street (UV = distance along the road / distance out from the kerb) so the joints stay square to the kerb on
  every curve; the kerb face uses the same concrete; each 2.4 m panel has its own slight tone.
- **Roadside verge**: the strip from the pavement (or asphalt edge) to the grass is a ramp that ends exactly on the terrain bed. `groundHeightAt()` now walks
  the same ramp (`GRAVEL_LIP`, `SHOULDER` in `CurvedRoads.ts`); before, the walker stood on the bed and the legs sank up to ~36 cm into the drawn slope.
  Street lamps standing on the verge sit on the ramp too.

## Map screen (opened by tapping the minimap)

`src/ui/MapModal.tsx` was redesigned (the minimap itself is untouched): a plain places directory down the left-hand side (every POI and landmark, grouped by
kind - Homes, Food & drink, Shopping, Offices, Health, Parks, Landmarks - each with an icon, its name and the distance, nearest first), the map to its right,
and a neutral professional UI typeface instead of the HUD's condensed game face. Tapping a place (in the list or on the map) selects it, centres the map on it and
puts a crosshair on the centre of the map; the card at the bottom has the details and **Set waypoint**. The old horizontal row of place chips along the top is gone.

## Launch sequence (Beta Lagos RP) + on-device cache

The game opens with the Beta Lagos RP launch sequence: DOTCON intro -> game logo -> "Welcome to Lagos" (tap) -> loading bar -> game. The loading bar is real:

- 0-50 %   downloads the game files that are not on the phone yet (live byte progress). Files are kept in the browser's Cache Storage and served by `public/sw.js`, so the next launch downloads nothing and the game also starts offline. A new deploy only downloads changed files.
- 50-60 %  starts the game engine code (split into its own chunk).
- 60-100 % builds the big textures (asphalt, sidewalk slabs, road paint, decals, gravel, grass / rock / dirt, bridge concrete) once and saves them in IndexedDB. Later launches read the saved pixels instead of drawing them again (less CPU, less heat, no stutter).

Files:
- `public/launch/launch.html` - the launch sequence page (images embedded). Shown in an iframe, talks to the game through `window.__BL_HOST`.
- `src/launch/LaunchGate.tsx` - runs the three loading steps above, mounts the game, fades the launch screen out. `src/main.tsx` renders it instead of `App`.
- `src/cache/AppCache.ts` + `public/sw.js` - game-file download / cache. `vite.config.ts` writes `precache.json` (file list + sizes) on `vite build`. Production builds only (nothing happens in `npm run dev`).
- `src/cache/BakeCache.ts` + `src/cache/warmup.ts` - texture bake cache and the loading step that fills it.
- `?nolaunch` in the URL skips the launch sequence while developing.

If you change how a texture looks, bump `BAKE_VERSION` in `src/cache/BakeCache.ts` so phones rebuild it. If you add a new big procedural texture, wrap its pixel work with `bakedData(...)` / `bakedCanvas(...)` and add it to `TASKS` in `warmup.ts`.
