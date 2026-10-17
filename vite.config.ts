import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const cfg = JSON.parse(readFileSync(new URL('./update.config.json', import.meta.url), 'utf8'));

// Builds ONLY the small launcher (launcher/ -> www/). The game itself is built by scripts/make-update.mjs and downloaded by the app.
export default defineConfig({
  root: 'launcher',
  base: './',
  define: { __UPDATE_URL__: JSON.stringify(String(process.env.UPDATE_URL || cfg.updateUrl).replace(/\/+$/, '')) },
  build: { outDir: '../www', emptyOutDir: true, target: 'es2020' },
});
