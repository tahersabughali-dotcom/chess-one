import { randomUUID } from "node:crypto";
import {
  canAuthenticate,
  checkNewPassword,
  checkPasswordInput,
  isUserId,
  type PasswordContext,
  parseEmail,
  parseLoginIdentifier,
  parseUsername,
  type UserId,
} from "@chess-one/identity";
import type {
  AuthenticatedSession,
  AuthRequest,
  ChangePasswordError,
  InputField,
  InvalidInput,
  LoginError,
  Outcome,
  RegisterError,
  SignedIn,
} from "./api.ts";
import type { AccountsContext } from "./config.ts";
import type { LoginFailure } from "./facts.ts";
import { fail, ok, throttle } from "./guards.ts";
import type { LoginAccount } from "./ports.ts";
import { announceRevoked, prepareSession, sessionWindow } from "./sessions.ts";

/** Longest identifier worth parsing: the longest email address. */
const MAX_IDENTIFIER_LENGTH = 254;

function invalid(field: InputField, reason: string): InvalidInput {
  return { kind: "invalid_input", field, reason };
}

function newUserId(): UserId {
  const id = randomUUID();
  if (!isUserId(id)) throw new Error("randomUUID produced a malformed user id");
  return id;
}

/** A new password: policy first, then the breach screen (a no-op until one is configured). */
async function screenNewPassword(
  context: AccountsContext,
  password: string,
  identity: PasswordContext,
  field: "password" | "newPassword",
): Promise<InvalidInput | null> {
  const policy = checkNewPassword(password, identity);
  if (!policy.ok) return invalid(field, policy.reason);
  if (await context.screen.isCompromised(password)) return invalid(field, "compromised");
  return null;
}

export async function register(
  context: AccountsContext,
  input: { readonly username: string; readonly email: string; readonly password: string },
  request: AuthRequest,
): Promise<Outcome<SignedIn, RegisterError>> {
  const rejected = (error: RegisterError): Outcome<never, RegisterError> => {
    const reason =
      error.kind === "invalid_input" && error.reason === "compromised"
        ? "compromised_password"
        : error.kind;
    context.facts.record({ name: "registration_rejected", reason });
    return fail(error);
  };
  const limited =
    throttle(context, "client_address", request.clientAddress) ??
    throttle(context, "registration", request.clientAddress);
  if (limited !== null) return rejected(limited);
  const username = parseUsername(input.username);
  if (!username.ok) return rejected(invalid("username", username.reason));
  const email = parseEmail(input.email);
  if (!email.ok) return rejected(invalid("email", email.reason));
  const identity = { username: username.value.canonical, email: email.value.canonical };
  const weak = await screenNewPassword(context, input.password, identity, "password");
  if (weak !== null) return rejected(weak);
  const hashed = await context.hasher.hash(input.password);
  if (hashed.kind === "busy") return rejected(hashed);

  const userId = newUserId();
  const now = context.clock.now();
  const prepared = prepareSession(context, userId, now);
  const created = await context.repository.createAccount(
    {
      userId,
      username: username.value.display,
      usernameCanonical: username.value.canonical,
      email: email.value.display,
      emailCanonical: email.value.canonical,
      passwordHash: hashed.hash,
    },
    prepared.record,
    sessionWindow(context, now),
  );
  if (created.kind === "username_taken") return rejected({ kind: "username_unavailable" });
  if (created.kind === "email_taken") return rejected({ kind: "email_unavailable" });
  context.facts.record({ name: "registration_success", userId });
  context.facts.record({
    name: "session_created",
    userId,
    sessionId: prepared.issued.sessionId,
    cause: "registration",
  });
  return ok({
    session: prepared.issued,
    account: { userId, username: username.value.display, status: "active", emailVerified: false },
  });
}

/**
 * Upgrades an outdated hash after a successful login; a busy hasher just
 * defers it. Returns the hash the store should now hold for this login.
 */
async function rehash(
  context: AccountsContext,
  account: LoginAccount,
  stored: string,
  password: string,
): Promise<string> {
  const hashed = await context.hasher.hash(password);
  if (hashed.kind === "busy") return stored;
  if (!(await context.repository.replacePasswordHash(account.userId, stored, hashed.hash))) {
    return stored;
  }
  context.facts.record({ name: "password_rehashed", userId: account.userId });
  return hashed.hash;
}

/**
 * Login. An unknown identifier and a wrong password take the same path: the
 * same limiter, one Argon2id verification (against a dummy hash when there
 * is no account), and the same `invalid_credentials`. Account status is
 * revealed only to someone who proved the password.
 */
export async function login(
  context: AccountsContext,
  input: { readonly identifier: string; readonly password: string },
  request: AuthRequest,
): Promise<Outcome<SignedIn, LoginError>> {
  const identifier = parseLoginIdentifier(input.identifier);
  const identifierKind = identifier.kind;
  const failed = (error: LoginError, reason: LoginFailure): Outcome<never, LoginError> => {
    context.facts.record({ name: "login_failure", reason, identifierKind });
    return fail(error);
  };
  const limited = throttle(context, "client_address", request.clientAddress);
  if (limited !== null) return failed(limited, "rate_limited");
  if (input.identifier.length === 0 || input.identifier.length > MAX_IDENTIFIER_LENGTH) {
    return failed(invalid("identifier", "length"), "invalid_input");
  }
  const password = checkPasswordInput(input.password);
  if (!password.ok) return failed(invalid("password", password.reason), "invalid_input");
  const key = identifier.kind === "unknown" ? input.identifier.toLowerCase() : identifier.canonical;
  const keyLimited = throttle(context, "login_identifier", key);
  if (keyLimited !== null) return failed(keyLimited, "rate_limited");

  const account =
    identifier.kind === "unknown" ? null : await context.repository.findLoginAccount(identifier);
  const verified = await context.hasher.verify(input.password, account?.passwordHash ?? null);
  if (verified.kind === "busy") return failed(verified, "busy");
  if (account === null || account.passwordHash === null) {
    return failed({ kind: "invalid_credentials" }, "unknown_account");
  }
  if (verified.kind === "mismatch")
    return failed({ kind: "invalid_credentials" }, "wrong_password");
  if (!canAuthenticate(account.status)) {
    context.facts.record({
      name: "account_disabled_auth_attempt",
      userId: account.userId,
      status: account.status,
      via: "login",
    });
    return fail({ kind: "account_unavailable" });
  }
  const expected = verified.needsRehash
    ? await rehash(context, account, account.passwordHash, input.password)
    : account.passwordHash;

  const now = context.clock.now();
  const prepared = prepareSession(context, account.userId, now);
  const created = await context.repository.createSession(
    prepared.record,
    sessionWindow(context, now),
    expected,
  );
  if (created.kind === "stale") return failed({ kind: "invalid_credentials" }, "password_changed");
  announceRevoked(context, account.userId, created.evicted, "session_limit");
  const { sessionId } = prepared.issued;
  context.facts.record({ name: "login_success", userId: account.userId, sessionId });
  context.facts.record({
    name: "session_created",
    userId: account.userId,
    sessionId,
    cause: "login",
  });
  return ok({
    session: prepared.issued,
    account: {
      userId: account.userId,
      username: account.username,
      status: account.status,
      emailVerified: account.emailVerified,
    },
  });
}

/**
 * Changes the password of the signed-in user. The current password is
 * required even with a valid session, and the attempt is throttled per user,
 * so a stolen session cannot guess it quickly. On success every session of
 * the user is revoked, the current one included, and the current device
 * gets a new session in the same transaction (rotation).
 */
export async function changePassword(
  context: AccountsContext,
  session: AuthenticatedSession,
  input: { readonly currentPassword: string; readonly newPassword: string },
  request: AuthRequest,
): Promise<Outcome<SignedIn, ChangePasswordError>> {
  const { userId } = session;
  const failed = (
    error: ChangePasswordError,
    reason: "invalid_input" | "wrong_password" | "stale" | "rate_limited" | "busy",
  ): Outcome<never, ChangePasswordError> => {
    context.facts.record({ name: "password_change_failed", userId, reason });
    return fail(error);
  };
  const limited =
    throttle(context, "password_change", userId) ??
    throttle(context, "client_address", request.clientAddress);
  if (limited !== null) return failed(limited, "rate_limited");
  const current = checkPasswordInput(input.currentPassword);
  if (!current.ok) return failed(invalid("currentPassword", current.reason), "invalid_input");
  const profile = await context.repository.getProfile(userId);
  if (profile === null) return failed({ kind: "invalid_credentials" }, "wrong_password");
  const identity = { username: profile.usernameCanonical, email: profile.emailCanonical };
  const weak = await screenNewPassword(context, input.newPassword, identity, "newPassword");
  if (weak !== null) return failed(weak, "invalid_input");

  const stored = await context.repository.getPasswordHash(userId);
  const verified = await context.hasher.verify(input.currentPassword, stored);
  if (verified.kind === "busy") return failed(verified, "busy");
  if (stored === null || verified.kind !== "match") {
    return failed({ kind: "invalid_credentials" }, "wrong_password");
  }
  const hashed = await context.hasher.hash(input.newPassword);
  if (hashed.kind === "busy") return failed(hashed, "busy");

  const prepared = prepareSession(context, userId, context.clock.now());
  const changed = await context.repository.changePassword(
    userId,
    stored,
    hashed.hash,
    prepared.record,
  );
  if (changed.kind === "stale") return failed({ kind: "invalid_credentials" }, "stale");
  announceRevoked(context, userId, changed.revoked, "password_changed");
  context.facts.record({ name: "password_changed", userId });
  context.facts.record({
    name: "session_created",
    userId,
    sessionId: prepared.issued.sessionId,
    cause: "password_change",
  });
  return ok({
    session: prepared.issued,
    account: {
      userId,
      username: profile.username,
      status: profile.status,
      emailVerified: profile.emailVerified,
    },
  });
}
