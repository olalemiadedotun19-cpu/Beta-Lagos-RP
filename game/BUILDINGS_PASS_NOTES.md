# Buildings detail pass

Every city building (frontage rows + second-row houses) is built by one kit (src/travel/BuildingKit.ts), so upgrading the kit
replaces all of them at once. Footprints / layout rng are untouched: same 2472 buildings, same positions and sizes (verified
by footprint signature against the original).

## Changed / added
- src/travel/TravelMaterials.ts  facade textures rewritten: recessed frames, sills, jalousies, burglar bars, shutters, curtains,
  storefronts + baked normal maps (relief) + emissive night windows. New 'roof' (ribbed sheet) and 'grille' (railing/gate/louvre/mesh) kinds.
- src/travel/BuildingDetail.ts   NEW: hip roofs (eaves/fascia/gutters), parapets, sills/hoods, AC units, balconies with railings,
  rooftop tanks/solar/dish/antenna, compound wall + piers + barred gate, striped awnings, containers.
- src/travel/BuildingKit.ts      all 15 variants (resA-D, comA-C, offA-C, shopA-E) re-detailed; cosmetic choices use a separate
  detail rng (kit.seed) so near/far LOD match and layout never moves. Office brise-soleil slab replaced by vertical fins.
- src/travel/Geo.ts              GeoBatch.poly() + tileOff (per-building window variety).
- src/world/CellBuilder.ts       adds roof/grille batches, sets kit.seed.

## Parasols / stalls / awnings (second request)
- New 'fabric' facade kind (woven canvas texture + normal map, tinted by vertex colour, double sided) in TravelMaterials.ts; CellBuilder has the extra batch.
- BuildingDetail.ts: parasol() (8 domed panels, scalloped valance, finial, pole, tyre foot), vendorStall() (trestle table, cloth, fruit / provisions / cloth goods,
  crate, stool, jerry can), cafeSet() (parasol + round table + stools), fpoly() (fabric polygon helper); stripedAwning() now uses fabric.
- BuildingKit.ts shopA uses vendorStall (same rng draws as before); DistrictBuilder.ts cafes use cafeSet.

## Cost (per 150 m cell, rendered in test harness)
- Near triangles roughly 1.6-1.8x the original; far LOD +10-30%. Cell build time about the same.
- If a low-end Android needs it, lower the near radius or drop acUnit/waterTank/stripedAwning calls in BuildingKit.ts.

## Notes
- Strict tsc typecheck clean for changed files.
- Compound walls sit 0.4 m in front of villa facades (existing layout), so villa ground floors are hidden - left as is
  because moving them would change footprints/collisions.
- District buildings (Glass Quarter, villas, Mews) only get the new textures, not new geometry.

## Trees
- TerrainTrees.ts TREE_KEEP_FRACTION 0.08 -> 0.004 (95% of the remaining trees removed; covers street, park, yard, curved-road and manor trees). Change that one constant to bring trees back.
- BarracksScene.ts keeps 1 tree in 20.
