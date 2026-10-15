/** Local, explicit operator tool. Does not load .env files or reveal connection strings. */
import { readFile, stat, mkdir, copyFile, realpath } from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const argv = process.argv.slice(2);
const value = flag => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
const mode = ['--register', '--attach', '--extract'].find(flag => argv.includes(flag));
const actorId = value('--actor');
const manifestPath = path.resolve(value('--manifest') || path.join(rootPath, 'docs/quant/SOURCE_REGISTER.json'));
const storagePath = path.resolve(process.env.QUANT_SOURCE_STORAGE_PATH || path.join(rootPath, '.local/quant-sources'));
const python = process.env.QUANT_PYTHON_BIN || 'python';
const renderer = process.env.QUANT_PDF_RENDER_BIN || 'pdftoppm';
const hashFile = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
const within = (base, candidate) => { const relative = path.relative(base, candidate); return !relative.startsWith('..') && !path.isAbsolute(relative); };
function licensed(source) {
  if (source.license_status !== 'verified') throw new Error('SOURCE_NOT_LICENSED');
  if (!source.license_note?.trim()) throw new Error('LICENSE_NOTE_MISSING');
}
function validateMetadata(source) {
  if (!source.title || !source.fileName || /[\\/\0]/.test(source.fileName) || !/^[0-9a-f]{64}$/i.test(source.fileHash) || !Number.isSafeInteger(source.fileSize) || source.fileSize < 0 || source.fileSize > 300 * 1024 * 1024) throw new Error('INVALID_SOURCE_METADATA');
}
const PDF_META = 'import sys,json;from pypdf import PdfReader;r=PdfReader(sys.argv[1]);print(json.dumps({"pages":len(r.pages)}))';
const PDF_PAGE = 'import sys,json;from pypdf import PdfReader;r=PdfReader(sys.argv[1]);p=r.pages[int(sys.argv[2])-1];print(json.dumps({"text":p.extract_text() or ""},ensure_ascii=False))';

async function connect() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  if (!actorId || !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('SUPERADMIN_ACTOR_REQUIRED');
  const require = createRequire(path.join(rootPath, 'lib/db/package.json'));
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const connection = await pool.connect();
  const actor = (await connection.query("SELECT id FROM users WHERE id=$1 AND role='SUPERADMIN' AND NOT suspended AND NOT is_deleted AND NOT student_code_managed", [actorId])).rows[0];
  if (!actor) { connection.release(); await pool.end(); throw new Error('SUPERADMIN_ACTOR_REQUIRED'); }
  return { pool, connection };
}
async function audit(connection, action, resource, details) {
  await connection.query('INSERT INTO audit_logs(id,user_id,action,summary,details) VALUES($1,$2,$3,$4,$5::jsonb)', [randomUUID(), actorId, 'education.quant.' + action, 'أداة إدارة مصادر القدرات: ' + action, JSON.stringify({ resource, ...details })]);
}
async function loadSource(connection, sourceId, lock = false) {
  if (!sourceId || !/^[0-9a-f-]{36}$/i.test(sourceId)) throw new Error('SOURCE_ID_REQUIRED');
  const source = (await connection.query('SELECT * FROM quant_sources WHERE id=$1' + (lock === 'update' ? ' FOR UPDATE' : lock ? ' FOR SHARE' : ''), [sourceId])).rows[0];
  if (!source) throw new Error('SOURCE_NOT_FOUND');
  licensed(source); // Mandatory before stat, opening, copying, parsing or rendering any PDF.
  return source;
}
async function assertStorage() {
  const publicRoots = [path.join(rootPath, 'artifacts/lootbot/public'), path.join(rootPath, 'artifacts/lootbot/dist'), path.join(rootPath, 'artifacts/api-server/dist')];
  if (publicRoots.some(publicRoot => within(publicRoot, storagePath))) throw new Error('SOURCE_STORAGE_MUST_BE_PRIVATE');
  await mkdir(storagePath, { recursive: true });
  const actual = await realpath(storagePath);
  if (publicRoots.some(publicRoot => within(publicRoot, actual))) throw new Error('SOURCE_STORAGE_MUST_BE_PRIVATE');
  return actual;
}
async function register(connection) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  let created = 0, existing = 0;
  await connection.query('BEGIN');
  try {
    for (const source of manifest.sources) {
      validateMetadata(source);
      const hash = source.fileHash.toLowerCase();
      if ((await connection.query('SELECT id FROM quant_sources WHERE file_hash=$1', [hash])).rowCount) { existing++; continue; }
      const sourceId = randomUUID();
      const inserted = await connection.query("INSERT INTO quant_sources(id,title,file_name,file_hash,file_size,source_url,attribution,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(file_hash) DO NOTHING RETURNING id", [sourceId, source.title, source.fileName, hash, source.fileSize, source.sourceUrl || '', source.attribution || '', actorId]);
      if (!inserted.rowCount) { existing++; continue; }
      await audit(connection, 'source.registered', sourceId, { fileHash: hash, licenseStatus: 'unverified' }); created++;
    }
    await connection.query('COMMIT');
    console.log(JSON.stringify({ created, existing, extractedPages: 0, message: 'Registered metadata only. Licensing approval must use the audited admin API.' }));
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
}
async function attach(connection) {
  const sourceId = value('--attach');
  await connection.query('BEGIN');
  try {
    const source = await loadSource(connection, sourceId, 'update');
    const file = value('--file'); if (!file) throw new Error('PDF_FILE_REQUIRED');
    const inputPath = path.resolve(file), inputStat = await stat(inputPath);
    if (!inputStat.isFile() || inputStat.size > 300 * 1024 * 1024 || inputStat.size !== Number(source.file_size)) throw new Error('PDF_SIZE_MISMATCH');
    const handle = await import('node:fs/promises').then(fs => fs.open(inputPath, 'r'));
    let signature; try { const buffer = Buffer.alloc(5); await handle.read(buffer, 0, 5, 0); signature = buffer.toString('ascii'); } finally { await handle.close(); }
    if (signature !== '%PDF-') throw new Error('NOT_A_PDF');
    if (await hashFile(inputPath) !== source.file_hash.toLowerCase()) throw new Error('PDF_HASH_MISMATCH');
    const store = await assertStorage(), folder = path.join(store, source.file_hash.toLowerCase());
    await mkdir(folder, { recursive: true });
    if (!within(store, await realpath(folder))) throw new Error('SOURCE_STORAGE_ESCAPE');
    const destination = path.join(folder, 'original.pdf');
    try { await copyFile(inputPath, destination, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST' || await hashFile(destination) !== source.file_hash.toLowerCase()) throw error; }
    const actualDestination = await realpath(destination);
    if (!within(store, actualDestination)) throw new Error('SOURCE_STORAGE_ESCAPE');
    await connection.query('UPDATE quant_sources SET private_path=$2,updated_at=now() WHERE id=$1', [sourceId, actualDestination]);
    await audit(connection, 'source.original.attached', sourceId, { fileHash: source.file_hash });
    await connection.query('COMMIT');
    console.log(JSON.stringify({ sourceId, attached: true, extractedPages: 0 }));
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
}
async function extract(connection) {
  const sourceId = value('--extract'), source = await loadSource(connection, sourceId);
  if (!source.private_path) throw new Error('PRIVATE_ORIGINAL_REQUIRED');
  // Verify tools before processing pages. No OCR or semantic answer inference is claimed.
  await exec(python, ['-c', 'import pypdf;print("ready")'], { timeout: 15000 });
  await exec(renderer, ['-v'], { timeout: 15000 });
  if (!(await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', ['quant-source:' + sourceId])).rows[0].locked) throw new Error('SOURCE_JOB_ALREADY_RUNNING');
  let jobId, privateFile, processed = 0, failed = 0;
  try {
    await connection.query('BEGIN');
    const current = await loadSource(connection, sourceId, 'update');
    const store = await assertStorage(); privateFile = await realpath(current.private_path);
    if (!within(store, privateFile)) throw new Error('SOURCE_STORAGE_ESCAPE');
    if (await hashFile(privateFile) !== current.file_hash.toLowerCase()) throw new Error('PDF_HASH_MISMATCH');
    const metadata = JSON.parse((await exec(python, ['-c', PDF_META, privateFile], { timeout: 60000, maxBuffer: 1024 * 1024 })).stdout);
    if (!Number.isInteger(metadata.pages) || metadata.pages < 1 || metadata.pages > 100000) throw new Error('INVALID_PAGE_COUNT');
    const pending = (await connection.query("SELECT id FROM quant_extraction_jobs WHERE source_id=$1 AND status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE", [sourceId])).rows[0];
    jobId = pending?.id || randomUUID();
    if (pending) await connection.query("UPDATE quant_extraction_jobs SET status='running',started_at=now(),error='' WHERE id=$1", [jobId]);
    else await connection.query("INSERT INTO quant_extraction_jobs(id,source_id,status,created_by,started_at) VALUES($1,$2,'running',$3,now())", [jobId, sourceId, actorId]);
    await connection.query('UPDATE quant_sources SET page_count=$2,updated_at=now() WHERE id=$1', [sourceId, metadata.pages]);
    await audit(connection, 'source.extraction.started', sourceId, { jobId, pageCount: metadata.pages });
    await connection.query('COMMIT');
    const maxPages = Math.max(1, Math.min(5000, Number(value('--max-pages')) || 50));
    const results = (await connection.query('SELECT page,status FROM quant_extraction_pages WHERE source_id=$1', [sourceId])).rows;
    const done = new Set(results.filter(row => row.status !== 'failed' || !argv.includes('--retry-failed')).map(row => row.page));
    for (let page = 1; page <= metadata.pages && processed < maxPages; page++) {
      if (done.has(page)) continue;
      await connection.query('BEGIN');
      try {
        await loadSource(connection, sourceId, true); // lock license for this page, including PDF operations
        const { text } = JSON.parse((await exec(python, ['-c', PDF_PAGE, privateFile, String(page)], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 })).stdout);
        const imageStem = path.join(path.dirname(privateFile), 'page-' + page);
        await exec(renderer, ['-f', String(page), '-l', String(page), '-scale-to', '1600', '-singlefile', '-png', privateFile, imageStem], { timeout: 60000, maxBuffer: 1024 * 1024 });
        // Image-only pages are never mistaken for blanks. All fields require human verification.
        await connection.query("INSERT INTO quant_extraction_pages(source_id,page,status,text_excerpt,reason) VALUES($1,$2,'needs_review',$3,$4) ON CONFLICT(source_id,page) DO UPDATE SET status='needs_review',text_excerpt=excluded.text_excerpt,reason=excluded.reason,processed_at=now()", [sourceId, page, String(text).slice(0, 50000), text.trim() ? 'Raw text and page image prepared; verify equations, choices, correct answer and attribution manually.' : 'No machine-readable text; inspect private page image. OCR is not enabled.']);
        await connection.query('COMMIT'); processed++;
      } catch (error) {
        await connection.query('ROLLBACK');
        if (error.message === 'SOURCE_NOT_LICENSED' || error.message === 'LICENSE_NOTE_MISSING') throw error;
        await connection.query("INSERT INTO quant_extraction_pages(source_id,page,status,reason) VALUES($1,$2,'failed',$3) ON CONFLICT(source_id,page) DO UPDATE SET status='failed',reason=excluded.reason,processed_at=now()", [sourceId, page, 'PDF page processing failed; inspect parser/render dependencies and retry explicitly.']);
        processed++; failed++;
      }
    }
    const totals = (await connection.query("SELECT count(*)::int AS count,count(*) FILTER(WHERE status='failed')::int AS failed FROM quant_extraction_pages WHERE source_id=$1", [sourceId])).rows[0];
    const status = totals.count >= metadata.pages && totals.failed === 0 ? 'completed' : 'pending';
    await connection.query("UPDATE quant_extraction_jobs SET status=$2,finished_at=CASE WHEN $2='completed' THEN now() ELSE NULL END WHERE id=$1", [jobId, status]);
    await audit(connection, 'source.extraction.batch', sourceId, { jobId, pagesProcessed: processed, failedPages: failed, status });
    console.log(JSON.stringify({ sourceId, jobId, status, pagesProcessed: processed, failedPages: failed, questionsDiscovered: 0, questionsApproved: 0, note: 'Raw pages are needs_review. No answer keys were inferred and nothing was published.' }));
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    if (jobId) await connection.query("UPDATE quant_extraction_jobs SET status='failed',finished_at=now(),error=$2 WHERE id=$1", [jobId, ['SOURCE_NOT_LICENSED', 'LICENSE_NOTE_MISSING'].includes(error.message) ? error.message : 'EXTRACTION_FAILED']);
    throw error;
  } finally { await connection.query('SELECT pg_advisory_unlock(hashtext($1))', ['quant-source:' + sourceId]); }
}
async function main() {
  if (!mode) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.sources.forEach(validateMetadata);
    console.log(JSON.stringify({ sources: manifest.sources.map(source => ({ title: source.title, fileHash: source.fileHash, fileSize: source.fileSize, licenseStatus: 'unverified' })), extractedPages: 0, commands: ['--register --actor UUID', '--attach SOURCE_UUID --file ORIGINAL_PDF --actor UUID', '--extract SOURCE_UUID --max-pages 50 --actor UUID'], requirements: 'DATABASE_URL from environment; licensing approval in admin; QUANT_PYTHON_BIN and QUANT_PDF_RENDER_BIN for approved extraction.' }, null, 2)); return;
  }
  const { pool, connection } = await connect();
  try { if (mode === '--register') await register(connection); else if (mode === '--attach') await attach(connection); else await extract(connection); }
  finally { connection.release(); await pool.end(); }
}
main().catch(error => { console.error(JSON.stringify({ error: /^[A-Z_]+$/.test(error.message) ? error.message : 'QUANT_SOURCE_OPERATION_FAILED', note: 'No connection strings, source text, answer keys or private storage paths are printed.' })); process.exitCode = 1; });
