import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

type EvalCase = {
  id: string;
  input: {
    transcript?: string;
    query?: string;
  };
  expected: {
    eventTypes?: string[];
    riskLevels?: string[];
    requiresConfirmation?: boolean;
    answerMustNotInvent?: boolean;
    expectedEvidence?: string[];
  };
};

type EvalFailureType = "schema_fail" | "risk_miss" | "permission_leak" | "bad_recall" | "unsupported_claim";

type EvalFailure = {
  id: string;
  type: EvalFailureType;
  message: string;
};

const evalDir = process.env.MEM_EVAL_DIR ?? "evals";
const files = (await readdir(evalDir)).filter((file) => file.endsWith(".json")).sort();
const failures: EvalFailure[] = [];

for (const file of files) {
  const item = JSON.parse(await readFile(join(evalDir, file), "utf8")) as EvalCase;
  if (!item.id || (!item.input.transcript && !item.input.query)) {
    failures.push({ id: item.id ?? file, type: "schema_fail", message: "Eval case is missing id or input" });
  }
  if (item.expected.answerMustNotInvent && !item.input.query) {
    failures.push({
      id: item.id,
      type: "bad_recall",
      message: "answerMustNotInvent cases must include a query",
    });
  }
  if (
    item.expected.expectedEvidence &&
    (!item.input.query ||
      !Array.isArray(item.expected.expectedEvidence) ||
      item.expected.expectedEvidence.some((value) => typeof value !== "string" || value.length === 0))
  ) {
    failures.push({
      id: item.id,
      type: "bad_recall",
      message: "expectedEvidence cases must include a query and non-empty string evidence hints",
    });
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, cases: files.length }, null, 2));
