import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Existing hosted build overrides may still call the root db:push command.
// Production upgrades use reviewed SQL migrations, not schema reconciliation.
export function databaseSetupPlan(environment = process.env) {
  const migrate = ['--filter', '@workspace/db', 'run', 'migrate'];
  if (environment.RENDER === 'true' || environment.NODE_ENV === 'production') {
    return [migrate];
  }
  return [['--filter', '@workspace/db', 'run', 'push'], migrate];
}

export async function runDatabaseSetup(environment = process.env) {
  const runner = fileURLToPath(new URL('./run-pnpm.mjs', import.meta.url));
  for (const argumentsForPnpm of databaseSetupPlan(environment)) {
    const result = await new Promise((done) => {
      // Fixed arguments go directly to Node; no shell or user command text.
      const child = spawn(process.execPath, [runner, ...argumentsForPnpm], {
        env: environment,
        stdio: 'inherit',
        shell: false,
      });
      child.once('error', (error) => {
        console.error(`Could not start database setup: ${error.code ?? error.name}`);
        done({ code: 1, signal: null });
      });
      child.once('exit', (code, signal) => done({ code: code ?? 1, signal }));
    });
    if (result.signal || result.code !== 0) return result;
  }
  return { code: 0, signal: null };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    try {
      process.loadEnvFile('.env');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (databaseSetupPlan().length === 1) {
      console.info('Hosted/production db:push runs SQL migrations only.');
    }
    const result = await runDatabaseSetup();
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.code;
  } catch (error) {
    console.error(`Database setup failed: ${error?.code ?? error?.name ?? 'UnknownError'}`);
    process.exitCode = 1;
  }
}
