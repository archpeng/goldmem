import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

const env = { ...loadDotEnv(".env"), ...process.env };
const defaultDatabaseUrl = "postgres://mem:mem@localhost:5432/mem";
const defaultGraphitiBaseUrl = "http://localhost:8890";
const defaultGraphitiNeo4jImage = env.GRAPHITI_NEO4J_IMAGE ?? "neo4j:5.26.4";
const startsLocalGraphiti = process.env.GRAPHITI_TEST_USE_EXISTING !== "true";
const databaseUrl = resolveGraphitiDatabaseUrl(env, defaultDatabaseUrl, startsLocalGraphiti);
const graphitiBaseUrl = (env.GRAPHITI_BASE_URL ?? defaultGraphitiBaseUrl).replace(/\/$/, "");

if (startsLocalGraphiti && !env.OPENAI_API_KEY) {
  throw new Error("test:graphiti requires OPENAI_API_KEY when it starts the local Graphiti sidecar");
}

if (startsLocalGraphiti) {
  const composeEnv = await prepareLocalGraphitiEnv(env);
  await runWithRetry(
    "docker",
    ["compose", "-f", "infra/docker-compose.yml", "--profile", "graphiti", "up", "-d", "--build", "postgres", "graphiti-neo4j", "graphiti-sidecar"],
    composeEnv,
    parseCount(composeEnv.GRAPHITI_DOCKER_COMPOSE_RETRIES, 2),
    parseDelayMs(composeEnv.GRAPHITI_DOCKER_PULL_BACKOFF_MS, 3_000),
    "docker compose graphiti up",
  );
}

await waitForPostgres(databaseUrl);
if (env.MEM_SKIP_GRAPHITI_MIGRATE !== "true") {
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

function resolveGraphitiDatabaseUrl(
  env: NodeJS.ProcessEnv,
  fallback: string,
  startsLocalGraphiti: boolean,
): string {
  const explicit = env.GRAPHITI_TEST_DATABASE_URL
    ?? env.MEM_STORE_TEST_DATABASE_URL;
  if (explicit) return explicit;
  if (startsLocalGraphiti || isLocalGraphitiBaseUrl(env.GRAPHITI_BASE_URL ?? defaultGraphitiBaseUrl)) return fallback;
  return env.DATABASE_URL ?? fallback;
}

function isLocalGraphitiBaseUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
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

async function prepareLocalGraphitiEnv(baseEnv: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const candidates = [
    defaultGraphitiNeo4jImage,
    baseEnv.GRAPHITI_NEO4J_IMAGE_FALLBACK,
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);

  const pullRetries = parseCount(baseEnv.GRAPHITI_DOCKER_PULL_RETRIES, 3);
  const pullBackoffMs = parseDelayMs(baseEnv.GRAPHITI_DOCKER_PULL_BACKOFF_MS, 3_000);
  const failures: string[] = [];

  for (const image of candidates) {
    try {
      await ensureDockerImage(image, pullRetries, pullBackoffMs);
      return {
        ...baseEnv,
        GRAPHITI_NEO4J_IMAGE: image,
      };
    } catch (error) {
      failures.push(`${image}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to prepare Graphiti Neo4j image. ${failures.join(" | ")}`);
}

async function ensureDockerImage(image: string, retries: number, backoffMs: number): Promise<void> {
  if (await dockerImageExists(image)) return;
  await runWithRetry("docker", ["pull", image], process.env, retries, backoffMs, `docker pull ${image}`);
}

async function dockerImageExists(image: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn("docker", ["image", "inspect", image], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function runWithRetry(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  attempts: number,
  delayMs: number,
  label: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run(command, args, env);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      console.warn(`${label} failed on attempt ${attempt}/${attempts}: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(delayMs * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseCount(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseDelayMs(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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
