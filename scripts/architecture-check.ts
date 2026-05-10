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
  .filter(Boolean)
  .filter((file) => !file.startsWith("node_modules/") && !file.startsWith("dist/"));

const violations: Violation[] = [];

for (const file of trackedFiles) {
  if (file === "scripts/architecture-check.ts") continue;
  if (!/\.(ts|tsx|js|md|json|yml|yaml|Dockerfile)$/.test(file) && !file.endsWith("Dockerfile")) continue;
  const text = await readFile(file, "utf8");

  if (/\binfer\s*:\s*true\b/.test(text)) {
    violations.push({ file, reason: "Canonical Mem0 memory writes must not enable infer=true." });
  }

  if (/GRAPHITI_BASE_URL|TemporalGraphStore|HttpTemporalGraphStore|NullTemporalGraphStore/.test(text)) {
    violations.push({ file, reason: "MVP must not reintroduce a parallel Graphiti/TemporalGraph path." });
  }

  if (
    /Mem0\s+(is|owns|becomes)\s+(the\s+)?(truth|authoritative)/i.test(text) ||
    /Mem0\s+is\s+(the\s+)?(source\s+of\s+truth|truth\s+source)/i.test(text) ||
    /(truth|authoritative)\s+(source|state)?\s*[:=]\s*Mem0/i.test(text)
  ) {
    violations.push({ file, reason: "Mem0 must not be authorized as truth/authoritative state." });
  }

  if (/Mem0\s+(is|as|=)?\s*semantic-only/i.test(text) || /Mem0\s+semantic-only/i.test(text)) {
    violations.push({ file, reason: "Mem0 should be described as a multilingual recall engine, not semantic-only." });
  }
}

const adapter = await readFile("packages/memory-store/src/http-adapters.ts", "utf8");
if (!/\binfer\s*:\s*false\b/.test(adapter)) {
  violations.push({
    file: "packages/memory-store/src/http-adapters.ts",
    reason: "HttpSemanticMemoryStore.addMemory must send infer=false to Mem0.",
  });
}

const kernel = await readFile("packages/memory-kernel/src/index.ts", "utf8");
if (!/metadata\.summary/.test(kernel)) {
  violations.push({
    file: "packages/memory-kernel/src/index.ts",
    reason: "Mem0 evidence must prefer PostgreSQL-derived metadata.summary.",
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
