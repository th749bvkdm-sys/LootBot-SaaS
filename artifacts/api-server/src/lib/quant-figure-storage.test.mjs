import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { readPrivateQuantFigure, validateFigureMetadata, quantProjectRoot } from './quant-figure-storage.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function cleanFixture(base) { const actual = path.resolve(base), parent = path.resolve(os.tmpdir()); if (path.dirname(actual) !== parent || !/^lootbot-figure/.test(path.basename(actual))) throw Error('Fixture cleanup path is outside its temporary directory.'); await rm(actual, { recursive: true, force: true }); }
function crc32(bytes) { let value = 0xffffffff; for (const b of bytes) { value ^= b; for (let i = 0; i < 8; i++) value = value >>> 1 ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(name, bytes) { const type = Buffer.from(name), buffer = Buffer.alloc(bytes.length + 12); buffer.writeUInt32BE(bytes.length); type.copy(buffer, 4); bytes.copy(buffer, 8); buffer.writeUInt32BE(crc32(Buffer.concat([type, bytes])), bytes.length + 8); return buffer; }
function png() { const header = Buffer.alloc(13); header.writeUInt32BE(16); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 6; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((16 * 4 + 1) * 16))), chunk('IEND', Buffer.alloc(0))]); }
test('private figure metadata accepts only reviewed keyed-page-free crop kinds and scoped paths', () => {
  const data = { kind: 'stem_diagram', sourcePage: 2, fileName: 'Q-0002.png', relativePath: 'fixture/figures/Q-0002.png', fileHash: 'a'.repeat(64), review: { status: 'reviewed', note: 'Crop independently checked: no answer label, footer or highlighted answer.' } };
  assert.equal(validateFigureMetadata(data, 2).fileHash, 'a'.repeat(64));
  assert.doesNotThrow(() => validateFigureMetadata({ ...data, kind: 'question_without_key' }, 2));
  assert.doesNotThrow(() => validateFigureMetadata({ ...data, review: { status: 'needs_review', note: data.review.note } }, 2));
  for (const item of [{ ...data, kind: 'full_page' }, { ...data, relativePath: '../private/page.png' }, { ...data, relativePath: 'https://example.invalid/key.png' }, { ...data, sourcePage: 3 }, { ...data, review: { status: 'unknown', note: data.review.note } }]) assert.throws(() => validateFigureMetadata(item, 2));
});
test('private PNG validation verifies hash, signature, dimensions and rejects public storage', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'lootbot-figures-')), store = path.join(base, '.local/quant-imports'), bytes = png();
  try {
    await mkdir(path.join(store, 'fixture/figures'), { recursive: true });
    await writeFile(path.join(store, 'fixture/figures/Q-0002.png'), bytes);
    const figure = await readPrivateQuantFigure(store, 'fixture/figures/Q-0002.png', hash(bytes), base);
    assert.equal(figure.width, 16); assert.equal(figure.height, 16); assert.deepEqual(figure.bytes, bytes);
    await assert.rejects(() => readPrivateQuantFigure(store, 'fixture/figures/Q-0002.png', 'a'.repeat(64), base));
    const invalid = Buffer.from(bytes); invalid[0] = 0; await writeFile(path.join(store, 'fixture/figures/invalid.png'), invalid);
    await assert.rejects(() => readPrivateQuantFigure(store, 'fixture/figures/invalid.png', hash(invalid), base));
    const incomplete = bytes.subarray(0, 33); await writeFile(path.join(store, 'fixture/figures/incomplete.png'), incomplete);
    await assert.rejects(() => readPrivateQuantFigure(store, 'fixture/figures/incomplete.png', hash(incomplete), base));
    const corrupt = Buffer.from(bytes); corrupt[40] ^= 1; await writeFile(path.join(store, 'fixture/figures/corrupt.png'), corrupt);
    await assert.rejects(() => readPrivateQuantFigure(store, 'fixture/figures/corrupt.png', hash(corrupt), base));
    const publicRoot = path.join(base, 'artifacts/lootbot/public'); await mkdir(publicRoot, { recursive: true }); await writeFile(path.join(publicRoot, 'public.png'), bytes);
    await assert.rejects(() => readPrivateQuantFigure(publicRoot, 'public.png', hash(bytes), base));
    await assert.rejects(() => readPrivateQuantFigure(store, '../public.png', hash(bytes), base));
  } finally { await cleanFixture(base); }
});
test('symlink path escaping private storage is rejected when OS permits symlink fixtures', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'lootbot-figure-link-')), store = path.join(base, 'store'), bytes = png();
  try {
    await mkdir(store); const outside = path.join(base, 'outside.png'); await writeFile(outside, bytes);
    try { await symlink(outside, path.join(store, 'outside.png')); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Windows user cannot create symlink fixture. Realpath boundary remains enforced.'); return; } throw error; }
    await assert.rejects(() => readPrivateQuantFigure(store, 'outside.png', hash(bytes), base));
  } finally { await cleanFixture(base); }
});
test('figure default project root works from repository root or API workspace', () => {
  const repository = path.resolve('..', '..'); assert.equal(quantProjectRoot(path.join(repository, 'artifacts/api-server')), repository); assert.equal(quantProjectRoot(repository), repository);
});

test('database figure bytes retain integrity checks and never fall back on corrupt stored data', async () => {
  const { readStoredQuantFigure, validatePrivateQuantFigureBytes } = await import('./quant-figure-storage.mjs');
  const bytes = png(), fileHash = hash(bytes);
  const asset = { file_hash: fileHash, relative_path: 'fixture/figures/Q-0002.png', width: 16, height: 16 };
  const query = { async query(sql, values) {
    assert.match(sql, /FROM quant_figure_blobs WHERE file_hash=\$1/);
    assert.deepEqual(values, [fileHash]);
    return { rows: [{ png_data: bytes, width: 16, height: 16 }] };
  } };
  assert.deepEqual((await readStoredQuantFigure(query, asset)).bytes, bytes);
  assert.throws(() => validatePrivateQuantFigureBytes(bytes, 'a'.repeat(64)), /PRIVATE_FIGURE_UNAVAILABLE/);
  await assert.rejects(() => readStoredQuantFigure(query, { ...asset, width: 32 }), /PRIVATE_FIGURE_UNAVAILABLE/);
  const corrupt = Buffer.from(bytes); corrupt[40] ^= 1;
  await assert.rejects(() => readStoredQuantFigure({ async query() { return { rows: [{ png_data: corrupt, width: 16, height: 16 }] }; } }, asset), /PRIVATE_FIGURE_UNAVAILABLE/);
});
