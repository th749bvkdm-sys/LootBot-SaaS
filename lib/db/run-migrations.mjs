import pg from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Locks, ledger checks and SQL share a transaction, including on pooled URLs. */
export async function applyMigrations({ connectionString, migrationsDir = new URL('./migrations/', import.meta.url), schema, onApplied = () => {} }) {
  if (!connectionString) throw new Error('DATABASE_URL is required for migrations.');
  if (schema !== undefined && !/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid migration schema.');
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 20_000 });
  const applied = [];
  await client.connect();
  try {
    const begin = async () => {
      await client.query('BEGIN');
      await client.query("select pg_advisory_xact_lock(hashtext('lootbot-schema-migrations'))");
      if (schema) await client.query("select set_config('search_path', $1, true)", [schema]);
    };
    await begin();
    try {
      await client.query('CREATE TABLE IF NOT EXISTS lootbot_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    const directory = migrationsDir instanceof URL ? fileURLToPath(migrationsDir) : migrationsDir;
    const files = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const source = await readFile(resolve(directory, name), 'utf8');
      const checksum = createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex');
      await begin();
      try {
        const { rows } = await client.query('SELECT checksum FROM lootbot_schema_migrations WHERE name = $1', [name]);
        if (rows[0]) {
          if (rows[0].checksum !== checksum) throw new Error(`Previously applied migration changed: ${name}`);
          await client.query('COMMIT');
          continue;
        }
        await client.query(source);
        await client.query('INSERT INTO lootbot_schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(name);
      onApplied(name);
    }
    return applied;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const applied = await applyMigrations({ connectionString: process.env.DATABASE_URL, onApplied: name => console.info(`Applied ${name}`) });
    console.info(`Database migrations ready (${applied.length} applied).`);
  } catch (error) {
    console.error('Database migration failed. No failed migration was committed.', error?.code ?? error?.name ?? 'UnknownError');
    process.exitCode = 1;
  }
}
