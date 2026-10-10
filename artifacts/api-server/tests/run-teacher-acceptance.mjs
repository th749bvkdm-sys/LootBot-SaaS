/** Disposable schema on the existing isolated test branch; never migrates public/production. */
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const pg = createRequire(new URL('../../../lib/db/package.json', import.meta.url))('pg');

const saved = (await readFile('../../.env.v2-test', 'utf8')).trim();
if (!saved.startsWith('DATABASE_URL=')) throw Error('Missing isolated test connection.');
const url = new URL(saved.slice('DATABASE_URL='.length));
if (url.hostname !== 'ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech') throw Error('Only the existing isolated test branch is permitted.');
url.searchParams.set('sslmode', 'verify-full');
const schema = `teacher_qa_${randomUUID().replaceAll('-', '')}`;
if (!/^teacher_qa_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe schema name.');
const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 20000 });
const entry = process.argv[2] ?? 'tests/teacher-integration.ts';
if (!/^tests\/[a-z0-9-]+\.ts$/.test(entry)) throw Error('Unsafe test entry.');
const output = `.teacher-integration-${process.pid}.mjs`;
await client.connect();
let created = false;
try {
  await client.query(`CREATE SCHEMA "${schema}"`); created = true;
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'teacher_%' AND tablename<>'lootbot_schema_migrations'");
  for (const { tablename } of tables.rows) {
    if (!/^[a-z0-9_]+$/.test(tablename)) throw Error('Unexpected table name.');
    await client.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
  }
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(await readFile('../../lib/db/migrations/0010_teacher_room.sql', 'utf8'));
  url.searchParams.set('options', `-csearch_path=${schema}`);
  await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', external: ['pg-native', 'pino', 'pino-pretty'], banner: { js: "import {createRequire} from 'node:module';globalThis.require=createRequire(import.meta.url);" }, logLevel: 'silent' });
  const child = spawn(process.execPath, process.argv.includes('--serve') ? [output] : ['--test', output], { env: { ...process.env, DATABASE_URL: url.toString(), TEACHER_TEST_SCHEMA: schema, NODE_ENV: 'test', LOG_LEVEL: 'silent', TEACHER_WORKER_DISABLED: 'true', STATIC_DIR: path.resolve('../lootbot/dist/public') }, stdio: 'inherit' });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  process.exitCode = Number(await new Promise(resolve => child.once('exit', code => resolve(code ?? 1))));
} finally {
  if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  await client.end();
  await unlink(output).catch(() => {});
}
