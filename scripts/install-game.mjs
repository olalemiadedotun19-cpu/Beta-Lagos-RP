// Installs the game's own dependencies (game/package.json) so `npm run update` can build it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.SKIP_GAME_INSTALL) process.exit(0);
const gameDir = resolve(import.meta.dirname, '..', 'game');
if (!existsSync(resolve(gameDir, 'package.json'))) process.exit(0);
const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps'], { cwd: gameDir, stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
