import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function runDocDriftCheck(repoRoot = process.cwd()): string[] {
  const violations: string[] = [];
  const readmePath = join(repoRoot, "README.md");
  const currentDocPath = join(repoRoot, "docs/current-capabilities-and-architecture.md");
  const readme = readFileSync(readmePath, "utf8");
  const currentDoc = readFileSync(currentDocPath, "utf8");
  const combined = `${readme}\n${currentDoc}`;

  const readmeLayoutPaths = parseReadmeLayoutPaths(readme);
  if (readmeLayoutPaths.length === 0) {
    violations.push("README.md: Repository layout section is missing or empty.");
  }
  for (const relativePath of readmeLayoutPaths) {
    if (!existsSync(join(repoRoot, relativePath))) {
      violations.push(`README.md: Repository layout references missing path ${relativePath}.`);
    }
  }

  const referencedModulePaths = extractModulePaths(combined);
  for (const relativePath of referencedModulePaths) {
    if (!existsSync(join(repoRoot, relativePath))) {
      violations.push(`Docs reference missing runtime path ${relativePath}.`);
    }
  }

  for (const relativePath of runtimeSurfacePaths(repoRoot)) {
    if (!combined.includes(relativePath)) {
      violations.push(`Active runtime surface ${relativePath} must be documented in README.md or docs/current-capabilities-and-architecture.md.`);
    }
  }

  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = resolve(process.cwd());
  const violations = runDocDriftCheck(repoRoot);
  if (violations.length > 0) {
    console.error("doc drift check failed:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }
  console.log("doc drift check ok");
}

function runtimeSurfacePaths(repoRoot: string): string[] {
  return [
    ...listChildDirs(repoRoot, "apps"),
    ...listChildDirs(repoRoot, "services"),
    ...listChildDirs(repoRoot, "packages"),
  ];
}

function listChildDirs(repoRoot: string, parent: string): string[] {
  return readdirSync(join(repoRoot, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parent}/${entry.name}`)
    .sort();
}

function extractModulePaths(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/\b(?:apps|services|packages)\/[A-Za-z0-9._-]+\b/g)]
        .map((match) => match[0]),
    ),
  ];
}

function parseReadmeLayoutPaths(readme: string): string[] {
  const headerIndex = readme.indexOf("## Repository Layout");
  if (headerIndex < 0) return [];
  const afterHeader = readme.slice(headerIndex);
  const blockMatch = afterHeader.match(/```text\n([\s\S]*?)\n```/);
  if (!blockMatch?.[1]) return [];

  const paths: string[] = [];
  let currentRoot = "";
  for (const rawLine of blockMatch[1].split("\n")) {
    const content = rawLine.split("#")[0]?.replace(/\s+$/, "") ?? "";
    if (!content.trim()) continue;
    const trimmed = content.trim();
    if (!trimmed.endsWith("/")) continue;

    const relative = trimmed.slice(0, -1);
    if (!rawLine.startsWith(" ")) {
      currentRoot = relative;
      paths.push(relative);
      continue;
    }

    if (!currentRoot) continue;
    paths.push(`${currentRoot}/${relative}`);
  }
  return paths;
}
