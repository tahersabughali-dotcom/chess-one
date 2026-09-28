import {
  type Color,
  fileIndex,
  type MoveIntent,
  oppositeColor,
  rankIndex,
  SQUARES,
  type Square,
} from "@chess-one/game-values";
import { isInCheck } from "./attacks.ts";
import { applyLegalMove, generateLegalMoves } from "./legal-moves.ts";
import type { Position } from "./position.ts";
import { repetitionKey } from "./repetition.ts";
import { evaluateMoveExhaustion } from "./terminal.ts";

/**
 * Package-internal. A cooperative mating line is a sequence of legal moves
 * (Article 3.10.1), chosen for both sides, after which the mating colour has
 * checkmated the other king. It is evidence of possibility only: it says
 * nothing about forced mate, best play, or evaluation. Repetition and the
 * seventy-five-move rule end an ongoing game; they do not decide whether such
 * a series of legal moves exists, so neither history nor the halfmove clock
 * takes part.
 *
 * The search below only proposes lines. A proposed line counts as proof only
 * after `isVerifiedMatingLine` replays it through the public move and terminal
 * functions, so a flaw in the search can make a line fail verification (the
 * caller then answers `UNKNOWN`), but it can never make an invalid line count
 * as proof.
 */

/** Material a line is searched for: king and queen or rook, or king and two knights, against a lone king. */
export type WitnessShape = "major_piece" | "two_knights";

type Point = readonly [number, number];

/**
 * Coordinates relative to one corner. `x` and `y` count squares away from the
 * corner; `transpose` swaps them, so the eight frames cover every corner and
 * both mirror images of a pattern.
 */
interface Frame {
  readonly cornerFile: number;
  readonly cornerRank: number;
  readonly transpose: boolean;
}

/**
 * Target pattern, in frame coordinates with the lone king on the corner (0, 0):
 * the mating king on (2, 1). With a queen or rook the checking piece then
 * mates along x = 0. With two knights, one knight stands on (2, 2) and the
 * other gives mate from (1, 2): for the a8 corner that is Ka8 against Kc7,
 * Nc6, Nb6.
 */
const KING_TARGET: Point = [2, 1];
const SUPPORT_KNIGHT: Point = [2, 2];
const MATING_KNIGHT: Point = [1, 2];

const CORNERS: readonly Point[] = [
  [0, 7],
  [7, 7],
  [0, 0],
  [7, 0],
];
const CORNERS_TRIED = 2;
const EXPANSIONS_PER_FRAME = 1_500;
const KNIGHT_STEPS: readonly Point[] = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];

function buildKnightDistances(): readonly (readonly number[])[] {
  const table: number[][] = [];
  for (let from = 0; from < 64; from += 1) {
    const distance: number[] = new Array<number>(64).fill(-1);
    distance[from] = 0;
    const queue = [from];
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head] ?? from;
      const x = current % 8;
      const y = (current - x) / 8;
      for (const [dx, dy] of KNIGHT_STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * 8 + nx;
        if (nx < 0 || nx > 7 || ny < 0 || ny > 7 || distance[next] !== -1) continue;
        distance[next] = (distance[current] ?? 0) + 1;
        queue.push(next);
      }
    }
    table.push(distance);
  }
  return table;
}

/** Knight-move distance; frame coordinates preserve it because frames are board symmetries. */
const KNIGHT_DISTANCE = buildKnightDistances();

function knightDistance(a: Point, b: Point): number {
  return KNIGHT_DISTANCE[a[1] * 8 + a[0]]?.[b[1] * 8 + b[0]] ?? 0;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

function toFrame(frame: Frame, square: Square): Point {
  const x = Math.abs(fileIndex(square) - frame.cornerFile);
  const y = Math.abs(rankIndex(square) - frame.cornerRank);
  return frame.transpose ? [y, x] : [x, y];
}

function kingSquare(position: Position, color: Color): Square {
  const index = position.board.findIndex((cell) => cell?.kind === "king" && cell.color === color);
  return SQUARES[index] ?? "a1";
}

function pieceCount(position: Position, color: Color): number {
  return position.board.filter((cell) => cell?.color === color).length;
}

/** Search guidance only; it has no bearing on whether a returned line is valid. */
function distanceToPattern(
  position: Position,
  matingColor: Color,
  frame: Frame,
  shape: WitnessShape,
): number {
  const lone = toFrame(frame, kingSquare(position, oppositeColor(matingColor)));
  const king = toFrame(frame, kingSquare(position, matingColor));
  const kings = 3 * Math.max(lone[0], lone[1]) + 2 * chebyshev(king, KING_TARGET);
  if (shape === "major_piece") return kings;
  const knights = position.board.flatMap((cell, index) => {
    const square = SQUARES[index];
    return cell?.kind === "knight" && cell.color === matingColor && square !== undefined
      ? [toFrame(frame, square)]
      : [];
  });
  const [first, second] = knights;
  if (first === undefined || second === undefined) return kings;
  const arranged = (support: Point, mating: Point) =>
    knightDistance(support, SUPPORT_KNIGHT) + Math.abs(knightDistance(mating, MATING_KNIGHT) - 1);
  return kings + Math.min(arranged(first, second), arranged(second, first));
}

function framesFor(position: Position, matingColor: Color): readonly Frame[] {
  const lone = kingSquare(position, oppositeColor(matingColor));
  const point: Point = [fileIndex(lone), rankIndex(lone)];
  const nearest = [...CORNERS]
    .map((corner, order) => ({ corner, order, distance: chebyshev(point, corner) }))
    .sort((a, b) => a.distance - b.distance || a.order - b.order)
    .slice(0, CORNERS_TRIED);
  return nearest.flatMap(({ corner: [cornerFile, cornerRank] }) => [
    { cornerFile, cornerRank, transpose: false },
    { cornerFile, cornerRank, transpose: true },
  ]);
}

interface SearchNode {
  readonly position: Position;
  readonly parent: number;
  readonly move: MoveIntent | null;
  readonly score: number;
}

function before(nodes: readonly SearchNode[], a: number, b: number): boolean {
  const left = nodes[a]?.score ?? 0;
  const right = nodes[b]?.score ?? 0;
  return left < right || (left === right && a < b);
}

function swap(heap: number[], i: number, j: number): void {
  const held = heap[i] ?? 0;
  heap[i] = heap[j] ?? 0;
  heap[j] = held;
}

function push(heap: number[], nodes: readonly SearchNode[], id: number): void {
  heap.push(id);
  let child = heap.length - 1;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    if (!before(nodes, heap[child] ?? 0, heap[parent] ?? 0)) break;
    swap(heap, child, parent);
    child = parent;
  }
}

function pop(heap: number[], nodes: readonly SearchNode[]): number {
  const top = heap[0] ?? 0;
  const last = heap.pop() ?? 0;
  if (heap.length === 0) return top;
  heap[0] = last;
  let parent = 0;
  for (;;) {
    const left = parent * 2 + 1;
    const right = left + 1;
    let best = parent;
    if (left < heap.length && before(nodes, heap[left] ?? 0, heap[best] ?? 0)) best = left;
    if (right < heap.length && before(nodes, heap[right] ?? 0, heap[best] ?? 0)) best = right;
    if (best === parent) return top;
    swap(heap, parent, best);
    parent = best;
  }
}

function lineTo(nodes: readonly SearchNode[], id: number): MoveIntent[] {
  const line: MoveIntent[] = [];
  for (let node = nodes[id]; node?.move != null; node = nodes[node.parent]) line.push(node.move);
  return line.reverse();
}

/**
 * Deterministic best-first search in one frame, bounded by expansions. It
 * never lets the lone king capture and never expands the same placement,
 * side to move, and rights twice; the halfmove clock is not part of that
 * identity and bounds nothing.
 */
function searchFrame(
  start: Position,
  matingColor: Color,
  frame: Frame,
  shape: WitnessShape,
): MoveIntent[] | null {
  const lone = oppositeColor(matingColor);
  const pieces = pieceCount(start, matingColor);
  const nodes: SearchNode[] = [{ position: start, parent: -1, move: null, score: 0 }];
  const seen = new Set<string>([repetitionKey(start).text]);
  const heap: number[] = [0];
  for (let expanded = 0; expanded < EXPANSIONS_PER_FRAME && heap.length > 0; expanded += 1) {
    const id = pop(heap, nodes);
    const position = nodes[id]?.position;
    if (position === undefined) return null;
    for (const move of generateLegalMoves(position)) {
      const next = applyLegalMove(position, move);
      if (!next.ok || pieceCount(next.value, matingColor) < pieces) continue;
      const child = next.value;
      if (
        position.sideToMove === matingColor &&
        isInCheck(child, lone) &&
        generateLegalMoves(child).length === 0
      ) {
        return [...lineTo(nodes, id), move];
      }
      const key = repetitionKey(child).text;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({
        position: child,
        parent: id,
        move,
        score: distanceToPattern(child, matingColor, frame, shape),
      });
      push(heap, nodes, nodes.length - 1);
    }
  }
  return null;
}

/**
 * Replays `line` from `position` with the public API: every move must be
 * legal, no position before the last may be checkmate or stalemate (no move
 * is played after either), and the last position must be checkmate won by
 * `matingColor`. Repetition and the halfmove clock are not consulted.
 */
export function isVerifiedMatingLine(
  position: Position,
  matingColor: Color,
  line: readonly MoveIntent[],
): boolean {
  let current = position;
  for (const move of line) {
    if (evaluateMoveExhaustion(current) !== null) return false;
    const next = applyLegalMove(current, move);
    if (!next.ok) return false;
    current = next.value;
  }
  const end = evaluateMoveExhaustion(current);
  return end?.kind === "checkmate" && end.winner === matingColor;
}

/**
 * A verified cooperative mating line for `matingColor` from `position`, or
 * `null` when the bounded search finds none. `null` proves nothing. An empty
 * line means the position is already checkmate won by `matingColor`.
 */
export function searchCooperativeMate(
  position: Position,
  matingColor: Color,
  shape: WitnessShape,
): readonly MoveIntent[] | null {
  if (evaluateMoveExhaustion(position) !== null) {
    return isVerifiedMatingLine(position, matingColor, []) ? Object.freeze([]) : null;
  }
  for (const frame of framesFor(position, matingColor)) {
    const line = searchFrame(position, matingColor, frame, shape);
    if (line !== null && isVerifiedMatingLine(position, matingColor, line)) {
      return Object.freeze(line);
    }
  }
  return null;
}
