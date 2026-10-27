export function err_why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function err_stack(err: unknown): string {
  return err instanceof Error ? err.stack ?? String(err) : String(err);
}

export function err_code(err: unknown): string | undefined {
  return err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : undefined;
}
