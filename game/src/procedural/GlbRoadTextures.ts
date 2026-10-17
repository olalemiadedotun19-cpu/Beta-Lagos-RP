import * as THREE from 'three';
import asphaltColorUrl from './assets/road/asphalt_color.webp?url';
import asphaltNormalUrl from './assets/road/asphalt_normal.webp?url';
import sidewalkColorUrl from './assets/road/sidewalk_color.webp?url';
import sidewalkNormalUrl from './assets/road/sidewalk_normal.webp?url';

/**
 * Road + sidewalk surface textures taken from the "free city road layout" model (ASPHALT_BARE and GENERIC_SIDEWALKS: colour + normal
 * maps, tileable). RoadBuilder.materials() uses them for every asphalt and pavement mesh, so one change restyles the whole road network
 * (RoadBuilder and CurvedRoadBuilder share those materials). Lane paint, crossings and wear decals stay procedural on top.
 */

export interface SurfaceMaps {
  map: THREE.Texture;
  normal: THREE.Texture;
}

let cache: { asphalt: SurfaceMaps; sidewalk: SurfaceMaps; ready: Promise<void> } | null = null;

function load(url: string, srgb: boolean, loaded: Promise<unknown>[]): THREE.Texture {
  const tex = new THREE.Texture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8; // clamped to the chosen texture quality by GraphicsSettings
  loaded.push(
    new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        tex.image = img;
        tex.needsUpdate = true;
        resolve();
      };
      img.onerror = () => resolve(); // never block the loading screen on a missing file
      img.src = url;
    }),
  );
  return tex;
}

function build() {
  const loaded: Promise<unknown>[] = [];
  return {
    asphalt: { map: load(asphaltColorUrl, true, loaded), normal: load(asphaltNormalUrl, false, loaded) },
    sidewalk: { map: load(sidewalkColorUrl, true, loaded), normal: load(sidewalkNormalUrl, false, loaded) },
    ready: Promise.all(loaded).then(() => undefined),
  };
}

export function getGlbRoadTextures(): { asphalt: SurfaceMaps; sidewalk: SurfaceMaps } {
  return (cache ??= build());
}

/** resolves once the four images are decoded (the loading screen waits for it) */
export function glbRoadTexturesReady(): Promise<void> {
  return (cache ??= build()).ready;
}

/** the model's material values: ASPHALT_BARE has a 0.52 grey base-colour factor; mean roughness of the two roughness maps */
export const GLB_ASPHALT_TINT = 0.52;
export const GLB_ASPHALT_ROUGHNESS = 0.79;
export const GLB_SIDEWALK_ROUGHNESS = 0.73;
