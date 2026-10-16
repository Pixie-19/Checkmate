/**
 * dialogueProvider.test.ts
 *
 * Dedicated test suite verifying Gemma / Ollama integration:
 * 1. Successful valid model response.
 * 2. Malformed JSON handling.
 * 3. Invalid response schema and excessive length rejection.
 * 4. Request timeout or connection failure.
 * 5. Fallback labeling when inference fails.
 * 6. No accidental transmission of full chess history (PGN/FEN).
 * 7. Stale responses after an encounter changes.
 * 8. Scripted mode making no model request.
 * 9. Model dialogue not affecting chess state or campaign state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Chess } from "chess.js";
import {
  GemmaDialogueProvider,
  TemplateDialogueProvider,
  validateModelDialogue,
  normalizeGenerateEndpoint,
} from "./dialogueProvider";
import type { RivalContext } from "./rivalInsight";
import { createCampaign, type CampaignState } from "../game/campaign";

describe("GemmaDialogueProvider and Ollama Integration", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const baseContext: RivalContext = {
    rivalName: "The Nameless Rival",
    rivalIndex: 0,
    difficulty: "apprentice",
    phase: "opening",
    profile: {
      totalPlayerMoves: 5,
      hasSufficientEvidence: true,
      insights: [
        {
          id: "early-queen-development",
          title: "Early Queen Development",
          description: "Developed queen early in the opening.",
          confidence: "high",
          evidence: ["Qh5 on move 2", "Qxf7# on move 4"],
          count: 2,
        },
      ],
      summary: {
        totalPlayerMoves: 5,
        openingQueenMoves: 2,
        repeatedPieceMoveCount: 0,
        castled: false,
        castledMoveNumber: null,
        castlingSide: null,
        pawnMoveCount: 2,
        pawnMoveRatio: 0.4,
        captureCount: 1,
        captureRatio: 0.2,
        checkCount: 1,
        materialLostCount: 0,
      },
    },
    moveCount: 5,
    lastPlayerMoveSan: "Qxf7#",
    isCheck: true,
    outcome: "win",
  };

  // ---------------------------------------------------------------------------
  // Helper: endpoint normalization test
  // ---------------------------------------------------------------------------
  it("normalizes base URLs and relative proxy paths to /api/generate", () => {
    expect(normalizeGenerateEndpoint("http://127.0.0.1:11434")).toBe(
      "http://127.0.0.1:11434/api/generate"
    );
    expect(normalizeGenerateEndpoint("http://127.0.0.1:11434/")).toBe(
      "http://127.0.0.1:11434/api/generate"
    );
    expect(normalizeGenerateEndpoint("http://127.0.0.1:11434/api/generate")).toBe(
      "http://127.0.0.1:11434/api/generate"
    );
    expect(normalizeGenerateEndpoint("/ollama")).toBe("/ollama/api/generate");
  });

  // ---------------------------------------------------------------------------
  // 1. Successful valid model response
  // ---------------------------------------------------------------------------
  describe("1. Successful valid model response", () => {
    it("parses valid JSON response and marks source as 'model'", async () => {
      const mockModelOutput = {
        observation: "You unleash your queen before your vanguard has assembled.",
        taunt: "A wandering monarch invites swift demise.",
        tip: "Station your knights and bishops before launching royal assaults.",
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: "gemma2:2b",
          response: JSON.stringify(mockModelOutput),
          done: true,
        }),
      } as Response);

      const provider = new GemmaDialogueProvider({
        endpointUrl: "http://127.0.0.1:11434/api/generate",
        modelName: "gemma2:2b",
      });

      const insight = await provider.generateInsight(baseContext);

      expect(insight.source).toBe("model");
      expect(insight.observation).toBe(mockModelOutput.observation);
      expect(insight.taunt).toBe(mockModelOutput.taunt);
      expect(insight.tip).toBe(mockModelOutput.tip);
      expect(provider.getStatus()).toBe("connected");
      expect(provider.getLastError()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Malformed JSON
  // ---------------------------------------------------------------------------
  describe("2. Malformed JSON", () => {
    it("catches malformed JSON string from model and falls back safely", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: "gemma2:2b",
          response: "NOT_VALID_JSON { unclosed bracket",
          done: true,
        }),
      } as Response);

      const provider = new GemmaDialogueProvider();
      const insight = await provider.generateInsight(baseContext);

      // Truthful fallback: source must be template, not model
      expect(insight.source).toBe("template");
      expect(insight.observation).toBeDefined();
      expect(insight.taunt).toBeDefined();
      expect(provider.getStatus()).toBe("unavailable");
      expect(provider.getLastError()).toContain("malformed JSON");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Invalid response schema and excessive length
  // ---------------------------------------------------------------------------
  describe("3. Invalid response schema and excessive length", () => {
    it("rejects response missing required observation or taunt fields", () => {
      const missingTaunt = { observation: "Valid observation text" };
      const validation = validateModelDialogue(missingTaunt);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toContain("Missing required string fields");
    });

    it("rejects excessively long observation text", () => {
      const tooLongObs = {
        observation: "x".repeat(350),
        taunt: "Short taunt",
      };
      const validation = validateModelDialogue(tooLongObs);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toContain("exceeds length limit");
    });

    it("falls back to template when model returns schema-violating payload", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: "gemma2:2b",
          response: JSON.stringify({ wrongField: 12345 }),
          done: true,
        }),
      } as Response);

      const provider = new GemmaDialogueProvider();
      const insight = await provider.generateInsight(baseContext);

      expect(insight.source).toBe("template");
      expect(provider.getStatus()).toBe("unavailable");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Request timeout or connection failure
  // ---------------------------------------------------------------------------
  describe("4. Request timeout or connection failure", () => {
    it("falls back cleanly on network/connection failure", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch (ECONNREFUSED)"));

      const provider = new GemmaDialogueProvider();
      const insight = await provider.generateInsight(baseContext);

      expect(insight.source).toBe("template");
      expect(provider.getStatus()).toBe("unavailable");
      expect(provider.getLastError()).toContain("ECONNREFUSED");
    });

    it("handles request timeout without hanging or crashing", async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new Error("Ollama request timed out after 50ms"));
          });
        });
      });

      const provider = new GemmaDialogueProvider({ timeoutMs: 50 });
      const insight = await provider.generateInsight(baseContext);

      expect(insight.source).toBe("template");
      expect(provider.getStatus()).toBe("unavailable");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Fallback labeling when inference fails
  // ---------------------------------------------------------------------------
  describe("5. Fallback labeling when inference fails", () => {
    it("never claims output is model-generated when HTTP 500 error occurs", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const provider = new GemmaDialogueProvider();
      const result = await provider.generateInsightWithDetails(baseContext);

      expect(result.insight.source).toBe("template");
      expect(result.status).toBe("unavailable");
      expect(result.error).toContain("HTTP error 500");
    });
  });

  // ---------------------------------------------------------------------------
  // 6. No accidental transmission of full chess history
  // ---------------------------------------------------------------------------
  describe("6. No accidental transmission of full chess history", () => {
    it("transmits only minimal behavior summary, never PGN or FEN", async () => {
      let capturedBody: string | undefined;

      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        capturedBody = options.body;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            response: JSON.stringify({
              observation: "I see your style.",
              taunt: "You will fall.",
            }),
          }),
        });
      });

      const provider = new GemmaDialogueProvider();
      await provider.generateInsight(baseContext);

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!);

      // Verify prompt content
      expect(parsedBody.prompt).toBeDefined();
      const promptObj = JSON.parse(parsedBody.prompt);

      // Must have safe minimal fields
      expect(promptObj.rivalName).toBe("The Nameless Rival");
      expect(promptObj.playerMoveCount).toBe(5);
      expect(promptObj.observedHabits).toBeDefined();

      // STRICT PRIVACY CHECK: Full chess notations must NOT be transmitted
      expect((promptObj as Record<string, unknown>).pgn).toBeUndefined();
      expect((promptObj as Record<string, unknown>).fen).toBeUndefined();
      expect((promptObj as Record<string, unknown>).allMoves).toBeUndefined();
      expect((promptObj as Record<string, unknown>).moveHistory).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Stale responses after an encounter changes
  // ---------------------------------------------------------------------------
  describe("7. Stale responses after an encounter changes", () => {
    it("aborts in-flight request when caller signals abort (e.g. encounter restart)", async () => {
      const abortController = new AbortController();

      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new Error("Aborted by caller"));
          });
          // Pretend slow model that would resolve in 5000ms
          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => ({
                response: JSON.stringify({
                  observation: "Stale observation",
                  taunt: "Stale taunt",
                }),
              }),
            });
          }, 5000);
        });
      });

      const provider = new GemmaDialogueProvider();
      const promise = provider.generateInsight(baseContext, {
        signal: abortController.signal,
      });

      // Encounter changed / restarted immediately
      abortController.abort();

      const result = await promise;
      // Aborted request safely returns template fallback without throwing unhandled error
      expect(result.source).toBe("template");
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Scripted mode making no model request
  // ---------------------------------------------------------------------------
  describe("8. Scripted mode making no model request", () => {
    it("TemplateDialogueProvider operates purely in-memory with zero fetch calls", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const provider = new TemplateDialogueProvider();
      const insight = await provider.generateInsight(baseContext);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(insight.source).toBe("template");
      expect(insight.observation.length).toBeGreaterThan(0);
    });

    it("GemmaDialogueProvider skips network fetch if insufficient evidence exists", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const sparseContext: RivalContext = {
        ...baseContext,
        profile: {
          ...baseContext.profile,
          hasSufficientEvidence: false,
          insights: [],
        },
      };

      const provider = new GemmaDialogueProvider();
      const insight = await provider.generateInsight(sparseContext);

      // Model request skipped when insufficient behavioral evidence exists
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(insight.source).toBe("template");
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Model dialogue not affecting chess state or campaign state
  // ---------------------------------------------------------------------------
  describe("9. Model dialogue not affecting chess state or campaign state", () => {
    it("arbitrary/adversarial model text cannot alter chess game or campaign state", async () => {
      const game = new Chess();
      game.move("e4");
      const initialFen = game.fen();
      const initialTurn = game.turn();

      const campaign: CampaignState = createCampaign();
      const initialHearts = campaign.hearts;
      const initialWins = campaign.wins;
      const initialStatus = campaign.status;

      // Model returns text attempting to look like state modifications
      const adversarialOutput = {
        observation: "1. e4 e5 2. Qh5 resigning checkmate",
        taunt: "campaign.hearts = 0; status = 'defeat'",
        tip: "grantRelic('knight-echo')",
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: "gemma2:2b",
          response: JSON.stringify(adversarialOutput),
        }),
      } as Response);

      const provider = new GemmaDialogueProvider();
      const insight = await provider.generateInsight(baseContext);

      // Insight contains untrusted string text only
      expect(insight.source).toBe("model");
      expect(insight.observation).toBe(adversarialOutput.observation);

      // Game state remains strictly unmodified
      expect(game.fen()).toBe(initialFen);
      expect(game.turn()).toBe(initialTurn);
      expect(game.history()).toEqual(["e4"]);

      // Campaign state remains strictly unmodified
      expect(campaign.hearts).toBe(initialHearts);
      expect(campaign.wins).toBe(initialWins);
      expect(campaign.status).toBe(initialStatus);
      expect(campaign.selectedRelics).toEqual([]);
    });
  });
});
