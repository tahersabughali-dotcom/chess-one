import {
  CLAIM_DRAW_COMMAND_V1,
  OFFER_DRAW_COMMAND_V1,
  RESIGN_GAME_COMMAND_V1,
  RESPOND_DRAW_OFFER_COMMAND_V1,
  SUBMIT_MOVE_COMMAND_V1,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import { GAME_ID } from "../live-game/support/harness.ts";
import { field, type TestClient } from "../realtime/support/client.ts";
import { storedState } from "../realtime/support/runtime.ts";
import { ManualWallTime } from "../realtime/support/time.ts";
import { START_WINDOW_MS } from "./support/harness.ts";
import {
  type AccessStack,
  accessStack,
  assign,
  claimGranted,
  expectNoDefects,
  logIn,
  logOut,
  readyAnswer,
  signUp,
  socketOf,
} from "./support/stack.ts";

async function withStack(run: (stack: AccessStack) => Promise<void>): Promise<void> {
  const stack = await accessStack();
  try {
    await run(stack);
  } finally {
    await stack.close();
  }
  expectNoDefects(stack);
}

interface Seated {
  readonly white: TestClient;
  readonly black: TestClient;
}

async function seated(stack: AccessStack): Promise<Seated> {
  const whiteId = await signUp(stack, "Whitey");
  const blackId = await signUp(stack, "Blacky");
  await assign(stack, whiteId, blackId);
  return {
    white: await socketOf(stack, await logIn(stack, "whitey")),
    black: await socketOf(stack, await logIn(stack, "blacky")),
  };
}

function readyState(
  myReady: boolean,
  opponentReady: boolean,
  gameLifecycle: string,
): Readonly<Record<string, unknown>> {
  return { type: "game_ready_state", gameId: GAME_ID, myReady, opponentReady, gameLifecycle };
}

/** The next readiness notice (no request id) that `matches`. */
function notice(client: TestClient, myReady: boolean, opponentReady: boolean): Promise<unknown> {
  return client.nextWhere(
    (message) =>
      field(message, "type") === "game_ready_state" &&
      field(message, "requestId") === null &&
      field(message, "myReady") === myReady &&
      field(message, "opponentReady") === opponentReady,
  );
}

function commandMessage(requestId: string, command: Readonly<Record<string, unknown>>): unknown {
  return {
    type: "game_command",
    requestId,
    command: { contractVersion: "1", gameId: GAME_ID, expectedGameSequence: 0, ...command },
  };
}

/** One browser command of every family, as White would send it before the start. */
const FAMILIES: readonly {
  readonly clientCommandId: string;
  readonly [field: string]: unknown;
}[] = [
  { command: SUBMIT_MOVE_COMMAND_V1, clientCommandId: "m-1", fromSquare: "e2", toSquare: "e4" },
  { command: CLAIM_DRAW_COMMAND_V1, clientCommandId: "c-1", claimKind: "threefold_current" },
  { command: RESIGN_GAME_COMMAND_V1, clientCommandId: "r-1" },
  { command: OFFER_DRAW_COMMAND_V1, clientCommandId: "o-1" },
  {
    command: RESPOND_DRAW_OFFER_COMMAND_V1,
    clientCommandId: "d-1",
    offerId: 0,
    decision: "accept",
  },
];

function wallOf(stack: AccessStack): ManualWallTime {
  const wall = stack.ga.runtime.wallClock;
  if (!(wall instanceof ManualWallTime)) throw new Error("the stack's wall clock is not manual");
  return wall;
}

describe("TST-GACC-READY the both-players ready barrier over the real edge (GAME-START-LIFECYCLE-001)", () => {
  it("TST-GACC-READY-001 the snapshot of a created game: awaiting, deadline, nobody ready, no clock running", async () => {
    await withStack(async (stack) => {
      const { white } = await seated(stack);
      const snapshot = field(await white.sync(GAME_ID), "snapshot");
      expect(snapshot).toMatchObject({
        gameLifecycle: "awaiting_players",
        sequence: 0,
        myReady: false,
        opponentReady: false,
        canClaimControl: true,
        controlHeld: false,
      });
      expect(field(snapshot, "startDeadlineAt")).toBe(
        stack.ga.runtime.wallClock.now() + START_WINDOW_MS,
      );
      expect(field(snapshot, "clock", "running")).toBe(false);
    });
  });

  it("TST-GACC-READY-002 ready needs the seat's control; one ready waits; the second starts the game and both hear it", async () => {
    await withStack(async (stack) => {
      const { white, black } = await seated(stack);
      expect(await readyAnswer(white, "early")).toMatchObject({
        type: "request_failed",
        code: "CONTROL_NOT_HELD",
      });
      await claimGranted(white, "claim-w");
      await claimGranted(black, "claim-b");
      expect(await readyAnswer(white, "ready-w")).toEqual({
        ...readyState(true, false, "awaiting_players"),
        requestId: "ready-w",
      });
      await black.sync(GAME_ID);
      expect(await readyAnswer(black, "ready-b")).toEqual({
        ...readyState(true, true, "in_progress"),
        requestId: "ready-b",
      });
      for (const client of [white, black]) {
        const update = await client.nextWhere(
          (message) =>
            field(message, "type") === "game_update" &&
            field(message, "snapshot", "sequence") === 1,
        );
        expect(field(update, "snapshot", "gameLifecycle")).toBe("in_progress");
        expect(field(update, "snapshot", "clock", "running")).toBe(true);
        expect(field(update, "snapshot", "myReady")).toBe(false);
      }
      expect((await storedState(stack.ga.runtime)).sequence).toBe(1);
      expect(await readyAnswer(white, "again")).toMatchObject({
        type: "request_failed",
        code: "GAME_NOT_AWAITING",
      });
      expect(stack.facts.named("ready_answered").map((fact) => fact.outcome)).toEqual([
        "refused",
        "ready",
        "started",
        "refused",
      ]);
    });
  });

  it("TST-GACC-READY-003 every command family before the start is GAME_NOT_STARTED: not received, bound, or sequenced", async () => {
    await withStack(async (stack) => {
      const { white } = await seated(stack);
      await claimGranted(white, "claim-w");
      for (const [index, command] of FAMILIES.entries()) {
        white.send(commandMessage(`cmd-${index}`, command));
        expect(await white.next("request_failed")).toEqual({
          type: "request_failed",
          requestId: `cmd-${index}`,
          code: "GAME_NOT_STARTED",
          retryable: false,
          clientCommandId: command.clientCommandId,
        });
      }
      expect(white.unread("command_response")).toEqual([]);
      const stored = await storedState(stack.ga.runtime);
      expect(stored.sequence).toBe(0);
      expect(stored.commandBindings).toEqual([]);
      expect(stored.clock.running).toBe(false);
      expect(stack.facts.count("command_refused_not_started")).toBe(FAMILIES.length);
    });
  });

  it("TST-GACC-READY-004 a disconnect clears that connection's ready; the game does not start on it", async () => {
    await withStack(async (stack) => {
      const { white, black } = await seated(stack);
      await claimGranted(white, "claim-w");
      await claimGranted(black, "claim-b");
      await black.sync(GAME_ID);
      await readyAnswer(white, "ready-w");
      await notice(black, false, true);
      await white.close();
      await notice(black, false, false);
      expect(await readyAnswer(black, "ready-b")).toMatchObject(
        readyState(true, false, "awaiting_players"),
      );
      expect((await storedState(stack.ga.runtime)).sequence).toBe(0);
      const again = await socketOf(stack, await logIn(stack, "whitey"));
      await claimGranted(again, "claim-w2");
      expect(await readyAnswer(again, "ready-w2")).toMatchObject(
        readyState(true, true, "in_progress"),
      );
    });
  });

  it("TST-GACC-READY-005 a control transfer clears the old session's ready; the new controller must ready again", async () => {
    await withStack(async (stack) => {
      const { white, black } = await seated(stack);
      await claimGranted(white, "claim-w");
      await claimGranted(black, "claim-b");
      await black.sync(GAME_ID);
      await readyAnswer(white, "ready-w");
      await notice(black, false, true);
      const other = await socketOf(stack, await logIn(stack, "whitey"));
      await claimGranted(other, "claim-other");
      expect(field(await white.next("control_revoked"), "code")).toBe("CONTROL_TRANSFERRED");
      await notice(black, false, false);
      expect(await readyAnswer(black, "ready-b")).toMatchObject(
        readyState(true, false, "awaiting_players"),
      );
      expect(await readyAnswer(white, "stale")).toMatchObject({ code: "CONTROL_NOT_HELD" });
      expect(await readyAnswer(other, "ready-other")).toMatchObject(
        readyState(true, true, "in_progress"),
      );
    });
  });

  it("TST-GACC-READY-006 a logout releases the seat and its ready", async () => {
    await withStack(async (stack) => {
      const whiteId = await signUp(stack, "Whitey");
      const blackId = await signUp(stack, "Blacky");
      await assign(stack, whiteId, blackId);
      const whiteCookie = await logIn(stack, "whitey");
      const white = await socketOf(stack, whiteCookie);
      const black = await socketOf(stack, await logIn(stack, "blacky"));
      await claimGranted(white, "claim-w");
      await claimGranted(black, "claim-b");
      await black.sync(GAME_ID);
      await readyAnswer(white, "ready-w");
      await notice(black, false, true);
      await logOut(stack, whiteCookie);
      await notice(black, false, false);
      expect(await readyAnswer(black, "ready-b")).toMatchObject(
        readyState(true, false, "awaiting_players"),
      );
      expect((await storedState(stack.ga.runtime)).sequence).toBe(0);
    });
  });

  it("TST-GACC-READY-007 a ready at the deadline aborts the game: no result, and commands are GAME_ABORTED_BEFORE_START", async () => {
    await withStack(async (stack) => {
      const { white, black } = await seated(stack);
      await claimGranted(white, "claim-w");
      await claimGranted(black, "claim-b");
      await readyAnswer(white, "ready-w");
      wallOf(stack).advance(START_WINDOW_MS);
      expect(await readyAnswer(black, "ready-b")).toMatchObject({
        type: "request_failed",
        code: "START_DEADLINE_PASSED",
        retryable: false,
      });
      const snapshot = field(await white.sync(GAME_ID, "sync-after"), "snapshot");
      expect(snapshot).toMatchObject({
        gameLifecycle: "aborted_before_start",
        sequence: 1,
        myReady: false,
        opponentReady: false,
        canClaimControl: false,
      });
      expect(JSON.stringify(snapshot)).not.toMatch(/winner|resultCode/);
      white.send(commandMessage("late", { ...FAMILIES[0], expectedGameSequence: 1 }));
      expect(await white.next("request_failed")).toMatchObject({
        code: "GAME_ABORTED_BEFORE_START",
      });
      const stored = await storedState(stack.ga.runtime);
      expect(stored.status.kind).toBe("aborted_before_start");
      expect(stored.commandBindings).toEqual([]);
    });
  });

  it("TST-GACC-READY-008 a stranger's ready is GAME_ACCESS_DENIED and marks nothing", async () => {
    await withStack(async (stack) => {
      await seated(stack);
      await signUp(stack, "Mallory");
      const stranger = await socketOf(stack, await logIn(stack, "mallory"));
      expect(await readyAnswer(stranger, "ready-x")).toMatchObject({
        type: "request_failed",
        code: "GAME_ACCESS_DENIED",
      });
      const writer = stack.ga.runtime.registry.acquire(GAME_ID);
      expect(writer?.readiness()).toEqual({ white: false, black: false });
    });
  });
});
