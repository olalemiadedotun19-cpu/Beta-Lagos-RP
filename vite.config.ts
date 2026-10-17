import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildLaunchPage } from './scripts/launch-page.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'update.config.json'), 'utf8'));

/** After the build, turns www/index.html into the game's own launch sequence + the launcher code (update check happens on its loading screen). */
function launchSequence(): Plugin {
  return {
    name: 'launch-sequence',
    apply: 'build',
    closeBundle() {
      const src = join(resolve(here, cfg.gameDir || 'game'), 'public/launch/launch.html');
      if (!existsSync(src)) throw new Error(`Launch sequence not found: ${src}`);
      const out = join(here, 'www/index.html');
      const built = readFileSync(out, 'utf8');
      const tag = /<script\b[^>]*\btype="module"[^>]*><\/script>/.exec(built)?.[0];
      if (!tag) throw new Error('Vite did not write the launcher script tag into www/index.html');
      const page = buildLaunchPage(readFileSync(src, 'utf8'), readFileSync(join(here, 'launcher/launch-bridge.js'), 'utf8'), tag);
      writeFileSync(out, page);
      console.log(`✓ Launcher page = game launch sequence (${(page.length / 1048576).toFixed(2)} MB)`);
    },
  };
}

// Builds ONLY the small launcher (launcher/ -> www/). The game itself is built by scripts/make-update.mjs and downloaded by the app.
export default defineConfig({
  root: 'launcher',
  base: './',
  plugins: [launchSequence()],
  define: { __UPDATE_URL__: JSON.stringify(String(cfg.updateUrl).replace(/\/+$/, '')) },
  build: { outDir: '../www', emptyOutDir: true, target: 'es2020' },
});
