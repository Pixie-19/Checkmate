/**
 * evaluationDataset.ts
 *
 * 16 realistic, legally verified chess scenarios designed to evaluate
 * Gemma 2 2B's behavioral grounding, schema adherence, rival persona fidelity,
 * and deterministic fallback behavior.
 */

import { Chess } from "chess.js";
import {
  analyzePlayerBehavior,
  type PlayerBehaviorProfile,
} from "../playerBehavior.ts";
import type { EngineDifficulty } from "../../engine/stockfish.ts";
import type { RivalContext } from "../rivalInsight.ts";

export interface EvalScenario {
  id: string;
  title: string;
  description: string;
  rivalIndex: number;
  rivalName: string;
  difficulty: EngineDifficulty;
  phase: "opening" | "midgame" | "endgame";
  moves: string[]; // Legal SAN moves (White is player, Black is rival)
  expectedHabitIds: string[];
  expectedKeywords: string[];
  antiKeywords?: string[]; // Words the model must NOT claim (e.g., claimed sacrifice when none occurred)
  shouldFallbackToTemplate: boolean;
  notes: string;
}

export const EVALUATION_SCENARIOS: EvalScenario[] = [
  {
    id: "SCN-01",
    title: "Isolated Early Queen Development",
    description: "Player develops Queen on move 2 (Qh5) without repeating queen moves, while minor pieces remain undeveloped.",
    rivalIndex: 0,
    rivalName: "The Nameless Rival",
    difficulty: "apprentice",
    phase: "opening",
    moves: ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "d3", "d6"],
    expectedHabitIds: ["early-queen-development"],
    expectedKeywords: ["queen", "early", "haste", "alone", "royalty"],
    antiKeywords: ["sacrificed", "sacrifice", "castled"],
    shouldFallbackToTemplate: false,
    notes: "Tests whether Gemma isolates the queen advance without claiming repeated moves or pieces lost.",
  },
  {
    id: "SCN-02",
    title: "Repeated Queen Movement (Wayward Queen)",
    description: "Player moves Queen on moves 2, 3, and 4 (Qh5, Qf3, Qe3), neglecting army development.",
    rivalIndex: 0,
    rivalName: "The Nameless Rival",
    difficulty: "apprentice",
    phase: "opening",
    moves: ["e4", "e5", "Qh5", "Nc6", "Qf3", "Nf6", "Qe3", "d6"],
    expectedHabitIds: ["early-queen-development", "repeated-piece-moves"],
    expectedKeywords: ["queen", "repeated", "again", "wander", "haste"],
    antiKeywords: ["sacrificed", "checkmate"],
    shouldFallbackToTemplate: false,
    notes: "Tests dual-habit synthesis: early queen + repeated maneuvering.",
  },
  {
    id: "SCN-03",
    title: "Repeated Knight Maneuvering",
    description: "Player moves the same King's Knight 3 times in the first 4 moves (Nf3, Ne5, Ng4, Ne3).",
    rivalIndex: 1,
    rivalName: "The Iron Warden",
    difficulty: "knight",
    phase: "opening",
    moves: ["Nf3", "d5", "Ne5", "Nd7", "Ng4", "e5", "Ne3", "c6"],
    expectedHabitIds: ["repeated-piece-moves"],
    expectedKeywords: ["knight", "horse", "repeated", "wander", "steed"],
    antiKeywords: ["queen", "sacrificed", "castled"],
    shouldFallbackToTemplate: false,
    notes: "Tests repeated minor piece identification and Iron Warden's disciplined scorn of wandering cavalry.",
  },
  {
    id: "SCN-04",
    title: "Early Kingside Castling",
    description: "Classical Italian opening with disciplined Kingside castling on move 4.",
    rivalIndex: 0,
    rivalName: "The Nameless Rival",
    difficulty: "apprentice",
    phase: "opening",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6"],
    expectedHabitIds: ["kingside-castle"],
    expectedKeywords: ["castle", "castled", "king", "shelter", "wall", "bastion"],
    antiKeywords: ["queen", "sacrificed", "reckless"],
    shouldFallbackToTemplate: false,
    notes: "Tests acknowledgment of sound defensive habits.",
  },
  {
    id: "SCN-05",
    title: "Pure Early Queenside Castling",
    description: "Sound Queen's pawn development with Queenside castling on move 8.",
    rivalIndex: 1,
    rivalName: "The Iron Warden",
    difficulty: "knight",
    phase: "opening",
    moves: [
      "d4", "d5",
      "Nc3", "Nf6",
      "Bf4", "Bf5",
      "Nf3", "e6",
      "e3", "c6",
      "Bd3", "Be7",
      "Qd2", "Nbd7",
      "O-O-O", "O-O",
    ],
    expectedHabitIds: ["queenside-castle"],
    expectedKeywords: ["queenside", "castle", "castling", "rampart", "wall", "shelter", "king"],
    antiKeywords: ["kingside", "sacrificed"],
    shouldFallbackToTemplate: false,
    notes: "Tests discrimination between kingside and queenside castling in Iron Warden persona.",
  },
  {
    id: "SCN-06",
    title: "Delayed Castling (Prolonged Center Exposure)",
    description: "Player maneuvers cautiously in the center, delaying castling until move 10.",
    rivalIndex: 1,
    rivalName: "The Iron Warden",
    difficulty: "knight",
    phase: "opening",
    moves: [
      "e4", "e5",
      "Nf3", "Nc6",
      "d3", "Nf6",
      "h3", "d6",
      "a3", "a6",
      "Be3", "Be7",
      "Nc3", "Be6",
      "Qd2", "Qd7",
      "Be2", "h6",
      "O-O", "O-O",
    ],
    expectedHabitIds: ["delayed-castle"],
    expectedKeywords: ["delay", "delayed", "hesitation", "finally", "shelter", "linger", "castle", "castling", "maneuver", "wall"],
    antiKeywords: ["queen", "sacrificed"],
    shouldFallbackToTemplate: false,
    notes: "Tests detection of delayed castling cadence vs instant castling.",
  },
  {
    id: "SCN-07",
    title: "Uncastled King in the Open Center",
    description: "Player completes 10 moves with central king exposed on e1 without castling.",
    rivalIndex: 2,
    rivalName: "The Crown Keeper",
    difficulty: "boss",
    phase: "midgame",
    moves: [
      "e4", "e5",
      "Nf3", "Nc6",
      "Bc4", "Bc5",
      "d3", "Nf6",
      "Nc3", "d6",
      "Bg5", "Be6",
      "Nd5", "Bxd5",
      "Bxd5", "Qd7",
      "Bxf6", "gxf6",
      "c3", "O-O-O",
      "Qd2", "Rhg8",
    ],
    expectedHabitIds: ["uncastled-king"],
    expectedKeywords: ["center", "uncastled", "exposed", "shelter", "king"],
    antiKeywords: ["castled", "safe behind"],
    shouldFallbackToTemplate: false,
    notes: "Tests Crown Keeper sovereign reproach of an unshielded monarch.",
  },
  {
    id: "SCN-08",
    title: "Pawn-Heavy Opening (Aggressive Pawn Storm)",
    description: "Player pushes pawns on 5 of their first 6 moves (83% pawn ratio).",
    rivalIndex: 1,
    rivalName: "The Iron Warden",
    difficulty: "knight",
    phase: "opening",
    moves: [
      "e4", "e5",
      "d4", "d6",
      "c4", "Nf6",
      "f3", "Be7",
      "g4", "O-O",
      "h4", "c6",
    ],
    expectedHabitIds: ["pawn-heavy-opening"],
    expectedKeywords: ["pawn", "pawns", "infantry", "storm", "push", "advance"],
    antiKeywords: ["sacrificed", "queen"],
    shouldFallbackToTemplate: false,
    notes: "Tests recognition of overextended pawn structures and weakness in rear ranks.",
  },
  {
    id: "SCN-09",
    title: "Frequent Checks Assault",
    description: "Player delivers 3 direct checks against the enemy king in early skirmishes.",
    rivalIndex: 2,
    rivalName: "The Crown Keeper",
    difficulty: "boss",
    phase: "opening",
    moves: [
      "e4", "e5",
      "Nf3", "Nc6",
      "Bc4", "d6",
      "Bxf7+", "Kxf7",
      "d4", "exd4",
      "Ng5+", "Ke8",
      "O-O", "Be7",
      "Qh5+", "g6",
    ],
    expectedHabitIds: ["frequent-checks"],
    expectedKeywords: ["check", "checks", "harass", "pursuit", "king"],
    antiKeywords: ["castled safe"],
    shouldFallbackToTemplate: false,
    notes: "Tests Crown Keeper mocking futile, premature checks as petty harassment.",
  },
  {
    id: "SCN-10",
    title: "High Capture Ratio (Aggressive Trades)",
    description: "Player initiates captures on 50% of their turns in the opening (3 captures in 6 moves).",
    rivalIndex: 1,
    rivalName: "The Iron Warden",
    difficulty: "knight",
    phase: "opening",
    moves: [
      "e4", "d5",
      "exd5", "Nf6",
      "c4", "c6",
      "dxc6", "Nxc6",
      "Nf3", "e5",
      "Nxe5", "Nxe5",
    ],
    expectedHabitIds: ["high-capture-rate"],
    expectedKeywords: ["trade", "capture", "blood", "exchange", "pieces"],
    antiKeywords: ["passive", "retreat"],
    shouldFallbackToTemplate: false,
    notes: "Tests recognition of tactical bloodthirst and piece trading.",
  },
  {
    id: "SCN-11",
    title: "Early Queen Loss under Tactical Crossfire",
    description: "Player brings Queen out to d2, moves to e3, and it is captured by Black on move 4.",
    rivalIndex: 0,
    rivalName: "The Nameless Rival",
    difficulty: "apprentice",
    phase: "opening",
    moves: [
      "e4", "d5",
      "d4", "dxe4",
      "Qd2", "Qxd4",
      "Qe3", "Qxe3+",
      "Bxe3",
    ],
    expectedHabitIds: ["early-queen-loss"],
    expectedKeywords: ["queen", "lost", "fallen", "perished", "sovereign"],
    antiKeywords: ["safe queen"],
    shouldFallbackToTemplate: false,
    notes: "Tests haunting observation of blundering the queen in the opening.",
  },
  {
    id: "SCN-12",
    title: "Insufficient Evidence Gate (< 3 Moves)",
    description: "Only 2 moves played by White (e4, Nf3). Insufficient data to warrant model call.",
    rivalIndex: 0,
    rivalName: "The Nameless Rival",
    difficulty: "apprentice",
    phase: "opening",
    moves: ["e4", "e5", "Nf3", "Nc6"],
    expectedHabitIds: [],
    expectedKeywords: [],
    shouldFallbackToTemplate: true,
    notes: "Crucial performance boundary: verifies that < 3 moves triggers deterministic template without Ollama HTTP call.",
  },
  {
    id: "SCN-13",
    title: "Harmonious Classical Development (Zero Habits Flagged)",
    description: "Player plays 5 disciplined opening moves (e4, Nf3, Bc4, d3, Nc3) without early queen, repeated moves, or pawn storm.",
    rivalIndex: 0,
    rivalName: "The Nameless Rival",
    difficulty: "apprentice",
    phase: "opening",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6", "Nc3", "d6"],
    expectedHabitIds: [],
    expectedKeywords: [],
    shouldFallbackToTemplate: true,
    notes: "Verifies that when evidence exists but no bad habits are flagged, template fallback is used seamlessly.",
  },
  {
    id: "SCN-14",
    title: "Triple Compound Habits: Queen + Repeat + Uncastled",
    description: "Player repeatedly moves Queen (4 times), fails to castle, leaving King vulnerable through 10 moves.",
    rivalIndex: 2,
    rivalName: "The Crown Keeper",
    difficulty: "boss",
    phase: "opening",
    moves: [
      "e4", "e5",
      "Qh5", "Nc6",
      "Qf3", "Nf6",
      "Qe3", "d6",
      "h3", "Be7",
      "d3", "O-O",
      "a3", "Be6",
      "Ne2", "d5",
      "Nd2", "d4",
      "Qg3", "Nh5",
    ],
    expectedHabitIds: ["early-queen-development", "repeated-piece-moves", "uncastled-king"],
    expectedKeywords: ["queen", "center", "uncastled", "repeat"],
    antiKeywords: ["castled"],
    shouldFallbackToTemplate: false,
    notes: "Tests complex habit synthesis under Crown Keeper persona.",
  },
  {
    id: "SCN-15",
    title: "Iron Warden Persona: Fortified Delayed Castling",
    description: "Militaristic encounter testing Iron Warden's voice on delayed fortification.",
    rivalIndex: 1,
    rivalName: "The Iron Warden",
    difficulty: "knight",
    phase: "opening",
    moves: [
      "e4", "e5",
      "Nf3", "Nc6",
      "d3", "Nf6",
      "h3", "d6",
      "a3", "a6",
      "Be3", "Be7",
      "Nc3", "Be6",
      "Qd2", "Qd7",
      "Be2", "h6",
      "O-O", "O-O",
    ],
    expectedHabitIds: ["delayed-castle"],
    expectedKeywords: ["rampart", "wall", "discipline", "iron", "fortress", "delayed", "delay", "castle", "castling", "patience", "maneuver"],
    antiKeywords: ["sacrificed"],
    shouldFallbackToTemplate: false,
    notes: "Tests Iron Warden fortress vocabulary and patient siege theme.",
  },
  {
    id: "SCN-16",
    title: "Crown Keeper Persona: Regal Judgment on Relentless Checks",
    description: "Royal encounter testing Crown Keeper's regal majesty when challenged by insolent checks.",
    rivalIndex: 2,
    rivalName: "The Crown Keeper",
    difficulty: "boss",
    phase: "opening",
    moves: [
      "e4", "e5",
      "Nf3", "Nc6",
      "Bc4", "d6",
      "Bxf7+", "Kxf7",
      "d4", "exd4",
      "Ng5+", "Ke8",
      "O-O", "Be7",
      "Qh5+", "g6",
    ],
    expectedHabitIds: ["frequent-checks"],
    expectedKeywords: ["throne", "crown", "insolence", "check", "majesty", "presumptuous"],
    antiKeywords: ["castled safe"],
    shouldFallbackToTemplate: false,
    notes: "Tests Crown Keeper throne vocabulary and royal dismissal of checks.",
  },
];

/**
 * Replays a scenario through chess.js and builds the exact RivalContext.
 */
export function buildScenarioContext(scenario: EvalScenario): {
  chess: Chess;
  profile: PlayerBehaviorProfile;
  context: RivalContext;
} {
  const chess = new Chess();
  for (const san of scenario.moves) {
    const res = chess.move(san);
    if (!res) {
      throw new Error(
        `Scenario ${scenario.id}: Invalid move "${san}" in sequence: ${scenario.moves.join(" ")}`
      );
    }
  }

  const profile = analyzePlayerBehavior(chess, "w");
  const lastMove = chess.history({ verbose: true }).slice(-1)[0];

  const context: RivalContext = {
    rivalName: scenario.rivalName,
    rivalIndex: scenario.rivalIndex,
    difficulty: scenario.difficulty,
    phase: scenario.phase,
    profile,
    moveCount: profile.totalPlayerMoves,
    lastPlayerMoveSan: lastMove?.color === "w" ? lastMove.san : undefined,
    isCheck: chess.isCheck(),
    outcome: undefined,
  };

  return { chess, profile, context };
}
