export function isUniqueViolation(error: unknown): boolean {
  const code = errorCode(error) ?? errorCode(errorCause(error));
  return code === "23505";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

function errorCause(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
}
