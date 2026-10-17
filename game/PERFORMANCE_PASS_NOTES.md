# Performance pass (fog removed, Textures setting now does real work)

## Fog is gone
- WorldRenderer: scene.fog = null. Draw distance is now just the camera far plane (GraphicsSettings.DRAW_METRES:
  tiny 140 / short 180 / medium 250 / long 320 / ultra 380 m, same reach the fog-based far plane had). Past it nothing is drawn.
- Shadow pass cut-off and the barracks island lighting no longer use fog; near the island the draw distance is lifted instead.
- The sign-in showroom scene keeps its own small backdrop fog (it is not the game world).

## Textures setting (Low / Med / High / Ultra) now changes cost, live, no restart
(see TextureLevel in graphics/GraphicsSettings.ts; helpers in graphics/TextureDetail.ts)
- Low:    roads, pavements, gravel, bridge concrete and ground = smooth plain colour (average of their old image). No relief maps, no
          paint chips, no wear decals, no grass/rock/soil noise shader. Facades = quarter-size colour image only (no relief, no lit windows).
          EVERY cell is built with the simple (far) building / road geometry (no balconies, AC units, tanks, awnings, stalls...).
- Medium: half-size colour images, no relief maps, lit night windows, full building detail only within ~75 m.
- High:   full images + relief maps, full detail within 150 m (the old behaviour).
- Ultra:  as High with 16x filtering.
- Unused images are freed from GPU memory when the level drops; relief maps are only generated when High/Ultra is first used.
- Changing the setting rebuilds the affected cells in the background (WorldStreamer), shaders recompile once.

## Verified / not verified
- `tsc --noEmit`: clean for all changed files (one existing error in cache/BakeCache.ts, untouched). `vite build`: OK.
- NOT run on a phone / in WebGL here: check on a real device that Low looks right (flat colours) and that fps improves.

# Pass 3: barracks = city light, Medium stays smooth at 100% resolution (NOT run in a browser: no npm / WebGL where it was written)
- Barracks light: WorldRenderer no longer lifts ambient / hemisphere / sun / exposure near the island (applyBarracksReach keeps only the longer view distance). Same rig as the city, day and night.
- Presets (Low / Medium / High / Max) no longer touch the RESOLUTION: set 100% once, then change presets freely. The preset label ignores resolution. Auto-detect still sets everything.
- Adaptive resolution floor 65% -> 80% of the chosen resolution (sharpness first).
- Street-lamp PointLights are taken out of the scene's light list by day (a light at intensity 0 still costs every lit pixel). Switching at dusk / dawn compiles the shader variant first (renderer.compileAsync), then flips.
- MSAA is skipped automatically when the pixel ratio is already 1.5x or more (restart needed, as before).
- Water: Low = 3 waves + plain foam, Medium = 4 waves, High / Ultra = unchanged (uniform uQ, follows the Textures setting live).
- BMW paint: clear-coat layer only for Textures High / Ultra (live).
- WorldStreamer: cell scan runs only after ~6 m of movement / a setting change / while jobs are pending; build budget drops to 2 ms while a frame is already > 21 ms.
- StreetFurniture.update: nearest-lamp sort only after 3 m of movement (was every lamp, every frame, at night).
- FPS counter now also shows draw calls, triangles and the pixel ratio actually used (Settings > Graphics > Show FPS).
