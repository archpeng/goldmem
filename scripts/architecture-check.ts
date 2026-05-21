import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runDocDriftCheck } from "./doc-drift-check.js";

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
  .filter((file) => !file.startsWith("node_modules/") && !file.startsWith("dist/") && !file.includes("/dist/"));

const violations: Violation[] = [];
const lineBudgetAllowlist = JSON.parse(await readFile("scripts/line-budget-allowlist.json", "utf8")) as {
  entries: Array<{ file: string; maxLines: number; owner: string; reason: string; exitCriteria: string }>;
};
const allowlistByFile = new Map(lineBudgetAllowlist.entries.map((entry) => [entry.file, entry]));
const hardBudgets = new Map<string, number>([
  ["services/api-server/src/index.ts", 250],
  ["packages/memory-kernel/src/query-orchestrator.ts", 250],
  ["apps/web-mvp/src/App.tsx", 250],
  ["packages/memory-kernel/src/index.ts", 350],
  ["packages/memory-store/src/postgres.ts", 250],
]);

for (const violation of runDocDriftCheck(process.cwd())) {
  violations.push({ file: "README.md", reason: violation });
}

for (const entry of lineBudgetAllowlist.entries) {
  if (!entry.owner || !entry.reason || !entry.exitCriteria) {
    violations.push({ file: "scripts/line-budget-allowlist.json", reason: `Allowlist entry for ${entry.file} must include owner, reason, and exitCriteria.` });
  }
}

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

  if (file.startsWith("packages/model-gateway/src/normalizers/") && /inferEventType|inferEntityType|inferRiskLevel|inferRiskType|inferSeverity|inferRequiresConfirmation|inferRequiresFamilyReview|inferQueryIntent/.test(text)) {
    violations.push({ file, reason: "Model-gateway normalizers must not reintroduce keyword-based domain inference helpers." });
  }
  if (file === "packages/model-gateway/src/normalizers/query.ts" && /purchase|grocery|groceries|banking/.test(text)) {
    violations.push({ file, reason: "Query normalizer must not map keyword aliases into event types." });
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

for (const [file, maxLines] of hardBudgets) {
  const text = await readFile(file, "utf8");
  const lineCount = text.split("\n").length;
  if (lineCount > maxLines) {
    violations.push({ file, reason: `Core entry file has ${lineCount} lines; expected ${maxLines} or fewer.` });
  }
}

for (const file of projectFiles) {
  if (!isBudgetTrackedFile(file)) continue;
  const text = await readFile(file, "utf8");
  const lineCount = text.split("\n").length;
  if (lineCount <= 350 || hardBudgets.has(file)) continue;

  const allowed = allowlistByFile.get(file);
  if (!allowed) {
    violations.push({ file, reason: `File has ${lineCount} lines and exceeds the 350-line broad-file threshold without an allowlist entry.` });
    continue;
  }
  if (lineCount > allowed.maxLines) {
    violations.push({ file, reason: `Allowlisted file has ${lineCount} lines; expected ${allowed.maxLines} or fewer.` });
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
if (!/"verify:fast"\s*:/.test(packageJson) || !/"verify:real"\s*:/.test(packageJson)) {
  violations.push({
    file: "package.json",
    reason: "Top-level verify:fast and verify:real scripts are required.",
  });
}

const documentationText = `${await readFile("README.md", "utf8")}\n${await readFile("docs/current-capabilities-and-architecture.md", "utf8")}`;
for (const scriptName of ["verify:fast", "verify:real", "doc:drift:check"]) {
  if (!documentationText.includes(scriptName)) {
    violations.push({
      file: "README.md",
      reason: `Documentation must mention ${scriptName}.`,
    });
  }
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

function isBudgetTrackedFile(file: string): boolean {
  return (
    /^packages\/.+\.(ts|tsx)$/.test(file) ||
    /^services\/.+\.(ts|tsx|py)$/.test(file) ||
    /^apps\/.+\.(ts|tsx)$/.test(file) ||
    /^scripts\/.+\.(ts|tsx)$/.test(file)
  );
}
