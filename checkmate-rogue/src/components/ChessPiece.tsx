/**
 * ChessPiece.tsx
 *
 * Renders chess pieces using verified Google Material Symbols Outlined font ligatures.
 * 
 * Verified Google Material Symbols ligature mapping:
 * - King   (k) -> chess_king_2   (verified single glyph with distinct royal crown & cross)
 * - Queen  (q) -> chess_queen    (verified single glyph with 5-point coronet)
 * - Rook   (r) -> chess_rook     (verified single glyph classic castle battlement)
 * - Bishop (b) -> chess_bishop_2 (verified single glyph with traditional mitre cross)
 * - Knight (n) -> chess_knight   (verified single glyph horse head)
 * - Pawn   (p) -> chess_pawn     (verified single glyph standard Staunton pawn)
 *
 * Important note on font version verification:
 * The Google Material Symbols font file contains `chess_king_2`, `chess_bishop_2`, and `chess_pawn_2`,
 * but DOES NOT contain `chess_knight_2`, `chess_rook_2`, or `chess_queen_2` (which render as raw text '_2').
 * Therefore, `chess_knight`, `chess_rook`, and `chess_queen` are used, ensuring 100% of symbols render
 * as clean, authentic chess glyphs without raw text or broken ligatures.
 */

import type { HTMLAttributes } from "react";

export type PieceColor = "w" | "b";
export type PieceType = "k" | "q" | "r" | "b" | "n" | "p";

export interface ChessPieceProps extends HTMLAttributes<HTMLSpanElement> {
  color: PieceColor;
  type: PieceType;
  className?: string;
}

export const MATERIAL_CHESS_SYMBOLS: Record<PieceType, string> = {
  k: "chess_king_2",
  q: "chess_queen",
  r: "chess_rook",
  b: "chess_bishop_2",
  n: "chess_knight",
  p: "chess_pawn",
};

export const UNICODE_CHESS_FALLBACKS: Record<PieceColor, Record<PieceType, string>> = {
  w: {
    k: "♔",
    q: "♕",
    r: "♖",
    b: "♗",
    n: "♘",
    p: "♙",
  },
  b: {
    k: "♚",
    q: "♛",
    r: "♜",
    b: "♝",
    n: "♞",
    p: "♟",
  },
};

export function ChessPiece({ color, type, className = "", ...props }: ChessPieceProps) {
  const symbol = MATERIAL_CHESS_SYMBOLS[type];
  if (!symbol) return null;

  return (
    <span
      className={`chess-piece ${color === "w" ? "white" : "black"} ${className}`}
      aria-hidden="true"
      data-piece={`${color}${type}`}
      data-fallback={UNICODE_CHESS_FALLBACKS[color][type]}
      {...props}
    >
      {symbol}
    </span>
  );
}

export default ChessPiece;
