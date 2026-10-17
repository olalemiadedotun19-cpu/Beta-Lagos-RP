import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildLaunchPage } from '../scripts/launch-page.mjs';

const src = readFileSync(new URL('../game/public/launch/launch.html', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../launcher/launch-bridge.js', import.meta.url), 'utf8');
const tag = '<script type="module" crossorigin src="./assets/index-test.js"></script>';
const page = buildLaunchPage(src, bridge, tag);

test('launcher page keeps the whole game launch sequence and adds the update check', () => {
  for (const part of ['id="dotcon"', 'id="splash"', 'id="welcome"', 'id="load"', 'Welcome to Lagos', 'TAP ANYWHERE TO START']) assert.ok(page.includes(part), part);
  assert.ok(page.includes('window.__IS_LAUNCHER=true'));
  assert.ok(page.includes('Checking for updates'));
  assert.ok(page.includes(tag));
});

test('the bridge runs after the sequence script, and the module tag is last before </body>', () => {
  assert.ok(page.indexOf('async function runLoader()') < page.indexOf('Checking for updates'));
  assert.ok(page.indexOf(tag) > page.indexOf('Checking for updates'));
  assert.ok(page.lastIndexOf(tag) < page.lastIndexOf('</body>'));
});

test('every inline script still compiles', () => {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 3);
  for (const s of scripts) new vm.Script(s);
});

test('the game copy skips the intro only for the launcher flag, and never in the launcher itself', () => {
  assert.ok(src.includes("localStorage.getItem('bl_skip_intro') === '1'"));
  assert.ok(src.includes('!window.__IS_LAUNCHER'));
});

test('a changed launch page makes the build fail loudly instead of shipping a broken app', () => {
  assert.throws(() => buildLaunchPage(src.replace('async function runLoader()', 'async function other()'), bridge, tag), /no longer matches/);
});
