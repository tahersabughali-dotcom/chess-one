/**
 * An infrastructure failure of the accounts store. It carries the operation
 * and a SQLSTATE or a malformed-column name, never a driver message, SQL
 * text, or stored value, so it is safe to report.
 */
export class AccountsStoreError extends Error {
  override readonly name = "AccountsStoreError";
  readonly operation: string;
  readonly detail: string;

  constructor(operation: string, detail: string) {
    super(`Accounts store operation ${operation} failed: ${detail}`);
    this.operation = operation;
    this.detail = detail;
  }
}

/** A value the database returned that the adapter cannot trust. */
export class MalformedRow extends Error {
  readonly column: string;

  constructor(column: string) {
    super(`malformed ${column}`);
    this.column = column;
  }
}

function sqlState(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const { code } = error;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/** The constraint a unique violation names; only the name, never the offending values. */
export function uniqueViolation(error: unknown): string | null {
  if (sqlState(error) !== "23505" || typeof error !== "object" || error === null) return null;
  if (!("constraint" in error)) return null;
  const { constraint } = error;
  return typeof constraint === "string" ? constraint : null;
}

export function storeError(operation: string, error: unknown): AccountsStoreError {
  if (error instanceof AccountsStoreError) return error;
  if (error instanceof MalformedRow) return new AccountsStoreError(operation, error.message);
  const code = sqlState(error);
  return new AccountsStoreError(operation, code === null ? "unexpected" : `sqlstate ${code}`);
}
