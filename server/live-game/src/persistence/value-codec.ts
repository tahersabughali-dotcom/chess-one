import { type Color, type DurationMs, isDurationMs } from "@chess-one/game-values";
import { type ClockState, isMonotonicMs } from "../clock.ts";
import type { DrawRuleDetail, GameResult, GameStatus, PositionFact } from "../result.ts";
import {
  corrupt,
  field,
  literalGuard,
  peek,
  readArray,
  readBoolean,
  readCount,
  readGuarded,
  readObject,
} from "./records.ts";

/**
 * Persisted forms of the clock and the status. They have the same field names
 * as the domain values and are rebuilt field by field, so no domain object is
 * ever stored or revived as is.
 */
export const isColor = literalGuard<Color>({ white: true, black: true });

const isDrawRuleDetail = literalGuard<DrawRuleDetail>({
  stalemate: true,
  dead_position: true,
  threefold_claim: true,
  fifty_move_claim: true,
  fivefold: true,
  seventy_five_move: true,
  timeout_no_mate: true,
  resign_no_mate_possible: true,
});

type DrawFactKind = Exclude<PositionFact["kind"], "checkmate">;
const isDrawFactKind = literalGuard<DrawFactKind>({
  stalemate: true,
  fivefold: true,
  seventy_five_move: true,
  dead_position: true,
});

function readDuration(value: unknown, path: string): DurationMs {
  const count = readCount(value, path);
  return isDurationMs(count) ? count : corrupt(path, "not a duration");
}

export function encodeClock(clock: ClockState): unknown {
  return {
    timeControl: { kind: clock.timeControl.kind, initialMs: clock.timeControl.initialMs },
    remainingMs: { white: clock.remainingMs.white, black: clock.remainingMs.black },
    activeSide: clock.activeSide,
    running: clock.running,
    anchorMs: clock.anchorMs,
  };
}

export function decodeClock(value: unknown, path: string): ClockState {
  const fields = readObject(value, path, [
    "timeControl",
    "remainingMs",
    "activeSide",
    "running",
    "anchorMs",
  ]);
  const control = readObject(field(fields, "timeControl"), `${path}.timeControl`, [
    "kind",
    "initialMs",
  ]);
  if (field(control, "kind") !== "sudden_death") {
    corrupt(`${path}.timeControl.kind`, "unknown time control");
  }
  const initialMs = readDuration(field(control, "initialMs"), `${path}.timeControl.initialMs`);
  if (initialMs === 0) corrupt(`${path}.timeControl.initialMs`, "empty time control");
  const balances = readObject(field(fields, "remainingMs"), `${path}.remainingMs`, [
    "white",
    "black",
  ]);
  const anchorMs = readCount(field(fields, "anchorMs"), `${path}.anchorMs`);
  if (!isMonotonicMs(anchorMs)) corrupt(`${path}.anchorMs`, "not a monotonic instant");
  return Object.freeze({
    timeControl: Object.freeze({ kind: "sudden_death", initialMs }),
    remainingMs: Object.freeze({
      white: readDuration(field(balances, "white"), `${path}.remainingMs.white`),
      black: readDuration(field(balances, "black"), `${path}.remainingMs.black`),
    }),
    activeSide: readGuarded(field(fields, "activeSide"), `${path}.activeSide`, isColor),
    running: readBoolean(field(fields, "running"), `${path}.running`),
    anchorMs,
  });
}

export function encodeResult(result: GameResult): unknown {
  switch (result.terminationReason) {
    case "draw_rule":
      return {
        resultCode: result.resultCode,
        terminationReason: result.terminationReason,
        drawRuleDetails: [...result.drawRuleDetails],
      };
    case "draw_agreed":
      return { resultCode: result.resultCode, terminationReason: result.terminationReason };
    default:
      return {
        resultCode: result.resultCode,
        terminationReason: result.terminationReason,
        winner: result.winner,
      };
  }
}

function decodeResult(value: unknown, path: string): GameResult {
  const code = peek(value, path, "resultCode");
  if (code === "white_win" || code === "black_win") {
    const fields = readObject(value, path, ["resultCode", "terminationReason", "winner"]);
    const reason = field(fields, "terminationReason");
    if (reason !== "checkmate" && reason !== "time" && reason !== "resignation") {
      corrupt(`${path}.terminationReason`, "not a win reason");
    }
    const winner = readGuarded(field(fields, "winner"), `${path}.winner`, isColor);
    if (winner !== (code === "white_win" ? "white" : "black")) {
      corrupt(`${path}.winner`, "does not match the result code");
    }
    return Object.freeze({ resultCode: code, terminationReason: reason, winner });
  }
  if (code !== "draw") corrupt(`${path}.resultCode`, "unknown result code");
  const reason = peek(value, path, "terminationReason");
  if (reason === "draw_agreed") {
    readObject(value, path, ["resultCode", "terminationReason"]);
    return Object.freeze({ resultCode: "draw", terminationReason: "draw_agreed" });
  }
  if (reason !== "draw_rule") corrupt(`${path}.terminationReason`, "not a draw reason");
  const fields = readObject(value, path, ["resultCode", "terminationReason", "drawRuleDetails"]);
  const detailsPath = `${path}.drawRuleDetails`;
  const details = readArray(field(fields, "drawRuleDetails"), detailsPath).map((item, index) =>
    readGuarded(item, `${detailsPath}[${index}]`, isDrawRuleDetail),
  );
  if (details.length === 0) corrupt(detailsPath, "a rule draw names at least one detail");
  if (new Set(details).size !== details.length) corrupt(detailsPath, "repeated detail");
  return Object.freeze({
    resultCode: "draw",
    terminationReason: "draw_rule",
    drawRuleDetails: Object.freeze(details),
  });
}

function decodeFact(value: unknown, path: string): PositionFact {
  if (peek(value, path, "kind") === "checkmate") {
    const fields = readObject(value, path, ["kind", "winner"]);
    const winner = readGuarded(field(fields, "winner"), `${path}.winner`, isColor);
    return Object.freeze({ kind: "checkmate", winner });
  }
  const fields = readObject(value, path, ["kind"]);
  return Object.freeze({
    kind: readGuarded(field(fields, "kind"), `${path}.kind`, isDrawFactKind),
  });
}

export function encodeStatus(status: GameStatus): unknown {
  switch (status.kind) {
    case "active":
      return { kind: "active" };
    case "finished":
      return { kind: "finished", result: encodeResult(status.result) };
    case "unresolved":
      if (status.reason === "TERMINAL_PRECEDENCE_UNRESOLVED") {
        return {
          kind: "unresolved",
          reason: status.reason,
          facts: status.facts.map((fact) =>
            fact.kind === "checkmate"
              ? { kind: fact.kind, winner: fact.winner }
              : { kind: fact.kind },
          ),
        };
      }
      return "flaggedSide" in status
        ? { kind: "unresolved", reason: status.reason, flaggedSide: status.flaggedSide }
        : { kind: "unresolved", reason: status.reason, resigningSide: status.resigningSide };
  }
}

export function decodeStatus(value: unknown, path: string): GameStatus {
  const kind = peek(value, path, "kind");
  if (kind === "active") {
    readObject(value, path, ["kind"]);
    return Object.freeze({ kind: "active" });
  }
  if (kind === "finished") {
    const fields = readObject(value, path, ["kind", "result"]);
    return Object.freeze({
      kind: "finished",
      result: decodeResult(field(fields, "result"), `${path}.result`),
    });
  }
  if (kind !== "unresolved") corrupt(`${path}.kind`, "unknown status");
  const reason = peek(value, path, "reason");
  if (reason === "TERMINAL_PRECEDENCE_UNRESOLVED") {
    const fields = readObject(value, path, ["kind", "reason", "facts"]);
    const facts = readArray(field(fields, "facts"), `${path}.facts`).map((fact, index) =>
      decodeFact(fact, `${path}.facts[${index}]`),
    );
    if (facts.length < 2) corrupt(`${path}.facts`, "an unresolved precedence needs two facts");
    return Object.freeze({ kind: "unresolved", reason, facts: Object.freeze(facts) });
  }
  if (reason !== "MATING_POSSIBILITY_UNRESOLVED") corrupt(`${path}.reason`, "unknown reason");
  if (peek(value, path, "flaggedSide") !== undefined) {
    const fields = readObject(value, path, ["kind", "reason", "flaggedSide"]);
    const flaggedSide = readGuarded(field(fields, "flaggedSide"), `${path}.flaggedSide`, isColor);
    return Object.freeze({ kind: "unresolved", reason, flaggedSide });
  }
  const fields = readObject(value, path, ["kind", "reason", "resigningSide"]);
  const resigningSide = readGuarded(
    field(fields, "resigningSide"),
    `${path}.resigningSide`,
    isColor,
  );
  return Object.freeze({ kind: "unresolved", reason, resigningSide });
}
