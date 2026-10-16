/**
 * dialogueProvider.ts
 *
 * Pluggable provider architecture for rival insight dialogue.
 * Supports offline deterministic templating and robust local Ollama / Gemma
 * inference with full fallback handling, schema validation, and privacy guards.
 */

import type { RivalContext, RivalInsight } from "./rivalInsight.ts";
import {
  generateTemplateInsight,
  validateRivalInsight,
} from "./rivalInsight.ts";

/**
 * Minimal, privacy-conscious summary sent to an external model service.
 * Never transmits full PGN, board FEN, or raw move lists.
 */
export interface MinimalBehaviorSummary {
  rivalName: string;
  difficulty: string;
  phase: string;
  playerMoveCount: number;
  lastMoveSan: string | null;
  topHabitIds: string[];
  castled: boolean;
  isCheck: boolean;
  outcome?: string;
}

export interface DialogueProvider {
  readonly id: string;
  readonly name: string;
  readonly isModelDriven: boolean;
  generateInsight(
    context: RivalContext,
    options?: { signal?: AbortSignal }
  ): Promise<RivalInsight>;
}

/**
 * Deterministic template provider.
 * Runs completely locally with 0 dependencies and zero network traffic.
 */
export class TemplateDialogueProvider implements DialogueProvider {
  readonly id = "template";
  readonly name = "Deterministic Script";
  readonly isModelDriven = false;

  /**
   * Synchronous helper for instant UI rendering without asynchronous ticks.
   */
  generateInsightSync(context: RivalContext): RivalInsight {
    return generateTemplateInsight(context);
  }

  async generateInsight(context: RivalContext): Promise<RivalInsight> {
    return this.generateInsightSync(context);
  }
}

/**
 * Configuration options for the local Ollama LLM service.
 */
export interface LocalModelConfig {
  endpointUrl: string; // e.g. "http://127.0.0.1:11434/api/generate"
  modelName: string;   // e.g. "gemma2:2b"
  timeoutMs: number;   // e.g. 4000
}

/**
 * Normalizes user-supplied endpoints so both base URLs (e.g. http://127.0.0.1:11434)
 * and full endpoint URLs (e.g. /ollama/api/generate) route correctly to /api/generate.
 */
export function normalizeGenerateEndpoint(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api/generate")) {
    return trimmed;
  }
  return `${trimmed}/api/generate`;
}

/**
 * Reads Ollama configuration from Vite environment variables (VITE_OLLAMA_*)
 * with safe defaults.
 */
export function getOllamaConfigFromEnv(): LocalModelConfig {
  let envEndpoint: string | undefined;
  let envModel: string | undefined;
  let envTimeout: string | undefined;

  try {
    if (typeof import.meta !== "undefined" && import.meta.env) {
      envEndpoint = import.meta.env.VITE_OLLAMA_ENDPOINT;
      envModel = import.meta.env.VITE_OLLAMA_MODEL;
      envTimeout = import.meta.env.VITE_OLLAMA_TIMEOUT_MS;
    }
  } catch {
    // import.meta may be undefined in certain test runners
  }

  const timeoutNum = envTimeout ? Number(envTimeout) : NaN;

  return {
    endpointUrl: envEndpoint
      ? normalizeGenerateEndpoint(envEndpoint)
      : "http://127.0.0.1:11434/api/generate",
    modelName: envModel?.trim() || "gemma2:2b",
    timeoutMs: Number.isFinite(timeoutNum) && timeoutNum > 0 ? timeoutNum : 4000,
  };
}

/**
 * Dialogue validation result.
 */
export interface DialogueValidationResult {
  isValid: boolean;
  reason?: string;
  cleaned?: { observation: string; taunt: string; tip?: string };
}

/**
 * Strips markdown code block fences if returned by the model.
 */
export function cleanJsonText(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Validates model output against strict bounds:
 * - Must be an object with non-empty observation & taunt strings.
 * - Observation: 5–280 characters.
 * - Taunt: 3–200 characters.
 * - Optional tip: ≤ 250 characters.
 */
export function validateModelDialogue(data: unknown): DialogueValidationResult {
  if (!data || typeof data !== "object") {
    return { isValid: false, reason: "Response payload is not a valid JSON object" };
  }

  const record = data as Record<string, unknown>;

  // Support case resilience (e.g. Observation vs observation)
  const rawObservation = record.observation ?? record.Observation ?? record.observations;
  const rawTaunt = record.taunt ?? record.Taunt ?? record.taunts;
  const rawTip = record.tip ?? record.Tip ?? record.tips;

  if (typeof rawObservation !== "string" || typeof rawTaunt !== "string") {
    return { isValid: false, reason: "Missing required string fields 'observation' or 'taunt'" };
  }

  const observation = rawObservation.trim();
  const taunt = rawTaunt.trim();

  if (observation.length < 5) {
    return { isValid: false, reason: "Observation is too short (< 5 characters)" };
  }
  if (observation.length > 280) {
    return { isValid: false, reason: "Observation exceeds length limit (> 280 characters)" };
  }

  if (taunt.length < 3) {
    return { isValid: false, reason: "Taunt is too short (< 3 characters)" };
  }
  if (taunt.length > 200) {
    return { isValid: false, reason: "Taunt exceeds length limit (> 200 characters)" };
  }

  let tip: string | undefined;
  if (rawTip !== undefined && rawTip !== null) {
    if (typeof rawTip !== "string") {
      return { isValid: false, reason: "Tip field must be a string if provided" };
    }
    const trimmedTip = rawTip.trim();
    if (trimmedTip.length > 250) {
      return { isValid: false, reason: "Tip exceeds length limit (> 250 characters)" };
    }
    if (trimmedTip.length > 0) {
      tip = trimmedTip;
    }
  }

  return {
    isValid: true,
    cleaned: { observation, taunt, tip },
  };
}

/**
 * Builds the gothic persona system prompt for Gemma with distinct rival voices
 * and explicit anti-hallucination grounding rules.
 */
export function buildGemmaSystemPrompt(rivalName: string): string {
  let personaDirective = "";
  if (rivalName.includes("Iron Warden")) {
    personaDirective =
      "You are The Iron Warden, a disciplined, unyielding fortress commander. Speak of iron, stone ramparts, discipline, and patient siegecraft. Scorn haste and recklessness.";
  } else if (rivalName.includes("Crown Keeper")) {
    personaDirective =
      "You are The Crown Keeper, the imperious monarch of the realm. Speak from the high throne with haughty grandeur and royal majesty. Treat the challenger's clumsy attempts as insolence.";
  } else {
    personaDirective =
      "You are The Nameless Rival, an enigmatic, hooded wanderer upon the checkered stones. Speak in haunting whispers of shadows, memory, and recurring habits.";
  }

  return `${personaDirective}
Context: Checkmate Rogue, a dark gothic chess roguelike.
Rules:
1. Grounding: Explicitly address the specific player habit named in "observedHabits" (e.g. queen, knight, castling, pawns, checks, trades). Never invent moves, captures, checks, or piece sacrifices not stated.
2. Observation: 1-2 atmospheric sentences (under 240 chars) reflecting the detected habit.
3. Taunt: 1 biting sentence (under 180 chars) mocking the specific flaw in your persona's voice.
4. Tip: 1 practical chess principle (under 220 chars) that counters the observed habit; or null if no habit.
5. Format: Return RAW JSON ONLY with keys "observation", "taunt", "tip".`;
}

/**
 * Builds the minimal behavior context string for Gemma prompt.
 */
export function buildGemmaUserPrompt(context: RivalContext): string {
  const habitSummaries = context.profile.insights.map(
    (h) => `${h.title}: ${h.description} (evidence: ${h.evidence.join("; ")})`
  );

  const payload = {
    rivalName: context.rivalName,
    difficulty: context.difficulty,
    encounterPhase: context.phase,
    playerMoveCount: context.moveCount,
    lastPlayerMove: context.lastPlayerMoveSan ?? null,
    isCheck: Boolean(context.isCheck),
    outcome: context.outcome ?? "ongoing",
    observedHabits:
      habitSummaries.length > 0
        ? habitSummaries
        : ["Opening phase — no prominent habits identified yet."],
  };

  return JSON.stringify(payload);
}

export type GemmaConnectionStatus = "idle" | "loading" | "connected" | "unavailable";

/**
 * Production-ready Gemma dialogue provider connected to a local Ollama instance.
 */
export class GemmaDialogueProvider implements DialogueProvider {
  readonly id = "gemma-local";
  readonly name = "Gemma (Local Service)";
  readonly isModelDriven = true;

  private config: LocalModelConfig;
  private status: GemmaConnectionStatus = "idle";
  private lastError: string | null = null;

  constructor(config?: Partial<LocalModelConfig>) {
    const envConfig = getOllamaConfigFromEnv();
    this.config = {
      endpointUrl: config?.endpointUrl
        ? normalizeGenerateEndpoint(config.endpointUrl)
        : envConfig.endpointUrl,
      modelName: config?.modelName || envConfig.modelName,
      timeoutMs: config?.timeoutMs || envConfig.timeoutMs,
    };
  }

  getConfig(): Readonly<LocalModelConfig> {
    return this.config;
  }

  getStatus(): GemmaConnectionStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Constructs only a minimal, non-sensitive behavior summary.
   * Never transmits full PGN, FEN, or raw move histories.
   */
  buildMinimalPayload(context: RivalContext): MinimalBehaviorSummary {
    return {
      rivalName: context.rivalName,
      difficulty: context.difficulty,
      phase: context.phase,
      playerMoveCount: context.moveCount,
      lastMoveSan: context.lastPlayerMoveSan ?? null,
      topHabitIds: context.profile.insights.map((i) => i.id),
      castled: context.profile.summary.castled,
      isCheck: Boolean(context.isCheck),
      outcome: context.outcome,
    };
  }

  /**
   * Generates dialogue insight using Ollama.
   * If offline, misconfigured, timed out, or unready, safely falls back
   * to deterministic template dialogue labeled as 'template'.
   */
  async generateInsight(
    context: RivalContext,
    options?: { signal?: AbortSignal }
  ): Promise<RivalInsight> {
    const result = await this.generateInsightWithDetails(context, options);
    return result.insight;
  }

  /**
   * Extended generator returning status and error details for UI consumption.
   */
  async generateInsightWithDetails(
    context: RivalContext,
    options?: { signal?: AbortSignal }
  ): Promise<{
    insight: RivalInsight;
    status: GemmaConnectionStatus;
    error?: string;
  }> {
    // Optimization: When there is insufficient behavioral evidence (early opening,
    // < 3 moves or no detected habits), use deterministic templates directly
    // without waking up or burdening the model service.
    if (!context.profile.hasSufficientEvidence || context.profile.insights.length === 0) {
      const templateInsight = generateTemplateInsight(context);
      return {
        insight: validateRivalInsight(templateInsight, "template"),
        status: this.status === "connected" ? "connected" : "idle",
      };
    }

    this.status = "loading";

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new Error(`Ollama request timed out after ${this.config.timeoutMs}ms`));
    }, this.config.timeoutMs);

    // Combine caller abort signal if provided
    const onCallerAbort = () => timeoutController.abort(options?.signal?.reason);
    if (options?.signal) {
      options.signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
      const systemPrompt = buildGemmaSystemPrompt(context.rivalName);
      const userPrompt = buildGemmaUserPrompt(context);

      const requestBody = {
        model: this.config.modelName,
        system: systemPrompt,
        prompt: userPrompt,
        format: "json",
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 160,
        },
      };

      const response = await fetch(this.config.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: timeoutController.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP error ${response.status}: ${response.statusText}`);
      }

      const rawJson = await response.json();

      // Extract JSON content from Ollama response format
      let parsedContent: unknown;
      if (rawJson && typeof rawJson === "object") {
        if ("response" in rawJson && typeof (rawJson as Record<string, unknown>).response === "string") {
          try {
            const cleaned = cleanJsonText((rawJson as Record<string, string>).response);
            parsedContent = JSON.parse(cleaned);
          } catch {
            throw new Error("Model response contained malformed JSON text");
          }
        } else if ("message" in rawJson && (rawJson as Record<string, { content?: string }>).message?.content) {
          try {
            const cleaned = cleanJsonText((rawJson as Record<string, { content: string }>).message.content);
            parsedContent = JSON.parse(cleaned);
          } catch {
            throw new Error("Model chat message contained malformed JSON text");
          }
        } else {
          parsedContent = rawJson;
        }
      }

      // Validate schema and length bounds
      const validation = validateModelDialogue(parsedContent);
      if (!validation.isValid || !validation.cleaned) {
        throw new Error(`Model response rejected: ${validation.reason ?? "invalid schema"}`);
      }

      this.status = "connected";
      this.lastError = null;

      const insight: RivalInsight = {
        observation: validation.cleaned.observation,
        taunt: validation.cleaned.taunt,
        tip: validation.cleaned.tip,
        source: "model",
      };

      return { insight, status: "connected" };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);

      this.status = "unavailable";
      this.lastError = errorMessage;

      // Safe, truthful fallback: returns template insight honestly labeled as 'template'
      const fallbackInsight = generateTemplateInsight(context);
      return {
        insight: validateRivalInsight(fallbackInsight, "template"),
        status: "unavailable",
        error: errorMessage,
      };
    } finally {
      clearTimeout(timer);
      if (options?.signal) {
        options.signal.removeEventListener("abort", onCallerAbort);
      }
    }
  }
}
