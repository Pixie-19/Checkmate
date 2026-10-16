/**
 * evaluationDataset.test.ts
 *
 * Verifies chess legality, habit extraction fidelity, and metric calculations
 * across all 16 evaluation scenarios.
 */

import { describe, it, expect } from "vitest";
import {
  EVALUATION_SCENARIOS,
  buildScenarioContext,
} from "./evaluationDataset";
import {
  checkGrounding,
  checkHallucinations,
  checkPersonaVoice,
  computeAggregateMetrics,
  evaluateScenarioResult,
} from "./evaluationMetrics";
import type { RivalInsight } from "../rivalInsight";

describe("Evaluation Dataset Scenarios Verification", () => {
  it("contains exactly 16 scenarios covering 12 distinct habit profiles & edge cases", () => {
    expect(EVALUATION_SCENARIOS).toHaveLength(16);
  });

  for (const scenario of EVALUATION_SCENARIOS) {
    it(`scenario ${scenario.id} (${scenario.title}) replays legally and matches habit expectations`, () => {
      const { chess, profile } = buildScenarioContext(scenario);

      // Verify move history length matches scenario input
      expect(chess.history()).toHaveLength(scenario.moves.length);

      // Verify habit extraction
      const detectedIds = profile.insights.map((i) => i.id);

      if (scenario.shouldFallbackToTemplate) {
        expect(profile.insights.length === 0 || !profile.hasSufficientEvidence).toBe(true);
      } else {
        expect(profile.hasSufficientEvidence).toBe(true);
        for (const expectedHabit of scenario.expectedHabitIds) {
          expect(detectedIds).toContain(expectedHabit);
        }
      }
    });
  }
});

describe("Evaluation Metrics Logic", () => {
  const dummyInsight: RivalInsight = {
    observation: "Your Queen wanders across the stones in reckless haste.",
    taunt: "A lone queen invites only defeat.",
    tip: "Develop your knights and bishops first.",
    source: "model",
  };

  it("identifies present keywords in grounding check", () => {
    const res = checkGrounding(dummyInsight, ["queen", "knights"]);
    expect(res.pass).toBe(true);
    expect(res.matched).toEqual(["queen", "knights"]);
  });

  it("fails grounding if expected keywords are absent", () => {
    const res = checkGrounding(dummyInsight, ["castled", "rooks"]);
    expect(res.pass).toBe(false);
    expect(res.matched).toHaveLength(0);
  });

  it("passes hallucination check when anti-keywords are absent", () => {
    const res = checkHallucinations(dummyInsight, ["sacrificed", "checkmate"]);
    expect(res.clean).toBe(true);
    expect(res.flagged).toHaveLength(0);
  });

  it("flags hallucinations when prohibited claims appear", () => {
    const hallucinatedInsight: RivalInsight = {
      ...dummyInsight,
      taunt: "You sacrificed your bishop for nothing.",
    };
    const res = checkHallucinations(hallucinatedInsight, ["sacrificed"]);
    expect(res.clean).toBe(false);
    expect(res.flagged).toEqual(["sacrificed"]);
  });

  it("evaluates persona voice correctly", () => {
    const wardenInsight: RivalInsight = {
      observation: "The iron ramparts stand unyielding.",
      taunt: "Our discipline shatters your frantic charge.",
      source: "model",
    };
    const res = checkPersonaVoice(wardenInsight, 1);
    expect(res.score).toBe(1);
    expect(res.indicators).toContain("iron");
    expect(res.indicators).toContain("rampart");
  });

  it("computes aggregate metrics accurately", () => {
    const scn = EVALUATION_SCENARIOS[0];
    const item1 = evaluateScenarioResult(scn, dummyInsight, 1200, true);
    const item2 = evaluateScenarioResult(scn, dummyInsight, 1800, true);

    const report = computeAggregateMetrics([item1, item2], "gemma2:2b", "http://localhost:11434");
    expect(report.totalScenarios).toBe(2);
    expect(report.modelInferenceCount).toBe(2);
    expect(report.schemaValidRate).toBe(1.0);
    expect(report.groundingRate).toBe(1.0);
    expect(report.latency.meanMs).toBe(1500);
    expect(report.latency.medianMs).toBe(1500);
  });
});
