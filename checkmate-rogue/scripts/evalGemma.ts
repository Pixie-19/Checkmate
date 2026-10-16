/**
 * evalGemma.ts
 *
 * Automated evaluation harness for Google's Gemma 2 2B integration.
 * Evaluates behavioral grounding, schema validity, rival personas,
 * and inference latency across 16 legally verified chess scenarios.
 *
 * Run: npm run eval:gemma
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  EVALUATION_SCENARIOS,
  buildScenarioContext,
} from "../src/ai/eval/evaluationDataset.ts";
import {
  evaluateScenarioResult,
  computeAggregateMetrics,
  type ScenarioEvalResult,
} from "../src/ai/eval/evaluationMetrics.ts";
import {
  buildGemmaSystemPrompt,
  buildGemmaUserPrompt,
  validateModelDialogue,
  cleanJsonText,
} from "../src/ai/dialogueProvider.ts";
import { generateTemplateInsight } from "../src/ai/rivalInsight.ts";

const OLLAMA_BASE = process.env.VITE_OLLAMA_ENDPOINT?.replace(/\/api\/generate\/?$/, "") || "http://127.0.0.1:11434";
const MODEL_NAME = process.env.VITE_OLLAMA_MODEL || "gemma2:2b";
const TIMEOUT_MS = Number(process.env.VITE_OLLAMA_TIMEOUT_MS) || 12000; // Allow 12s during evaluation to avoid false timeouts

interface OllamaTagModel {
  name: string;
  model: string;
}

async function checkOllamaAvailability(): Promise<{
  available: boolean;
  modelFound: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { available: false, modelFound: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { models?: OllamaTagModel[] };
    const modelNames = (data.models || []).map((m) => m.name);
    const hasModel = modelNames.some((n) => n === MODEL_NAME || n.startsWith(`${MODEL_NAME}:`));
    return { available: true, modelFound: hasModel, models: modelNames };
  } catch (err: unknown) {
    return {
      available: false,
      modelFound: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function warmupModel(): Promise<number> {
  const t0 = Date.now();
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_NAME,
        prompt: "Respond with JSON: {\"ready\": true}",
        format: "json",
        stream: false,
        options: { num_predict: 10 },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Warmup failure handled by subsequent calls
  }
  return Date.now() - t0;
}

async function runEvaluation() {
  console.log("\n==================================================================");
  console.log("♟️  CHECKMATE ROGUE — GEMMA 2 2B BENCHMARK & EVALUATION HARNESS");
  console.log("==================================================================\n");

  console.log(`Checking local Ollama service at: ${OLLAMA_BASE}`);
  const status = await checkOllamaAvailability();

  if (!status.available) {
    console.error(`❌ Ollama is NOT reachable at ${OLLAMA_BASE}.`);
    console.error(`   Error details: ${status.error}`);
    console.error(`   Please start Ollama (e.g. 'ollama serve') before running evaluation.\n`);
    process.exit(1);
  }

  console.log(`✓ Ollama service reachable. Installed models: [${status.models.join(", ")}]`);

  if (!status.modelFound) {
    console.error(`❌ Model "${MODEL_NAME}" is NOT installed in Ollama.`);
    console.error(`   Please run: ollama pull ${MODEL_NAME}\n`);
    process.exit(1);
  }

  console.log(`✓ Target model "${MODEL_NAME}" is available.`);
  console.log(`Warming up ${MODEL_NAME}...`);
  const warmupMs = await warmupModel();
  console.log(`✓ Model ready (warmup: ${warmupMs}ms).\n`);

  console.log(`Evaluating ${EVALUATION_SCENARIOS.length} scenarios...\n`);

  const results: ScenarioEvalResult[] = [];

  for (const scenario of EVALUATION_SCENARIOS) {
    process.stdout.write(`• Running ${scenario.id.padEnd(7)} | ${scenario.title.slice(0, 36).padEnd(36)} ... `);
    const { context } = buildScenarioContext(scenario);

    // 1. Template Fallback Branch
    if (scenario.shouldFallbackToTemplate) {
      const t0 = Date.now();
      const templateInsight = generateTemplateInsight(context);
      const latencyMs = Date.now() - t0;
      const evalResult = evaluateScenarioResult(
        scenario,
        templateInsight,
        latencyMs,
        true
      );
      results.push(evalResult);
      console.log(`✓ Template fallback (0ms)`);
      continue;
    }

    // 2. Real Model Inference Branch
    const systemPrompt = buildGemmaSystemPrompt(scenario.rivalName);
    const userPrompt = buildGemmaUserPrompt(context);

    const t0 = Date.now();
    let rawJson: unknown;
    let isSuccess = false;
    let schemaReason: string | undefined;

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL_NAME,
          system: systemPrompt,
          prompt: userPrompt,
          format: "json",
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 160,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const latencyMs = Date.now() - t0;

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const body = (await res.json()) as { response?: string };
      if (!body.response) {
        throw new Error("Missing 'response' field in Ollama payload");
      }

      try {
        const cleaned = cleanJsonText(body.response);
        rawJson = JSON.parse(cleaned);
      } catch {
        throw new Error("Model response was not valid JSON");
      }

      const validation = validateModelDialogue(rawJson);

      if (!validation.isValid || !validation.cleaned) {
        schemaReason = validation.reason;
        throw new Error(validation.reason || "Schema validation failed");
      }

      isSuccess = true;
      const evalResult = evaluateScenarioResult(
        scenario,
        {
          observation: validation.cleaned.observation,
          taunt: validation.cleaned.taunt,
          tip: validation.cleaned.tip,
          source: "model",
        },
        latencyMs,
        true
      );
      results.push(evalResult);

      const statusTag = evalResult.groundingPass ? "✓ Gemma 2" : "⚠ Ungrounded";
      console.log(`${statusTag} (${latencyMs}ms)`);
    } catch (err: unknown) {
      const latencyMs = Date.now() - t0;
      const errMsg = err instanceof Error ? err.message : String(err);

      // Do NOT replace with fake model response; record honest failure with template fallback
      const fallbackInsight = generateTemplateInsight(context);
      const evalResult = evaluateScenarioResult(
        scenario,
        fallbackInsight,
        latencyMs,
        false,
        errMsg
      );
      results.push(evalResult);
      console.log(`❌ Fallback (${errMsg})`);
    }
  }

  const report = computeAggregateMetrics(
    results,
    MODEL_NAME,
    `${OLLAMA_BASE}/api/generate`
  );

  // -------------------------------------------------------------------------
  // Print Formatted Terminal Summary
  // -------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log("📊 GEMMA 2 2B EVALUATION REPORT SUMMARY");
  console.log("==================================================================");
  console.log(`Timestamp:              ${report.timestamp}`);
  console.log(`Target Model:           ${report.modelIdentifier}`);
  console.log(`Total Scenarios:        ${report.totalScenarios}`);
  console.log(`Model Inference Calls:  ${report.modelInferenceCount} / ${report.totalScenarios - 2} active habit scenarios`);
  console.log(`Template Fallbacks:     ${report.fallbackCount} (2 expected: SCN-12 & SCN-13)`);
  console.log(`Valid JSON & Schema:    ${(report.schemaValidRate * 100).toFixed(1)}%`);
  console.log(`Behavior Grounding:     ${(report.groundingRate * 100).toFixed(1)}%`);
  console.log(`Hallucination-Free:     ${(report.hallucinationFreeRate * 100).toFixed(1)}%`);
  console.log(`Latency (Mean / Med):   ${report.latency.meanMs}ms / ${report.latency.medianMs}ms [Min: ${report.latency.minMs}ms, Max: ${report.latency.maxMs}ms]`);
  console.log("==================================================================\n");

  // Save JSON report
  const docsDir = path.resolve(process.cwd(), "docs");
  await fs.mkdir(docsDir, { recursive: true });

  const jsonOutputPath = path.join(docsDir, "eval-results.json");
  await fs.writeFile(jsonOutputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`✓ Saved raw evaluation results to: ${jsonOutputPath}`);

  // Generate Human Review Worksheet
  const worksheetPath = path.join(docsDir, "HUMAN_REVIEW_WORKSHEET.md");
  let worksheet = `# ♟️ Gemma Dialogue Evaluation — Human Review Worksheet\n\n`;
  worksheet += `Generated: **${report.timestamp}**\n`;
  worksheet += `Model: **${report.modelIdentifier}** via \`${report.endpointUrl}\`\n\n`;
  worksheet += `| Metric | Automated Result |\n`;
  worksheet += `|---|---|\n`;
  worksheet += `| Total Scenarios | ${report.totalScenarios} |\n`;
  worksheet += `| Model Responses | ${report.modelInferenceCount} |\n`;
  worksheet += `| Fallback Dispatches | ${report.fallbackCount} |\n`;
  worksheet += `| Schema Adherence | ${(report.schemaValidRate * 100).toFixed(1)}% |\n`;
  worksheet += `| Behavioral Grounding | ${(report.groundingRate * 100).toFixed(1)}% |\n`;
  worksheet += `| Hallucination-Free | ${(report.hallucinationFreeRate * 100).toFixed(1)}% |\n`;
  worksheet += `| Mean Generation Time | ${report.latency.meanMs}ms |\n\n`;
  worksheet += `---\n\n## Scenario Details & Review Cards\n\n`;

  for (const r of report.results) {
    const scn = EVALUATION_SCENARIOS.find((s) => s.id === r.scenarioId)!;
    worksheet += `### [${r.scenarioId}] ${r.title}\n\n`;
    worksheet += `- **Rival**: ${r.rivalName} (${scn.difficulty})\n`;
    worksheet += `- **Move History**: \`${scn.moves.join(" ")}\`\n`;
    worksheet += `- **Detected Habits**: \`${r.detectedHabitIds.join(", ") || "None (Expected fallback)"}\`\n`;
    worksheet += `- **Source**: \`${r.source}\` (${r.latencyMs}ms)\n`;
    worksheet += `- **Automated Checks**: Schema: ${r.schemaValid ? "✅ Valid" : "❌ Invalid"} | Grounding: ${r.groundingPass ? "✅ Passed" : "❌ Failed"} (${r.groundingMatched.join(", ") || "None"}) | Hallucinations: ${r.hallucinationFree ? "✅ Clean" : `⚠️ Flagged: ${r.hallucinationsFlagged.join(", ")}`}\n\n`;
    worksheet += `**Model Output**:\n`;
    worksheet += `> **Observation**: "${r.dialogue.observation}"\n>\n`;
    worksheet += `> **Taunt**: "${r.dialogue.taunt}"\n>\n`;
    worksheet += `> **Tip**: "${r.dialogue.tip ?? "None"}"\n\n`;
    worksheet += `| Evaluation Dimension | Rating (1-5) | Notes |\n`;
    worksheet += `|---|:---:|---|\n`;
    worksheet += `| **Grounding** (Directly reflects moves) | [ ] | |\n`;
    worksheet += `| **Rival Voice** (Fits assigned persona) | [ ] | |\n`;
    worksheet += `| **Narrative Tone** (Gothic atmosphere) | [ ] | |\n`;
    worksheet += `| **Tactical Tip Relevance** | [ ] | |\n\n`;
    worksheet += `---\n\n`;
  }

  await fs.writeFile(worksheetPath, worksheet, "utf8");
  console.log(`✓ Saved human review worksheet to: ${worksheetPath}\n`);
}

runEvaluation().catch((err) => {
  console.error("Evaluation script encountered fatal error:", err);
  process.exit(1);
});
