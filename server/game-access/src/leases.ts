import { randomBytes } from "node:crypto";
import { type ControlLeaseId, isControlLeaseId } from "@chess-one/live-game-runtime";

/** 256 bits from the CSPRNG as 43 characters of unpadded base64url. */
export const CONTROL_LEASE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** A fresh control lease: opaque, unguessable, generated here and nowhere else. */
export function newControlLease(): ControlLeaseId {
  const lease = randomBytes(32).toString("base64url");
  if (!CONTROL_LEASE_FORMAT.test(lease) || !isControlLeaseId(lease)) {
    throw new Error("The CSPRNG produced a malformed control lease");
  }
  return lease;
}
