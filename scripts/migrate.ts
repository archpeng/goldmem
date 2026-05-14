import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://mem:mem@localhost:5432/mem";
const migrationsDir = process.env.MEM_MIGRATIONS_DIR ?? "infra/db/migrations";
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const applied = await pool.query("select 1 from schema_migrations where filename = $1", [file]);
    if (applied.rowCount) {
      console.log(`skip ${file}`);
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), "utf8");
    await pool.query("begin");
    try {
      await pool.query(sql);
      await pool.query("insert into schema_migrations (filename) values ($1)", [file]);
      await pool.query("commit");
      console.log(`applied ${file}`);
    } catch (error) {
      await pool.query("rollback");
      throw error;
    }
  }
} finally {
  await pool.end();
}
