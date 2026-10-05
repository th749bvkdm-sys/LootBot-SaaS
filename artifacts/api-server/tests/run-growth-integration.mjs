import { build } from 'esbuild';
import { readFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const artifact = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(artifact, '../..');
const env = await readFile(path.join(root, '.env.v2-test'), 'utf8');
const connection = env.split(/\r?\n/).find(line => line.startsWith('DATABASE_URL='))?.slice(13).trim().replace(/^['"]|['"]$/g, '');
if (!connection || new URL(connection).hostname !== 'ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech') throw new Error('Only the isolated V2 test branch is permitted.');
const output = path.join(artifact, '.growth-integration.mjs');
try {
  await build({ entryPoints: [path.join(artifact, 'tests/growth-integration.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', external: ['pg-native', 'pino', 'pino-pretty'], banner: { js: "import { createRequire } from 'node:module'; globalThis.require = createRequire(import.meta.url);" }, logLevel: 'silent' });
  const url = new URL(connection); url.searchParams.set('sslmode', 'verify-full');
  const result = spawnSync(process.execPath, ['--test', output], { cwd: artifact, env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'production', LOG_LEVEL: 'silent', SESSION_SECRET: 'isolated-growth-integration-secret-not-used-for-login' }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await unlink(output).catch(() => undefined); }
