/** Private, reviewed figure crops only. The caller must authorize before file access. */
import { realpath, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const within = (base, candidate) => { const relative = path.relative(base, candidate); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };
const fail = () => { throw Error('PRIVATE_FIGURE_UNAVAILABLE'); };
const crcTable = Uint32Array.from({ length: 256 }, (_, initial) => { let value = initial; for (let i = 0; i < 8; i++) value = value >>> 1 ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0; });
const crc32 = bytes => { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; };
function validatePngData(bytes, width, height) {
  // Operator crops use a stable 8-bit, non-interlaced PNG format.
  const colorType = bytes[25], channelCount = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (bytes[24] !== 8 || !channelCount || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) fail();
  const compressed = []; let offset = 8, ended = false, chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail();
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length || length > 12 * 1024 * 1024) fail();
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    if (chunkIndex++ === 0 && name !== 'IHDR') fail();
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail();
    if (name === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    if (name === 'IEND') { if (length !== 0 || end !== bytes.length) fail(); ended = true; }
    offset = end;
  }
  if (!ended || !compressed.length) fail();
  let rows; try { rows = inflateSync(Buffer.concat(compressed), { maxOutputLength: 32 * 1024 * 1024 }); } catch { fail(); }
  const rowSize = width * channelCount + 1;
  if (rows.length !== rowSize * height) fail();
  for (let row = 0; row < height; row++) if (rows[row * rowSize] > 4) fail();
}
export function quantProjectRoot(cwd = process.cwd()) {
  return path.basename(cwd) === 'api-server' && path.basename(path.dirname(cwd)) === 'artifacts' ? path.resolve(cwd, '../..') : path.resolve(cwd);
}
export function quantFigureStorageRoot(projectRoot = quantProjectRoot()) {
  return path.resolve(process.env.QUANT_FIGURE_STORAGE_PATH || path.join(projectRoot, '.local/quant-imports'));
}
export function validateFigureMetadata(figure, sourcePage) {
  if (!figure || !['stem_diagram', 'question_without_key'].includes(figure.kind) || typeof figure.relativePath !== 'string' ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.png$/.test(figure.relativePath) ||
      figure.relativePath.split('/').some(part => part === '.' || part === '..' || part.includes('..')) ||
      !/^[0-9a-f]{64}$/i.test(figure.fileHash || '') || typeof figure.fileName !== 'string' || figure.fileName !== path.posix.basename(figure.relativePath) ||
      figure.sourcePage !== sourcePage || !['reviewed', 'needs_review'].includes(figure.review?.status) || typeof figure.review.note !== 'string' || figure.review.note.trim().length < 20 || figure.review.note.length > 4000)
    fail();
  return { relativePath: figure.relativePath, fileHash: figure.fileHash.toLowerCase(), fileName: figure.fileName, sourcePage: figure.sourcePage, reviewNote: figure.review.note };
}
export async function readPrivateQuantFigure(storageRoot, relativePath, expectedHash, projectRoot = quantProjectRoot()) {
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.png$/.test(relativePath || '') || relativePath.split('/').some(part => part.includes('..')) || !/^[0-9a-f]{64}$/i.test(expectedHash || '')) fail();
  const actualRoot = await realpath(path.resolve(storageRoot));
  const publicFolders = ['artifacts/lootbot/public', 'artifacts/lootbot/dist', 'artifacts/api-server/dist'].map(folder => path.resolve(projectRoot, folder));
  if (publicFolders.some(folder => actualRoot === folder || within(folder, actualRoot))) fail();
  const actualFile = await realpath(path.join(actualRoot, ...relativePath.split('/')));
  if (!within(actualRoot, actualFile) || publicFolders.some(folder => actualFile === folder || within(folder, actualFile))) fail();
  const metadata = await stat(actualFile);
  if (!metadata.isFile() || metadata.size < 33 || metadata.size > 12 * 1024 * 1024) fail();
  const bytes = await readFile(actualFile);
  if (!bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13 || createHash('sha256').update(bytes).digest('hex') !== expectedHash.toLowerCase()) fail();
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 16 || height < 16 || width > 4000 || height > 4000 || width * height > 8_000_000) fail();
  validatePngData(bytes, width, height);
  return { bytes, width, height, size: bytes.length };
}
