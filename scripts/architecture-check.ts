import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Violation = {
  file: string;
  reason: string;
};

const trackedFiles = (await execFileAsync("git", ["ls-files"], { maxBuffer: 10 * 1024 * 1024 })).stdout
  .split("\n")
  .filter(Boolean);
const untrackedFiles = (await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { maxBuffer: 10 * 1024 * 1024 })).stdout
  .split("\n")
  .filter(Boolean);
const projectFiles = [...new Set([...trackedFiles, ...untrackedFiles])]
  .filter((file) => !file.startsWith("node_modules/") && !file.startsWith("dist/"));

const violations: Violation[] = [];

for (const file of projectFiles) {
  if (file === "scripts/architecture-check.ts") continue;
  if (!/\.(ts|tsx|js|md|json|yml|yaml|Dockerfile)$/.test(file) && !file.endsWith("Dockerfile")) continue;
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
    throw error;
  }

  if (/TemporalGraphStore|HttpTemporalGraphStore|NullTemporalGraphStore/.test(text)) {
    violations.push({ file, reason: "Use the Graphiti-targeted TemporalMemoryStore path, not a parallel TemporalGraphStore path." });
  }

  const ageLabelPattern = new RegExp("\\u8001\\u4eba");
  if (ageLabelPattern.test(text)) {
    violations.push({ file, reason: "Use user/person-first wording instead of age-labeled Chinese copy." });
  }

  const removedProviderPattern = new RegExp(`\\b(${["Mem", "mem", "MEM"].map((prefix) => `${prefix}0`).join("|")})\\b`);
  if (removedProviderPattern.test(text)) {
    violations.push({ file, reason: "Legacy memory provider has been removed; use the pgvector-backed semantic recall index." });
  }

  if (file.startsWith("packages/memory-store/") && /@mem\/model-gateway/.test(text)) {
    violations.push({ file, reason: "memory-store must not depend on model-gateway; shared context contracts belong in memory-schema." });
  }

  if (isProductionSource(file) && /as\s+unknown\s+as|as\s+never|as\s+Partial\s*</.test(text)) {
    violations.push({ file, reason: "Production code must not hide boundary uncertainty with broad casts." });
  }
}

for (const file of [
  "packages/memory-schema/package.json",
  "packages/memory-kernel/package.json",
  "packages/memory-store/package.json",
  "packages/risk-engine/package.json",
  "packages/permission-engine/package.json",
  "packages/reminder-engine/package.json",
]) {
  const text = await readFile(file, "utf8");
  if (/--passWithNoTests/.test(text)) {
    violations.push({ file, reason: "Safety-owner packages must not pass tests when no tests exist." });
  }
}

for (const [file, maxLines] of [
  ["packages/memory-kernel/src/index.ts", 350],
  ["packages/memory-store/src/postgres.ts", 250],
] as const) {
  const text = await readFile(file, "utf8");
  const lineCount = text.split("\n").length;
  if (lineCount > maxLines) {
    violations.push({ file, reason: `Core entry file has ${lineCount} lines; expected ${maxLines} or fewer.` });
  }
}

const semanticStore = await readFile("packages/memory-store/src/postgres-semantic-memory.ts", "utf8");
if (!/semantic_memories/.test(semanticStore)) {
  violations.push({
    file: "packages/memory-store/src/postgres-semantic-memory.ts",
    reason: "Semantic recall must use the pgvector-backed semantic_memories index.",
  });
}
if (/provider\s*:/.test(semanticStore)) {
  violations.push({
    file: "packages/memory-store/src/postgres-semantic-memory.ts",
    reason: "Semantic recall store results must not expose provider-specific fields.",
  });
}

const packageJson = await readFile("package.json", "utf8");
if (!/"test:graphiti"\s*:/.test(packageJson) || !/"mvp:verify"\s*:\s*"[^"]*pnpm test:graphiti/.test(packageJson)) {
  violations.push({
    file: "package.json",
    reason: "Graphiti is core long-term memory; mvp:verify must include pnpm test:graphiti.",
  });
}

for (const file of [
  "packages/memory-kernel/src/ingest-temporal-writer.ts",
  "packages/memory-kernel/src/query-orchestrator.ts",
]) {
  const text = await readFile(file, "utf8");
  if (/NullTemporalMemoryStore/.test(text)) {
    violations.push({
      file,
      reason: "Kernel must not silently branch on NullTemporalMemoryStore; temporal failures must be surfaced and audited.",
    });
  }
}

const retrieval = await readFile("packages/memory-kernel/src/retrieval.ts", "utf8");
const querySemantic = await readFile("packages/memory-kernel/src/query-semantic.ts", "utf8");
if (!/alignSemanticEvidence/.test(querySemantic) || !/eventStore\.getByIds/.test(querySemantic) || !/sourceStore\.get/.test(querySemantic)) {
  violations.push({
    file: "packages/memory-kernel/src/query-semantic.ts",
    reason: "Semantic recall candidates must be rehydrated from PostgreSQL source/event records before final evidence.",
  });
}
if (/metadata\.summary/.test(retrieval) || /result\.memory/.test(retrieval)) {
  violations.push({
    file: "packages/memory-kernel/src/retrieval.ts",
    reason: "Final semantic evidence must not use semantic index metadata.summary or provider/index memory text.",
  });
}
if (!/retrievalSource:\s*"semantic"/.test(querySemantic)) {
  violations.push({
    file: "packages/memory-kernel/src/query-semantic.ts",
    reason: "Semantic recall evidence must use retrievalSource=semantic.",
  });
}

if (violations.length > 0) {
  console.error("Architecture check failed:");
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.reason}`);
  }
  process.exit(1);
}

console.log("architecture check ok");

function isProductionSource(file: string): boolean {
  return /\.(ts|tsx)$/.test(file) && !/(\.test|\.spec)\.(ts|tsx)$/.test(file) && !file.includes("/test/");
}
