import {
  type ClaimDecision,
  type SeatListing,
  trustedCommandContext,
} from "@chess-one/game-access";
import type {
  CommandIngress,
  CommandOutcome,
  ControlLeaseId,
  GameId,
  GameSubscriber,
  GameView,
  GameWriterPort,
  IngressRefused,
  RecoveryReason,
  ReplayOutcome,
  Seat,
  SyncOutcome,
  UnavailableReason,
} from "@chess-one/live-game-runtime";
import type { RawData, WebSocket } from "ws";
import type { ResolvedEdgeConfig } from "./config.ts";
import type { CloseReason } from "./facts.ts";
import {
  type ClientCommand,
  type ClientMessage,
  decodeClientMessage,
  type ProtocolViolation,
  REALTIME_PROTOCOL,
  violation,
} from "./protocol/client-messages.ts";
import {
  type BusyCode,
  type ControlDeniedCode,
  encodeCommandResponse,
  encodeSnapshot,
  type RequestFailure,
  type ServerMessage,
  type SnapshotWire,
  serializeServerMessage,
} from "./protocol/server-messages.ts";
import {
  ConnectionSeats,
  type SeatEntry,
  type SeatEvent,
  type SeatLookup,
} from "./seat-control.ts";
import type { TrustedSessionContext } from "./session.ts";
import { TokenBucket } from "./token-bucket.ts";

/** WebSocket close codes this edge uses (RFC 6455 section 7.4.1). */
export const CLOSE_NORMAL = 1000;
export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_MESSAGE_TOO_LARGE = 1009;

interface Subscription {
  readonly entry: SeatEntry;
  readonly writer: GameWriterPort;
  readonly subscriber: GameSubscriber;
  /** Highest game sequence sent on this connection; state messages never go below it. */
  lastSentSequence: number;
}

type Refusal = { readonly busy: BusyCode } | { readonly failed: RequestFailure };

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function failureOf(reason: UnavailableReason): RequestFailure {
  switch (reason) {
    case "temporarily_unavailable":
      return "TEMPORARILY_UNAVAILABLE";
    case "game_not_found":
      return "GAME_NOT_FOUND";
    case "game_corrupt":
      return "GAME_UNAVAILABLE";
  }
}

function deniedCode(decision: Exclude<ClaimDecision, { kind: "granted" }>): ControlDeniedCode {
  if (decision.kind === "unavailable") return "TEMPORARILY_UNAVAILABLE";
  switch (decision.reason) {
    case "no_access":
      return "GAME_ACCESS_DENIED";
    case "game_closed":
      return "GAME_CLOSED";
    case "session_ended":
      return "SESSION_ENDED";
    case "rate_limited":
      return "RATE_LIMITED";
    case "conflict":
      return "CONFLICT";
  }
}

export interface ConnectionOptions {
  readonly id: string;
  readonly socket: WebSocket;
  readonly session: TrustedSessionContext;
  readonly games: readonly SeatListing[];
  readonly config: ResolvedEdgeConfig;
  readonly onClosed: (connection: RealtimeConnection) => void;
}

/**
 * One WebSocket connection. Its id is internal bookkeeping, never identity:
 * the actor comes only from the trusted session resolved at upgrade, and the
 * seat and control of each game from that session's game authority. Several
 * connections and sessions of one player reach the same writer; only the
 * session holding a seat's control lease may command it
 * (LIVE-MULTI-CONNECTION-001).
 */
export class RealtimeConnection {
  readonly id: string;
  readonly closed: Promise<void>;
  readonly #socket: WebSocket;
  readonly #session: TrustedSessionContext;
  readonly #games: readonly SeatListing[];
  readonly #seats: ConnectionSeats;
  readonly #config: ResolvedEdgeConfig;
  readonly #onClosed: (connection: RealtimeConnection) => void;
  readonly #bucket: TokenBucket;
  readonly #subscriptions = new Map<GameId, Subscription>();
  readonly #markClosed: () => void;
  #state: "awaiting_hello" | "ready" | "closing" | "closed" = "awaiting_hello";
  #closeReason: CloseReason = "client";
  #strikes = 0;
  #busyNotified = false;
  #protocolErrors = 0;
  #awaitingPong = false;
  #handshakeTimer: ReturnType<typeof setTimeout> | null;
  #heartbeatTimer: ReturnType<typeof setInterval> | null;
  #closeTimer: ReturnType<typeof setTimeout> | null = null;
  #recheckTimer: ReturnType<typeof setInterval> | null = null;
  #rechecking = false;
  #unwatch: (() => void) | null = null;

  constructor(options: ConnectionOptions) {
    this.id = options.id;
    this.#socket = options.socket;
    this.#session = options.session;
    this.#games = options.games;
    this.#config = options.config;
    this.#onClosed = options.onClosed;
    const { limits, clock } = options.config;
    this.#seats = new ConnectionSeats(
      options.session.authority,
      limits.maxGamesPerConnection,
      this.#seatEvent,
    );
    this.#bucket = new TokenBucket(limits.inboundBurst, limits.inboundRefillPerSecond, clock.now());
    const closed = Promise.withResolvers<void>();
    this.closed = closed.promise;
    this.#markClosed = closed.resolve;

    this.#socket.on("message", this.#onMessage);
    this.#socket.on("pong", this.#onPong);
    this.#socket.on("error", this.#onError);
    this.#socket.on("close", this.#onClose);
    this.#handshakeTimer = setTimeout(() => {
      this.#handshakeTimer = null;
      if (this.#state === "awaiting_hello") this.close(CLOSE_POLICY_VIOLATION, "hello_timeout");
    }, limits.handshakeTimeoutMs);
    this.#heartbeatTimer = setInterval(this.#heartbeat, limits.heartbeatIntervalMs);
    const { liveness } = options.session;
    if (liveness !== undefined) {
      this.#unwatch = liveness.watch(this.#sessionEnded);
      this.#recheckTimer = setInterval(this.#recheck, limits.sessionRecheckIntervalMs);
    }
  }

  get subscriptionCount(): number {
    return this.#subscriptions.size;
  }

  /** Starts the close handshake; the socket is terminated if it does not finish in time. */
  close(code: number, reason: CloseReason): void {
    if (this.#state === "closing" || this.#state === "closed") return;
    this.#state = "closing";
    this.#closeReason = reason;
    this.#stopTimers();
    this.#releaseSubscriptions();
    this.#seats.close();
    this.#socket.close(code, reason);
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null;
      this.#socket.terminate();
    }, this.#config.limits.closeTimeoutMs);
  }

  readonly #onMessage = (data: RawData, isBinary: boolean): void => {
    if (this.#state === "closing" || this.#state === "closed") return;
    this.#awaitingPong = false;
    if (!this.#bucket.take(this.#config.clock.now())) {
      this.#rateLimited();
      return;
    }
    this.#strikes = 0;
    this.#busyNotified = false;
    if (isBinary || Array.isArray(data)) {
      this.#protocolError(violation("BINARY_NOT_SUPPORTED"));
      return;
    }
    let text: string;
    try {
      text = decoder.decode(data);
    } catch (error: unknown) {
      if (!(error instanceof TypeError)) throw error;
      this.#protocolError(violation("MALFORMED_UNICODE"));
      return;
    }
    const decoded = decodeClientMessage(text);
    if (!decoded.ok) {
      this.#protocolError(decoded.violation);
      return;
    }
    this.#dispatch(decoded.message);
  };

  readonly #onPong = (): void => {
    this.#awaitingPong = false;
  };

  readonly #onError = (error: Error): void => {
    const tooLarge = "code" in error && error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
    this.#config.facts.record({ name: tooLarge ? "message_too_large" : "socket_error" });
    if (this.#state !== "closing" && this.#state !== "closed") {
      this.#closeReason = tooLarge ? "message_too_large" : "socket_error";
    }
  };

  readonly #onClose = (code: number): void => {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#stopTimers();
    if (this.#closeTimer !== null) clearTimeout(this.#closeTimer);
    this.#closeTimer = null;
    this.#releaseSubscriptions();
    this.#seats.close();
    this.#socket.off("message", this.#onMessage);
    this.#socket.off("pong", this.#onPong);
    this.#socket.off("close", this.#onClose);
    this.#socket.off("error", this.#onError);
    this.#config.facts.record({ name: "connection_closed", code, reason: this.#closeReason });
    this.#onClosed(this);
    this.#markClosed();
  };

  readonly #heartbeat = (): void => {
    if (this.#state === "closing" || this.#state === "closed") return;
    if (this.#awaitingPong) {
      this.#config.facts.record({ name: "dead_connection" });
      this.#closeReason = "dead_connection";
      this.#socket.terminate();
      return;
    }
    this.#awaitingPong = true;
    this.#socket.ping();
  };

  /**
   * The periodic session recheck. It runs beside message handling, never in
   * front of it. A session that ended, or a store that cannot answer, closes
   * the connection with 1008: the session is not trusted on a guess.
   */
  readonly #recheck = (): void => {
    const liveness = this.#session.liveness;
    if (liveness === undefined || this.#rechecking) return;
    if (this.#state === "closing" || this.#state === "closed") return;
    this.#rechecking = true;
    liveness.check().then(
      (active) => {
        this.#rechecking = false;
        if (!active) this.#sessionEnded();
      },
      (error: unknown) => {
        this.#rechecking = false;
        this.#config.reportDefect(error);
        this.close(CLOSE_POLICY_VIOLATION, "session_unverifiable");
      },
    );
  };

  /** The session ended (revoked, expired, idle, account closed): its seats lose their controller. */
  readonly #sessionEnded = (): void => {
    if (this.#state === "closing" || this.#state === "closed") return;
    this.#session.authority.sessionEnded();
    this.close(CLOSE_POLICY_VIOLATION, "session_ended");
  };

  readonly #seatEvent = (event: SeatEvent): void => {
    const { gameId, seat } = event.entry;
    if (event.kind === "granted") {
      this.#send({ type: "control_granted", requestId: null, gameId, seat });
      return;
    }
    this.#config.facts.record({ name: "control_revoked_sent", gameId });
    this.#send({ type: "control_revoked", gameId, seat, code: event.code });
  };

  #stopTimers(): void {
    if (this.#handshakeTimer !== null) clearTimeout(this.#handshakeTimer);
    if (this.#heartbeatTimer !== null) clearInterval(this.#heartbeatTimer);
    if (this.#recheckTimer !== null) clearInterval(this.#recheckTimer);
    this.#handshakeTimer = null;
    this.#heartbeatTimer = null;
    this.#recheckTimer = null;
    const unwatch = this.#unwatch;
    this.#unwatch = null;
    if (unwatch !== null) unwatch();
  }

  #releaseSubscriptions(): void {
    for (const subscription of this.#subscriptions.values()) {
      subscription.writer.unsubscribe(subscription.subscriber);
    }
    this.#subscriptions.clear();
  }

  /**
   * Over-limit messages are dropped unparsed. The first in a run is answered
   * with `server_busy`; a long enough run closes the connection.
   */
  #rateLimited(): void {
    this.#config.facts.record({ name: "rate_limited" });
    this.#strikes += 1;
    if (this.#strikes >= this.#config.limits.maxRateLimitStrikes) {
      this.close(CLOSE_POLICY_VIOLATION, "rate_limited");
      return;
    }
    if (this.#busyNotified) return;
    this.#busyNotified = true;
    this.#busy(null, "RATE_LIMITED", null);
  }

  #protocolError(problem: ProtocolViolation): void {
    this.#config.facts.record({ name: "malformed_message", code: problem.code });
    this.#send({ type: "protocol_error", code: problem.code, field: problem.field });
    this.#protocolErrors += 1;
    if (
      this.#state === "awaiting_hello" ||
      problem.code === "UNSUPPORTED_PROTOCOL_VERSION" ||
      this.#protocolErrors >= this.#config.limits.maxProtocolErrors
    ) {
      this.close(CLOSE_PROTOCOL_ERROR, "protocol_error");
    }
  }

  #dispatch(message: ClientMessage): void {
    if (this.#state === "awaiting_hello") {
      if (message.type !== "hello") {
        this.#protocolError(violation("HELLO_REQUIRED"));
        return;
      }
      this.#ready();
      return;
    }
    switch (message.type) {
      case "hello":
        this.#protocolError(violation("HELLO_ALREADY_RECEIVED"));
        return;
      case "ping":
        this.#send({ type: "pong", nonce: message.nonce });
        return;
      case "sync_game":
        this.#sync(message.gameId, message.requestId);
        return;
      case "claim_game_control":
        this.#claim(message.gameId, message.requestId);
        return;
      case "game_command":
        this.#command(message.gameId, message.command, message.requestId);
        return;
    }
  }

  #ready(): void {
    this.#state = "ready";
    if (this.#handshakeTimer !== null) clearTimeout(this.#handshakeTimer);
    this.#handshakeTimer = null;
    const { limits } = this.#config;
    this.#send({
      type: "connection_ready",
      protocol: REALTIME_PROTOCOL,
      actorId: this.#session.actorId,
      games: this.#games.map(({ gameId, seat }) => ({ gameId, seat })),
      limits: {
        maxMessageBytes: limits.maxMessageBytes,
        heartbeatIntervalMs: limits.heartbeatIntervalMs,
        inboundBurst: limits.inboundBurst,
        inboundRefillPerSecond: limits.inboundRefillPerSecond,
      },
    });
  }

  /** The game's writer with this connection subscribed to it, or why not. */
  #subscribe(entry: SeatEntry): Subscription | Refusal {
    const writer = this.#config.writers.acquire(entry.gameId);
    if (writer === null) return { busy: "WRITER_CAPACITY" };
    const existing = this.#subscriptions.get(entry.gameId);
    if (existing !== undefined && existing.writer === writer && existing.entry === entry) {
      return existing;
    }
    if (existing !== undefined) {
      existing.writer.unsubscribe(existing.subscriber);
      this.#subscriptions.delete(entry.gameId);
    }
    if (this.#subscriptions.size >= this.#config.limits.maxGamesPerConnection) {
      return { failed: "SUBSCRIPTION_LIMIT" };
    }
    const subscription: Subscription = {
      entry,
      writer,
      lastSentSequence: -1,
      subscriber: {
        onUpdate: (view) => this.#deliverUpdate(subscription, view),
        onRecoveryRequired: (gameId, reason) => this.#recoveryRequired(gameId, reason, null, null),
        onWriterStopped: () => this.#writerStopped(subscription),
      },
    };
    const result = writer.subscribe(subscription.subscriber);
    if (result === "limit_reached") return { failed: "SUBSCRIPTION_LIMIT" };
    if (result === "writer_stopped") return { failed: "TEMPORARILY_UNAVAILABLE" };
    this.#subscriptions.set(entry.gameId, subscription);
    return subscription;
  }

  #refuse(refusal: Refusal, requestId: string | null, clientCommandId: string | null): void {
    if ("busy" in refusal) this.#busy(requestId, refusal.busy, clientCommandId);
    else this.#failed(requestId, refusal.failed, clientCommandId);
  }

  /**
   * Runs `then` with the session's seat once game access answers. Every
   * waiter of one lookup is called in arrival order. A game of other players
   * and a game that does not exist get the same answer.
   */
  #withSeat(
    lookup: Promise<SeatLookup>,
    requestId: string | null,
    clientCommandId: string | null,
    then: (entry: SeatEntry) => void,
  ): void {
    lookup.then(
      (found) => {
        if (this.#state !== "ready") return;
        switch (found.kind) {
          case "seat":
            then(found.entry);
            return;
          case "denied":
            this.#failed(requestId, "GAME_ACCESS_DENIED", clientCommandId);
            return;
          case "unavailable":
            this.#failed(requestId, "TEMPORARILY_UNAVAILABLE", clientCommandId);
            return;
          case "limit":
            this.#failed(requestId, "SUBSCRIPTION_LIMIT", clientCommandId);
            return;
        }
      },
      (error: unknown) => {
        this.#config.reportDefect(error);
        this.#failed(requestId, "TEMPORARILY_UNAVAILABLE", clientCommandId);
      },
    );
  }

  /** Sync always asks game access again: it is how a connection repairs its view of control. */
  #sync(gameId: GameId, requestId: string | null): void {
    this.#withSeat(this.#seats.lookup(gameId), requestId, null, (entry) => {
      const subscription = this.#subscribe(entry);
      if (!("writer" in subscription)) {
        this.#refuse(subscription, requestId, null);
        return;
      }
      const ingress = subscription.writer.requestSync((outcome) =>
        this.#synced(subscription, outcome, requestId),
      );
      if (!ingress.accepted) this.#refuseIngress(gameId, ingress, requestId, null);
    });
  }

  #claim(gameId: GameId, requestId: string | null): void {
    this.#seats.claim(gameId).then(
      (result) => {
        if (result.kind === "granted") {
          this.#config.facts.record({ name: "control_claim", gameId, outcome: "granted" });
          this.#send({ type: "control_granted", requestId, gameId, seat: result.entry.seat });
          return;
        }
        if (result.kind === "limit") {
          this.#failed(requestId, "SUBSCRIPTION_LIMIT", null);
          return;
        }
        this.#controlDenied(gameId, requestId, deniedCode(result.decision));
      },
      (error: unknown) => {
        this.#config.reportDefect(error);
        this.#controlDenied(gameId, requestId, "TEMPORARILY_UNAVAILABLE");
      },
    );
  }

  #controlDenied(gameId: GameId, requestId: string | null, code: ControlDeniedCode): void {
    const unavailable = code === "TEMPORARILY_UNAVAILABLE";
    this.#config.facts.record({
      name: "control_claim",
      gameId,
      outcome: unavailable ? "unavailable" : "denied",
    });
    this.#send({
      type: "control_denied",
      requestId,
      gameId,
      code,
      retryable: unavailable || code === "RATE_LIMITED" || code === "CONFLICT",
    });
  }

  #synced(subscription: Subscription, outcome: SyncOutcome, requestId: string | null): void {
    if (outcome.kind === "unavailable") {
      this.#failed(requestId, failureOf(outcome.reason), null);
      return;
    }
    if (outcome.kind === "recovery_required") {
      this.#recoveryRequired(outcome.gameId, outcome.reason, requestId, null);
      return;
    }
    const { view } = outcome;
    if (!this.#advance(subscription, view, true)) return;
    this.#config.facts.record({ name: "sync_served", gameId: view.gameId });
    this.#send({
      type: "game_snapshot",
      requestId,
      snapshot: this.#snapshot(subscription, view),
    });
    if (view.recoveryReason !== null) {
      this.#recoveryRequired(view.gameId, view.recoveryReason, requestId, null);
    }
  }

  /**
   * A command waits behind a seat lookup already running for its game, so
   * commands keep their arrival order; with the seat known it goes to the
   * writer synchronously.
   */
  #command(gameId: GameId, command: ClientCommand, requestId: string | null): void {
    const known = this.#seats.known(gameId);
    const running = this.#seats.resolving(gameId);
    if (known !== undefined && running === undefined) {
      this.#submit(known, command, requestId);
      return;
    }
    this.#withSeat(
      running ?? this.#seats.lookup(gameId),
      requestId,
      command.clientCommandId,
      (entry) => this.#submit(entry, command, requestId),
    );
  }

  /**
   * The command context is composed here and nowhere else: the actor from
   * the session, the seat from the assignment, and the lease this session
   * holds, which replaces anything the client sent. A command without
   * control is never admitted; it can only be a historical replay.
   */
  #submit(entry: SeatEntry, command: ClientCommand, requestId: string | null): void {
    const { gameId } = entry;
    const clientCommandId = command.clientCommandId;
    const subscription = this.#subscribe(entry);
    if (!("writer" in subscription)) {
      this.#refuse(subscription, requestId, clientCommandId);
      return;
    }
    const context = trustedCommandContext(this.#session.actorId, gameId, entry.seat, entry.control);
    if (context === null) {
      this.#historical(entry, command, requestId);
      return;
    }
    const lease = context.actor.controlLeaseId;
    const ingress: CommandIngress = subscription.writer.submitCommand(
      context.actor,
      { ...command, controlLeaseId: lease },
      (outcome) => this.#answered(entry, lease, command, outcome, requestId),
    );
    if (ingress.accepted) {
      this.#config.facts.record({ name: "command_submitted", gameId });
    } else if (ingress.reason === "control_not_held") {
      this.#seats.lost(entry, lease);
      this.#historical(entry, command, requestId);
    } else {
      this.#refuseIngress(gameId, ingress, requestId, clientCommandId);
    }
  }

  /**
   * A command from a session without control: read-only retrieval of a
   * decision its seat already bound, from the stored bindings, on any
   * connection and after any restart. Game access first proves, in the
   * store, that the session is active and its user holds the seat; control
   * is not needed. The writer rebuilds the command under the lease its
   * binding was stored with, so no lease comes from here. A command id the
   * seat never bound is `CONTROL_NOT_HELD`; one bound to another command is
   * `INVALID_COMMAND_IDENTITY`.
   */
  #historical(entry: SeatEntry, command: ClientCommand, requestId: string | null): void {
    const { gameId } = entry;
    const clientCommandId = command.clientCommandId;
    this.#seats.replayAccess(gameId).then(
      (access) => {
        if (this.#state !== "ready") return;
        switch (access.kind) {
          case "player":
            this.#replay(gameId, access.seat, command, requestId);
            return;
          case "denied":
            this.#failed(requestId, "GAME_ACCESS_DENIED", clientCommandId);
            return;
          case "session_ended":
            this.#controlNotHeld(gameId, requestId, clientCommandId);
            return;
          case "unavailable":
            this.#failed(requestId, "TEMPORARILY_UNAVAILABLE", clientCommandId);
            return;
        }
      },
      (error: unknown) => {
        this.#config.reportDefect(error);
        this.#failed(requestId, "TEMPORARILY_UNAVAILABLE", clientCommandId);
      },
    );
  }

  #replay(gameId: GameId, seat: Seat, command: ClientCommand, requestId: string | null): void {
    const clientCommandId = command.clientCommandId;
    const writer = this.#config.writers.acquire(gameId);
    if (writer === null) {
      this.#busy(requestId, "WRITER_CAPACITY", clientCommandId);
      return;
    }
    const participant = Object.freeze({ gameId, playerId: this.#session.actorId, seat });
    const ingress = writer.replayCommand(participant, command, (outcome) =>
      this.#replayed(gameId, outcome, requestId, clientCommandId),
    );
    if (!ingress.accepted) this.#refuseIngress(gameId, ingress, requestId, clientCommandId);
  }

  #answered(
    entry: SeatEntry,
    lease: ControlLeaseId,
    command: ClientCommand,
    outcome: CommandOutcome,
    requestId: string | null,
  ): void {
    const clientCommandId = command.clientCommandId;
    switch (outcome.kind) {
      case "decided":
        this.#send({
          type: "command_response",
          requestId,
          response: encodeCommandResponse(outcome.response),
        });
        return;
      case "control_not_held":
        this.#seats.lost(entry, lease);
        this.#historical(entry, command, requestId);
        return;
      case "recovery_required":
        this.#recoveryRequired(outcome.gameId, outcome.reason, requestId, clientCommandId);
        return;
      case "unavailable":
        this.#failed(requestId, failureOf(outcome.reason), clientCommandId);
        return;
    }
  }

  #replayed(
    gameId: GameId,
    outcome: ReplayOutcome,
    requestId: string | null,
    clientCommandId: string,
  ): void {
    switch (outcome.kind) {
      case "decided":
        this.#send({
          type: "command_response",
          requestId,
          response: encodeCommandResponse(outcome.response),
        });
        return;
      case "control_not_held":
        this.#controlNotHeld(gameId, requestId, clientCommandId);
        return;
      case "identity_conflict":
        this.#failed(requestId, "INVALID_COMMAND_IDENTITY", clientCommandId);
        return;
      case "recovery_required":
        this.#recoveryRequired(outcome.gameId, outcome.reason, requestId, clientCommandId);
        return;
      case "unavailable":
        this.#failed(requestId, failureOf(outcome.reason), clientCommandId);
        return;
    }
  }

  #controlNotHeld(gameId: GameId, requestId: string | null, clientCommandId: string): void {
    this.#config.facts.record({ name: "command_refused_control", gameId });
    this.#failed(requestId, "CONTROL_NOT_HELD", clientCommandId);
  }

  #snapshot(subscription: Subscription, view: GameView): SnapshotWire {
    const { entry } = subscription;
    return encodeSnapshot(view, entry.seat, entry.control.held);
  }

  #refuseIngress(
    gameId: GameId,
    refused: IngressRefused,
    requestId: string | null,
    clientCommandId: string | null,
  ): void {
    switch (refused.reason) {
      case "queue_full":
        this.#busy(requestId, "WRITER_QUEUE_FULL", clientCommandId);
        return;
      case "writer_stopped":
        this.#failed(requestId, "TEMPORARILY_UNAVAILABLE", clientCommandId);
        return;
      case "infrastructure_paused":
        this.#recoveryRequired(gameId, refused.recovery, requestId, clientCommandId);
        return;
    }
  }

  #deliverUpdate(subscription: Subscription, view: GameView): void {
    if (!this.#advance(subscription, view, false)) return;
    this.#send({ type: "game_update", snapshot: this.#snapshot(subscription, view) });
  }

  /**
   * The per-connection order guarantee: a state message never carries a lower
   * sequence than one already sent. A snapshot may repeat the last sequence;
   * an update must advance it.
   */
  #advance(subscription: Subscription, view: GameView, snapshot: boolean): boolean {
    const last = subscription.lastSentSequence;
    if (view.sequence < last || (!snapshot && view.sequence === last)) {
      if (view.sequence < last) {
        this.#config.facts.record({ name: "sequence_regression_suppressed", gameId: view.gameId });
      }
      return false;
    }
    subscription.lastSentSequence = view.sequence;
    return true;
  }

  #writerStopped(subscription: Subscription): void {
    const { gameId } = subscription.entry;
    if (this.#subscriptions.get(gameId) === subscription) this.#subscriptions.delete(gameId);
    this.#send({ type: "sync_required", gameId, reason: "WRITER_STOPPED" });
  }

  #recoveryRequired(
    gameId: GameId,
    reason: RecoveryReason,
    requestId: string | null,
    clientCommandId: string | null,
  ): void {
    this.#config.facts.record({ name: "recovery_required_sent", gameId });
    this.#send({ type: "recovery_required", requestId, gameId, reason, clientCommandId });
  }

  #busy(requestId: string | null, code: BusyCode, clientCommandId: string | null): void {
    this.#config.facts.record({ name: "server_busy", code });
    this.#send({ type: "server_busy", requestId, code, retryable: true, clientCommandId });
  }

  #failed(requestId: string | null, code: RequestFailure, clientCommandId: string | null): void {
    this.#send({
      type: "request_failed",
      requestId,
      code,
      retryable: code === "TEMPORARILY_UNAVAILABLE",
      clientCommandId,
    });
  }

  /**
   * Outbound backpressure: a message that would take the socket's unsent
   * backlog past the limit is not queued; the connection is closed as a slow
   * consumer instead, so memory stays bounded and no update is silently
   * skipped on a connection that stays open. The client repairs its state
   * with reconnect and `sync_game`.
   */
  #send(message: ServerMessage): void {
    if (this.#state === "closing" || this.#state === "closed") return;
    const bytes = encoder.encode(serializeServerMessage(message));
    if (
      this.#socket.bufferedAmount + bytes.byteLength >
      this.#config.limits.maxOutboundBufferBytes
    ) {
      this.#config.facts.record({ name: "slow_consumer" });
      this.close(CLOSE_POLICY_VIOLATION, "slow_consumer");
      return;
    }
    this.#socket.send(bytes, { binary: false }, (error) => {
      if (error !== undefined && error !== null) this.#onError(error);
    });
  }
}
