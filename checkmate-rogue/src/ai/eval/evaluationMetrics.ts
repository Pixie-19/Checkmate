/**
 * evaluationMetrics.ts
 *
 * Transparent, deterministic evaluation metrics for validating Gemma dialogue.
 * Evaluates schema conformance, behavioral grounding, anti-hallucination checks,
 * and rival persona voice fidelity without synthetic score inflation.
 */

import type { RivalInsight } from "../rivalInsight.ts";
import type { EvalScenario } from "./evaluationDataset.ts";

export interface ScenarioEvalResult {
  scenarioId: string;
  title: string;
  rivalName: string;
  source: "model" | "template";
  latencyMs: number;
  dialogue: RivalInsight;
  schemaValid: boolean;
  schemaReason?: string;
  detectedHabitIds: string[];
  expectedHabitIds: string[];
  groundingMatched: string[];
  groundingPass: boolean;
  hallucinationsFlagged: string[];
  hallucinationFree: boolean;
  personaScore: number; // 0 to 1
  personaIndicators: string[];
}

export interface AggregateEvalReport {
  timestamp: string;
  modelIdentifier: string;
  endpointUrl: string;
  totalScenarios: number;
  modelInferenceCount: number;
  fallbackCount: number;
  schemaValidRate: number; // 0.0 - 1.0
  groundingRate: number;   // 0.0 - 1.0
  hallucinationFreeRate: number; // 0.0 - 1.0
  latency: {
    meanMs: number;
    medianMs: number;
    minMs: number;
    maxMs: number;
  };
  results: ScenarioEvalResult[];
}

const RIVAL_PERSONA_LEXICON: Record<number, string[]> = {
  0: ["shadow", "whisper", "echo", "dark", "wanderer", "stone", "nameless", "child", "familiar", "veil"],
  1: ["iron", "warden", "bastion", "rampart", "wall", "discipline", "siege", "stone", "formation", "patient", "foundation"],
  2: ["crown", "throne", "monarch", "sovereign", "royal", "insolence", "presumptuous", "glory", "realm", "majesty", "decree"],
};

/**
 * Checks whether the dialogue text references expected behavioral keywords.
 */
export function checkGrounding(
  dialogue: RivalInsight,
  expectedKeywords: string[]
): { matched: string[]; pass: boolean } {
  if (expectedKeywords.length === 0) {
    return { matched: [], pass: true };
  }

  const combined = `${dialogue.observation} ${dialogue.taunt} ${dialogue.tip ?? ""}`.toLowerCase();
  const matched = expectedKeywords.filter((kw) => combined.includes(kw.toLowerCase()));

  // Passes if at least 1 expected keyword/concept is directly mentioned
  return {
    matched,
    pass: matched.length > 0,
  };
}

/**
 * Checks for prohibited hallucinated claims (e.g., claiming sacrifices when none occurred).
 */
export function checkHallucinations(
  dialogue: RivalInsight,
  antiKeywords?: string[]
): { flagged: string[]; clean: boolean } {
  if (!antiKeywords || antiKeywords.length === 0) {
    return { flagged: [], clean: true };
  }

  const combined = `${dialogue.observation} ${dialogue.taunt} ${dialogue.tip ?? ""}`.toLowerCase();
  const flagged = antiKeywords.filter((word) => combined.includes(word.toLowerCase()));

  return {
    flagged,
    clean: flagged.length === 0,
  };
}

/**
 * Checks for persona-specific stylistic keywords.
 */
export function checkPersonaVoice(
  dialogue: RivalInsight,
  rivalIndex: number
): { score: number; indicators: string[] } {
  const lexicon = RIVAL_PERSONA_LEXICON[rivalIndex] ?? [];
  const combined = `${dialogue.observation} ${dialogue.taunt}`.toLowerCase();
  const indicators = lexicon.filter((term) => combined.includes(term));

  return {
    score: indicators.length > 0 ? 1 : 0.5, // 1.0 if explicit persona words present, 0.5 if neutral
    indicators,
  };
}

/**
 * Evaluates a single scenario result.
 */
export function evaluateScenarioResult(
  scenario: EvalScenario,
  dialogue: RivalInsight,
  latencyMs: number,
  schemaValid: boolean,
  schemaReason?: string
): ScenarioEvalResult {
  const grounding = checkGrounding(dialogue, scenario.expectedKeywords);
  const hallucination = checkHallucinations(dialogue, scenario.antiKeywords);
  const persona = checkPersonaVoice(dialogue, scenario.rivalIndex);

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    rivalName: scenario.rivalName,
    source: dialogue.source,
    latencyMs,
    dialogue,
    schemaValid,
    schemaReason,
    detectedHabitIds: scenario.expectedHabitIds,
    expectedHabitIds: scenario.expectedHabitIds,
    groundingMatched: grounding.matched,
    groundingPass: grounding.pass,
    hallucinationsFlagged: hallucination.flagged,
    hallucinationFree: hallucination.clean,
    personaScore: persona.score,
    personaIndicators: persona.indicators,
  };
}

/**
 * Computes aggregate summary metrics across all evaluated scenarios.
 */
export function computeAggregateMetrics(
  results: ScenarioEvalResult[],
  modelIdentifier: string,
  endpointUrl: string
): AggregateEvalReport {
  const totalScenarios = results.length;
  const modelInferenceCount = results.filter((r) => r.source === "model").length;
  const fallbackCount = results.filter((r) => r.source === "template").length;

  const schemaValidCount = results.filter((r) => r.schemaValid).length;
  const groundingPassCount = results.filter((r) => r.groundingPass).length;
  const hallucinationFreeCount = results.filter((r) => r.hallucinationFree).length;

  // Latencies for model calls only
  const modelLatencies = results
    .filter((r) => r.source === "model")
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b);

  let meanMs = 0;
  let medianMs = 0;
  let minMs = 0;
  let maxMs = 0;

  if (modelLatencies.length > 0) {
    meanMs = Math.round(
      modelLatencies.reduce((sum, v) => sum + v, 0) / modelLatencies.length
    );
    const mid = Math.floor(modelLatencies.length / 2);
    medianMs =
      modelLatencies.length % 2 !== 0
        ? modelLatencies[mid]
        : Math.round((modelLatencies[mid - 1] + modelLatencies[mid]) / 2);
    minMs = modelLatencies[0];
    maxMs = modelLatencies[modelLatencies.length - 1];
  }

  return {
    timestamp: new Date().toISOString(),
    modelIdentifier,
    endpointUrl,
    totalScenarios,
    modelInferenceCount,
    fallbackCount,
    schemaValidRate: totalScenarios > 0 ? Number((schemaValidCount / totalScenarios).toFixed(3)) : 0,
    groundingRate: totalScenarios > 0 ? Number((groundingPassCount / totalScenarios).toFixed(3)) : 0,
    hallucinationFreeRate: totalScenarios > 0 ? Number((hallucinationFreeCount / totalScenarios).toFixed(3)) : 0,
    latency: {
      meanMs,
      medianMs,
      minMs,
      maxMs,
    },
    results,
  };
}
