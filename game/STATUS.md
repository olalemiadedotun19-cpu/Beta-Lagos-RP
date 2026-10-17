# Multiplayer + cloud accounts (Firebase) - NOT compiled or run in a browser (no npm registry here)
- See MULTIPLAYER.md (setup, data layout, limits). New code in src/net/*; database.rules.json goes into the Firebase console.
- Engine hooks: GameEngine.startMultiplayer() (called by App after the loading screen), step() -> net.update, getPlayerData() (interior = door position, hasPlayed),
  resumePoint() ("Where you left off"), PlayerController.grounded, CarRider.netClip, PlayerCar.getNetState().
- Entry flow now uses net/cloudAuth.ts (Firebase when configured, local accounts otherwise); saves go through net/CloudSaveProvider.ts.
- Checked headless only: scripts/verify-net.ts. Check on two real devices: avatar smoothness, remote car build time, name tags, car enter / exit seen by the other player.

# BMW i8: spawn / despawn from the phone (NOT run in a browser: no npm / WebGL where it was written)
- Phone > new "Car" app (ui/SmartphoneModal.tsx): "Spawn car" puts the BMW i8 on the character's right-hand side, "Despawn car" removes it. The button shows
  "Spawning..." while the model loads (first spawn only, then it is kept). Not possible while inside a building (a message is shown).
- Model + build: vehicles/bmw/BmwI8.ts, asset vehicles/bmw/assets/bmw_i8.glb (taken from bmw_i8_viewer.html). Same look as the viewer: real size (4.689 m), clear-coat paint,
  dark glass, the simple cabin, soft studio reflections baked once per engine (the game scene has no environment map; tune ENV_INTENSITY if the paint looks too bright / dark).
- Placement + lifecycle: vehicles/PlayerCar.ts. The car is parked parallel to the way the character faces, its side SIDE_GAP (0.85 m) from the character, and tilted to the
  ground under its four wheels (slopes, kerbs). It is static: it does not follow the character and has NO collision yet (the character can walk through it). Hidden indoors.
- Engine hooks (core/GameEngine.ts): isCarSpawned(), spawnCar(), despawnCar(); disposed with the engine. App.tsx holds `carSpawned` and passes it to the phone.
- Not done on purpose: driving, doors, wheels turning, collision, saving the car across sessions.
- Model credit: "BMW I8" by iSteven (https://sketchfab.com/3d-models/bmw-i8-4b143b95aec045bf8912d99662f8d580), CC BY-NC 4.0 (credit line is in the Car app).

# International Life: sign-in flow + clothing showroom (NOT run in a browser: no npm / WebGL where it was written)

## What replaced the creation screen (src/ui/entry/*, src/auth/*, src/wardrobe/*)
- App.tsx now always opens `EntryFlow` after the loading screen: SIGN IN button only -> login form (name / username / password) -> 3D clothing showroom -> START GAME.
  The old CharacterCreation.tsx and CharacterPreview.tsx are deleted. A saved game is no longer auto-resumed: the player signs in first, then the showroom, then the game.
- Accounts are LOCAL to the device (auth/AccountStore.ts): new username = account created, existing username = password checked. PBKDF2-SHA256 + salt, no plaintext stored.
  Not server-grade security (there is no server). Each account owns one save slot `acct_<username>`; a pre-accounts save with the same username is adopted on first sign-in.
- Showroom (ShowroomScene.ts + Showroom.tsx): boutique room, figure idle on a podium, glass panel left (bottom sheet in portrait), drag to turn, pinch / wheel zoom,
  Full body / Close-up. Cards are rendered once from the real character wearing the real garment. Picking a card equips it immediately.
- Clothes that really exist (wardrobe/Wardrobe.ts): Leather Jacket (jacket mesh in figure.glb over the knit top) and Knit Top (procedural knit alone), both under Shirts.
  Head, Trousers and Accessories have no shipped models -> blank placeholders. scripts/character-src/bomber.glb is NOT shipped (unskinned), so it is not offered.
- Outfit is saved in `PlayerData.outfit` and applied in GameEngine (setOutfit) at start and in setPlayerData. FigureCharacter.setOutfit / setCastShadow are new.
- To add a garment: ship the model, add it to WARDROBE_ITEMS, make FigureCharacter.setOutfit show / hide it. UI, saving and game start need no change.
- In-game "New life" opens the same flow with `freshStart` (the account's old progress is not loaded) and a "Back to game" link on the sign-in screen.


## Remembered sign-in + spawn point picker (src/ui/entry/EntryFlow.tsx, SpawnPicker.tsx, spawn/SpawnPoints.ts)
- After the first sign-in the device remembers the account (`rememberAccount`, localStorage key intl_life_session_v1, username only). Next launch skips SIGN IN, the account form
  and the showroom: a remembered account with a saved character goes straight to the spawn picker; one that never got as far as starting goes to the showroom. Signing out
  (showroom icon, or "Not <name>? Sign out" on the spawn picker) forgets it. In-game "new life" still asks for the sign-in first.
- Spawn picker (after the showroom for new citizens, first screen for returning ones): Home and Random location are shown locked ("Soon"), Bus station is the only choice.
  The choice is saved in `PlayerData.spawnPoint` but NOTHING moves the player by it yet: when the spawn points are built, read it where the engine places the player and
  set `available: true` on the new ones in spawn/SpawnPoints.ts. Not run in a browser.

## Not verified
- `npm i && npm run build` / `npm run lint` not run (registry blocked). Account logic and the SHA-256 fallback were run in node; the showroom look (light levels, framing in portrait / landscape),
  card thumbnails and the panel CSS have never been seen on a screen. Check on a phone first: framing offsets in ShowroomScene.goal(), light values in buildLights().

# International Life — player figure + Barracks island: status

## Player character replaced by the figure from the viewer (index.html)
- The player is now the Mixamo-rigged figure (skin shader, leather jacket, knit inner wear): src/player/figure/{FigureCharacter,FigureMaterials,CharacterPreload}.ts,
  assets in src/player/figure/assets (figure.glb, clips.json). The old army soldier (src/player/army) is deleted.
- Animations: the Mixamo locomotion pack (12 clips, scripts/character-src/locomotion) baked by scripts/locomotion/bake_locomotion.py (python + numpy + scipy, no three.js;
  run it after scripts/bake-character.mjs, which still makes the offensive idle, fall pose and seated pose): idle, walking, running, strafe + strafe walking (L/R),
  turn 90 + turn 180 (L/R), jump. Walk, run and the strafes share one stride phase (per-clip foot offsets measured by forward kinematics, stored in clips.json `meta`) and blend by
  real ground speed. Full-stick walk is 1.8 m/s (clip captured at 1.62), Sprint 4.4 m/s (captured at 4.26): the speeds the clips travel at, so feet stay planted.
  A lighter analog push shortens the stride (walk blended with the idle) and eases the step rate only slightly. Strafe clips blend in by the angle between where the body faces
  and where it travels (sharp direction changes). Standing still and asked to head 60+ deg away: the 90 / 180 turn clip rotates the character (its yaw is a separate curve
  in `meta.turn`, the pose carries none) and the walk starts at 50% of the turn. Jump: clip time follows the airtime (0.7 s), landing plays on from touch-down.
- Standing still 20 s switches to the offensive stance (OFFENSIVE_IDLE_AFTER in FigureCharacter.ts, 0 = never).
- Creation-screen appearance options still do nothing. The bomber jacket is not shipped (scripts/character-src/bomber.glb is kept).
- Not run on a real device; the full game was only built (vite build), the figure was checked in a standalone headless render.
- Re-bake after changing the sources: node scripts/bake-character.mjs

## Older notes below (they mention the army soldier, which is gone)

## DONE (verified by headless render of the full game)
- Old character removed (CharacterModel, ProceduralAnatomy, CharacterColliders, BodyProfiles deleted).
- Barracks soldier is the player: src/player/army/{ArmyCharacter.ts, CharacterCore.ts, clips.json}.
  Walk / run / idle / jump driven by real movement speed. Run animation seen in-game.
  Edited: GameEngine.ts, CharacterPreview.tsx, PlayerController.ts.
- Barracks ported to three r186: src/world/barracks/BarracksScene.ts. Renders in-game (gate, guardhouses, road, sign seen).
- Placement: src/world/barracks/BarracksLayout.ts + BarracksIsland.ts
  Island far south of the map (z 1500..1920, x 31.5 +-215), reached by a ~650 m bridge from the end of Allen Avenue South
  (x=31.5, starts z~852, ramps up over land with a solid embankment, then piers over the sea; parapets, centre line, lamps).
  Barracks rotated 180 deg so the gate faces the city. Built lazily within 900 m of the player.
- Hooks: CurvedRoads.groundHeightAt (island/deck heights), worldData.worldBounds.maxZ, WorldStreamer (update/night/dispose),
  GameEngine passes the camera.
- Screenshots checked: bridge start, mid-bridge, bridge end, island gate. Asphalt lightened (was too dark).

- Inside the barracks checked (gate, road, parade ground, barracks blocks, trees): scale vs the soldier looks correct, lighting fine.
- Barracks build measured: ~0.8 s on a desktop software renderer (one-off, triggered 900 m away, i.e. before you reach the bridge).

## LEFT
1. Full walk across the bridge on a real device (headless test too slow): ramp height, parapet collision, reaching the gate.
2. Night lighting inside the barracks and collisions with its buildings not inspected.
3. (FIXED, see below) the barracks build used to freeze phones for 2-4 s when you came within 900 m.
4. Not compiled with real tsc / `vite build` (npm registry blocked here). Run `npm i && npm run build`; fix any type errors
   (ported files use // @ts-nocheck).
5. Creation-screen appearance options no longer change the soldier. Character build takes ~2-5 s at start.
6. Locomotion pack not yet seen in a browser: check foot slide at walk 1.8 / run 4.4, the turn-in-place feel (TURN_* in FigureCharacter.ts), strafe blend (STRAFE_FROM / STRAFE_TO) and the jump landing.

## Barracks textures preloaded on the loading screen (not yet run on a real device)
- warmup.ts (loading bar 60-100 %) now also prepares the whole barracks: world/barracks/BarracksPreload.ts builds the scene in 10 slices, one per frame.
- First launch: every heavy barracks texture (ground, asphalt, concrete, stucco, roof tiles, doors, facades, bark, leaves, helipad ...) is painted once and
  saved to the device through cache/BakeCache.ts (keys `bar|b1|...`). Later launches read the pixels back, no painting.
- BarracksIsland.build() takes the finished scene (getPreloadedBarracks); the old lazy build is only a fallback.
- Each baked texture paints with its own seeded rng, so the layout is the same whether textures were painted or restored (one-off change: trees / lit windows
  land in different spots than before, because textures no longer consume the shared rng).
- Bump BAR_V in BarracksScene.ts when a barracks texture or the road layout changes. Roughly 40-50 MB is saved on the device (facades are the biggest).
- Not covered: the first GPU upload of these textures when the island becomes visible (renderer.initTexture could pre-upload them).

## Soldier built on the loading screen too (not yet run on a real device)
- player/army/CharacterPreload.ts: the soldier is sculpted during loading, in parallel with the barracks; GameEngine and CharacterPreview take it
  (takePreloadedCharacter) instead of building their own. The creation preview hands it back when it closes (releaseCharacter), so the engine reuses it.
- The loading bar (cache/warmup.ts, 60-100 % of the launch bar) is now the weighted progress of road textures 20 %, barracks 40 %, soldier 40 %,
  and only reaches 100 % when all of them are done. Failures are logged and fall back to building later, so the bar never hangs.
- The soldier's share follows the builder's stages (body, head, clothes, hair), so it can pause for a moment on the body / head step.
- Still built only after the game opens: the streets around the spawn point (WorldStreamer.warmup in GameEngine).

## Spawn at the barracks + lossless optimizations (not yet run on a real device)
- Spawn: BARRACKS_SPAWN in world/barracks/BarracksLayout.ts (34 m inside the main gate, facing the parade ground). New characters, the district spawn
  point and every game start use it. ALWAYS_SPAWN_AT_BARRACKS = true ignores the saved position; set it to false to resume where the player left.
  The engine now builds the streets around the spawn point at start-up (before it built the old city centre, 1.5 km away, for nothing).
- Optimizations that do not touch texture size, resolution, anisotropy, shadow size or draw distance:
  1. WorldRenderer.updateShadowPass: the sun shadow map covers a fixed patch around the map centre, so its depth pass (4096^2 at Max) is skipped while
     that patch is further away than the fog lets you see. In the barracks the whole pass is gone.
  2. Barracks flags: cloth + normals recomputed at most 60x/s and only for flags on screen (was every frame, all flags within 250 m).
  3. Barracks oaks: the visible-tree lists and their GPU buffers are rebuilt only when the camera moved > 0.25 m or turned (was every frame).
  4. PlayerController.updateCamera: no new Vector3 per frame (less garbage collection, fewer micro-stutters).
- Noticed, not changed: the sun's shadow camera never follows the player, so there are no sun shadows anywhere except around the map centre
  (including the barracks). Making it follow the player would add shadows and GPU cost; say if you want it.

## Maps show the barracks island + bridge (not run on a real device)
- world/barracks/BarracksMapData.ts: map footprint of the island, compound fence, roads, parade / plazas, buildings, helipad, and the causeway bridge (world metres).
  Mirrors the roads / buildings in BarracksScene.ts - update it if that layout changes.
- NavMap.getMapData().barracks -> drawMap.drawBarracks(): used by BOTH the minimap and the full map. Bridge is light-cased like the other bridges.
- MapCanvas: the full map can now pan / tap down to the island (z limit = BARRACKS_MAX_Z instead of 900); MIN_SCALE 0.16 -> 0.11 so city + island fit one screen.
- Note: routing (computeRoute) still only knows the city roads, so a waypoint on the island shows as a straight dashed line.

## Performance pass 2: shorter draw distance + smooth Max (not run on a real device)
- Draw distance is ~40 % shorter at every level and has a new "Tiny" step: factor tiny 0.25 / short 0.35 / medium 0.5 / long 0.65 / ultra 0.8
  (was short 0.6 / medium 0.8 / long 1 / ultra 1.3). Fog visibility = 431 m x factor (tiny ~108 m ... ultra ~345 m). Tiers: low=tiny, medium=short, high=long, max=ultra.
- Camera far plane now follows the fog (2.6 / density + 25 m, max 900 m) instead of a fixed 700 m x factor, so nothing the fog has already hidden is drawn.
  It also follows the barracks fog lift (WorldRenderer.updateFarPlane).
- WorldStreamer: load radius = max(100, 250 x factor) (GraphicsSettings.loadRadiusFor); full-detail radius = 0.75 x load radius (max 150 m);
  unload radius = load radius + 50 m (was a fixed 330 m, so cells outside the visible range stayed in the scene). warmup() uses the same radius.
- Sun shadow map is redone every 2-3 frames instead of every frame (SHADOW_EVERY in GraphicsSettings), plus whenever the patch comes into view or the settings change.
- Dynamic resolution ("Adaptive resolution" switch, on by default): steps the pixel ratio down (never below 65 %) while fps < 90 % of 60 (or 30 when capped at 30),
  steps back up by 4 % after a stable stretch; each failed raise doubles the wait (WorldRenderer.updateAdaptive). Paused during the device test and for ~3-5 s after a settings change.
- 'Native' resolution is capped at pixel ratio 2 on phones (was 3). Desktop unchanged.
- applyGraphics now ignores the fps-counter notifications (it re-ran every 0.5 s while the counter was on).
- Tune: DRAW_FACTOR / SHADOW_EVERY in graphics/GraphicsSettings.ts, DYN_MIN in rendering/WorldRenderer.ts.

## HUD icons: sprint / punch / aim (not run on a real device)
- Supplied 64 px black art -> smoothed to 256 px white masks, embedded in src/ui/hud/hudImages.ts (SPRINT_ICON / PUNCH_ICON / AIM_ICON).
- icons.tsx: IconSprint now uses the runner picture; new IconPunch (fist) and IconAim (crosshair). They are CSS masks on `currentColor`, so they are
  white on the glass buttons, gold when toggled on (Sprint, Aim) and dark on the yellow primary variant.
- VirtualControls.ActionCluster: row is now [Aim] [Punch] [Sprint] [Jump] (.hud-actions in index.css: row-reverse + wrap-reverse, so on a narrow portrait
  screen Aim wraps onto a row above instead of running under the joystick).
- Punch and Aim are UI only: the game has no combat system yet. Aim toggles its gold state; Punch does nothing. Wire them in ActionCluster
  (or pass your own `extras.actions` from App, which are added to the left of Aim).

## Jump button removed: double-tap Sprint to jump (not run on a real device)
- ActionCluster: no Jump button; Sprint is now the corner (large) button. One tap toggles sprint at once; a second tap within 300 ms
  (DOUBLE_TAP_MS) undoes that toggle, so the sprint state stays as it was, and sends a 130 ms virtual jump (JUMP_PULSE_MS).
- Keyboard Space still jumps. Help text in ControlsHelpModal updated.

## Rearrange HUD (settings)
- Settings > Interface > HUD layout > "Rearrange HUD" closes the menu and puts the HUD in edit mode: every item (minimap, Bag/Phone, objective, status bars, clock+menu, action buttons, Interact button) is a dashed draggable box; Done / Reset bar in the centre.
- Positions are saved per orientation (landscape / portrait) as screen-fraction offsets in GameSettings.hudLayout; "Reset HUD positions" (settings) clears both. Reset-all in settings also clears them.
- Code: ui/hud/HudMover.tsx (wrapper + edit bar), GameHUD.tsx / hud/VirtualControls.tsx (items wrapped), GameSettings.ts (hudLayout, hudEdit), MoreMenuModal.tsx (rows), index.css (.hud-edit).
- The joystick is floating (appears under the thumb), so it is not movable. Not run on a device: no npm registry here, only a syntax check.


## Car doors, getting in and out (added)

- Press the car button (door icon, key F) near the player's car: the nearest door is picked (left = driver's seat, right = passenger's, mirrored),
  the character walks round the car to the spot beside it, turns to face it, and `Entering_Car` plays; the butterfly door swings open at the
  handle and shuts behind. `Driving` loops while seated; the button becomes the ajar icon (exit) which plays `Exiting_Car`.
- `scripts/locomotion/bake_car_clips.py` bakes the three FBX (sources in `scripts/character-src/car`) into `clips.json` with the root motion split out
  as curves in `meta.car` (seat frame). `bake_locomotion.py` keeps them when re-run.
- `vehicles/carGeometry.ts` (seat frame, door spots, routing, SEAT_* / WHEEL_POS tuning), `vehicles/carClips.ts`, `vehicles/CarRider.ts` (state machine),
  door rig in `vehicles/bmw/BmwI8.ts` (the viewer's split + hinge). `npm run verify:car` checks all the pure maths and the baked data.
- NOT run in a browser yet: seat fit (head ~7 cm over the roofline, one foot slightly under the floor), door clearance and mirrored right-hand
  entry still need an eye. The car does not drive.

### Driving + leaned-back seat (added)

- Sitting in the car you drive it: left of the screen = steer left / right, right = gas / brake / drift (brake from a standstill reverses),
  keyboard W/S (or arrows) gas / brake, A/D steer, Space = drift, F = exit. You can only get out below ~9 km/h.
  `vehicles/CarDriving.ts` is the arcade physics (pure: `npm run verify:driving`), `vehicles/DriveControls.ts` the HUD button flags,
  `CarRider.ts` runs it (collides with buildings through `PlayerController.collideCircle`, stops at water, camera follows behind the car).
  Tune the feel in `DRIVE` at the top of CarDriving.ts.
- The seated character leans back 30 deg (baked into the clips by `bake_car_clips.py`: RECLINE_DEG / HEAD_FOLLOW); the head tops out at 1.32 m, the
  roof above it is 1.33 m (measured on the GLB). Seat, backrest and steering wheel (carGeometry.ts SEAT_* / WHEEL_POS) follow it; verify-car checks they agree.
- (Wheels, sound and speedometer were added next, see below.)

### Wheels, engine sound, speedometer (added)

- Wheels (`vehicles/bmw/BmwI8.ts` splitWheels): the GLB has the rear pair in ONE mesh set (wheel.001, mirrored inside it) and the front pair baked turned
  17 deg (a showroom pose). Every wheel mesh is cut into four corners by triangle, the front corners are un-steered about their wheel node's origin
  (measured: tyre 0.278 wide, centres at x +-0.8453, z 1.5569, symmetric), and each corner becomes steer pivot -> spin group (tyre, rim, disc) + caliper
  (steers, does not spin). `PlayerCar.setSteering` now also steers the front wheels, `PlayerCar.rollWheels(speed, dt, handbrake)` spins all four at
  speed / radius (the handbrake locks the rears). Called from CarRider.updateSeated.
- Engine sound (`vehicles/EngineSound.ts`): synthesised with Web Audio, no files. Revs from speed through a 6-speed automatic (shift cut), free revving
  at a standstill, wind / road noise by speed, tyre squeal when sliding or on the handbrake. Audio is unlocked in `CarRider.beginEnter` (inside the car
  button press), starts when seated, fades out on exit. Tune GEAR_TOP / UP_RPM / MASTER at the top of the file.
- Speedometer (`ui/hud/Speedometer.tsx`, mounted in GameHUD, movable via Rearrange HUD as "Speedometer"): drawn to the reference image: 0-200 km/h dial,
  red needle, red zone 160-200, big digits, P R N D strip, fuel gauge behind on the left, speed chip top right, trip chip bottom left. Data comes from
  `vehicles/DriveTelemetry.ts` (written by CarRider every frame, read by the gauge's own animation frame, no React re-render). The fuel gauge is real but
  there is no refuelling: it drains slowly (250 km per tank) and nothing happens at empty. The car tops out at 40 m/s (144 km/h), so the red zone is
  never reached unless DRIVE.maxSpeed is raised.
- NOT run in a browser (no npm / WebGL here): check on a phone that the wheels sit flush in the arches, the front wheels turn the right way, and the
  engine pitch / volume feel right. `npm run verify:car` and `verify:driving` still pass.

### Driving HUD icons + handbrake position (added)
- Gas / brake pedals = the two halves of the supplied pedals image (left = brake, right = gas; swap the two constants in `ui/hud/hudImages.ts` if you want them the other way round),
  steering chevrons = the supplied left one and its mirror, handbrake = the supplied lever image (hudImages.ts: GAS_PEDAL_ICON, BRAKE_PEDAL_ICON, STEER_LEFT_ICON, STEER_RIGHT_ICON, HANDBRAKE_ICON; all drawn through IconMask like the other HUD art).
- The handbrake (drift) now sits just left of the exit-car button and a little higher (inside the `car` HudMover, so they move together in Rearrange HUD).
- While seated the walking controls (stick, sprint, punch, aim, interact) are replaced by the driving ones and come back when the character leaves the car (unchanged logic: `driving` in GameHUD).

### Camera + driving smoothness + wheel rolling (fix pass)
- On-foot camera starts closer: `FOOT_DISTANCE` 4.2 m (was 6.8), `FOOT_PITCH` 0.2 (was 0.28), top of `player/PlayerController.ts`. The FOV angle itself is unchanged
  (68 portrait / 55 landscape + the Graphics slider).
- Car camera (PlayerController `setVehicleCamera` / `setVehicleAnchor`, fed by CarRider): one blend value (`vehicleEase`) glides pivot, distance (+2.4 m), pitch
  and the swing round behind the car from the moment the enter clip starts (2.4 s in) and back when the exit starts (1.8 s out). `chaseHeading` is gone.
  In the car the camera follows the car RIGIDLY (no positional lag): the old 16/s lerp lagged a fast car by v/16 metres and the lag changed with every
  throttle change, which looked like the car sliding backwards in the frame. Only yaw, height, ground clearance and the building-pull-in distance are smoothed.
- `PlayerCar.setPose(x, z, yaw, dt)` eases ride height / pitch / roll (~70 ms) so kerbs do not snap the body; `GameEngine.smoothDelta` averages steady frame times.
- Wheels (`BmwI8.ts`): the tyre had a flat black material, so spinning it was invisible. It now has a tread + sidewall texture mapped round the axle (`tyreUVs`,
  `makeTyreTexture`). `rollBmwWheels` caps the SHOWN spin (24 rad/s, 0.42 rad/frame) so it never looks frozen or backwards (wagon-wheel effect), also in reverse.
- NOT run in a browser (no WebGL / npm here). verify:driving and verify:car pass. Check on a phone: start distance feels right, entering / leaving the car glides,
  no backwards slide while driving, tyres visibly roll both ways. Tune: FOOT_DISTANCE, DRIVE_EXTRA_DISTANCE, VEHICLE_BLEND_IN / _OUT (PlayerController),
  MAX_VISUAL_SPIN / MAX_VISUAL_STEP (BmwI8).
- Speedometer dial made about 13% bigger (Speedometer.tsx `size`): portrait min(65vw, 260px), landscape clamp(168px, 52vh, 260px) (was 58vw / 230px and 46vh / 230px).
- Look-up limit raised: `minPitch` -0.32 -> -0.9 rad (PlayerController). The camera cannot go under the ground, so past that the view tilts up from the low camera (look point raised in updateCamera) instead of stopping.
- Car flight (`PlayerCar.setCarPose`, driven by CarRider): the car no longer glues to the lowest ground each frame. On the ground it rides slopes at slope x speed; when the ground falls away faster
  than gravity pulls (ramp lip, hill crest, bridge end) it leaves the ground and flies a ballistic arc (AIR_GRAVITY 15), nose following the arc, then lands with a quick tilt recovery. While more than 0.25 m up there
  is no gas / brake / steering (CarRider) and water does not stop it. Checked only with a numeric simulation (2 m ramp: ~1.6-2.9 m high, 0.6-1 s air at 36-108 km/h; speed bumps and kerbs do not launch). Tune AIR_GRAVITY / MAX_LAUNCH.
  NOT run in a browser; there are no dedicated ramps in the map, so test on a bridge end or a hill crest.
- Car collision (`vehicles/CarCollision.ts`, `PlayerController.collideCarBox`, CarRider.collideCar): the three circles are gone. The car's real rectangle (2.08 x 4.68 m, 1.35 m tall) is tested against the
  world boxes with a separating-axis test, so corners and the stretches between the old circles no longer sink 20-30 cm into walls. Physics now takes steps of at most 0.3 m (up to 16 per frame) so top speed cannot skip a thin wall.
  `npm run verify:carcollision` checks it. The world's collision boxes are axis-aligned: a rotated building is whatever box the world data gives it (an enclosing box can still feel like an invisible corner; that is in the data, not the car).
- Terrain: `PlayerCar.setCarPose` samples the ground under the nose, belly and tail as well as the four wheels and lifts the car (max 0.4 m) until they clear, so a crest or the foot of a slope no longer swallows the bumper or belly.
