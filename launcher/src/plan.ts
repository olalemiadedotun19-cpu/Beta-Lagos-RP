// Pure update logic (no Capacitor imports) so it can be unit-tested with `npm test`.

export interface RemoteFile { path: string; size: number; hash: string }
export interface Manifest { version: string; builtAt?: string; required?: boolean; notes?: string; files: RemoteFile[] }
export interface InstalledFile { hash: string; size: number }
export interface Installed { version: string; status: 'ready' | 'updating'; target?: string; files: Record<string, InstalledFile> }
export interface Plan {
  /** files to download (new or changed) */
  todo: RemoteFile[];
  /** installed files that the new version no longer uses (deleted after a successful update) */
  stale: string[];
  bytes: number;
  /** nothing playable is installed yet */
  first: boolean;
  /** the player may not skip this update */
  mustUpdate: boolean;
}

export function isSafePath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((s) => s === '' || s === '.' || s === '..');
}

/** Throws if the manifest from the server is not usable (also blocks path tricks like ../). */
export function validateManifest(m: unknown): Manifest {
  const x = m as Manifest;
  if (!x || typeof x !== 'object' || typeof x.version !== 'string' || !Array.isArray(x.files) || !x.files.length) throw new Error('Bad update manifest');
  for (const f of x.files) {
    if (!isSafePath(f?.path) || typeof f.hash !== 'string' || !f.hash || !Number.isFinite(f.size) || f.size < 0) throw new Error(`Bad file entry in manifest: ${String(f?.path)}`);
  }
  if (!x.files.some((f) => f.path === 'index.html')) throw new Error('Manifest has no index.html');
  return x;
}

export function planUpdate(m: Manifest, inst: Installed | null): Plan {
  const have = inst?.files ?? {};
  const todo = m.files.filter((f) => have[f.path]?.hash !== f.hash);
  const wanted = new Set(m.files.map((f) => f.path));
  const stale = Object.keys(have).filter((p) => !wanted.has(p));
  const first = !inst || !inst.version;
  const mustUpdate = first || inst!.status === 'updating' || !!m.required;
  return { todo, stale, bytes: todo.reduce((a, f) => a + f.size, 0), first, mustUpdate };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}

export const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');
