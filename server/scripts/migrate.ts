import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const MIGRATIONS_TABLE = 'schema_migrations';

const getMigrationsDir = (): string => {
  const scriptFile = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptFile);
  return path.resolve(scriptDir, '../drizzle');
};

const listMigrationFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d+.*\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
};

const ensureMigrationsTable = async (pool: Pool): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name text PRIMARY KEY,
      applied_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
};

const getAppliedMigrations = async (pool: Pool): Promise<Set<string>> => {
  const result = await pool.query<{ name: string }>(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC, name ASC`,
  );
  return new Set(result.rows.map((row) => row.name));
};

const applyMigration = async (pool: Pool, filePath: string, name: string): Promise<void> => {
  const sql = await readFile(filePath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (sql.trim().length > 0) {
      await client.query(sql);
    }
    await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [name]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const main = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  const statusOnly = process.argv.includes('--status');
  const migrationsDir = getMigrationsDir();
  const files = await listMigrationFiles(migrationsDir);
  const pool = new Pool({ connectionString });

  try {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);
    const pending = files.filter((name) => !applied.has(name));

    if (statusOnly) {
      console.log(`[migrate] applied=${applied.size} pending=${pending.length} dir=${migrationsDir}`);
      for (const name of pending) {
        console.log(`[pending] ${name}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log(`[migrate] no pending migrations (dir=${migrationsDir}).`);
      return;
    }

    console.log(`[migrate] applying ${pending.length} migration(s) from ${migrationsDir}`);
    for (const name of pending) {
      const filePath = path.join(migrationsDir, name);
      await applyMigration(pool, filePath, name);
      console.log(`[applied] ${name}`);
    }
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate] failed: ${message}`);
  process.exit(1);
});
