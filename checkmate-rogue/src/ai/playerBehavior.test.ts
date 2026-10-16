/**
 * playerBehavior.test.ts
 *
 * Comprehensive tests for the Adaptive Rival Intelligence System:
 * 1. Empty history and insufficient evidence
 * 2. Detection of a behavior with known example moves
 * 3. Repeated piece movement
 * 4. Deterministic output for identical histories
 * 5. Player moves versus Stockfish moves
 * 6. Aggregation across encounters
 * 7. New-run reset and encounter restart behavior
 * 8. Knight's Echo undo without double-counting
 * 9. Malformed provider output and fallback dialogue
 * 10. Template provider operation without a model installed
 */

import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  analyzePlayerBehavior,
} from "./playerBehavior";
import {
  generateTemplateInsight,
  validateRivalInsight,
  FALLBACK_RIVAL_INSIGHT,
  type RivalContext,
} from "./rivalInsight";
import {
  TemplateDialogueProvider,
  GemmaDialogueProvider,
} from "./dialogueProvider";
import {
  createCampaign,
  recordEncounterBehavior,
  getAggregatedCampaignStats,
  type EncounterBehaviorRecord,
} from "../game/campaign";
import { applyUndo } from "../game/relicEffects";

describe("Adaptive Rival Intelligence System", () => {
  // ---------------------------------------------------------------------------
  // 1. Empty history and insufficient evidence
  // ---------------------------------------------------------------------------
  describe("1. Empty history and insufficient evidence", () => {
    it("returns zero player moves and no insights for empty array", () => {
      const profile = analyzePlayerBehavior([]);
      expect(profile.totalPlayerMoves).toBe(0);
      expect(profile.hasSufficientEvidence).toBe(false);
      expect(profile.insights).toEqual([]);
    });

    it("returns insufficient evidence for a brand new game with 0 moves", () => {
      const game = new Chess();
      const profile = analyzePlayerBehavior(game);
      expect(profile.totalPlayerMoves).toBe(0);
      expect(profile.hasSufficientEvidence).toBe(false);
      expect(profile.insights).toHaveLength(0);
    });

    it("does not emit premature insights when fewer than 3 player moves exist", () => {
      const game = new Chess();
      game.move("e4");
      game.move("e5");
      game.move("Qh5"); // 2nd White move
      game.move("Nc6");

      const profile = analyzePlayerBehavior(game, "w");
      expect(profile.totalPlayerMoves).toBe(2);
      expect(profile.hasSufficientEvidence).toBe(false);
      expect(profile.insights).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Detection of a behavior with known example moves
  // ---------------------------------------------------------------------------
  describe("2. Detection of early queen development", () => {
    it("detects early queen sally in Scholar's Mate attack", () => {
      const game = new Chess();
      game.move("e4");
      game.move("e5");
      game.move("Qh5"); // Move 2: Queen to h5
      game.move("Nc6");
      game.move("Bc4"); // Move 3: Bishop to c4
      game.move("Nf6");
      game.move("Qxf7#"); // Move 4: Queen delivers checkmate

      const profile = analyzePlayerBehavior(game, "w");
      expect(profile.hasSufficientEvidence).toBe(true);
      expect(profile.summary.openingQueenMoves).toBe(2);

      const insight = profile.insights.find(
        (i) => i.id === "early-queen-development"
      );
      expect(insight).toBeDefined();
      expect(insight?.confidence).toBe("high");
      expect(insight?.count).toBe(2);
      expect(insight?.evidence.some((e) => e.includes("Qh5"))).toBe(true);
      expect(insight?.evidence.some((e) => e.includes("Qxf7#"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Repeated piece movement
  // ---------------------------------------------------------------------------
  describe("3. Repeated piece movement", () => {
    it("detects same knight moved 3 times in opening", () => {
      const game = new Chess();
      game.move("Nc3"); // Move 1: Knight b1 -> c3
      game.move("e5");
      game.move("Ne4"); // Move 2: Knight c3 -> e4
      game.move("d5");
      game.move("Ng3"); // Move 3: Knight e4 -> g3
      game.move("c5");
      game.move("e4"); // Move 4: Pawn e4 (to reach 4 moves)

      const profile = analyzePlayerBehavior(game, "w");
      expect(profile.hasSufficientEvidence).toBe(true);
      expect(profile.summary.repeatedPieceMoveCount).toBe(3);

      const repeatInsight = profile.insights.find(
        (i) => i.id === "repeated-piece-moves"
      );
      expect(repeatInsight).toBeDefined();
      expect(repeatInsight?.count).toBe(3);
      expect(repeatInsight?.confidence).toBe("high");
      expect(repeatInsight?.evidence[0]).toContain("Knight moved 3 times");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Deterministic output for identical histories
  // ---------------------------------------------------------------------------
  describe("4. Deterministic output for identical histories", () => {
    it("produces identical behavior profiles across repeated runs", () => {
      const game = new Chess();
      game.move("e4"); game.move("e5");
      game.move("Nf3"); game.move("Nc6");
      game.move("Bc4"); game.move("Bc5");
      game.move("O-O"); game.move("Nf6");

      const profile1 = analyzePlayerBehavior(game, "w");
      const profile2 = analyzePlayerBehavior(game, "w");
      expect(profile1).toEqual(profile2);

      const dummyContext: RivalContext = {
        rivalName: "The Iron Warden",
        rivalIndex: 1,
        difficulty: "knight",
        phase: "midgame",
        profile: profile1,
        moveCount: profile1.totalPlayerMoves,
      };

      const insight1 = generateTemplateInsight(dummyContext);
      const insight2 = generateTemplateInsight(dummyContext);
      expect(insight1).toEqual(insight2);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Player moves versus Stockfish moves
  // ---------------------------------------------------------------------------
  describe("5. Player moves versus Stockfish moves", () => {
    it("does not attribute Stockfish (Black) moves to the player (White)", () => {
      const game = new Chess();
      // White plays standard pawn moves
      game.move("e4");
      // Black (rival) moves queen early
      game.move("e5");
      game.move("d4");
      game.move("Qh4"); // Black queen
      game.move("Nc3");
      game.move("Qxe4+"); // Black queen capture and check
      game.move("Be2");

      const whiteProfile = analyzePlayerBehavior(game, "w");
      // White did not move Queen
      expect(whiteProfile.summary.openingQueenMoves).toBe(0);
      expect(
        whiteProfile.insights.some((i) => i.id === "early-queen-development")
      ).toBe(false);

      // Analyze Black's behavior explicitly
      const blackProfile = analyzePlayerBehavior(game, "b");
      expect(blackProfile.summary.openingQueenMoves).toBe(2);
      expect(
        blackProfile.insights.some((i) => i.id === "early-queen-development")
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Aggregation across encounters
  // ---------------------------------------------------------------------------
  describe("6. Aggregation across encounters", () => {
    it("correctly aggregates stats across multiple encounter records", () => {
      let campaign = createCampaign();

      const encounter1: EncounterBehaviorRecord = {
        encounterIndex: 0,
        rivalName: "The Nameless Rival",
        outcome: "win",
        playerMoveCount: 14,
        castled: true,
        castlingSide: "kingside",
        openingQueenMoves: 0,
        repeatedPieceMoveCount: 1,
        pawnMoveCount: 4,
        captureCount: 3,
        checkCount: 1,
        topInsightIds: ["kingside-castle"],
      };

      const encounter2: EncounterBehaviorRecord = {
        encounterIndex: 1,
        rivalName: "The Iron Warden",
        outcome: "win",
        playerMoveCount: 22,
        castled: false,
        castlingSide: null,
        openingQueenMoves: 2,
        repeatedPieceMoveCount: 3,
        pawnMoveCount: 8,
        captureCount: 6,
        checkCount: 2,
        topInsightIds: ["early-queen-development", "repeated-piece-moves"],
      };

      campaign = recordEncounterBehavior(campaign, encounter1);
      campaign = recordEncounterBehavior(campaign, encounter2);

      const stats = getAggregatedCampaignStats(campaign);
      expect(stats.encountersCompleted).toBe(2);
      expect(stats.totalPlayerMoves).toBe(36);
      expect(stats.totalCaptures).toBe(9);
      expect(stats.totalChecks).toBe(3);
      expect(stats.timesCastled).toBe(1);
      expect(stats.earlyQueenEncounters).toBe(1);
      expect(stats.records).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. New-run reset and encounter restart behavior
  // ---------------------------------------------------------------------------
  describe("7. New-run reset and encounter restart behavior", () => {
    it("retains encounter behavior when restarting or retrying encounters", () => {
      let campaign = createCampaign();
      campaign = recordEncounterBehavior(campaign, {
        encounterIndex: 0,
        rivalName: "The Nameless Rival",
        outcome: "win",
        playerMoveCount: 12,
        castled: true,
        castlingSide: "kingside",
        openingQueenMoves: 0,
        repeatedPieceMoveCount: 1,
        pawnMoveCount: 3,
        captureCount: 2,
        checkCount: 0,
        topInsightIds: ["kingside-castle"],
      });

      // An encounter restart only touches local UI/board, campaign object is preserved
      expect(campaign.encounterBehaviors).toHaveLength(1);

      // Starting a new run creates fresh campaign, resetting history
      const freshCampaign = createCampaign();
      expect(freshCampaign.encounterBehaviors).toEqual([]);
      expect(getAggregatedCampaignStats(freshCampaign).encountersCompleted).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Knight's Echo undo without double-counting
  // ---------------------------------------------------------------------------
  describe("8. Knight's Echo undo without double-counting", () => {
    it("discards undone moves so they do not contaminate the behavior profile", () => {
      const game = new Chess();
      game.move("e4");
      game.move("e5");
      game.move("Nf3");
      game.move("Nc6");
      // White plays early queen move:
      game.move("Qe2");

      // Before undo, White has 3 moves including queen move
      const beforeUndo = analyzePlayerBehavior(game, "w");
      expect(beforeUndo.summary.openingQueenMoves).toBe(1);

      // Player triggers Knight's Echo before Stockfish replies
      const undoneGame = applyUndo(game, false);
      const afterUndo = analyzePlayerBehavior(undoneGame, "w");

      // Queen move was undone, leaving only e4 and Nf3
      expect(afterUndo.totalPlayerMoves).toBe(2);
      expect(afterUndo.summary.openingQueenMoves).toBe(0);
      expect(
        afterUndo.insights.some((i) => i.id === "early-queen-development")
      ).toBe(false);
    });

    it("handles paired undo when Stockfish had already replied", () => {
      const game = new Chess();
      game.move("e4");
      game.move("e5");
      game.move("Nf3");
      game.move("Nc6");
      game.move("Bc4"); // Player move 3
      game.move("Bc5"); // Stockfish reply 3

      // Undo both half-moves
      const undone = applyUndo(game, true);
      const profile = analyzePlayerBehavior(undone, "w");

      // Final accepted history has only 2 White moves (e4, Nf3)
      expect(profile.totalPlayerMoves).toBe(2);
      expect(undone.history()).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Malformed provider output and fallback dialogue
  // ---------------------------------------------------------------------------
  describe("9. Malformed provider output and fallback dialogue", () => {
    it("returns safe fallback when given null or non-object", () => {
      const insight = validateRivalInsight(null);
      expect(insight.observation).toBe(FALLBACK_RIVAL_INSIGHT.observation);
      expect(insight.taunt).toBe(FALLBACK_RIVAL_INSIGHT.taunt);
      expect(insight.source).toBe("template");
    });

    it("fills missing fields with fallback values when given partial object", () => {
      const partial = {
        observation: "I see your move.",
        // taunt is missing
        source: "model",
      };
      const insight = validateRivalInsight(partial, "model");
      expect(insight.observation).toBe("I see your move.");
      expect(insight.taunt).toBe(FALLBACK_RIVAL_INSIGHT.taunt);
      expect(insight.source).toBe("model");
    });

    it("handles empty or whitespace-only strings gracefully", () => {
      const malformed = {
        observation: "   ",
        taunt: "",
      };
      const insight = validateRivalInsight(malformed);
      expect(insight.observation).toBe(FALLBACK_RIVAL_INSIGHT.observation);
      expect(insight.taunt).toBe(FALLBACK_RIVAL_INSIGHT.taunt);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Template provider operation without a model installed
  // ---------------------------------------------------------------------------
  describe("10. Template provider operation without a model installed", () => {
    const context: RivalContext = {
      rivalName: "The Nameless Rival",
      rivalIndex: 0,
      difficulty: "apprentice",
      phase: "opening",
      profile: {
        totalPlayerMoves: 4,
        hasSufficientEvidence: true,
        insights: [
          {
            id: "early-queen-development",
            title: "Early Queen Development",
            description: "Developed queen early.",
            confidence: "high",
            evidence: ["Qh5 on move 2"],
            count: 1,
          },
        ],
        summary: {
          totalPlayerMoves: 4,
          openingQueenMoves: 1,
          repeatedPieceMoveCount: 0,
          castled: false,
          castledMoveNumber: null,
          castlingSide: null,
          pawnMoveCount: 2,
          pawnMoveRatio: 0.5,
          captureCount: 0,
          captureRatio: 0,
          checkCount: 0,
          materialLostCount: 0,
        },
      },
      moveCount: 4,
    };

    it("runs synchronously and asynchronously with TemplateDialogueProvider", async () => {
      const provider = new TemplateDialogueProvider();
      expect(provider.isModelDriven).toBe(false);
      expect(provider.id).toBe("template");

      const syncResult = provider.generateInsightSync(context);
      expect(syncResult.source).toBe("template");
      expect(syncResult.observation).toContain("Queen");

      const asyncResult = await provider.generateInsight(context);
      expect(asyncResult.source).toBe("template");
      expect(asyncResult.observation).toBe(syncResult.observation);
    });

    it("GemmaDialogueProvider safely falls back to template when unconfigured or unreachable", async () => {
      const provider = new GemmaDialogueProvider({
        endpointUrl: "http://127.0.0.1:9999/api/generate",
        timeoutMs: 100,
      });
      expect(provider.isModelDriven).toBe(true);

      const result = await provider.generateInsight(context);
      // Honestly reports source as template when no model server is reached
      expect(result.source).toBe("template");
      expect(result.observation).toBeDefined();
      expect(result.taunt).toBeDefined();
    });

    it("GemmaDialogueProvider constructs only minimal, non-sensitive payload", () => {
      const provider = new GemmaDialogueProvider();
      const payload = provider.buildMinimalPayload(context);

      expect(payload.rivalName).toBe("The Nameless Rival");
      expect(payload.playerMoveCount).toBe(4);
      expect(payload.topHabitIds).toEqual(["early-queen-development"]);
      // Never contains raw moves, PGN, or FEN
      expect((payload as unknown as Record<string, unknown>).pgn).toBeUndefined();
      expect((payload as unknown as Record<string, unknown>).fen).toBeUndefined();
    });
  });
});
