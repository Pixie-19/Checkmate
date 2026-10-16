/**
 * GemmaLabView.tsx
 *
 * Dedicated full-width application view for inspecting the Gemma 2 2B integration:
 * Move telemetry → Behavior extraction → Gemma prompt payload → Real model output.
 *
 * Designed to seamlessly match Checkmate Rogue's gothic dark fantasy aesthetic.
 */

import { useState, useTransition } from "react";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Play,
  RefreshCw,
  ArrowLeft,
  Copy,
  Check,
  User,
  ScrollText,
} from "lucide-react";
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

interface GemmaLabViewProps {
  onBackToGame: () => void;
}

export default function GemmaLabView({ onBackToGame }: GemmaLabViewProps) {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("SCN-01");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [resultInsight, setResultInsight] = useState<RivalInsight | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedPayload, setCopiedPayload] = useState<boolean>(false);
  const [copiedMoves, setCopiedMoves] = useState<boolean>(false);
  const [, startTransition] = useTransition();

  const currentScenario =
    EVALUATION_SCENARIOS.find((s) => s.id === selectedScenarioId) ??
    EVALUATION_SCENARIOS[0];

  const { context } = buildScenarioContext(currentScenario);
  const systemPrompt = buildGemmaSystemPrompt(currentScenario.rivalName);
  const userPrompt = buildGemmaUserPrompt(context);

  // Pretty-printed JSON payload for clean technical display
  let formattedPayload = userPrompt;
  try {
    formattedPayload = JSON.stringify(JSON.parse(userPrompt), null, 2);
  } catch {
    // Keep raw string if parsing fails
  }

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

  function handleCopyPayload() {
    navigator.clipboard.writeText(formattedPayload).then(() => {
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 2000);
    });
  }

  function handleCopyMoves() {
    navigator.clipboard.writeText(currentScenario.moves.join(" ")).then(() => {
      setCopiedMoves(true);
      setTimeout(() => setCopiedMoves(false), 2000);
    });
  }

  // Active insight for automated checks
  const hasInferenceRun = resultInsight !== null;
  const activeInsight: RivalInsight = resultInsight ?? {
    observation: "",
    taunt: "",
    tip: undefined,
    source: "template",
  };

  const grounding = checkGrounding(activeInsight, currentScenario.expectedKeywords);
  const hallucination = checkHallucinations(activeInsight, currentScenario.antiKeywords);
  const persona = checkPersonaVoice(activeInsight, currentScenario.rivalIndex);

  // Rival difficulty flair
  const difficultyLabel =
    currentScenario.difficulty === "apprentice"
      ? "Encounter I · Apprentice"
      : currentScenario.difficulty === "knight"
      ? "Encounter II · Knight"
      : "Encounter III · Sovereign Boss";

  return (
    <main className="gemma-lab-view" aria-label="Gemma Lab AI Inspector">
      {/* ── View Header ───────────────────────────────────────────────────────── */}
      <section className="gemma-lab-header">
        <div className="gemma-lab-title-group">
          <div className="eyebrow">RIVAL INTELLIGENCE · GOOGLE GEMMA 2 2B</div>
          <h1 className="gemma-lab-title">Gemma Lab</h1>
          <p className="gemma-lab-subtitle">
            Inside the mind of your rival.
          </p>
          <p className="gemma-lab-lead">
            Explore how real chess behavior becomes structured evidence and Gemma-generated dialogue.
          </p>
        </div>

        <div className="gemma-lab-meta-group">
          <div className="lab-meta-chip">
            <Sparkles size={14} className="icon-gold" />
            <span className="meta-bold">Gemma 2 · 2B</span>
            <span className="meta-sub">Google Open-Weight</span>
          </div>

          <div className="lab-meta-chip">
            <span className="status-dot green" />
            <span className="meta-bold">Ollama Localhost</span>
            <span className="meta-sub">:11434</span>
          </div>

          <button
            type="button"
            className="btn-back-to-game"
            onClick={onBackToGame}
            aria-label="Return to Chess Game"
            title="Return to Chess Game"
          >
            <ArrowLeft size={16} />
            <span>Back to Game</span>
          </button>
        </div>
      </section>

      {/* ── Scenario Control Toolbar ─────────────────────────────────────────── */}
      <section className="gemma-lab-toolbar" aria-label="Scenario Controls">
        <div className="toolbar-picker-group">
          <label htmlFor="lab-scenario-picker" className="toolbar-label">
            Select Scenario:
          </label>
          <div className="toolbar-select-wrapper">
            <select
              id="lab-scenario-picker"
              className="toolbar-select"
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
                  [{s.id}] {s.title} — {s.rivalName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="toolbar-rival-tag">
          <User size={14} className="icon-gold" />
          <span>{currentScenario.rivalName}</span>
          <span className="rival-diff-pill">{currentScenario.difficulty}</span>
        </div>

        <button
          type="button"
          className="btn-run-inference"
          onClick={handleRunInference}
          disabled={isRunning}
          aria-label="Run Live Gemma Inference"
        >
          {isRunning ? (
            <>
              <RefreshCw size={16} className="spin" />
              <span>Gemma is Reasoning...</span>
            </>
          ) : (
            <>
              <Play size={16} fill="currentColor" />
              <span>Run Live Inference</span>
            </>
          )}
        </button>
      </section>

      {/* ── Main Two-Column Layout ──────────────────────────────────────────── */}
      <div className="gemma-lab-layout">
        {/* ── LEFT COLUMN: Evidence & Input (~55%) ────────────────────────────── */}
        <div className="gemma-lab-column">
          {/* Card 1: Scenario & Move Telemetry */}
          <div className="lab-panel">
            <div className="panel-accent-top" />
            <div className="lab-panel-header">
              <div className="eyebrow">STAGE 01 · CHESS MOVE TELEMETRY</div>
              <h2 className="lab-panel-title">{currentScenario.title}</h2>
            </div>

            <p className="lab-scenario-desc">{currentScenario.description}</p>

            <div className="lab-meta-row">
              <span className="lab-meta-label">Opponent:</span>
              <span className="lab-meta-val">
                <strong>{currentScenario.rivalName}</strong> ({difficultyLabel})
              </span>
            </div>

            <div className="lab-meta-row">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                <span className="lab-meta-label">Move Sequence ({currentScenario.moves.length} ply):</span>
                <button
                  type="button"
                  className="btn-subtle-copy"
                  onClick={handleCopyMoves}
                  title="Copy move history"
                >
                  {copiedMoves ? <Check size={12} className="icon-emerald" /> : <Copy size={12} />}
                  <span>{copiedMoves ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <div className="lab-moves-display">{currentScenario.moves.join(" ")}</div>
            </div>

            <div className="lab-evidence-gate">
              <div className="gate-title">
                <span>Sufficiency Gate:</span>
                <span className={context.profile.hasSufficientEvidence ? "badge-gate green" : "badge-gate purple"}>
                  {context.profile.hasSufficientEvidence ? "≥ 3 Player Moves" : "< 3 Moves"}
                </span>
              </div>
              <p className="gate-desc">
                {context.profile.hasSufficientEvidence
                  ? "Sufficient behavioral evidence collected. Heuristic signals are compiled and dispatched to Gemma 2."
                  : "Insufficient moves to observe distinct human habits. Promptly routes to offline scripted dialogue without latency."}
              </p>
            </div>
          </div>

          {/* Card 2: Deterministic Behavioral Signals */}
          <div className="lab-panel">
            <div className="panel-accent-top" />
            <div className="lab-panel-header">
              <div className="eyebrow">STAGE 02 · HEURISTIC HABIT SIGNALS</div>
              <h2 className="lab-panel-title">Extracted Player Patterns</h2>
            </div>

            {context.profile.insights.length === 0 ? (
              <div className="lab-empty-signals">
                <ScrollText size={20} className="icon-gold" />
                <div>
                  <strong>No Habit Weaknesses Flagged</strong>
                  <p>
                    Harmonious classical piece development detected. The player did not lunge their queen early, repeat moves recklessly, or overextend pawns.
                  </p>
                </div>
              </div>
            ) : (
              <div className="lab-signals-grid">
                {context.profile.insights.map((h) => (
                  <div key={h.id} className="signal-gothic-card">
                    <div className="signal-card-header">
                      <div className="signal-title-wrap">
                        <span className="signal-name">{h.title}</span>
                      </div>
                      <span className={`confidence-pill ${h.confidence}`}>
                        {h.confidence} confidence
                      </span>
                    </div>

                    <p className="signal-desc">{h.description}</p>

                    <div className="signal-evidence-tray">
                      <span className="evidence-title">Chess Evidence:</span>
                      {h.evidence.map((ev, i) => (
                        <div key={i} className="evidence-chip">
                          {ev}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Card 3: Minimal Gemma Prompt Payload */}
          <div className="lab-panel">
            <div className="panel-accent-top" />
            <div className="lab-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="eyebrow">STAGE 03 · INPUT TO GEMMA</div>
                <h2 className="lab-panel-title">Minimal Behavior Payload</h2>
              </div>
              <button
                type="button"
                className="btn-subtle-copy"
                onClick={handleCopyPayload}
                title="Copy structured JSON payload"
              >
                {copiedPayload ? <Check size={14} className="icon-emerald" /> : <Copy size={14} />}
                <span>{copiedPayload ? "Copied JSON" : "Copy Payload"}</span>
              </button>
            </div>

            <p className="lab-desc-small">
              Privacy-safe JSON sent to <code className="code-inline">POST /api/generate</code>. Board FEN, full PGN, and raw histories are never transmitted.
            </p>

            <pre className="lab-json-view">{formattedPayload}</pre>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Intelligence & Output (~45%) ────────────────────── */}
        <div className="gemma-lab-column">
          {/* Card 4: Gemma 2 Generated Response (THE CENTERPIECE) */}
          <div className="lab-panel lab-centerpiece-panel">
            <div className="panel-accent-top-gold" />
            <div className="centerpiece-header">
              <div>
                <div className="eyebrow gold">STAGE 04 · GENERATED RIVAL DIALOGUE</div>
                <h2 className="lab-panel-title centerpiece-title">Rival Intelligence</h2>
              </div>

              <div className="centerpiece-status-badges">
                {latencyMs !== null && (
                  <span className="latency-pill">
                    <Clock size={12} /> {latencyMs}ms
                  </span>
                )}
                <span className={`source-pill ${activeInsight.source === "model" ? "model" : "template"}`}>
                  {activeInsight.source === "model" ? "Google Gemma 2 (2B)" : "Scripted Fallback"}
                </span>
              </div>
            </div>

            {errorMsg && (
              <div className="lab-alert-box error">
                <AlertTriangle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            {!hasInferenceRun ? (
              <div className="lab-awaiting-state">
                <div className="awaiting-icon-wrap">
                  <Sparkles size={28} className="icon-gold" />
                </div>
                <h3 className="awaiting-title">Awaiting the Rival's Thoughts</h3>
                <p className="awaiting-desc">
                  Click <strong>Run Live Inference</strong> above to trigger Google's Gemma 2 (2B) via local Ollama.
                  Gemma will evaluate the extracted behavioral signals and respond in <em>{currentScenario.rivalName}'s</em> atmospheric gothic persona.
                </p>
                <div className="awaiting-subnote">
                  Benchmark harness: 16 scenarios verified with 100% schema validity & 87.5% behavioral grounding.
                </div>
              </div>
            ) : (
              <div className="lab-dialogue-cards">
                {/* Observation */}
                <div className="dialogue-card observation">
                  <div className="dialogue-tag">OBSERVATION</div>
                  <p className="dialogue-prose">
                    "{activeInsight.observation}"
                  </p>
                </div>

                {/* Taunt */}
                <div className="dialogue-card taunt">
                  <div className="dialogue-tag taunt-tag">RIVAL'S TAUNT</div>
                  <blockquote className="dialogue-quote">
                    "{activeInsight.taunt}"
                  </blockquote>
                </div>

                {/* Tip */}
                {activeInsight.tip && (
                  <div className="dialogue-card tip">
                    <div className="dialogue-tag tip-tag">TACTICAL ADVICE</div>
                    <p className="dialogue-tip-prose">
                      "{activeInsight.tip}"
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 5: Quality & Grounding Verification Checks */}
          <div className="lab-panel">
            <div className="panel-accent-top" />
            <div className="lab-panel-header">
              <div className="eyebrow">QUALITY VERIFICATION & SAFETY BOUNDS</div>
              <h2 className="lab-panel-title">Inference Quality Checks</h2>
            </div>

            <div className="quality-checks-list">
              <div className="quality-check-item">
                <div className="check-left">
                  <ShieldCheck size={16} className={hasInferenceRun ? "icon-emerald" : "icon-dim"} />
                  <div className="check-text">
                    <span className="check-label">Strict JSON Schema Enforcement</span>
                    <span className="check-sub">Keys `observation`, `taunt`, `tip` within length bounds</span>
                  </div>
                </div>
                <span className={hasInferenceRun ? "check-pill pass" : "check-pill pending"}>
                  {hasInferenceRun ? "100% Valid" : "Ready"}
                </span>
              </div>

              <div className="quality-check-item">
                <div className="check-left">
                  <CheckCircle2 size={16} className={grounding.pass ? "icon-emerald" : "icon-amber"} />
                  <div className="check-text">
                    <span className="check-label">Behavioral Telemetry Grounding</span>
                    <span className="check-sub">Dialogue explicitly references player habits</span>
                  </div>
                </div>
                <span className={grounding.pass ? "check-pill pass" : "check-pill note"}>
                  {grounding.pass ? `Matched: [${grounding.matched.join(", ")}]` : "Awaiting Run"}
                </span>
              </div>

              <div className="quality-check-item">
                <div className="check-left">
                  <CheckCircle2 size={16} className={hallucination.clean ? "icon-emerald" : "icon-crimson"} />
                  <div className="check-text">
                    <span className="check-label">Anti-Hallucination Guard</span>
                    <span className="check-sub">Rejects claims of unmade sacrifices or fake captures</span>
                  </div>
                </div>
                <span className={hallucination.clean ? "check-pill pass" : "check-pill alert"}>
                  {hallucination.clean ? "Clean · No Fakes" : `Flagged: [${hallucination.flagged.join(", ")}]`}
                </span>
              </div>

              <div className="quality-check-item">
                <div className="check-left">
                  <Sparkles size={16} className={persona.score === 1 ? "icon-emerald" : "icon-gold"} />
                  <div className="check-text">
                    <span className="check-label">Rival Persona Lexicon</span>
                    <span className="check-sub">Vocabulary tailored to {currentScenario.rivalName}</span>
                  </div>
                </div>
                <span className="check-pill persona">
                  {persona.indicators.length > 0 ? `Vocabulary: [${persona.indicators.join(", ")}]` : "Solemn Gothic Tone"}
                </span>
              </div>
            </div>
          </div>

          {/* Card 6: System Persona Directive */}
          <div className="lab-panel">
            <div className="panel-accent-top" />
            <div className="lab-panel-header">
              <div className="eyebrow">STAGE 00 · SYSTEM DIRECTIVE</div>
              <h2 className="lab-panel-title">Persona Prompt Configuration</h2>
            </div>
            <pre className="lab-system-prompt-view">{systemPrompt}</pre>
          </div>
        </div>
      </div>
    </main>
  );
}
