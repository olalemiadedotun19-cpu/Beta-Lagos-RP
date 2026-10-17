import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePath, formatBytes, planUpdate, validateManifest } from '../launcher/src/plan.ts';

const f = (path, hash, size = 100) => ({ path, hash, size });
const manifest = (files, extra = {}) => ({ version: 'v2', files, ...extra });

test('first install downloads everything and cannot be skipped', () => {
  const p = planUpdate(manifest([f('index.html', 'a'), f('assets/x.js', 'b', 900)]), null);
  assert.equal(p.todo.length, 2);
  assert.equal(p.bytes, 1000);
  assert.ok(p.first && p.mustUpdate);
});

test('only changed / new files are downloaded, old ones are marked stale', () => {
  const inst = { version: 'v1', status: 'ready', files: { 'index.html': { hash: 'a', size: 1 }, 'assets/old.js': { hash: 'o', size: 1 }, 'assets/keep.js': { hash: 'k', size: 1 } } };
  const p = planUpdate(manifest([f('index.html', 'a2', 10), f('assets/keep.js', 'k', 20), f('assets/new.js', 'n', 30)]), inst);
  assert.deepEqual(p.todo.map((x) => x.path), ['index.html', 'assets/new.js']);
  assert.deepEqual(p.stale, ['assets/old.js']);
  assert.equal(p.bytes, 40);
  assert.equal(p.mustUpdate, false);
});

test('nothing to do when everything matches', () => {
  const inst = { version: 'v1', status: 'ready', files: { 'index.html': { hash: 'a', size: 1 } } };
  assert.equal(planUpdate(manifest([f('index.html', 'a')]), inst).todo.length, 0);
});

test('an interrupted update is resumed (finished files are kept) and cannot be skipped', () => {
  const inst = { version: 'v1', status: 'updating', target: 'v2', files: { 'index.html': { hash: 'a2', size: 1 }, 'assets/a.js': { hash: 'old', size: 1 } } };
  const p = planUpdate(manifest([f('index.html', 'a2'), f('assets/a.js', 'new'), f('assets/b.js', 'b')]), inst);
  assert.deepEqual(p.todo.map((x) => x.path), ['assets/a.js', 'assets/b.js']);
  assert.ok(p.mustUpdate);
});

test('required flag from the server blocks skipping', () => {
  const inst = { version: 'v1', status: 'ready', files: { 'index.html': { hash: 'a', size: 1 } } };
  assert.ok(planUpdate(manifest([f('index.html', 'z')], { required: true }), inst).mustUpdate);
});

test('manifest validation rejects path tricks and missing index.html', () => {
  assert.throws(() => validateManifest(manifest([f('index.html', 'a'), f('../evil.js', 'b')])));
  assert.throws(() => validateManifest(manifest([f('index.html', 'a'), f('/abs.js', 'b')])));
  assert.throws(() => validateManifest(manifest([f('a//b.js', 'a'), f('index.html', 'b')])));
  assert.throws(() => validateManifest(manifest([f('assets/x.js', 'a')])));
  assert.throws(() => validateManifest({ version: 'x', files: [] }));
  assert.doesNotThrow(() => validateManifest(manifest([f('index.html', 'a'), f('launch/launch.html', 'b')])));
});

test('helpers', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1048576), '5.0 MB');
  assert.equal(formatBytes(2.5 * 1073741824), '2.5 GB');
  assert.equal(encodePath('assets/my file#1.js'), 'assets/my%20file%231.js');
});
