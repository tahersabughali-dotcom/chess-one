import { formatFen, type Position, pieceAt } from "@chess-one/chess-rules";
import { fileIndex, parseMoveIntent, rankIndex, squareIndex } from "@chess-one/game-values";
import { checkersOf } from "./attack-oracle.ts";

/**
 * Test-only replay for claim-history fixtures made of knight moves. It checks
 * knight geometry, empty destinations, and that no king is left or put in
 * check. It is a fixture integrity check, not the move engine.
 */
export function applyQuietKnightMove(position: Position, uci: string): Position {
  const intent = parseMoveIntent({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  if (!intent.ok || uci.length !== 4) throw new Error(`${uci}: malformed`);
  const { from, to } = intent.value;
  const piece = pieceAt(position, from);
  if (piece === null || piece.kind !== "knight" || piece.color !== position.sideToMove) {
    throw new Error(`${uci}: no knight of the side to move on ${from}`);
  }
  const df = Math.abs(fileIndex(to) - fileIndex(from));
  const dr = Math.abs(rankIndex(to) - rankIndex(from));
  if (!((df === 1 && dr === 2) || (df === 2 && dr === 1)))
    throw new Error(`${uci}: not a knight jump`);
  if (pieceAt(position, to) !== null) throw new Error(`${uci}: destination occupied`);

  const board = [...position.board];
  board[squareIndex(to)] = piece;
  board[squareIndex(from)] = null;
  const next: Position = {
    board,
    sideToMove: position.sideToMove === "white" ? "black" : "white",
    castling: position.castling,
    enPassantTarget: null,
    halfmoveClock: position.halfmoveClock + 1,
    fullmoveNumber: position.fullmoveNumber + (position.sideToMove === "black" ? 1 : 0),
  };
  if (checkersOf(next, position.sideToMove).length > 0)
    throw new Error(`${uci}: leaves own king in check`);
  if (checkersOf(next, next.sideToMove).length > 0) throw new Error(`${uci}: gives check`);
  return next;
}

/** FIDE 9.2.3 identity: placement, side to move, castling rights, and en passant availability. */
export function repetitionKey(position: Position): string {
  return formatFen(position).split(" ").slice(0, 4).join(" ");
}

export function replay(start: Position, plies: readonly string[]): readonly Position[] {
  const positions: Position[] = [start];
  let current = start;
  for (const uci of plies) {
    current = applyQuietKnightMove(current, uci);
    positions.push(current);
  }
  return positions;
}
