import { checkNewPassword, checkPasswordInput, parseEmail } from "@chess-one/identity";
import type {
  AuthenticatedSession,
  AuthRequest,
  Outcome,
  ResetPasswordError,
  ResetRequestError,
  VerificationError,
  VerificationRequestError,
} from "./api.ts";
import type { AccountsContext } from "./config.ts";
import type { AccountTokenDelivery, TokenDelivery } from "./extensions.ts";
import { fail, ok, throttle } from "./guards.ts";
import { announceRevoked } from "./sessions.ts";
import { isSecretToken, newSecretToken, tokenDigest } from "./tokens.ts";

/**
 * A delivery failure is reported, never surfaced: the caller's answer must
 * not depend on whether an account exists.
 */
async function deliver(
  context: AccountsContext,
  delivery: AccountTokenDelivery,
  message: TokenDelivery,
): Promise<void> {
  try {
    await delivery.deliver(message);
  } catch (error: unknown) {
    context.reportDefect(error);
    context.facts.record({ name: "token_delivery_failed", purpose: message.purpose });
  }
}

/**
 * Starts a password reset. The answer is `accepted` for every well-formed
 * address; only an active account with that address gets a token (single
 * use, 30 minutes, stored as a digest; earlier unused reset tokens of the
 * account are deleted).
 */
export async function requestPasswordReset(
  context: AccountsContext,
  input: { readonly email: string },
  request: AuthRequest,
): Promise<Outcome<null, ResetRequestError>> {
  const { delivery } = context;
  if (delivery === null) return fail({ kind: "feature_unavailable" });
  const limited = throttle(context, "client_address", request.clientAddress);
  if (limited !== null) return fail(limited);
  const email = parseEmail(input.email);
  if (!email.ok) return fail({ kind: "invalid_input", field: "email", reason: email.reason });
  const keyLimited = throttle(context, "password_reset_request", email.value.canonical);
  if (keyLimited !== null) return fail(keyLimited);

  const account = await context.repository.findActiveAccountByEmail(email.value.canonical);
  context.facts.record({ name: "password_reset_requested", issued: account !== null });
  if (account === null) return ok(null);
  const token = newSecretToken();
  const now = context.clock.now();
  const expiresAt = now + context.tokens.passwordResetTtlMs;
  await context.repository.issueActionToken({
    tokenHash: tokenDigest("password_reset", token),
    userId: account.userId,
    purpose: "password_reset",
    emailCanonical: account.emailCanonical,
    createdAt: now,
    expiresAt,
  });
  await deliver(context, delivery, {
    purpose: "password_reset",
    userId: account.userId,
    email: account.email,
    token,
    expiresAt,
  });
  return ok(null);
}

/**
 * Completes a reset: the token is consumed, the password replaced, and every
 * session revoked, in one transaction. No session is created; the user signs
 * in with the new password.
 */
export async function resetPassword(
  context: AccountsContext,
  input: { readonly token: string; readonly newPassword: string },
  request: AuthRequest,
): Promise<Outcome<null, ResetPasswordError>> {
  if (context.delivery === null) return fail({ kind: "feature_unavailable" });
  const limited = throttle(context, "client_address", request.clientAddress);
  if (limited !== null) return fail(limited);
  const rejected = (reason: "invalid_token" | "invalid_input"): void =>
    context.facts.record({ name: "password_reset_rejected", reason });
  const shape = checkPasswordInput(input.newPassword);
  if (!shape.ok) {
    rejected("invalid_input");
    return fail({ kind: "invalid_input", field: "newPassword", reason: shape.reason });
  }
  if (!isSecretToken(input.token)) {
    rejected("invalid_token");
    return fail({ kind: "invalid_token" });
  }
  const digest = tokenDigest("password_reset", input.token);
  const now = context.clock.now();
  const pending = await context.repository.findActionToken(digest, "password_reset", now);
  if (pending === null) {
    rejected("invalid_token");
    return fail({ kind: "invalid_token" });
  }
  const policy = checkNewPassword(input.newPassword, {
    username: pending.usernameCanonical,
    email: pending.emailCanonical,
  });
  const compromised = policy.ok && (await context.screen.isCompromised(input.newPassword));
  if (!policy.ok || compromised) {
    rejected("invalid_input");
    const reason = policy.ok ? "compromised" : policy.reason;
    return fail({ kind: "invalid_input", field: "newPassword", reason });
  }
  const hashed = await context.hasher.hash(input.newPassword);
  if (hashed.kind === "busy") return fail(hashed);
  const consumed = await context.repository.consumePasswordReset(digest, now, hashed.hash);
  if (consumed.kind === "invalid") {
    rejected("invalid_token");
    return fail({ kind: "invalid_token" });
  }
  announceRevoked(context, consumed.userId, consumed.revoked, "password_reset");
  context.facts.record({ name: "password_reset_completed", userId: consumed.userId });
  return ok(null);
}

/** Sends a verification token (single use, 24 hours) to the account's current address. */
export async function requestEmailVerification(
  context: AccountsContext,
  session: AuthenticatedSession,
): Promise<Outcome<null, VerificationRequestError>> {
  const { delivery } = context;
  if (delivery === null) return fail({ kind: "feature_unavailable" });
  const limited = throttle(context, "email_verification_request", session.userId);
  if (limited !== null) return fail(limited);
  const profile = await context.repository.getProfile(session.userId);
  if (profile === null) throw new Error("An authenticated session has no account");
  if (profile.emailVerified) return fail({ kind: "already_verified" });
  const token = newSecretToken();
  const now = context.clock.now();
  const expiresAt = now + context.tokens.emailVerificationTtlMs;
  await context.repository.issueActionToken({
    tokenHash: tokenDigest("email_verification", token),
    userId: profile.userId,
    purpose: "email_verification",
    emailCanonical: profile.emailCanonical,
    createdAt: now,
    expiresAt,
  });
  context.facts.record({ name: "email_verification_requested", userId: profile.userId });
  await deliver(context, delivery, {
    purpose: "email_verification",
    userId: profile.userId,
    email: profile.email,
    token,
    expiresAt,
  });
  return ok(null);
}

export async function confirmEmailVerification(
  context: AccountsContext,
  input: { readonly token: string },
  request: AuthRequest,
): Promise<Outcome<null, VerificationError>> {
  if (context.delivery === null) return fail({ kind: "feature_unavailable" });
  const limited = throttle(context, "client_address", request.clientAddress);
  if (limited !== null) return fail(limited);
  const consumed = isSecretToken(input.token)
    ? await context.repository.consumeEmailVerification(
        tokenDigest("email_verification", input.token),
        context.clock.now(),
      )
    : null;
  if (consumed === null || consumed.kind === "invalid") {
    context.facts.record({ name: "email_verification_rejected" });
    return fail({ kind: "invalid_token" });
  }
  context.facts.record({ name: "email_verified", userId: consumed.userId });
  return ok(null);
}
