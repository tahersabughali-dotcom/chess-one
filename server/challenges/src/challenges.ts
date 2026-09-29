import {
  AttemptLimiter,
  type AuthenticatedSession,
  type Outcome,
  type PlayerRecord,
} from "@chess-one/accounts";
import {
  CHALLENGE_POLICY,
  type Challenge,
  type ChallengeId,
  completeAcceptance,
  DEFAULT_CHALLENGE_RULESET_ID,
  decide,
  decideAcceptance,
  effectiveChallenge,
  encodeChallengeCursor,
  failAcceptance,
  isChallengeDirection,
  isChallengeId,
  isSeatPreference,
  newChallenge,
  parseChallengeCursor,
  parseChallengeRuleset,
  parseTimeControlRequest,
  reserveAcceptance,
  resolvePageSize,
  roleOf,
} from "@chess-one/challenge-domain";
import { canonicalLoginUsername, type UserId } from "@chess-one/identity";
import type {
  AcceptingReconciliation,
  ChallengeAcceptance,
  ChallengeApi,
  ChallengeError,
  ChallengePage,
  ChallengeView,
  CreateChallengeInput,
  ListChallengesInput,
} from "./api.ts";
import {
  type ChallengesConfig,
  type ResolvedChallengesConfig,
  resolveChallengesConfig,
} from "./config.ts";
import type {
  ChallengeAcceptFailure,
  ChallengeAcceptPending,
  ChallengeAcceptRefusal,
  ChallengeActionRefusal,
  ChallengeCreateRejection,
  ChallengeReconcileVia,
} from "./facts.ts";
import {
  type AcceptingCursor,
  type ChallengeGameCheck,
  type ChallengeGameCreation,
  type ChallengeGameSpec,
  type ChallengeListing,
  ChallengeStoreError,
} from "./ports.ts";
import { KeyedSerializer } from "./serializer.ts";
import { newChallengeId, newGameReference, secureSeatColor } from "./system.ts";
import { challengeView } from "./view.ts";

type Stored<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function failure<T>(error: ChallengeError): Outcome<T, ChallengeError> {
  return { ok: false, error };
}

function success<T>(value: T): Outcome<T, ChallengeError> {
  return { ok: true, value };
}

const UNAVAILABLE: ChallengeError = Object.freeze({ kind: "temporarily_unavailable" });
const ACCEPT_FAILED: ChallengeError = Object.freeze({ kind: "challenge_accept_failed" });
const UNCONFIRMED: ChallengeGameCreation = Object.freeze({ kind: "unconfirmed" });
const UNKNOWN: ChallengeGameCheck = "unknown";

/** The most accepting challenges one reconciliation pass examines. */
const MAX_RECONCILE_BATCH = 100;

/** How one settlement of an accepting challenge ended. */
type Settled =
  | { readonly kind: "accepted"; readonly challenge: Challenge }
  | {
      readonly kind: "processing";
      readonly cause: ChallengeAcceptPending;
      readonly challenge: Challenge;
    }
  | { readonly kind: "failed" };

type Reconciled =
  | { readonly kind: "settled"; readonly listing: ChallengeListing; readonly settled: Settled }
  | { readonly kind: "not_accepting" }
  | { readonly kind: "unavailable" };

const FAILED: Settled = Object.freeze({ kind: "failed" });
const NOT_ACCEPTING: Reconciled = Object.freeze({ kind: "not_accepting" });
const UNREACHABLE: Reconciled = Object.freeze({ kind: "unavailable" });
const SETTLED_ANSWER: Readonly<
  Record<Settled["kind"], "accepted" | "processing" | "accept_failed">
> = Object.freeze({ accepted: "accepted", processing: "processing", failed: "accept_failed" });

/**
 * Direct challenges between registered players: create, read, list, accept,
 * decline, cancel, and expiry. Every decision is the domain state machine's;
 * the store makes each transition a compare-and-set so concurrent requests
 * have one winner. It knows no HTTP or SQL, and reaches games only through
 * the trusted game creator.
 */
export class Challenges implements ChallengeApi {
  readonly #config: ResolvedChallengesConfig;
  readonly #limiter: AttemptLimiter;
  readonly #settling = new KeyedSerializer<ChallengeId>();

  constructor(config: ChallengesConfig) {
    this.#config = resolveChallengesConfig(config);
    this.#limiter = new AttemptLimiter(this.#config.rateLimit, this.#config.maxRateLimitKeys);
  }

  async create(
    session: AuthenticatedSession,
    input: CreateChallengeInput,
  ): Promise<Outcome<ChallengeView, ChallengeError>> {
    const { clock, players, store, eligibility } = this.#config;
    const now = clock.now();
    const throttle = this.#limiter.take(session.userId, now);
    if (!throttle.allowed) {
      return this.#refuseCreate("rate_limited", {
        kind: "rate_limited",
        retryAfterMs: throttle.retryAfterMs,
      });
    }
    const seatPreference = input.seatPreference;
    if (!isSeatPreference(seatPreference)) {
      return this.#refuseCreate("invalid_input", { kind: "invalid_seat_preference" });
    }
    const { type, initialMs, incrementMs } = input.timeControl;
    const timeControl = parseTimeControlRequest(type, initialMs, incrementMs);
    if (timeControl === null) {
      return this.#refuseCreate("invalid_input", { kind: "invalid_time_control" });
    }
    const rulesetId =
      input.rulesetId === null
        ? DEFAULT_CHALLENGE_RULESET_ID
        : parseChallengeRuleset(input.rulesetId);
    if (rulesetId === null) return this.#refuseCreate("invalid_input", { kind: "invalid_ruleset" });
    const username = canonicalLoginUsername(input.opponentUsername);
    if (username === null) {
      return this.#refuseCreate("player_not_found", { kind: "player_not_found" });
    }

    const challenger = await players.findPlayerById(session.userId);
    if (challenger === null || challenger.status !== "active") {
      return this.#refuseCreate("account_unavailable", { kind: "account_unavailable" });
    }
    const opponent = await players.findPlayerByUsername(username);
    if (opponent === null) {
      return this.#refuseCreate("player_not_found", { kind: "player_not_found" });
    }
    if (opponent.userId === challenger.userId) {
      return this.#refuseCreate("same_player", { kind: "cannot_challenge_self" });
    }
    if (opponent.status !== "active") {
      return this.#refuseCreate("player_unavailable", { kind: "player_unavailable" });
    }
    const eligible = eligibility.check(challenger, opponent);
    if (eligible === "challenger_ineligible") {
      return this.#refuseCreate("account_unavailable", { kind: "account_unavailable" });
    }
    if (eligible === "opponent_ineligible") {
      return this.#refuseCreate("player_unavailable", { kind: "player_unavailable" });
    }

    const created = newChallenge({
      challengeId: newChallengeId(),
      challengerUserId: challenger.userId,
      challengedUserId: opponent.userId,
      rulesetId,
      timeControl,
      seatPreference,
      now,
    });
    if (!created.ok) {
      this.#config.reportDefect(new Error(`Challenge construction refused: ${created.reason}`));
      return this.#refuseCreate("store_unavailable", UNAVAILABLE);
    }
    const { challenge } = created;
    const stored = await this.#stored(() =>
      store.create(challenge, {
        maxOutgoingPending: CHALLENGE_POLICY.maxOutgoingPending,
        maxIncomingPending: CHALLENGE_POLICY.maxIncomingPending,
      }),
    );
    if (!stored.ok) return this.#refuseCreate("store_unavailable", UNAVAILABLE);
    switch (stored.value) {
      case "pair_pending":
        return this.#refuseCreate("already_pending", { kind: "challenge_already_pending" });
      case "outgoing_limit":
        return this.#refuseCreate("outgoing_limit", { kind: "challenge_limit_reached" });
      case "incoming_limit":
        return this.#refuseCreate("incoming_limit", { kind: "player_unavailable" });
      case "created":
        this.#config.facts.record({
          name: "challenge_created",
          challengeId: challenge.challengeId,
        });
        return success(
          challengeView(listingOf(challenge, challenger, opponent), challenge, "challenger"),
        );
    }
  }

  async get(
    session: AuthenticatedSession,
    challengeId: string,
  ): Promise<Outcome<ChallengeView, ChallengeError>> {
    if (!isChallengeId(challengeId)) return failure({ kind: "challenge_not_found" });
    const found = await this.#stored(() => this.#config.store.find(challengeId));
    if (!found.ok) return failure(UNAVAILABLE);
    const listing = found.value;
    const role = listing === null ? null : roleOf(listing.challenge, session.userId);
    if (listing === null || role === null) return failure({ kind: "challenge_not_found" });
    const now = this.#config.clock.now();
    return success(challengeView(listing, effectiveChallenge(listing.challenge, now), role));
  }

  async list(
    session: AuthenticatedSession,
    input: ListChallengesInput,
  ): Promise<Outcome<ChallengePage, ChallengeError>> {
    const { direction } = input;
    const after = input.cursor === null ? null : parseChallengeCursor(input.cursor);
    const size = resolvePageSize(input.limit);
    if (!isChallengeDirection(direction) || (input.cursor !== null && after === null)) {
      return failure({ kind: "invalid_request" });
    }
    if (size === null) return failure({ kind: "invalid_request" });
    const role = direction === "incoming" ? "challenged" : "challenger";
    const found = await this.#stored(() =>
      this.#config.store.listPending({
        userId: session.userId,
        direction,
        now: this.#config.clock.now(),
        after,
        limit: size + 1,
      }),
    );
    if (!found.ok) return failure(UNAVAILABLE);
    const page = found.value.slice(0, size);
    const last = page.at(-1);
    return success(
      Object.freeze({
        direction,
        challenges: Object.freeze(
          page.map((listing) => challengeView(listing, listing.challenge, role)),
        ),
        nextCursor:
          found.value.length > size && last !== undefined
            ? encodeChallengeCursor({
                createdAt: last.challenge.createdAt,
                challengeId: last.challenge.challengeId,
              })
            : null,
      }),
    );
  }

  /**
   * Only the challenged player accepts. The first accept revalidates both
   * accounts and reserves the acceptance durably (`accepting`: the game id
   * and the final seats, each drawn once) with a compare-and-set on the
   * pending, unexpired row, so accept, decline, cancel, and expiry have one
   * winner. Every accept then creates or finds that same game, and the
   * challenge becomes `accepted` only once the game is proven to exist, or
   * `accept_failed` once it is proven it never will (answered
   * `challenge_accept_failed`, never why). Until then the answer is
   * `processing`, and a retry runs the same reconciliation as maintenance.
   */
  async accept(
    session: AuthenticatedSession,
    challengeId: string,
  ): Promise<Outcome<ChallengeAcceptance, ChallengeError>> {
    const refuse = (
      reason: ChallengeAcceptRefusal,
      error: ChallengeError,
    ): Outcome<ChallengeAcceptance, ChallengeError> => {
      this.#config.facts.record({ name: "challenge_accept_refused", reason });
      return failure(error);
    };
    if (!isChallengeId(challengeId)) return refuse("not_found", { kind: "challenge_not_found" });
    const { store, clock } = this.#config;
    const actor = await this.#player(session.userId);
    if (actor === "unavailable") return refuse("store_unavailable", UNAVAILABLE);
    if (actor === null || actor.status !== "active") {
      return refuse("account_unavailable", { kind: "account_unavailable" });
    }
    const now = clock.now();
    /** A lost compare-and-set means the row left `pending`, so the second read decides. */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const found = await this.#stored(() => store.find(challengeId));
      if (!found.ok) return refuse("store_unavailable", UNAVAILABLE);
      const listing = found.value;
      if (listing === null) return refuse("not_found", { kind: "challenge_not_found" });
      const decision = decideAcceptance(listing.challenge, session.userId, now);
      switch (decision.kind) {
        case "refused":
          if (decision.reason === "not_participant") {
            return refuse("not_found", { kind: "challenge_not_found" });
          }
          if (decision.reason === "wrong_role") {
            return refuse("wrong_role", { kind: "not_challenge_participant" });
          }
          return effectiveChallenge(listing.challenge, now).status === "expired"
            ? refuse("expired", { kind: "challenge_expired" })
            : refuse("not_pending", { kind: "challenge_not_pending" });
        case "expired": {
          const expired = await this.#stored(() => store.expire(challengeId, now));
          if (!expired.ok) return refuse("store_unavailable", UNAVAILABLE);
          if (!expired.value) continue;
          this.#config.facts.record({ name: "challenge_expired", challengeId, via: "accept" });
          return refuse("expired", { kind: "challenge_expired" });
        }
        case "accepted":
          return success(await this.#accepted(listing, decision.challenge));
        case "failed":
          return refuse("accept_failed", ACCEPT_FAILED);
        case "continue":
          return this.#answer(await this.#reconcile(challengeId, "request"), refuse);
        case "reserve": {
          const challenger = await this.#player(listing.challenge.challengerUserId);
          if (challenger === "unavailable") return refuse("store_unavailable", UNAVAILABLE);
          if (challenger === null || challenger.status !== "active") {
            return refuse("player_unavailable", { kind: "player_unavailable" });
          }
          const eligible = this.#config.eligibility.check(challenger, actor);
          if (eligible === "challenger_ineligible") {
            return refuse("player_unavailable", { kind: "player_unavailable" });
          }
          if (eligible === "opponent_ineligible") {
            return refuse("account_unavailable", { kind: "account_unavailable" });
          }
          const next = reserveAcceptance(listing.challenge, {
            now,
            gameId: newGameReference(),
            drawChallengerColor: secureSeatColor,
          });
          const reserved = await this.#stored(() => store.reserveAcceptance(next, now));
          if (!reserved.ok) return refuse("store_unavailable", UNAVAILABLE);
          if (!reserved.value) continue;
          this.#config.facts.record({ name: "challenge_accept_reserved", challengeId });
          const settled = await this.#settling.run(challengeId, () => this.#settle(next, "fresh"));
          return this.#answer({ kind: "settled", listing, settled }, refuse);
        }
      }
    }
    this.#config.reportDefect(new Error("A challenge acceptance compare-and-set failed twice"));
    return refuse("store_unavailable", UNAVAILABLE);
  }

  /**
   * Maintenance hook for one `accepting` challenge: the same reconciliation
   * an accept retry runs. An accepted or failed challenge answers as it is,
   * changing nothing. No session: a trusted caller only.
   */
  async reconcileAcceptingChallenge(
    challengeId: string,
  ): Promise<"accepted" | "processing" | "accept_failed" | "not_accepting" | "unavailable"> {
    if (!isChallengeId(challengeId)) return "not_accepting";
    const reconciled = await this.#reconcile(challengeId, "maintenance");
    if (reconciled.kind !== "settled") return reconciled.kind;
    return SETTLED_ANSWER[reconciled.settled.kind];
  }

  /**
   * Maintenance, for a future scheduler (none runs yet): reconciles up to
   * `limit` accepting challenges after `after`, oldest reservation first,
   * one at a time. Idempotent and safe beside accept retries and other
   * passes: each challenge is settled under its own serialisation, every
   * write is a compare-and-set, and the game id is always the reserved one.
   * No challenge fails for its age: only on proof. Pass `next` back to
   * continue; a challenge still processing is met again on a later pass.
   */
  async reconcileAcceptingChallenges(
    limit: number,
    after: AcceptingCursor | null = null,
  ): Promise<AcceptingReconciliation> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECONCILE_BATCH) {
      throw new RangeError(
        `The reconciliation limit must be an integer from 1 to ${MAX_RECONCILE_BATCH}`,
      );
    }
    const found = await this.#stored(() => this.#config.store.listAccepting({ after, limit }));
    if (!found.ok) {
      this.#config.facts.record({
        name: "challenge_accept_reconcile_unavailable",
        challengeId: null,
        via: "maintenance",
        cause: "store_unavailable",
      });
      return Object.freeze({
        listed: false,
        examined: 0,
        accepted: 0,
        failed: 0,
        processing: 0,
        next: after,
      });
    }
    const counts = { accepted: 0, failed: 0, processing: 0 };
    for (const listing of found.value) {
      const reconciled = await this.#reconcile(listing.challenge.challengeId, "maintenance");
      if (reconciled.kind !== "settled") {
        if (reconciled.kind === "unavailable") counts.processing += 1;
        continue;
      }
      const { kind } = reconciled.settled;
      if (kind === "accepted") counts.accepted += 1;
      else if (kind === "failed") counts.failed += 1;
      else counts.processing += 1;
    }
    const last = found.value.at(-1)?.challenge;
    const reservation = last?.acceptance ?? null;
    return Object.freeze({
      listed: true,
      examined: found.value.length,
      ...counts,
      next:
        found.value.length === limit && last !== undefined && reservation !== null
          ? Object.freeze({ acceptedAt: reservation.acceptedAt, challengeId: last.challengeId })
          : null,
    });
  }

  /**
   * Re-reads the challenge under its serialisation and settles it if it is
   * still accepting; an accepted or failed one is answered as stored.
   */
  #reconcile(challengeId: ChallengeId, via: ChallengeReconcileVia): Promise<Reconciled> {
    return this.#settling.run(challengeId, async (): Promise<Reconciled> => {
      const { facts } = this.#config;
      const found = await this.#stored(() => this.#config.store.find(challengeId));
      if (!found.ok) {
        facts.record({
          name: "challenge_accept_reconcile_unavailable",
          challengeId,
          via,
          cause: "store_unavailable",
        });
        return UNREACHABLE;
      }
      const listing = found.value;
      if (listing === null) return NOT_ACCEPTING;
      const { challenge } = listing;
      if (challenge.status === "accepted") {
        return { kind: "settled", listing, settled: { kind: "accepted", challenge } };
      }
      if (challenge.status === "accept_failed")
        return { kind: "settled", listing, settled: FAILED };
      if (challenge.status !== "accepting") return NOT_ACCEPTING;
      facts.record({ name: "challenge_accept_reconcile_started", challengeId, via });
      const settled = await this.#settle(challenge, via);
      if (settled.kind === "processing") {
        facts.record({
          name: "challenge_accept_reconcile_unavailable",
          challengeId,
          via,
          cause: settled.cause,
        });
      } else {
        facts.record({
          name: "challenge_accept_reconciled",
          challengeId,
          via,
          outcome: settled.kind === "accepted" ? "accepted" : "accept_failed",
        });
      }
      return { kind: "settled", listing, settled };
    });
  }

  /** The accept answer for a settled (or unreachable) acceptance. */
  async #answer(
    reconciled: Reconciled,
    refuse: (
      reason: ChallengeAcceptRefusal,
      error: ChallengeError,
    ) => Outcome<ChallengeAcceptance, ChallengeError>,
  ): Promise<Outcome<ChallengeAcceptance, ChallengeError>> {
    if (reconciled.kind === "unavailable") return refuse("store_unavailable", UNAVAILABLE);
    if (reconciled.kind === "not_accepting") {
      this.#config.reportDefect(new Error("A reserved challenge left its acceptance states"));
      return refuse("store_unavailable", UNAVAILABLE);
    }
    const { listing, settled } = reconciled;
    switch (settled.kind) {
      case "accepted":
        return success(await this.#accepted(listing, settled.challenge));
      case "processing":
        return success(
          Object.freeze({
            challenge: challengeView(listing, settled.challenge, "challenged"),
            game: null,
          }),
        );
      case "failed":
        return refuse("accept_failed", ACCEPT_FAILED);
    }
  }

  /**
   * Settles an `accepting` challenge on proof only, always with its reserved
   * game id, seats, and settings. A fresh reservation creates first (both
   * accounts were just checked); a retry or reconciliation checks first, so
   * a game already created is found, never created again. Then:
   * - the game matches the reservation: `accepted`, whatever has happened to
   *   the accounts since (an accepted history is never rewritten);
   * - the game is surely absent: both participants are read again; either
   *   one ineligible (for any account reason, never told apart) fails the
   *   acceptance, both eligible create the same game again;
   * - a creation refused for a participant, with the game proven absent:
   *   `accept_failed`;
   * - another game holds the id: a defect, `accept_failed`, never a second id;
   * - anything unproven (a check, an account read, the final write): still
   *   `accepting`. Nothing fails for its age.
   * The caller holds the challenge's serialisation.
   */
  async #settle(accepting: Challenge, attempt: "fresh" | ChallengeReconcileVia): Promise<Settled> {
    const { challengeId, acceptance } = accepting;
    if (acceptance === null) throw new Error("An accepting challenge has no reservation");
    const spec: ChallengeGameSpec = Object.freeze({
      gameId: acceptance.gameId,
      white: acceptance.white,
      black: acceptance.black,
      rulesetId: accepting.rulesetId,
      timeControl: accepting.timeControl,
      startDeadlineAt: acceptance.startDeadlineAt,
    });
    const processing = (cause: ChallengeAcceptPending): Settled => {
      this.#config.facts.record({ name: "challenge_accept_processing", challengeId, cause });
      return Object.freeze({ kind: "processing", cause, challenge: accepting });
    };
    const create = () => this.#game(() => this.#config.games.create(spec), UNCONFIRMED);
    const check = () => this.#game(() => this.#config.games.check(spec), UNKNOWN);
    const found = (existing: Exclude<ChallengeGameCheck, "absent">): Promise<Settled> => {
      switch (existing) {
        case "matches":
          return this.#complete(accepting, attempt, processing);
        case "mismatch":
          this.#config.reportDefect(new Error("A reserved challenge game id holds another game"));
          return this.#fail(accepting, "game_mismatch", processing);
        case "unknown":
          return Promise.resolve(processing("creation_unconfirmed"));
      }
    };

    let created: ChallengeGameCreation;
    if (attempt === "fresh") {
      created = await create();
    } else {
      const existing = await check();
      if (existing !== "absent") return found(existing);
      const eligible = await this.#participantsEligible(accepting);
      if (eligible === "unavailable") return processing("eligibility_unavailable");
      if (eligible === "ineligible") {
        return this.#fail(accepting, "participant_unavailable", processing);
      }
      created = await create();
    }
    if (created.kind === "created") return this.#complete(accepting, attempt, processing);
    const after = await check();
    if (after !== "absent") return found(after);
    return created.kind === "refused"
      ? this.#fail(accepting, "participant_unavailable", processing)
      : processing("game_absent");
  }

  /** Both participants still exist, are active, and pass the eligibility policy. */
  async #participantsEligible(
    challenge: Challenge,
  ): Promise<"eligible" | "ineligible" | "unavailable"> {
    const challenger = await this.#player(challenge.challengerUserId);
    const challenged = await this.#player(challenge.challengedUserId);
    if (challenger === "unavailable" || challenged === "unavailable") return "unavailable";
    if (challenger === null || challenged === null) return "ineligible";
    if (challenger.status !== "active" || challenged.status !== "active") return "ineligible";
    return this.#config.eligibility.check(challenger, challenged) === "eligible"
      ? "eligible"
      : "ineligible";
  }

  /** `accepting` to `accepted`: the reserved game is proven to exist. */
  async #complete(
    accepting: Challenge,
    attempt: "fresh" | ChallengeReconcileVia,
    processing: (cause: ChallengeAcceptPending) => Settled,
  ): Promise<Settled> {
    const next = completeAcceptance(accepting);
    const completed = await this.#stored(() => this.#config.store.completeAcceptance(next));
    if (!completed.ok) return processing("completion_failed");
    if (!completed.value) return this.#settledElsewhere(accepting, "complete", processing);
    this.#config.facts.record({
      name: "challenge_accepted",
      challengeId: accepting.challengeId,
      via: attempt === "maintenance" ? "reconcile" : "request",
    });
    return Object.freeze({ kind: "accepted", challenge: next });
  }

  /** `accepting` to `accept_failed`: the reserved game is proven never to exist as reserved. */
  async #fail(
    accepting: Challenge,
    reason: ChallengeAcceptFailure,
    processing: (cause: ChallengeAcceptPending) => Settled,
  ): Promise<Settled> {
    const next = failAcceptance(accepting, this.#config.clock.now());
    const failed = await this.#stored(() => this.#config.store.failAcceptance(next));
    if (!failed.ok) return processing("completion_failed");
    if (!failed.value) return this.#settledElsewhere(accepting, "fail", processing);
    this.#config.facts.record({
      name: "challenge_accept_failed",
      challengeId: accepting.challengeId,
      reason,
    });
    return FAILED;
  }

  /**
   * A lost final compare-and-set: another process settled the challenge
   * first, so the stored outcome stands. One that failed while this process
   * proved its game exists is reported (the orphan game can never start and
   * is aborted at its start deadline).
   */
  async #settledElsewhere(
    accepting: Challenge,
    writing: "complete" | "fail",
    processing: (cause: ChallengeAcceptPending) => Settled,
  ): Promise<Settled> {
    const gameId = accepting.acceptance?.gameId;
    const again = await this.#stored(() => this.#config.store.find(accepting.challengeId));
    const stored = again.ok ? again.value?.challenge : undefined;
    if (stored?.status === "accepted" && stored.createdGameId === gameId) {
      return Object.freeze({ kind: "accepted", challenge: stored });
    }
    if (stored?.status === "accept_failed" && stored.acceptance?.gameId === gameId) {
      if (writing === "complete") {
        this.#config.reportDefect(new Error("A challenge whose game exists failed elsewhere"));
      }
      return FAILED;
    }
    this.#config.reportDefect(new Error("An accepting challenge left accepting elsewhere"));
    return processing("completion_failed");
  }

  /** An accepted challenge as its challenged player sees it, with its game's current lifecycle. */
  async #accepted(listing: ChallengeListing, accepted: Challenge): Promise<ChallengeAcceptance> {
    const { acceptance, createdGameId } = accepted;
    if (acceptance === null || createdGameId === null) {
      throw new Error("An accepted challenge has no game");
    }
    const view = challengeView(listing, accepted, "challenged");
    const lifecycle = await this.#game(
      () => this.#config.games.lifecycle(createdGameId),
      "unknown",
    );
    return Object.freeze({
      challenge: view,
      game: Object.freeze({
        gameId: createdGameId,
        viewerSeat: acceptance.white === accepted.challengedUserId ? "white" : "black",
        lifecycle,
        startDeadlineAt: acceptance.startDeadlineAt,
      }),
    });
  }

  /** An account read; a failure is reported and fails closed. */
  async #player(userId: UserId): Promise<PlayerRecord | null | "unavailable"> {
    try {
      return await this.#config.players.findPlayerById(userId);
    } catch (error: unknown) {
      this.#config.reportDefect(error);
      return "unavailable";
    }
  }

  /** A game-creator call; a failure is reported and becomes `fallback`, which proves nothing. */
  async #game<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      this.#config.reportDefect(error);
      return fallback;
    }
  }

  decline(
    session: AuthenticatedSession,
    challengeId: string,
  ): Promise<Outcome<ChallengeView, ChallengeError>> {
    return this.#resolve(session, challengeId, "decline");
  }

  cancel(
    session: AuthenticatedSession,
    challengeId: string,
  ): Promise<Outcome<ChallengeView, ChallengeError>> {
    return this.#resolve(session, challengeId, "cancel");
  }

  /**
   * Maintenance hook for a future scheduler: marks up to `limit` overdue
   * pending challenges expired (never deletes them). Reads and actions
   * already treat an overdue challenge as expired without it.
   */
  async expireOverdue(limit: number): Promise<number> {
    const count = await this.#config.store.expireOverdue(this.#config.clock.now(), limit);
    if (count > 0) this.#config.facts.record({ name: "challenges_expired_swept", count });
    return count;
  }

  async #resolve(
    session: AuthenticatedSession,
    challengeId: string,
    action: "decline" | "cancel",
  ): Promise<Outcome<ChallengeView, ChallengeError>> {
    const refuse = (
      reason: ChallengeActionRefusal,
      error: ChallengeError,
    ): Outcome<ChallengeView, ChallengeError> => {
      this.#config.facts.record({ name: "challenge_action_refused", action, reason });
      return failure(error);
    };
    if (!isChallengeId(challengeId)) {
      return refuse("not_found", { kind: "challenge_not_found" });
    }
    const actor = await this.#config.players.findPlayerById(session.userId);
    if (actor === null || actor.status !== "active") {
      return refuse("account_unavailable", { kind: "account_unavailable" });
    }
    const now = this.#config.clock.now();
    /** A lost compare-and-set means the challenge left `pending`, so the second read decides. */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const found = await this.#stored(() => this.#config.store.find(challengeId));
      if (!found.ok) return refuse("store_unavailable", UNAVAILABLE);
      const listing = found.value;
      if (listing === null) return refuse("not_found", { kind: "challenge_not_found" });
      const decision = decide(listing.challenge, { action, actor: session.userId, now });
      switch (decision.kind) {
        case "refused":
          if (decision.reason === "not_participant") {
            return refuse("not_found", { kind: "challenge_not_found" });
          }
          if (decision.reason === "wrong_role") {
            return refuse("wrong_role", { kind: "not_challenge_participant" });
          }
          return listing.challenge.status === "expired"
            ? refuse("expired", { kind: "challenge_expired" })
            : refuse("not_pending", { kind: "challenge_not_pending" });
        case "unchanged":
          return success(challengeView(listing, decision.challenge, roleOfActor(listing, session)));
        case "expired": {
          const expired = await this.#stored(() => this.#config.store.expire(challengeId, now));
          if (!expired.ok) return refuse("store_unavailable", UNAVAILABLE);
          if (!expired.value) continue;
          this.#config.facts.record({ name: "challenge_expired", challengeId, via: "action" });
          return refuse("expired", { kind: "challenge_expired" });
        }
        case "transition": {
          const { next } = decision;
          const resolved = await this.#stored(() => this.#config.store.resolve(next, now));
          if (!resolved.ok) return refuse("store_unavailable", UNAVAILABLE);
          if (!resolved.value) continue;
          this.#config.facts.record({
            name: action === "decline" ? "challenge_declined" : "challenge_cancelled",
            challengeId,
          });
          return success(challengeView(listing, next, roleOfActor(listing, session)));
        }
      }
    }
    this.#config.reportDefect(new Error("A challenge compare-and-set failed on a resolved read"));
    return refuse("store_unavailable", UNAVAILABLE);
  }

  #refuseCreate(
    reason: ChallengeCreateRejection,
    error: ChallengeError,
  ): Outcome<ChallengeView, ChallengeError> {
    this.#config.facts.record({ name: "challenge_create_rejected", reason });
    return failure(error);
  }

  /** A store failure becomes a refusal; corruption is also reported as a defect. */
  async #stored<T>(work: () => Promise<T>): Promise<Stored<T>> {
    try {
      return { ok: true, value: await work() };
    } catch (error: unknown) {
      if (!(error instanceof ChallengeStoreError)) throw error;
      if (error.kind === "corrupt") this.#config.reportDefect(error);
      return { ok: false };
    }
  }
}

function listingOf(
  challenge: Challenge,
  challenger: PlayerRecord,
  opponent: PlayerRecord,
): ChallengeListing {
  return {
    challenge,
    challengerUsername: challenger.username,
    challengedUsername: opponent.username,
  };
}

function roleOfActor(
  listing: ChallengeListing,
  session: AuthenticatedSession,
): "challenger" | "challenged" {
  return listing.challenge.challengerUserId === session.userId ? "challenger" : "challenged";
}
