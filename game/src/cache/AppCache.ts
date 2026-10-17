/**
 * Game-file cache (production builds).
 *
 * `vite build` writes precache.json (see vite.config.ts): every game file with its byte size. On launch this downloads
 * the files that are not on the device yet, streaming them so the loading bar follows REAL bytes, and stores them in
 * the browser's Cache Storage. public/sw.js then serves /assets/* from that storage, so the next launch downloads
 * nothing (and the game also starts offline). When a new build is deployed, only the changed files are downloaded and
 * the old ones are deleted.
 */

export const STATIC_CACHE = 'bl-static-v1';

interface Manifest {
  files: { url: string; size: number }[];
}

const base = (): string => import.meta.env.BASE_URL;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(`${base()}sw.js`).catch(() => undefined);
}

async function readManifest(cache: Cache): Promise<Manifest | null> {
  const url = new URL(`${base()}precache.json`, location.href).href;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (r.ok) {
      await cache.put(url, r.clone());
      return (await r.json()) as Manifest;
    }
  } catch {
    /* offline: fall back to the copy saved last time */
  }
  const saved = await cache.match(url);
  return saved ? ((await saved.json()) as Manifest) : null;
}

/** Downloads missing game files. Does nothing in dev builds, or when the browser has no Cache Storage. */
export async function precacheGameFiles(onProgress: (doneBytes: number, totalBytes: number, downloading: boolean) => void): Promise<void> {
  if (!import.meta.env.PROD || typeof caches === 'undefined') return;
  const cache = await caches.open(STATIC_CACHE);
  const manifest = await readManifest(cache);
  if (!manifest || !manifest.files.length) return;

  const total = manifest.files.reduce((a, f) => a + f.size, 0);
  let done = 0;
  onProgress(0, total, false);

  for (const f of manifest.files) {
    const url = new URL(base() + f.url, location.href).href;
    if (await cache.match(url)) {
      done += f.size;
      onProgress(done, total, false);
      continue;
    }
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${f.url} (${res.status})`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      got += value.length;
      onProgress(done + Math.min(got, f.size), total, true);
    }
    await cache.put(url, new Response(new Blob(chunks as BlobPart[]), { headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } }));
    done += f.size;
    onProgress(done, total, true);
  }

  // a new build was deployed: drop files that belong to older builds
  const keep = new Set(manifest.files.map((f) => new URL(base() + f.url, location.href).href));
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.includes('/assets/') && !keep.has(req.url)) await cache.delete(req);
  }
}
