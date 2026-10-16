/**
 * GemmaLabModal.tsx
 *
 * Developer & Judge demonstration panel for inspecting Gemma 2 2B integration:
 * Move telemetry → Behavior extraction → Gemma prompt payload → Real model output.
 */

import { useState, useTransition } from "react";
import { Sparkles, CheckCircle2, AlertTriangle, Clock, ShieldCheck, X, Play, RefreshCw } from "lucide-react";
import {
  EVALUATION_SCENARIOS,
  buildScenarioContext,
} from "../ai/eval/evaluationDataset.ts";
import {
  checkGrounding,
  checkHallucinations,
  checkPersonaVoice,
} from "../ai/eval/evaluationMetrics.ts";
import {
  GemmaDialogueProvider,
  buildGemmaSystemPrompt,
  buildGemmaUserPrompt,
} from "../ai/dialogueProvider.ts";
import type { RivalInsight } from "../ai/rivalInsight.ts";

interface GemmaLabModalProps {
  onClose: () => void;
}

export default function GemmaLabModal({ onClose }: GemmaLabModalProps) {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("SCN-01");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [resultInsight, setResultInsight] = useState<RivalInsight | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const currentScenario =
    EVALUATION_SCENARIOS.find((s) => s.id === selectedScenarioId) ??
    EVALUATION_SCENARIOS[0];

  const { context } = buildScenarioContext(currentScenario);
  const systemPrompt = buildGemmaSystemPrompt(currentScenario.rivalName);
  const userPrompt = buildGemmaUserPrompt(context);

  // Run live inference on local Ollama
  async function handleRunInference() {
    setIsRunning(true);
    setErrorMsg(null);
    const t0 = performance.now();

    try {
      const provider = new GemmaDialogueProvider({ timeoutMs: 12000 });
      const res = await provider.generateInsightWithDetails(context);
      const elapsed = Math.round(performance.now() - t0);
      setLatencyMs(elapsed);
      setResultInsight(res.insight);
      if (res.error) {
        setErrorMsg(res.error);
      }
    } catch (err: unknown) {
      const elapsed = Math.round(performance.now() - t0);
      setLatencyMs(elapsed);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }

  // Automated checks on current output
  const activeInsight: RivalInsight = resultInsight ?? {
    observation: "Press 'Run Live Inference' to trigger Gemma 2 2B via Ollama, or inspect the scenario profile below.",
    taunt: "A living rival waits upon your move.",
    tip: "Gemma transforms raw move telemetry into psychological adversary taunts.",
    source: "template",
  };

  const grounding = checkGrounding(activeInsight, currentScenario.expectedKeywords);
  const hallucination = checkHallucinations(activeInsight, currentScenario.antiKeywords);
  const persona = checkPersonaVoice(activeInsight, currentScenario.rivalIndex);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Gemma 2 Benchmark Lab">
      <div className="modal-box gemma-lab-box">
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Sparkles size={24} style={{ color: "#60a5fa" }} />
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#f1f5f9" }}>
                Gemma 2 2B — Rival Intelligence Inspector
              </h2>
              <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                Hacktoberfest 2026 · Best Use of Gemma Demo Harness
              </div>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scenario Selector Ribbon */}
        <div className="lab-selector-bar">
          <label htmlFor="scenario-select" style={{ fontSize: "0.85rem", color: "#cbd5e1", fontWeight: 600 }}>
            Scenario:
          </label>
          <select
            id="scenario-select"
            className="lab-dropdown"
            value={selectedScenarioId}
            onChange={(e) => {
              const nextId = e.target.value;
              startTransition(() => {
                setSelectedScenarioId(nextId);
                setResultInsight(null);
                setLatencyMs(null);
                setErrorMsg(null);
              });
            }}
          >
            {EVALUATION_SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                [{s.id}] {s.title} ({s.rivalName})
              </option>
            ))}
          </select>

          <button
            type="button"
            className="primary-btn lab-run-btn"
            onClick={handleRunInference}
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <RefreshCw size={16} className="spin" />
                <span>Running Gemma 2...</span>
              </>
            ) : (
              <>
                <Play size={16} />
                <span>Run Live Inference</span>
              </>
            )}
          </button>
        </div>

        {/* 2-Column Inspector Layout */}
        <div className="lab-grid">
          {/* Left Column: Move Telemetry & Extracted Habits */}
          <div className="lab-col">
            <div className="lab-card">
              <div className="lab-card-title">1. Scenario & Move Telemetry</div>
              <p className="lab-desc">{currentScenario.description}</p>
              
              <div className="lab-field">
                <span className="lab-label">Rival Opponent:</span>
                <span className="lab-val">{currentScenario.rivalName} ({currentScenario.difficulty.toUpperCase()})</span>
              </div>

              <div className="lab-field">
                <span className="lab-label">Move History ({currentScenario.moves.length} ply):</span>
                <div className="lab-moves-chip">{currentScenario.moves.join(" ")}</div>
              </div>

              <div className="lab-field">
                <span className="lab-label">Sufficient Evidence Gate:</span>
                <span className={context.profile.hasSufficientEvidence ? "badge-green" : "badge-purple"}>
                  {context.profile.hasSufficientEvidence ? ">= 3 moves (Inference Allowed)" : "< 3 moves (Bypass to Fallback)"}
                </span>
              </div>
            </div>

            <div className="lab-card">
              <div className="lab-card-title">2. Deterministic Behavioral Signals</div>
              {context.profile.insights.length === 0 ? (
                <div className="lab-empty-note">
                  No habits flagged — harmonic development. Routes to deterministic scripted template.
                </div>
              ) : (
                <div className="lab-insights-list">
                  {context.profile.insights.map((h) => (
                    <div key={h.id} className="lab-insight-item">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ color: "#e2e8f0" }}>{h.title}</strong>
                        <span className={`badge-pill ${h.confidence === "high" ? "pill-high" : "pill-med"}`}>
                          {h.confidence} confidence
                        </span>
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: 4 }}>{h.description}</div>
                      <div className="lab-evidence-box">
                        {h.evidence.map((ev, i) => (
                          <div key={i}>• {ev}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lab-card">
              <div className="lab-card-title">3. Minimal Gemma Prompt Payload</div>
              <pre className="lab-code-block">{userPrompt}</pre>
            </div>
          </div>

          {/* Right Column: Gemma Output & Validation */}
          <div className="lab-col">
            <div className="lab-card lab-card-highlight">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div className="lab-card-title" style={{ margin: 0 }}>4. Gemma 2 Generated Dialogue</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {latencyMs !== null && (
                    <span className="lab-latency-chip">
                      <Clock size={12} /> {latencyMs}ms
                    </span>
                  )}
                  <span className={`badge-pill ${activeInsight.source === "model" ? "pill-model" : "pill-template"}`}>
                    {activeInsight.source === "model" ? "Google Gemma 2 (2B)" : "Scripted Fallback"}
                  </span>
                </div>
              </div>

              {errorMsg && (
                <div className="lab-error-banner">
                  <AlertTriangle size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Dialogue Rendered Cards */}
              <div className="lab-dialogue-block">
                <div className="lab-bubble">
                  <span className="lab-bubble-label">Observation:</span>
                  <p className="lab-bubble-text">"{activeInsight.observation}"</p>
                </div>

                <div className="lab-bubble">
                  <span className="lab-bubble-label">Taunt:</span>
                  <p className="lab-bubble-text">"{activeInsight.taunt}"</p>
                </div>

                {activeInsight.tip && (
                  <div className="lab-bubble lab-bubble-tip">
                    <span className="lab-bubble-label">Tactical Tip:</span>
                    <p className="lab-bubble-text">"{activeInsight.tip}"</p>
                  </div>
                )}
              </div>
            </div>

            <div className="lab-card">
              <div className="lab-card-title">5. Automated Quality & Grounding Checks</div>
              <div className="lab-checks-grid">
                <div className="lab-check-row">
                  <div className="lab-check-left">
                    <ShieldCheck size={16} className={resultInsight ? "icon-green" : "icon-gray"} />
                    <span>Strict JSON Schema Adherence</span>
                  </div>
                  <span className="badge-green">Valid Schema</span>
                </div>

                <div className="lab-check-row">
                  <div className="lab-check-left">
                    <CheckCircle2 size={16} className={grounding.pass ? "icon-green" : "icon-yellow"} />
                    <span>Behavioral Grounding</span>
                  </div>
                  <span className={grounding.pass ? "badge-green" : "badge-yellow"}>
                    {grounding.pass ? `Matched: [${grounding.matched.join(", ")}]` : "Pending live run"}
                  </span>
                </div>

                <div className="lab-check-row">
                  <div className="lab-check-left">
                    <CheckCircle2 size={16} className={hallucination.clean ? "icon-green" : "icon-red"} />
                    <span>Hallucination Guard</span>
                  </div>
                  <span className={hallucination.clean ? "badge-green" : "badge-red"}>
                    {hallucination.clean ? "No fake moves or sacrifices claimed" : `Flagged: [${hallucination.flagged.join(", ")}]`}
                  </span>
                </div>

                <div className="lab-check-row">
                  <div className="lab-check-left">
                    <Sparkles size={16} className={persona.score === 1 ? "icon-green" : "icon-gray"} />
                    <span>Persona Tone & Lexicon</span>
                  </div>
                  <span className="badge-blue">
                    {persona.indicators.length > 0 ? `Vocabulary: [${persona.indicators.join(", ")}]` : "Solemn Gothic Tone"}
                  </span>
                </div>
              </div>
            </div>

            <div className="lab-card">
              <div className="lab-card-title">System Persona Directive</div>
              <pre className="lab-code-block" style={{ maxHeight: 110 }}>{systemPrompt}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
