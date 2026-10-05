import { build } from 'esbuild';
import { readFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const artifact = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envText = await readFile(path.resolve(artifact, '../../.env.v2-test'), 'utf8');
const connection = envText.split(/\r?\n/).find(line => line.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '');
if (!connection || !/^ep-summer-recipe-b21ls93d(?:-pooler)?\.[a-z0-9.-]+\.neon\.tech$/.test(new URL(connection).hostname)) throw Error('Only the isolated V2 test branch is permitted.');
const output = path.join(artifact, '.commerce-back-integration.mjs');
globalThis.require = createRequire(import.meta.url);
await build({ entryPoints: [path.join(artifact, 'tests/commerce-back-integration.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', external: ['pg-native', 'pino', 'pino-pretty'], banner: { js: "import { createRequire } from 'node:module'; globalThis.require = createRequire(import.meta.url);" }, logLevel: 'silent' });
const url = new URL(connection); url.searchParams.set('sslmode', 'verify-full');
try {
  const result = spawnSync(process.execPath, ['--test', output], { cwd: artifact, env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'production', LOG_LEVEL: 'silent' }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await unlink(output); }
