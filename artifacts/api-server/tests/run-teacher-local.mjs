/** Runs the unchanged HTTP server against a fresh, in-memory PostgreSQL database. */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';

const entry = process.argv[2] ?? 'tests/teacher-integration.ts';
if (!/^tests\/[a-z0-9-]+\.ts$/.test(entry)) throw Error('Unsafe test entry.');
const schema = `teacher_qa_${randomUUID().replaceAll('-', '')}`;
const schemaFile = path.resolve(`../../lib/db/.teacher-test-schema-${process.pid}.mjs`);
const output = `.teacher-local-${process.pid}.mjs`;
const kit = createRequire(new URL('../../../lib/db/package.json', import.meta.url))('drizzle-kit/api');
let localDb, socket;
try {
  await build({ entryPoints: ['../../lib/db/src/schema/index.ts'], outfile: schemaFile, platform: 'node', format: 'esm', bundle: true, packages: 'external', logLevel: 'silent' });
  const model = await import(pathToFileURL(schemaFile).href);
  const legacy = kit.generateDrizzleJson(model);
  for (const key of Object.keys(legacy.tables)) if (key.startsWith('public.teacher_')) delete legacy.tables[key];
  delete legacy.tables['public.users'].columns.account_type;
  delete legacy.tables['public.users'].checkConstraints.users_account_type_check;
  const statements = await kit.generateMigration(kit.generateDrizzleJson({}), legacy);
  localDb = await PGlite.create();
  await localDb.exec(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";`);
  for (const statement of statements) await localDb.exec(statement.replaceAll('"public".', `"${schema}".`));
  // Verify a real legacy merchant retains its account type after the forward migration.
  await localDb.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)', ['legacy-fixture', 'حساب تاجر تجريبي سابق', 'legacy@example.invalid', 'unused-test-hash']);
  const teacherMigration = await readFile('../../lib/db/migrations/0010_teacher_room.sql', 'utf8');
  await localDb.exec(teacherMigration);
  await localDb.exec(teacherMigration);
  const preserved = await localDb.query('SELECT account_type FROM users WHERE id=$1', ['legacy-fixture']);
  if (preserved.rows[0]?.account_type !== 'merchant') throw Error('Legacy merchant migration failed.');
  console.log('LOCAL_MIGRATION_PASS applied twice; legacy merchant preserved; teacher ownership constraints installed.');
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  socket = new PGLiteSocketServer({ db: localDb, host: '127.0.0.1', port, maxConnections: 10 });
  await socket.start();
  await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', external: ['pg-native', 'pino', 'pino-pretty'], banner: { js: "import {createRequire} from 'node:module';globalThis.require=createRequire(import.meta.url);" }, logLevel: 'silent' });
  const child = spawn(process.execPath, process.argv.includes('--serve') ? [output] : ['--test', output], { env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, TEACHER_TEST_SCHEMA: schema, TEACHER_OCR_PROVIDER: 'manual', TEACHER_WORKER_DISABLED: 'true', NODE_ENV: 'test', LOG_LEVEL: 'silent', STATIC_DIR: path.resolve('../lootbot/dist/public') }, stdio: 'inherit' });
  process.once('SIGINT', () => child.kill('SIGINT')); process.once('SIGTERM', () => child.kill('SIGTERM'));
  process.exitCode = Number(await new Promise(resolve => child.once('exit', code => resolve(code ?? 1))));
} finally {
  if (socket) await socket.stop();
  if (localDb) await localDb.close();
  await unlink(schemaFile).catch(() => {}); await unlink(output).catch(() => {});
}
