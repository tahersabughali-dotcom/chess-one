/** The colour the challenger asks to play. The challenged player cannot change it. */
export type SeatPreference = "white" | "black" | "random";

export type SeatColor = "white" | "black";

export function isSeatPreference(value: string): value is SeatPreference {
  return value === "white" || value === "black" || value === "random";
}

export interface FinalSeats<T> {
  readonly white: T;
  readonly black: T;
}

/**
 * The final seats of the challenge's game. `drawChallengerColor` is asked
 * only for `random`, once, at acceptance; the server supplies an unbiased
 * CSPRNG draw, never a client value.
 */
export function resolveSeats<T>(
  preference: SeatPreference,
  challenger: T,
  challenged: T,
  drawChallengerColor: () => SeatColor,
): FinalSeats<T> {
  const color = preference === "random" ? drawChallengerColor() : preference;
  return Object.freeze(
    color === "white"
      ? { white: challenger, black: challenged }
      : { white: challenged, black: challenger },
  );
}
