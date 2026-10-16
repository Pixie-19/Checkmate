/**
 * playerBehavior.ts
 *
 * Pure, deterministic analyzer of player chess behavior.
 * Evaluates move history to identify repeatable habits, opening patterns,
 * and tactical tendencies without guessing or calling external engines.
 */

import type { Chess, Move, Square } from "chess.js";

export type ConfidenceLevel = "low" | "medium" | "high";

export interface BehaviorInsight {
  id: string;
  title: string;
  description: string;
  confidence: ConfidenceLevel;
  evidence: string[];
  count?: number;
}

export interface PlayerBehaviorSummary {
  totalPlayerMoves: number;
  openingQueenMoves: number;
  repeatedPieceMoveCount: number;
  castled: boolean;
  castledMoveNumber: number | null;
  castlingSide: "kingside" | "queenside" | null;
  pawnMoveCount: number;
  pawnMoveRatio: number;
  captureCount: number;
  captureRatio: number;
  checkCount: number;
  materialLostCount: number;
}

export interface PlayerBehaviorProfile {
  totalPlayerMoves: number;
  hasSufficientEvidence: boolean;
  insights: BehaviorInsight[];
  summary: PlayerBehaviorSummary;
}

interface PieceTracker {
  id: string;
  piece: string;
  currentSquare: Square;
  moves: { san: string; moveNumber: number; from: Square; to: Square }[];
}

const PIECE_NAMES: Record<string, string> = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};

/**
 * Extracts verbose move history from either a Chess instance or a Move array.
 */
function getVerboseHistory(input: Chess | readonly Move[]): readonly Move[] {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof (input as Chess).history === "function") {
    return (input as Chess).history({ verbose: true });
  }
  return [];
}

/**
 * Deterministically analyzes player moves from a game or move history.
 *
 * @param input Chess game instance or array of Move objects
 * @param playerColor Color of the player being analyzed (default: "w" for player)
 */
export function analyzePlayerBehavior(
  input: Chess | readonly Move[],
  playerColor: "w" | "b" = "w"
): PlayerBehaviorProfile {
  const allMoves = getVerboseHistory(input);

  // Determine whether allMoves contains full game (both colors) or only player moves
  const hasBothColors = allMoves.some((m) => m.color !== playerColor);

  // Player moves with calculated turn/move numbers (1-indexed)
  const playerMovesWithTurn: { move: Move; moveNumber: number }[] = [];
  const opponentMovesWithTurn: { move: Move; moveNumber: number }[] = [];

  let whiteTurn = 1;
  let blackTurn = 1;

  for (const m of allMoves) {
    if (m.color === "w") {
      if (playerColor === "w") {
        playerMovesWithTurn.push({ move: m, moveNumber: whiteTurn });
      } else {
        opponentMovesWithTurn.push({ move: m, moveNumber: whiteTurn });
      }
      whiteTurn++;
    } else {
      if (playerColor === "b") {
        playerMovesWithTurn.push({ move: m, moveNumber: blackTurn });
      } else {
        opponentMovesWithTurn.push({ move: m, moveNumber: blackTurn });
      }
      blackTurn++;
    }
  }

  const totalPlayerMoves = playerMovesWithTurn.length;

  // Baseline summary defaults
  const summary: PlayerBehaviorSummary = {
    totalPlayerMoves,
    openingQueenMoves: 0,
    repeatedPieceMoveCount: 0,
    castled: false,
    castledMoveNumber: null,
    castlingSide: null,
    pawnMoveCount: 0,
    pawnMoveRatio: 0,
    captureCount: 0,
    captureRatio: 0,
    checkCount: 0,
    materialLostCount: 0,
  };

  // If insufficient evidence (< 3 player moves), return empty insights
  if (totalPlayerMoves < 3) {
    return {
      totalPlayerMoves,
      hasSufficientEvidence: false,
      insights: [],
      summary,
    };
  }

  const insights: BehaviorInsight[] = [];

  // -------------------------------------------------------------------------
  // 1. Early Queen Development (moves <= 6)
  // -------------------------------------------------------------------------
  const earlyQueenMoves = playerMovesWithTurn.filter(
    (item) => item.move.piece === "q" && item.moveNumber <= 6
  );
  summary.openingQueenMoves = earlyQueenMoves.length;

  if (earlyQueenMoves.length >= 1) {
    const isMultiple = earlyQueenMoves.length >= 2;
    insights.push({
      id: "early-queen-development",
      title: "Early Queen Development",
      description:
        "Developed the queen early in the opening phase before completing minor piece development.",
      confidence: isMultiple ? "high" : "medium",
      evidence: earlyQueenMoves.map(
        (eq) => `Queen to ${eq.move.to} on move ${eq.moveNumber} (${eq.move.san})`
      ),
      count: earlyQueenMoves.length,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Repeated Piece Movement in the Opening (first 10 moves)
  // Traces non-pawn piece paths: starting from square X, moving, and continuing.
  // -------------------------------------------------------------------------
  const openingPlayerMoves = playerMovesWithTurn.filter((m) => m.moveNumber <= 10);
  const activePieces: PieceTracker[] = [];

  for (const item of openingPlayerMoves) {
    const { move, moveNumber } = item;
    if (move.piece === "p") continue; // Pawns analyzed separately

    // Find if an existing tracked piece was at move.from
    const existing = activePieces.find(
      (p) => p.piece === move.piece && p.currentSquare === move.from
    );

    if (existing) {
      existing.currentSquare = move.to;
      existing.moves.push({
        san: move.san,
        moveNumber,
        from: move.from,
        to: move.to,
      });
    } else {
      activePieces.push({
        id: `${move.piece}-${move.from}`,
        piece: move.piece,
        currentSquare: move.to,
        moves: [{ san: move.san, moveNumber, from: move.from, to: move.to }],
      });
    }
  }

  // Check for pieces moved 2+ times in the opening
  const repeatedPieces = activePieces.filter((p) => p.moves.length >= 2);
  let maxRepeatedMoves = 0;

  for (const rp of repeatedPieces) {
    if (rp.moves.length > maxRepeatedMoves) {
      maxRepeatedMoves = rp.moves.length;
    }
  }
  summary.repeatedPieceMoveCount = maxRepeatedMoves;

  // Insight triggered if a piece was moved 3+ times, or 2 times within <= 6 opening moves
  const significantRepeats = repeatedPieces.filter(
    (rp) => rp.moves.length >= 3 || (rp.moves.length === 2 && openingPlayerMoves.length <= 6)
  );

  for (const sr of significantRepeats) {
    const pieceName = PIECE_NAMES[sr.piece] ?? "Piece";
    const moveDescriptions = sr.moves
      .map((m) => `${m.san} (move ${m.moveNumber})`)
      .join(", ");

    insights.push({
      id: "repeated-piece-moves",
      title: "Repeated Piece Movement",
      description: `Moved the same ${pieceName} ${sr.moves.length} times during the opening phase.`,
      confidence: sr.moves.length >= 3 ? "high" : "medium",
      evidence: [
        `${pieceName} moved ${sr.moves.length} times in opening: ${moveDescriptions}`,
      ],
      count: sr.moves.length,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Castling Behavior
  // -------------------------------------------------------------------------
  const castlingMove = playerMovesWithTurn.find(
    (m) =>
      m.move.flags.includes("k") ||
      m.move.flags.includes("q") ||
      m.move.san === "O-O" ||
      m.move.san === "O-O-O"
  );

  if (castlingMove) {
    summary.castled = true;
    summary.castledMoveNumber = castlingMove.moveNumber;
    const isQueenside =
      castlingMove.move.flags.includes("q") || castlingMove.move.san === "O-O-O";
    summary.castlingSide = isQueenside ? "queenside" : "kingside";

    if (castlingMove.moveNumber <= 8) {
      insights.push({
        id: isQueenside ? "queenside-castle" : "kingside-castle",
        title: isQueenside ? "Early Queenside Castling" : "Early Kingside Castling",
        description: `Castled on move ${castlingMove.moveNumber} to safeguard the king early.`,
        confidence: "high",
        evidence: [
          `Castled ${summary.castlingSide} on move ${castlingMove.moveNumber} (${castlingMove.move.san})`,
        ],
        count: 1,
      });
    } else {
      insights.push({
        id: "delayed-castle",
        title: "Delayed Castling",
        description: `Castled on move ${castlingMove.moveNumber} after prolonged piece maneuvering.`,
        confidence: "medium",
        evidence: [
          `Castled ${summary.castlingSide} on move ${castlingMove.moveNumber} (${castlingMove.move.san})`,
        ],
        count: 1,
      });
    }
  } else if (totalPlayerMoves >= 10) {
    insights.push({
      id: "uncastled-king",
      title: "Uncastled King",
      description: "Kept the king uncastled in the center through 10+ moves.",
      confidence: totalPlayerMoves >= 14 ? "high" : "medium",
      evidence: [`No castling move played across ${totalPlayerMoves} player moves`],
      count: 0,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Pawn Advancement and Opening Pawn Density
  // -------------------------------------------------------------------------
  const openingPawnMoves = openingPlayerMoves.filter((m) => m.move.piece === "p");
  summary.pawnMoveCount = openingPawnMoves.length;
  summary.pawnMoveRatio =
    openingPlayerMoves.length > 0
      ? openingPawnMoves.length / openingPlayerMoves.length
      : 0;

  if (openingPlayerMoves.length >= 5 && summary.pawnMoveRatio >= 0.6) {
    const pct = Math.round(summary.pawnMoveRatio * 100);
    insights.push({
      id: "pawn-heavy-opening",
      title: "Pawn-Heavy Opening",
      description: `Pushed pawns on ${summary.pawnMoveCount} of the first ${openingPlayerMoves.length} moves (${pct}%).`,
      confidence: summary.pawnMoveCount >= 5 ? "high" : "medium",
      evidence: [
        `${summary.pawnMoveCount} pawn moves in first ${openingPlayerMoves.length} moves: ` +
          openingPawnMoves.map((p) => p.move.san).join(", "),
      ],
      count: summary.pawnMoveCount,
    });
  }

  // -------------------------------------------------------------------------
  // 5. Checks and Captures
  // -------------------------------------------------------------------------
  const checkMoves = playerMovesWithTurn.filter(
    (m) => m.move.san.includes("+") || m.move.san.includes("#")
  );
  summary.checkCount = checkMoves.length;

  if (checkMoves.length >= 3) {
    insights.push({
      id: "frequent-checks",
      title: "Frequent Checks",
      description: `Delivered ${checkMoves.length} checks, exerting direct pressure on the rival king.`,
      confidence: checkMoves.length >= 4 ? "high" : "medium",
      evidence: checkMoves.map(
        (cm) => `${cm.move.san} on move ${cm.moveNumber}`
      ),
      count: checkMoves.length,
    });
  }

  const captureMoves = playerMovesWithTurn.filter(
    (m) => Boolean(m.move.captured) || m.move.flags.includes("c")
  );
  summary.captureCount = captureMoves.length;
  summary.captureRatio =
    totalPlayerMoves > 0 ? captureMoves.length / totalPlayerMoves : 0;

  if (totalPlayerMoves >= 6 && summary.captureRatio >= 0.4 && captureMoves.length >= 3) {
    const pct = Math.round(summary.captureRatio * 100);
    insights.push({
      id: "high-capture-rate",
      title: "High Capture Tendency",
      description: `Made captures on ${captureMoves.length} of ${totalPlayerMoves} moves (${pct}%).`,
      confidence: captureMoves.length >= 5 ? "high" : "medium",
      evidence: [
        `${captureMoves.length} captures across ${totalPlayerMoves} player moves`,
      ],
      count: captureMoves.length,
    });
  }

  // -------------------------------------------------------------------------
  // 6. Material Losses (Calculated Reliably from Opponent verbose moves)
  // -------------------------------------------------------------------------
  if (hasBothColors && opponentMovesWithTurn.length > 0) {
    const opponentCaptures = opponentMovesWithTurn.filter((m) =>
      Boolean(m.move.captured)
    );
    summary.materialLostCount = opponentCaptures.length;

    // Detect early queen loss (queen taken on move <= 10)
    const earlyQueenLoss = opponentCaptures.find(
      (m) => m.move.captured === "q" && m.moveNumber <= 10
    );

    if (earlyQueenLoss) {
      insights.push({
        id: "early-queen-loss",
        title: "Early Queen Loss",
        description: "Lost the queen during the opening phase.",
        confidence: "high",
        evidence: [
          `Queen captured by rival's ${earlyQueenLoss.move.san} on move ${earlyQueenLoss.moveNumber}`,
        ],
        count: 1,
      });
    }
  }

  return {
    totalPlayerMoves,
    hasSufficientEvidence: true,
    insights,
    summary,
  };
}
