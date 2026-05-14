import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

const defaultDatabaseUrl = "postgres://mem:mem@localhost:5432/mem";
const databaseUrl = process.env.MEM_STORE_TEST_DATABASE_URL ?? defaultDatabaseUrl;

if (!process.env.MEM_STORE_TEST_DATABASE_URL) {
  await run("docker", ["compose", "-f", "infra/docker-compose.yml", "up", "-d", "postgres"], process.env);
}

await waitForPostgres(databaseUrl);
await run("pnpm", ["--filter", "@mem/memory-store", "test"], {
  ...process.env,
  MEM_STORE_TEST_DATABASE_URL: databaseUrl,
});

async function waitForPostgres(connectionString: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Postgres did not become ready within 30s: ${message}`);
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}
