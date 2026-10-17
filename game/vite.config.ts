import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/** Writes precache.json (every built game file + its byte size) so the launch loading bar can download and report real bytes. */
function precacheManifest(): Plugin {
  return {
    name: 'precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.values(bundle)
        .filter((f) => !f.fileName.endsWith('.map'))
        .map((f) => ({
          url: f.fileName,
          size: f.type === 'chunk' ? Buffer.byteLength(f.code) : typeof f.source === 'string' ? Buffer.byteLength(f.source) : f.source.byteLength,
        }));
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ files }) });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), precacheManifest()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
