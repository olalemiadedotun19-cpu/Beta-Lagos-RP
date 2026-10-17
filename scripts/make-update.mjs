#!/usr/bin/env node
/**
 * Builds the game and prepares the folder that gets hosted online (update-out/).
 *
 *   npm run update:build           build the game + write update-out/ (manifest.json = file list with sizes + hashes)
 *   npm run update                 same, then upload update-out/ to Cloudflare Pages
 *
 * Options:  --skip-build   use the existing game/dist
 *           --game <dir>   game folder (default: update.config.json "gameDir")
 *           --notes "text" short message shown in the app's update prompt
 *           --required     the player cannot skip this update
 *           --project <n>  Cloudflare Pages project name (default: update.config.json "cfProject")
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const die = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};
const run = (cmd, a, cwd, quiet = false) => spawnSync(cmd, a, { cwd, stdio: quiet ? 'ignore' : 'inherit', shell: true });
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

const cfg = JSON.parse(readFileSync(join(root, 'update.config.json'), 'utf8'));
const gameDir = resolve(root, opt('game', cfg.gameDir || 'game'));
const dist = join(gameDir, 'dist');
const out = join(root, 'update-out');

// the app never needs these: the service worker + precache list are only for the browser version
const SKIP_ROOT = new Set(['sw.js', 'precache.json']);

if (!flag('skip-build')) {
  if (!existsSync(join(gameDir, 'node_modules'))) die(`Game dependencies are missing. Run:  npm --prefix ${relative(root, gameDir) || '.'} install`);
  console.log(`▶ Building the game in ${gameDir}`);
  if (run('npm', ['run', 'build'], gameDir).status !== 0) die('Game build failed (see the error above).');
}
if (!existsSync(join(dist, 'index.html'))) die(`${dist}/index.html not found. Build the game first.`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

const files = walk(dist)
  .map((abs) => ({ abs, path: relative(dist, abs).split(sep).join('/') }))
  .filter((f) => !f.path.endsWith('.map') && !f.path.endsWith('.DS_Store') && !SKIP_ROOT.has(f.path))
  .sort((a, b) => a.path.localeCompare(b.path))
  .map((f) => ({
    ...f,
    size: statSync(f.abs).size,
    hash: createHash('sha256').update(readFileSync(f.abs)).digest('hex'),
  }));

const combined = createHash('sha256').update(files.map((f) => `${f.path}:${f.hash}`).join('\n')).digest('hex');
const d = new Date();
const version = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}-${combined.slice(0, 6)}`;

rmSync(out, { recursive: true, force: true });
for (const f of files) {
  const to = join(out, f.path);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(f.abs, to);
}
const manifest = {
  version,
  builtAt: d.toISOString(),
  ...(opt('notes') ? { notes: opt('notes') } : {}),
  ...(flag('required') ? { required: true } : {}),
  files: files.map(({ path, size, hash }) => ({ path, size, hash })),
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
// Cloudflare Pages reads this file: CORS for the browser version + caching rules
writeFileSync(
  join(out, '_headers'),
  ['/*', '  Access-Control-Allow-Origin: *', '/manifest.json', '  Cache-Control: no-store', '/assets/*', '  Cache-Control: public, max-age=31536000, immutable', ''].join('\n'),
);

const total = files.reduce((a, f) => a + f.size, 0);
console.log(`\n✓ ${files.length} files, ${mb(total)}  →  update-out/   (version ${version})`);
const big = files.filter((f) => f.size > 25 * 1024 * 1024);
if (big.length) console.warn(`⚠ Cloudflare Pages rejects files over 25 MiB:\n${big.map((f) => `   ${f.path}  ${mb(f.size)}`).join('\n')}\n  Host those with Cloudflare R2 instead, or shrink them.`);

if (flag('deploy')) {
  const project = opt('project', cfg.cfProject);
  if (!project || /YOUR/i.test(project)) die('Set "cfProject" in update.config.json (your Cloudflare Pages project name).');
  console.log(`\n▶ Uploading to Cloudflare Pages project "${project}" (first time: it asks you to log in)`);
  run('npx', ['wrangler', 'pages', 'project', 'create', project, '--production-branch', 'main'], root, true); // fails harmlessly when it already exists
  if (run('npx', ['wrangler', 'pages', 'deploy', 'update-out', '--project-name', project, '--branch', 'main', '--commit-dirty=true'], root).status !== 0) die('Upload failed. Run "npx wrangler login" and try again.');
  console.log(`\n✓ Live at https://${project}.pages.dev  (make sure update.config.json "updateUrl" is exactly that)`);
  console.log('  Phones will see the update prompt the next time they open the app.');
} else {
  console.log('Not uploaded. Run "npm run update" to upload, or host update-out/ yourself.');
}
