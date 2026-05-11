import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

const env = { ...loadDotEnv(".env"), ...process.env };
const defaultDatabaseUrl = "postgres://goldmem:goldmem@localhost:5432/goldmem";
const defaultGraphitiBaseUrl = "http://localhost:8890";
const externalGraphitiBaseUrl = process.env.GRAPHITI_BASE_URL;
const databaseUrl = env.DATABASE_URL ?? defaultDatabaseUrl;
const graphitiBaseUrl = (env.GRAPHITI_BASE_URL ?? defaultGraphitiBaseUrl).replace(/\/$/, "");

if (!externalGraphitiBaseUrl && !env.OPENAI_API_KEY) {
  throw new Error("test:graphiti requires OPENAI_API_KEY when it starts the local Graphiti sidecar");
}

if (!externalGraphitiBaseUrl) {
  await run("docker", ["compose", "-f", "infra/docker-compose.yml", "--profile", "graphiti", "up", "-d", "--build", "postgres", "graphiti-neo4j", "graphiti-sidecar"], env);
}

await waitForPostgres(databaseUrl);
if (env.GOLDMEM_SKIP_GRAPHITI_MIGRATE !== "true") {
  await run("pnpm", ["db:migrate"], { ...env, DATABASE_URL: databaseUrl });
}
await waitForGraphiti(graphitiBaseUrl);
await run("pnpm", ["graphiti:smoke"], {
  ...env,
  GRAPHITI_BASE_URL: graphitiBaseUrl,
});

function loadDotEnv(path: string): NodeJS.ProcessEnv {
  try {
    const output: NodeJS.ProcessEnv = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      output[key] = stripQuotes(rawValue);
    }
    return output;
  } catch {
    return {};
  }
}

function stripQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

async function waitForPostgres(connectionString: string): Promise<void> {
  const deadline = Date.now() + 60_000;
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
  throw new Error(`Postgres did not become ready within 60s: ${message}`);
}

async function waitForGraphiti(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastBody = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: env.GRAPHITI_API_KEY ? { "x-api-key": env.GRAPHITI_API_KEY } : undefined,
      });
      lastBody = await response.text();
      if (response.ok) {
        const health = lastBody ? JSON.parse(lastBody) as { ok?: unknown } : {};
        if (health.ok === true) return;
      }
    } catch (error) {
      lastBody = error instanceof Error ? error.message : String(error);
    }
    await sleep(2000);
  }
  throw new Error(`Graphiti did not become healthy within 180s: ${lastBody}`);
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
