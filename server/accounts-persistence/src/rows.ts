import {
  type AccountProfile,
  isSessionId,
  type SessionId,
  type StoredSession,
} from "@chess-one/accounts";
import {
  type AccountStatus,
  type CanonicalEmail,
  type CanonicalUsername,
  isAccountStatus,
  isCanonicalEmail,
  isCanonicalUsername,
  isUserId,
  type UserId,
} from "@chess-one/identity";
import { type RawBuilder, sql } from "kysely";
import { MalformedRow } from "./store-error.ts";

/** A `timestamptz` column as integer epoch milliseconds (pg returns `int8` as text). */
export function epochMs(column: string): RawBuilder<string> {
  return sql<string>`(extract(epoch from ${sql.ref(column)}) * 1000)::int8`;
}

export function millis(text: string, column: string): number {
  if (!/^-?(0|[1-9]\d*)$/.test(text)) throw new MalformedRow(column);
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new MalformedRow(column);
  return value;
}

export function userIdOf(value: string): UserId {
  if (!isUserId(value)) throw new MalformedRow("user_id");
  return value;
}

export function sessionIdOf(value: string): SessionId {
  if (!isSessionId(value)) throw new MalformedRow("session_id");
  return value;
}

export function statusOf(value: string): AccountStatus {
  if (!isAccountStatus(value)) throw new MalformedRow("status");
  return value;
}

export function flag(value: unknown, column: string): boolean {
  if (typeof value !== "boolean") throw new MalformedRow(column);
  return value;
}

export function canonicalIdentity(row: {
  readonly username_canonical: string;
  readonly email_canonical: string;
}): { readonly usernameCanonical: CanonicalUsername; readonly emailCanonical: CanonicalEmail } {
  const usernameCanonical = row.username_canonical;
  const emailCanonical = row.email_canonical;
  if (!isCanonicalUsername(usernameCanonical)) throw new MalformedRow("username_canonical");
  if (!isCanonicalEmail(emailCanonical)) throw new MalformedRow("email_canonical");
  return { usernameCanonical, emailCanonical };
}

export interface SessionRow {
  readonly session_id: string;
  readonly user_id: string;
  readonly created_ms: string;
  readonly last_seen_ms: string;
  readonly expires_ms: string;
  readonly revoked: boolean;
  readonly status: string;
}

export function storedSession(row: SessionRow | undefined): StoredSession | null {
  if (row === undefined) return null;
  return {
    sessionId: sessionIdOf(row.session_id),
    userId: userIdOf(row.user_id),
    createdAt: millis(row.created_ms, "created_at"),
    lastSeenAt: millis(row.last_seen_ms, "last_seen_at"),
    absoluteExpiresAt: millis(row.expires_ms, "absolute_expires_at"),
    revoked: flag(row.revoked, "revoked_at"),
    userStatus: statusOf(row.status),
  };
}

export interface ProfileRow {
  readonly user_id: string;
  readonly username: string;
  readonly username_canonical: string;
  readonly email: string;
  readonly email_canonical: string;
  readonly status: string;
  readonly email_verified: boolean;
}

export function accountProfile(row: ProfileRow | undefined): AccountProfile | null {
  if (row === undefined) return null;
  return {
    userId: userIdOf(row.user_id),
    username: row.username,
    ...canonicalIdentity(row),
    email: row.email,
    status: statusOf(row.status),
    emailVerified: flag(row.email_verified, "email_verified"),
  };
}
