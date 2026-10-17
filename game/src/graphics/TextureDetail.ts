import * as THREE from 'three';

/**
 * Helpers for the "Textures" quality setting (see TextureLevel in GraphicsSettings.ts).
 *  - scaledTexture(): a smaller copy of a texture (half / quarter size) so low settings really use less GPU memory and bandwidth
 *  - averageColor(): the mean colour of a texture, used as the flat "smooth" colour of a surface when its image is switched off
 *  - releaseUnused(): frees the GPU copy of textures no material uses any more (three uploads them again if they are needed later)
 */

type Source = (CanvasImageSource & { width: number; height: number }) | null | undefined;

const copies = new WeakMap<THREE.Texture, Map<number, THREE.Texture>>();
const averages = new WeakMap<THREE.Texture, THREE.Color>();

const sourceOf = (t: THREE.Texture): Source => {
  const img = t.image as Source;
  return img && img.width > 0 && img.height > 0 ? img : null;
};

/** `src` at `scale` of its size (1 = `src` itself). If the image has not been decoded yet the original is returned. */
export function scaledTexture(src: THREE.Texture, scale: number): THREE.Texture {
  if (scale >= 0.999) return src;
  const img = sourceOf(src);
  if (!img) return src;
  let byScale = copies.get(src);
  if (!byScale) copies.set(src, (byScale = new Map()));
  const have = byScale.get(scale);
  if (have) return have;
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(img.width * scale));
  c.height = Math.max(16, Math.round(img.height * scale));
  const g = c.getContext('2d');
  if (!g) return src;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.colorSpace = src.colorSpace;
  t.flipY = src.flipY;
  t.anisotropy = 4; // clamped by the texture-quality cap in GraphicsSettings
  byScale.set(scale, t);
  return t;
}

/** mean colour of a texture, in the texture's own colour space (sRGB images give an sRGB colour) */
export function averageColor(src: THREE.Texture, fallback: THREE.ColorRepresentation = 0x808080): THREE.Color {
  const have = averages.get(src);
  if (have) return have.clone();
  const img = sourceOf(src);
  if (!img) return new THREE.Color(fallback);
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return new THREE.Color(fallback);
  g.drawImage(img, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  let r = 0;
  let gr = 0;
  let b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    gr += d[i + 1];
    b += d[i + 2];
  }
  const col = new THREE.Color().setRGB(r / n / 255, gr / n / 255, b / n / 255, THREE.SRGBColorSpace);
  averages.set(src, col);
  return col.clone();
}

/** dispose every texture in `all` that is not in `inUse` (frees GPU memory; three re-uploads a texture if it is used again) */
export function releaseUnused(all: Iterable<THREE.Texture | null | undefined>, inUse: Set<THREE.Texture>): void {
  for (const t of all) if (t && !inUse.has(t)) t.dispose();
}

/** every texture variant created so far for `src` (the original is not included) */
export function copiesOf(src: THREE.Texture): THREE.Texture[] {
  const m = copies.get(src);
  return m ? [...m.values()] : [];
}
