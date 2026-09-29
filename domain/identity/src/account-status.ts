/**
 * `active` accounts may authenticate. `disabled` is an administrative stop;
 * `locked` is a security hold. Neither may authenticate, and neither is ever
 * entered automatically by failed login attempts.
 */
export type AccountStatus = "active" | "disabled" | "locked";

export const ACCOUNT_STATUSES: readonly AccountStatus[] = ["active", "disabled", "locked"];

export function isAccountStatus(value: string): value is AccountStatus {
  return value === "active" || value === "disabled" || value === "locked";
}

export function canAuthenticate(status: AccountStatus): boolean {
  return status === "active";
}
