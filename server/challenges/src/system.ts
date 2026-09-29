import { randomBytes, randomInt } from "node:crypto";
import {
  CHALLENGE_ID_FORMAT,
  type ChallengeId,
  type GameReference,
  isChallengeId,
  isGameReference,
  type SeatColor,
} from "@chess-one/challenge-domain";

/** A fresh challenge id: 128 bits from the CSPRNG, generated here and nowhere else. */
export function newChallengeId(): ChallengeId {
  const id = randomBytes(16).toString("base64url");
  if (!CHALLENGE_ID_FORMAT.test(id) || !isChallengeId(id)) {
    throw new Error("The CSPRNG produced a malformed challenge id");
  }
  return id;
}

/**
 * The id of an accepted challenge's game: 128 bits from the CSPRNG, drawn
 * once per acceptance reservation and stored with it.
 */
export function newGameReference(): GameReference {
  const id = randomBytes(16).toString("base64url");
  if (!isGameReference(id)) throw new Error("The CSPRNG produced a malformed game id");
  return id;
}

/** The challenger's colour for a `random` preference: an unbiased CSPRNG draw. */
export function secureSeatColor(): SeatColor {
  return randomInt(2) === 0 ? "white" : "black";
}
