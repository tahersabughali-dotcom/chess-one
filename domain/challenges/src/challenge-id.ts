declare const challengeIdBrand: unique symbol;
declare const gameReferenceBrand: unique symbol;

/**
 * The id of one direct challenge: 128 bits from the server's CSPRNG as 22
 * characters of unpadded base64url. Opaque; never derived from a user or a
 * time, never chosen by a client.
 */
export type ChallengeId = string & { readonly [challengeIdBrand]: true };

export const CHALLENGE_ID_FORMAT = /^[A-Za-z0-9_-]{22}$/;

export function isChallengeId(value: string): value is ChallengeId {
  return CHALLENGE_ID_FORMAT.test(value);
}

/**
 * The live game an accepted challenge created, in the live game's stable id
 * syntax. The challenge only stores and shows it; it never creates or reads
 * the game.
 */
export type GameReference = string & { readonly [gameReferenceBrand]: true };

const GAME_REFERENCE_FORMAT = /^[A-Za-z0-9._:-]{1,128}$/;

export function isGameReference(value: string): value is GameReference {
  return GAME_REFERENCE_FORMAT.test(value);
}
