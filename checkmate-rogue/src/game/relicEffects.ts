/**
 * relicEffects.ts
 *
 * Pure functions for relic game-mechanics. No React, no Stockfish calls here —
 * they are kept pure so they can be unit-tested without a browser environment.
 */

import { Chess, type Move } from "chess.js";

// ---------------------------------------------------------------------------
// Piece values used for defensive scoring
// ---------------------------------------------------------------------------
const PIECE_VALUE: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

/**
 * Scores how "defensive" a white move is, for Fortress Pact.
 *
 * Higher = more defensive. Priority order:
 *   1. Move gets out of check (necessary move).
 *   2. Move captures a high-value attacker.
 *   3. Move defends a threatened high-value piece.
 *   4. Move improves king safety (king castles or moves away from center).
 *   5. Any legal move (baseline).
 *
 * Returns a numeric score; the caller picks the highest-scoring legal move.
 */
export function scoreDefensiveMove(game: Chess, move: Move): number {
  let score = 0;

  // Priority 1: If White is in check, any legal move resolves it — bonus for
  // moves that escape check.
  if (game.isCheck()) {
    score += 500;
  }

  // Priority 2: Capture bonus proportional to captured piece value.
  if (move.captured) {
    score += PIECE_VALUE[move.captured] * 20;
  }

  // Priority 3: Castling (king safety).
  if (move.flags.includes("k") || move.flags.includes("q")) {
    score += 80;
  }

  // Priority 4: Bonus for moving a high-value piece out of a threatened square.
  // We check whether the source square is attacked by the opponent *before* the
  // move (i.e., in the current position) using a probe game.
  const pieceMoved = game.get(move.from);
  if (pieceMoved) {
    const pieceVal = PIECE_VALUE[pieceMoved.type] ?? 1;

    // Is the piece currently on a square attacked by black?
    const probeAttacked = isSquareAttackedBy(game, move.from, "b");
    if (probeAttacked) {
      // Escaping a threatened piece: bonus proportional to piece value.
      score += pieceVal * 15;
    }

    // Extra bonus for moving a queen or rook to safety.
    if (pieceMoved.type === "q" || pieceMoved.type === "r") {
      score += 10;
    }
  }

  return score;
}

/**
 * Returns true if the given square is attacked by any piece of `byColor`.
 * Uses chess.js `isAttacked()` which is stable across chess.js v1.x.
 */
function isSquareAttackedBy(
  game: Chess,
  square: string,
  byColor: "w" | "b"
): boolean {
  try {
    // chess.js v1.x: isAttacked(square, attackerColor)
    return (game as Chess & { isAttacked: (sq: string, color: "w" | "b") => boolean }).isAttacked(
      square,
      byColor
    );
  } catch {
    return false;
  }
}

/**
 * Returns the best defensive move for White in the given position, or null
 * if there are no legal moves (game already over).
 *
 * This is a *heuristic* selection, not a Stockfish result. For positions where
 * no meaningfully defensive move can be found, the highest-scoring move is
 * still returned, but the caller should inspect `wasDefensive` to decide
 * whether to show a caveat.
 */
export type DefensiveSuggestion = {
  move: Move;
  /** True when the top score was above the baseline (i.e., a genuine threat was found). */
  wasDefensive: boolean;
};

export function getBestDefensiveMove(game: Chess): DefensiveSuggestion | null {
  if (game.turn() !== "w") return null;

  const moves = game.moves({ verbose: true }) as Move[];
  if (moves.length === 0) return null;

  let best = moves[0];
  let bestScore = scoreDefensiveMove(game, moves[0]);

  for (let i = 1; i < moves.length; i++) {
    const s = scoreDefensiveMove(game, moves[i]);
    if (s > bestScore) {
      bestScore = s;
      best = moves[i];
    }
  }

  return {
    move: best,
    // "Defensive" if any positive signal was found beyond baseline.
    wasDefensive: bestScore > 0,
  };
}

// ---------------------------------------------------------------------------
// Knight's Echo — Undo eligibility
// ---------------------------------------------------------------------------

export type UndoEligibility =
  | { canUndo: true }
  | { canUndo: false; reason: string };

/**
 * Determines whether the undo action is available for Knight's Echo.
 *
 * Rules:
 *  - The relic must not have been used yet this encounter (caller's responsibility).
 *  - There must be at least two half-moves in history (White played, Black replied).
 *    OR exactly one half-move (White played, Black hasn't replied yet).
 *  - If it's currently Black's turn, the engine is (or was) thinking; the last
 *    move was White's move, so we CAN undo that white move (only), putting us
 *    back to White's turn. This is safe.
 *  - If it's White's turn and the last move was Black's (i.e., the engine has
 *    already replied), we must undo TWO half-moves (Black's then White's) to
 *    return to a proper White-to-move position. Both moves are undone together.
 *    This is allowed but the caller must note that history is shorter.
 *  - The game must not be over.
 *  - There must be at least one White move to undo.
 */
export function checkUndoEligibility(
  game: Chess,
  engineHasReplied: boolean
): UndoEligibility {
  if (game.isGameOver()) {
    return { canUndo: false, reason: "The game has ended." };
  }

  const hist = game.history({ verbose: true }) as Move[];
  if (hist.length === 0) {
    return { canUndo: false, reason: "No moves have been made yet." };
  }

  const lastMove = hist[hist.length - 1];

  if (engineHasReplied) {
    // It's White's turn; last two moves: White → Black.
    // We'll undo both to restore a clean White-to-move position.
    if (hist.length < 2) {
      return {
        canUndo: false,
        reason: "The rival has already replied. Not enough history to undo.",
      };
    }
    // Verify the last move was Black's.
    if (lastMove.color !== "b") {
      return {
        canUndo: false,
        reason: "Unexpected move order — cannot safely undo.",
      };
    }
    return { canUndo: true };
  } else {
    // Engine hasn't replied yet — it's Black's turn (or White just moved).
    // Undo only the last White move.
    if (lastMove.color !== "w") {
      return {
        canUndo: false,
        reason: "No White move to undo.",
      };
    }
    return { canUndo: true };
  }
}

/**
 * Applies the undo, returning a new Chess instance with the move(s) reversed.
 * - If `engineHasReplied` is true, undoes Black's reply then White's move (2 half-moves).
 * - Otherwise, undoes only White's last move (1 half-move).
 *
 * Uses loadPgn from a reconstructed PGN so move history is fully preserved.
 */
export function applyUndo(game: Chess, engineHasReplied: boolean): Chess {
  const hist = game.history({ verbose: true }) as Move[];
  const movesToRemove = engineHasReplied ? 2 : 1;
  const remainingMoves = hist.slice(0, hist.length - movesToRemove);

  const fresh = new Chess();
  for (const m of remainingMoves) {
    fresh.move({ from: m.from, to: m.to, promotion: m.promotion ?? "q" });
  }
  return fresh;
}
