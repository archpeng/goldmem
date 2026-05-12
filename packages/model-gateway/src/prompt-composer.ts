import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function composePrompt(input: {
  promptsDir: string;
  base: string;
  capabilities?: string[];
}): Promise<string> {
  const base = await readFile(join(input.promptsDir, input.base), "utf8");
  const capabilities = await Promise.all(
    (input.capabilities ?? []).map(async (capability) => {
      const content = await readFile(join(input.promptsDir, "capabilities", capability), "utf8");
      return `\n\n---\n\n${content.trim()}`;
    }),
  );
  return [base.trim(), ...capabilities].join("");
}
