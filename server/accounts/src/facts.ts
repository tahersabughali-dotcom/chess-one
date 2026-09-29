import type { AccountStatus, UserId } from "@chess-one/identity";
import type { RevocationReason } from "./ports.ts";
import type { SessionId } from "./tokens.ts";

export type AuthThrottleScope =
  | "client_address"
  | "registration"
  | "login_identifier"
  | "password_change"
  | "password_reset_request"
  | "email_verification_request";

export type RegistrationRejection =
  | "invalid_input"
  | "compromised_password"
  | "username_unavailable"
  | "email_unavailable"
  | "rate_limited"
  | "busy";

export type LoginFailure =
  | "invalid_input"
  | "unknown_account"
  | "wrong_password"
  | "password_changed"
  | "rate_limited"
  | "busy";

export type SessionRejection = "unknown" | "revoked" | "expired" | "idle";

/**
 * Security facts: ids, codes, and counts only. Never a password, token,
 * token digest, email address, username, or client address.
 */
export type AccountsFact =
  | { readonly name: "registration_success"; readonly userId: UserId }
  | { readonly name: "registration_rejected"; readonly reason: RegistrationRejection }
  | { readonly name: "login_success"; readonly userId: UserId; readonly sessionId: SessionId }
  | {
      readonly name: "login_failure";
      readonly reason: LoginFailure;
      readonly identifierKind: "email" | "username" | "unknown";
    }
  | {
      readonly name: "account_disabled_auth_attempt";
      readonly userId: UserId;
      readonly status: AccountStatus;
      readonly via: "login" | "session";
    }
  | {
      readonly name: "session_created";
      readonly userId: UserId;
      readonly sessionId: SessionId;
      readonly cause: "registration" | "login" | "password_change";
    }
  | {
      readonly name: "session_revoked";
      readonly userId: UserId;
      readonly sessionId: SessionId;
      readonly reason: RevocationReason;
    }
  | { readonly name: "session_rejected"; readonly reason: SessionRejection }
  | { readonly name: "password_rehashed"; readonly userId: UserId }
  | { readonly name: "password_changed"; readonly userId: UserId }
  | {
      readonly name: "password_change_failed";
      readonly userId: UserId;
      readonly reason: "invalid_input" | "wrong_password" | "stale" | "rate_limited" | "busy";
    }
  | { readonly name: "password_reset_requested"; readonly issued: boolean }
  | { readonly name: "password_reset_completed"; readonly userId: UserId }
  | { readonly name: "password_reset_rejected"; readonly reason: "invalid_token" | "invalid_input" }
  | { readonly name: "email_verification_requested"; readonly userId: UserId }
  | { readonly name: "email_verified"; readonly userId: UserId }
  | { readonly name: "email_verification_rejected" }
  | {
      readonly name: "account_status_changed";
      readonly userId: UserId;
      readonly status: AccountStatus;
    }
  | {
      readonly name: "token_delivery_failed";
      readonly purpose: "password_reset" | "email_verification";
    }
  | { readonly name: "auth_rate_limited"; readonly scope: AuthThrottleScope };

export interface AccountsFactSink {
  record(fact: AccountsFact): void;
}
