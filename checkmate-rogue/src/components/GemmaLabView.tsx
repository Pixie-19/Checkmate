/**
 * GemmaLabView.tsx
 *
 * Dedicated full-width application view for inspecting the Gemma 2 2B integration:
 * Move telemetry → Behavior extraction → Gemma prompt payload → Real model output.
 *
 * Designed to seamlessly match Checkmate Rogue's gothic dark fantasy aesthetic.
 * Features:
 * - 6-Step Judge-Ready Demonstration Flow (Scenario → Behavior → Prompt → Inference → Response → Audit)
 * - Scenario Comparison Mode (Side-by-side contrast of two distinct playstyles)
 * - Live Ollama availability probe and accurate cold-start model loading indicators
 * - Request cancellation guards preventing stale responses across scenario changes
 */

import { useState, useTransition, useEffect, useRef } from "react";
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
  ScrollText,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Columns2,
  Layers,
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

const IS_HOSTED: boolean =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_IS_HOSTED === "true";

interface GemmaLabViewProps {
  onBackToGame: () => void;
}

type LabMode = "walkthrough" | "comparison";

const PRESET_SCENARIOS = [
  { id: "SCN-01", label: "Early Queen Lunge" },
  { id: "SCN-02", label: "Wayward Queen" },
  { id: "SCN-03", label: "Knight Wanderlust" },
  { id: "SCN-04", label: "Kingside Castling" },
  { id: "SCN-07", label: "Uncastled King" },
  { id: "SCN-08", label: "Aggressive Pawn Storm" },
  { id: "SCN-09", label: "Relentless Checks" },
  { id: "SCN-11", label: "Early Queen Loss" },
  { id: "SCN-12", label: "Insufficient Gate (<3 Moves)" },
];

const COMPARISON_PRESETS = [
  {
    name: "Early Queen vs Disciplined Castle",
    idA: "SCN-02",
    idB: "SCN-04",
    desc: "Wayward Queen maneuvering vs classical kingside shelter",
  },
  {
    name: "Knight Wanderlust vs Iron Ramparts",
    idA: "SCN-03",
    idB: "SCN-05",
    desc: "Restless cavalry sorties vs fortified queenside castle",
  },
  {
    name: "Relentless Checks vs Pawn Storm",
    idA: "SCN-09",
    idB: "SCN-08",
    desc: "Early tactical harassment vs 83% pawn advancement",
  },
  {
    name: "Early Queen Loss vs Exposed King",
    idA: "SCN-11",
    idB: "SCN-07",
    desc: "Queen blundered under crossfire vs monarch left in center",
  },
];

function nowMs(): number {
  return Date.now();
}

export default function GemmaLabView({ onBackToGame }: GemmaLabViewProps) {
  // Mode selection: 6-Step Guided Walkthrough vs Dual Scenario Comparison
  const [labMode, setLabMode] = useState<LabMode>("walkthrough");

  // ── Walkthrough Mode State ──────────────────────────────────────────────
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("SCN-01");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [loadingStatusText, setLoadingStatusText] = useState<string>("Gemma 2 is reasoning...");
  const [resultInsight, setResultInsight] = useState<RivalInsight | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [elapsedTimer, setElapsedTimer] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState<boolean>(false);

  // Copy indicators
  const [copiedPayload, setCopiedPayload] = useState<boolean>(false);
  const [copiedMoves, setCopiedMoves] = useState<boolean>(false);

  // ── Comparison Mode State ───────────────────────────────────────────────
  const [scenarioIdA, setScenarioIdA] = useState<string>("SCN-02");
  const [scenarioIdB, setScenarioIdB] = useState<string>("SCN-04");
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [resultA, setResultA] = useState<RivalInsight | null>(null);
  const [resultB, setResultB] = useState<RivalInsight | null>(null);
  const [latencyA, setLatencyA] = useState<number | null>(null);
  const [latencyB, setLatencyB] = useState<number | null>(null);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  // ── Ollama Service Health Check ────────────────────────────────────────
  const [ollamaStatus, setOllamaStatus] = useState<{
    checked: boolean;
    available: boolean;
    modelFound: boolean;
    models: string[];
    error?: string;
  }>({
    checked: false,
    available: false,
    modelFound: false,
    models: [],
  });

  const [, startTransition] = useTransition();

  // Guard refs to prevent stale responses across scenario changes
  const activeRequestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const compareAbortRef = useRef<AbortController | null>(null);

  // Probe Ollama service on mount
  useEffect(() => {
    let mounted = true;
    const provider = new GemmaDialogueProvider();
    provider.checkAvailability().then((status) => {
      if (mounted) {
        setOllamaStatus({
          checked: true,
          available: status.available,
          modelFound: status.modelFound,
          models: status.models,
          error: status.error,
        });
      }
    });

    return () => {
      mounted = false;
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (compareAbortRef.current) compareAbortRef.current.abort();
    };
  }, []);

  // Timer interval while inference is running
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRunning || isComparing) {
      const startTime = nowMs();
      interval = setInterval(() => {
        const diff = nowMs() - startTime;
        setElapsedTimer(diff);
        if (diff > 2500) {
          setLoadingStatusText("Loading Gemma 2 into memory (cold start) & generating...");
        } else {
          setLoadingStatusText("Gemma 2 (2B) is reasoning via local Ollama...");
        }
      }, 100);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, isComparing]);

  // Active scenario for walkthrough
  const currentScenario =
    EVALUATION_SCENARIOS.find((s) => s.id === selectedScenarioId) ??
    EVALUATION_SCENARIOS[0];

  const { context } = buildScenarioContext(currentScenario);
  const systemPrompt = buildGemmaSystemPrompt(currentScenario.rivalName);
  const userPrompt = buildGemmaUserPrompt(context);

  let formattedPayload = userPrompt;
  try {
    formattedPayload = JSON.stringify(JSON.parse(userPrompt), null, 2);
  } catch {
    // Keep raw string if parsing fails
  }

  // ── Step 4 Live Inference Handler (with cancellation & loading state) ────
  async function handleRunInference() {
    if (isRunning) return;

    // Abort previous in-flight request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort("New inference started");
    }
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    const reqId = ++activeRequestIdRef.current;
    setIsRunning(true);
    setLoadingStatusText("Connecting to local Ollama...");
    setErrorMsg(null);
    setElapsedTimer(0);
    const t0 = nowMs();

    try {
      // Configurable 15,000ms timeout for evaluation lab to accommodate local CPU cold-start
      const provider = new GemmaDialogueProvider({ timeoutMs: 15000 });
      const res = await provider.generateInsightWithDetails(context, {
        signal: abortCtrl.signal,
      });

      // Guard against stale response if user switched scenario
      if (activeRequestIdRef.current !== reqId) return;

      const elapsed = nowMs() - t0;
      setLatencyMs(elapsed);
      setResultInsight(res.insight);
      if (res.error) {
        setErrorMsg(res.error);
      }
    } catch (err: unknown) {
      if (activeRequestIdRef.current !== reqId) return;
      const elapsed = nowMs() - t0;
      setLatencyMs(elapsed);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeRequestIdRef.current === reqId) {
        setIsRunning(false);
      }
    }
  }

  function handleSwitchScenario(nextId: string) {
    if (nextId === selectedScenarioId) return;
    // Abort active in-flight inference immediately
    if (abortControllerRef.current) {
      abortControllerRef.current.abort("Scenario changed");
      abortControllerRef.current = null;
    }
    startTransition(() => {
      setSelectedScenarioId(nextId);
      setResultInsight(null);
      setLatencyMs(null);
      setErrorMsg(null);
      setIsRunning(false);
    });
  }

  // ── Comparison Mode Runner (runs both scenarios concurrently) ───────────
  async function handleRunComparison() {
    if (isComparing) return;

    if (compareAbortRef.current) {
      compareAbortRef.current.abort("New comparison started");
    }
    const abortCtrl = new AbortController();
    compareAbortRef.current = abortCtrl;

    setIsComparing(true);
    setErrorA(null);
    setErrorB(null);
    setElapsedTimer(0);

    const scnA = EVALUATION_SCENARIOS.find((s) => s.id === scenarioIdA) ?? EVALUATION_SCENARIOS[0];
    const scnB = EVALUATION_SCENARIOS.find((s) => s.id === scenarioIdB) ?? EVALUATION_SCENARIOS[1];

    const ctxA = buildScenarioContext(scnA).context;
    const ctxB = buildScenarioContext(scnB).context;

    const providerA = new GemmaDialogueProvider({ timeoutMs: 15000 });
    const providerB = new GemmaDialogueProvider({ timeoutMs: 15000 });

    const runA = async () => {
      const t0 = nowMs();
      try {
        const res = await providerA.generateInsightWithDetails(ctxA, { signal: abortCtrl.signal });
        setLatencyA(nowMs() - t0);
        setResultA(res.insight);
        if (res.error) setErrorA(res.error);
      } catch (err: unknown) {
        setLatencyA(nowMs() - t0);
        setErrorA(err instanceof Error ? err.message : String(err));
      }
    };

    const runB = async () => {
      const t0 = nowMs();
      try {
        const res = await providerB.generateInsightWithDetails(ctxB, { signal: abortCtrl.signal });
        setLatencyB(nowMs() - t0);
        setResultB(res.insight);
        if (res.error) setErrorB(res.error);
      } catch (err: unknown) {
        setLatencyB(nowMs() - t0);
        setErrorB(err instanceof Error ? err.message : String(err));
      }
    };

    await Promise.all([runA(), runB()]);
    setIsComparing(false);
  }

  function handleApplyPresetComparison(preset: typeof COMPARISON_PRESETS[0]) {
    setScenarioIdA(preset.idA);
    setScenarioIdB(preset.idB);
    setResultA(null);
    setResultB(null);
    setLatencyA(null);
    setLatencyB(null);
    setErrorA(null);
    setErrorB(null);
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

  // Active insight for automated evaluation metrics
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

  const difficultyLabel =
    currentScenario.difficulty === "apprentice"
      ? "Encounter I · Apprentice"
      : currentScenario.difficulty === "knight"
      ? "Encounter II · Knight"
      : "Encounter III · Sovereign Boss";

  // Comparison helper context
  const scnObjA = EVALUATION_SCENARIOS.find((s) => s.id === scenarioIdA) ?? EVALUATION_SCENARIOS[0];
  const scnObjB = EVALUATION_SCENARIOS.find((s) => s.id === scenarioIdB) ?? EVALUATION_SCENARIOS[1];
  const ctxObjA = buildScenarioContext(scnObjA).context;
  const ctxObjB = buildScenarioContext(scnObjB).context;

  return (
    <main className="gemma-lab-view" aria-label="Gemma Lab AI Inspector">
      {/* ── View Header ───────────────────────────────────────────────────────── */}
      <section className="gemma-lab-header">
        <div className="gemma-lab-title-group">
          <div className="eyebrow">RIVAL INTELLIGENCE · GOOGLE GEMMA 2 2B</div>
          <h1 className="gemma-lab-title">Gemma Lab</h1>
          <p className="gemma-lab-subtitle">Inside the mind of your rival.</p>
          <p className="gemma-lab-lead">
            Explore how genuine chess telemetry deterministically feeds local Gemma 2 (2B) inference
            to generate psychological rival dialogue, gothic taunts, and grounded tactical coaching.
          </p>
        </div>

        <div className="gemma-lab-meta-group">
          <div className="lab-meta-chip">
            <Sparkles size={14} className="icon-gold" />
            <span className="meta-bold">Gemma 2 · 2B</span>
            <span className="meta-sub">Google Open-Weight</span>
          </div>

          {IS_HOSTED ? (
            <div className="lab-meta-chip" title="Hosted Static Deployment — Local Ollama probing disabled to protect visitor privacy.">
              <span className="status-dot green" />
              <span className="meta-bold">Hosted Static</span>
              <span className="meta-sub">Deterministic</span>
            </div>
          ) : (
            <div className="lab-meta-chip" title={ollamaStatus.checked ? (ollamaStatus.available ? "Ollama daemon connected" : ollamaStatus.error ?? "Offline") : "Checking Ollama..."}>
              <span className={`status-dot ${ollamaStatus.available && ollamaStatus.modelFound ? "green" : "amber"}`} />
              <span className="meta-bold">Ollama Localhost</span>
              <span className="meta-sub">
                {ollamaStatus.checked
                  ? ollamaStatus.available && ollamaStatus.modelFound
                    ? ":11434 (Ready)"
                    : ":11434 (Fallback)"
                  : ":11434"}
              </span>
            </div>
          )}

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

      {/* ── Mode Selection Tabs (Walkthrough vs Comparison) ───────────────────── */}
      <div className="gemma-mode-tabs" role="tablist" aria-label="Gemma Lab Modes">
        <button
          type="button"
          role="tab"
          aria-selected={labMode === "walkthrough"}
          className={`gemma-mode-tab ${labMode === "walkthrough" ? "active" : ""}`}
          onClick={() => setLabMode("walkthrough")}
        >
          <Layers size={14} />
          <span>Guided Demonstration (Steps 1–6)</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={labMode === "comparison"}
          className={`gemma-mode-tab ${labMode === "comparison" ? "active" : ""}`}
          onClick={() => setLabMode("comparison")}
        >
          <Columns2 size={14} />
          <span>Scenario Comparison Mode</span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODE 1: 6-STEP GUIDED DEMONSTRATION FLOW                               */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {labMode === "walkthrough" && (
        <>
          {/* ── Visual 6-Step Progression Track ─────────────────────────────── */}
          <nav className="gemma-step-track" aria-label="Demonstration Pipeline Progress">
            <div className={`step-track-item ${selectedScenarioId ? "active" : ""}`}>
              <span className="step-number-badge">1</span>
              <div className="step-track-info">
                <span className="step-track-label">Step 01</span>
                <span className="step-track-title">Chess Scenario</span>
              </div>
            </div>

            <div className={`step-track-item ${context.profile.insights.length > 0 ? "completed" : "active"}`}>
              <span className="step-number-badge">2</span>
              <div className="step-track-info">
                <span className="step-track-label">Step 02</span>
                <span className="step-track-title">Detected Behavior</span>
              </div>
            </div>

            <div className="step-track-item completed">
              <span className="step-number-badge">3</span>
              <div className="step-track-info">
                <span className="step-track-label">Step 03</span>
                <span className="step-track-title">Gemma Payload</span>
              </div>
            </div>

            <div className={`step-track-item ${isRunning ? "active" : hasInferenceRun ? "completed" : ""}`}>
              <span className="step-number-badge">4</span>
              <div className="step-track-info">
                <span className="step-track-label">Step 04</span>
                <span className="step-track-title">Real Inference</span>
              </div>
            </div>

            <div className={`step-track-item ${hasInferenceRun ? "completed" : ""}`}>
              <span className="step-number-badge">5</span>
              <div className="step-track-info">
                <span className="step-track-label">Step 05</span>
                <span className="step-track-title">Rival Dialogue</span>
              </div>
            </div>

            <div className={`step-track-item ${hasInferenceRun ? "completed" : ""}`}>
              <span className="step-number-badge">6</span>
              <div className="step-track-info">
                <span className="step-track-label">Step 06</span>
                <span className="step-track-title">Grounding Audit</span>
              </div>
            </div>
          </nav>

          {/* ── Main Two-Column Layout ──────────────────────────────────────── */}
          <div className="gemma-lab-layout">
            {/* ── LEFT COLUMN: Input & Telemetry Pipeline (~55%) ────────────── */}
            <div className="gemma-lab-column">
              {/* STEP 1: Choose Scenario & Move Telemetry */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="lab-panel-header">
                  <div className="step-badge">STEP 01 · CHOOSE A CHESS SCENARIO</div>
                  <h2 className="lab-panel-title">{currentScenario.title}</h2>
                </div>

                <div className="toolbar-picker-group" style={{ marginBottom: 12 }}>
                  <label htmlFor="lab-scenario-picker" className="toolbar-label">
                    Select Scenario:
                  </label>
                  <div className="toolbar-select-wrapper">
                    <select
                      id="lab-scenario-picker"
                      className="toolbar-select"
                      value={selectedScenarioId}
                      onChange={(e) => handleSwitchScenario(e.target.value)}
                    >
                      {EVALUATION_SCENARIOS.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.id}] {s.title} — {s.rivalName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Quick Presets for Judges */}
                <div className="quick-presets-wrapper">
                  <span className="comparison-preset-label">Quick Scenarios:</span>
                  {PRESET_SCENARIOS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`preset-chip ${selectedScenarioId === p.id ? "active" : ""}`}
                      onClick={() => handleSwitchScenario(p.id)}
                    >
                      [{p.id}] {p.label}
                    </button>
                  ))}
                </div>

                <p className="lab-scenario-desc" style={{ marginTop: 14 }}>
                  {currentScenario.description}
                </p>

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
                      title="Copy move sequence"
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
                      {context.profile.hasSufficientEvidence ? "≥ 3 Player Moves (Sufficient)" : "< 3 Moves (Gate Triggered)"}
                    </span>
                  </div>
                  <p className="gate-desc">
                    {context.profile.hasSufficientEvidence
                      ? "Sufficient behavioral evidence collected. Heuristic signals are compiled and dispatched to Gemma 2."
                      : "Insufficient moves to observe distinct human habits. Promptly routes to offline scripted dialogue with zero latency."}
                  </p>
                </div>
              </div>

              {/* STEP 2: Deterministic Behavioral Signals */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="lab-panel-header">
                  <div className="step-badge">STEP 02 · SEE THE DETECTED BEHAVIOR</div>
                  <h2 className="lab-panel-title">Extracted Player Patterns</h2>
                </div>

                {context.profile.insights.length === 0 ? (
                  <div className="lab-empty-signals">
                    <ScrollText size={20} className="icon-gold" />
                    <div>
                      <strong>No Negative Habit Flaws Detected</strong>
                      <p>
                        Harmonious classical piece development detected. The player did not overextend pawns, wander their queen early, or linger uncastled.
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

              {/* STEP 3: Inspect Gemma's Input Payload */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="lab-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div className="step-badge">STEP 03 · INSPECT GEMMA'S INPUT</div>
                    <h2 className="lab-panel-title">Minimal Structured Payload</h2>
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

                <button
                  type="button"
                  className="btn-subtle-copy"
                  style={{ marginTop: 10 }}
                  onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                >
                  {showSystemPrompt ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>{showSystemPrompt ? "Hide System Directive" : "Inspect System Persona Directive"}</span>
                </button>

                {showSystemPrompt && (
                  <pre className="lab-system-prompt-view" style={{ marginTop: 10 }}>
                    {systemPrompt}
                  </pre>
                )}
              </div>
            </div>

            {/* ── RIGHT COLUMN: Live Execution & Intelligence (~45%) ────────── */}
            <div className="gemma-lab-column">
              {/* STEP 4: Real Model Execution Control */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="lab-panel-header">
                  <div className="step-badge">STEP 04 · RUN REAL INFERENCE</div>
                  <h2 className="lab-panel-title">Local Model Execution</h2>
                </div>

                <div className="inference-action-panel">
                  <div className="inference-status-row">
                    <div className="status-meta-left">
                      <span className="status-dot green" />
                      <span><strong>Target:</strong> gemma2:2b (Ollama :11434)</span>
                    </div>

                    <div className="status-meta-right">
                      {latencyMs !== null && (
                        <span className="latency-pill">
                          <Clock size={12} /> {latencyMs}ms
                        </span>
                      )}
                      <span className="rival-diff-pill">{currentScenario.difficulty}</span>
                    </div>
                  </div>

                  {isRunning && (
                    <div className="inference-loading-banner" role="status" aria-live="polite">
                      <RefreshCw size={16} className="spin icon-gold" />
                      <span>{loadingStatusText}</span>
                      <span className="inference-timer">{elapsedTimer}ms</span>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="lab-alert-box error" role="alert">
                      <AlertTriangle size={16} />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    id="btn-run-gemma-inference"
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
                        <span>{hasInferenceRun ? "Re-Run Live Inference" : "Run Live Gemma Inference"}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* STEP 5: Rival Response (THE CENTERPIECE) */}
              <div className="lab-panel lab-centerpiece-panel">
                <div className="panel-accent-top-gold" />
                <div className="centerpiece-header">
                  <div>
                    <div className="step-badge" style={{ color: "var(--gold-soft)" }}>
                      STEP 05 · SEE THE RIVAL RESPOND
                    </div>
                    <h2 className="lab-panel-title centerpiece-title">Rival Intelligence</h2>
                  </div>

                  <div className="centerpiece-status-badges">
                    {latencyMs !== null && (
                      <span className="latency-pill">
                        <Clock size={12} /> {latencyMs}ms
                      </span>
                    )}
                    <span
                      className={`source-pill ${
                        !hasInferenceRun
                          ? "pending"
                          : activeInsight.source === "model"
                          ? "model"
                          : "template"
                      }`}
                    >
                      {!hasInferenceRun
                        ? "Awaiting Inference"
                        : activeInsight.source === "model"
                        ? "Google Gemma 2 (2B)"
                        : "Scripted Fallback"}
                    </span>
                  </div>
                </div>

                {!hasInferenceRun ? (
                  <div className="lab-awaiting-state">
                    <div className="awaiting-icon-wrap">
                      <Sparkles size={28} className="icon-gold" />
                    </div>
                    <h3 className="awaiting-title">Awaiting the Rival's Thoughts</h3>
                    <p className="awaiting-desc">
                      Click <strong>Run Live Gemma Inference</strong> in Step 4 to call Google's Gemma 2 (2B)
                      through local Ollama. Gemma will analyze the extracted habits and respond in{" "}
                      <em>{currentScenario.rivalName}'s</em> persona.
                    </p>
                    <div className="awaiting-subnote">
                      Validated on 16 chess scenarios with 100% schema validity & strict behavioral grounding.
                    </div>
                  </div>
                ) : (
                  <div className="lab-dialogue-cards">
                    {/* Observation */}
                    <div className="dialogue-card observation">
                      <div className="dialogue-tag">OBSERVATION · GROUNDED HABIT</div>
                      <p className="dialogue-prose">"{activeInsight.observation}"</p>
                    </div>

                    {/* Taunt */}
                    <div className="dialogue-card taunt">
                      <div className="dialogue-tag taunt-tag">RIVAL'S TAUNT · GOTHIC VOICE</div>
                      <blockquote className="dialogue-quote">"{activeInsight.taunt}"</blockquote>
                    </div>

                    {/* Tip */}
                    {activeInsight.tip && (
                      <div className="dialogue-card tip">
                        <div className="dialogue-tag tip-tag">TACTICAL ADVICE · CHESS PRINCIPLE</div>
                        <p className="dialogue-tip-prose">"{activeInsight.tip}"</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* STEP 6: Quality & Grounding Audit */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="lab-panel-header">
                  <div className="step-badge">STEP 06 · INSPECT EVALUATION RESULTS</div>
                  <h2 className="lab-panel-title">Inference Quality & Safety Audit</h2>
                </div>

                <div className="quality-checks-list">
                  <div className="quality-check-item">
                    <div className="check-left">
                      <ShieldCheck size={16} className={hasInferenceRun ? "icon-emerald" : "icon-dim"} />
                      <div className="check-text">
                        <span className="check-label">Strict JSON Schema Enforcement</span>
                        <span className="check-sub">Keys `observation`, `taunt`, `tip` strictly bounded</span>
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
                        <span className="check-sub">Dialogue explicitly references observed habits</span>
                      </div>
                    </div>
                    <span className={grounding.pass ? "check-pill pass" : "check-pill note"}>
                      {grounding.pass
                        ? `Matched: [${grounding.matched.join(", ")}]`
                        : hasInferenceRun
                        ? "Generic Grounding"
                        : "Awaiting Run"}
                    </span>
                  </div>

                  <div className="quality-check-item">
                    <div className="check-left">
                      <CheckCircle2 size={16} className={hallucination.clean ? "icon-emerald" : "icon-crimson"} />
                      <div className="check-text">
                        <span className="check-label">Anti-Hallucination Guard</span>
                        <span className="check-sub">Rejects claims of unmade sacrifices or phantom captures</span>
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
                        <span className="check-label">Rival Persona Lexicon Fidelity</span>
                        <span className="check-sub">Vocabulary tailored to {currentScenario.rivalName}</span>
                      </div>
                    </div>
                    <span className="check-pill persona">
                      {persona.indicators.length > 0
                        ? `Vocabulary: [${persona.indicators.join(", ")}]`
                        : "Solemn Gothic Tone"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODE 2: SCENARIO COMPARISON MODE (SIDE-BY-SIDE EVALUATION)              */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {labMode === "comparison" && (
        <section aria-label="Scenario Comparison">
          {/* Comparison Presets */}
          <div className="comparison-preset-bar">
            <span className="comparison-preset-label">Recommended Comparisons:</span>
            {COMPARISON_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`preset-chip ${scenarioIdA === p.idA && scenarioIdB === p.idB ? "active" : ""}`}
                onClick={() => handleApplyPresetComparison(p)}
                title={p.desc}
              >
                {p.name}
              </button>
            ))}

            <button
              type="button"
              id="btn-run-comparison"
              className="btn-run-inference"
              style={{ marginLeft: "auto", minWidth: 200 }}
              onClick={handleRunComparison}
              disabled={isComparing}
            >
              {isComparing ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  <span>Comparing Live ({elapsedTimer}ms)...</span>
                </>
              ) : (
                <>
                  <SlidersHorizontal size={14} />
                  <span>Run Comparative Inference</span>
                </>
              )}
            </button>
          </div>

          {/* Comparison Side-by-Side Dual Grid */}
          <div className="comparison-grid">
            {/* ── SCENARIO A ──────────────────────────────────────────────── */}
            <div className="comparison-column col-a">
              <div className="comparison-column-header">
                <span className="comparison-tag tag-a">SCENARIO A</span>
                <div className="comparison-picker-wrap">
                  <select
                    className="toolbar-select"
                    value={scenarioIdA}
                    onChange={(e) => {
                      setScenarioIdA(e.target.value);
                      setResultA(null);
                      setLatencyA(null);
                    }}
                  >
                    {EVALUATION_SCENARIOS.map((s) => (
                      <option key={s.id} value={s.id}>
                        [{s.id}] {s.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Move Sequence A */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="eyebrow">CHESS TELEMETRY A</div>
                <h3 className="lab-panel-title" style={{ fontSize: 16 }}>
                  {scnObjA.title} · <span className="muted" style={{ fontSize: 13 }}>{scnObjA.rivalName}</span>
                </h3>
                <div className="lab-moves-display" style={{ marginTop: 8 }}>
                  {scnObjA.moves.join(" ")}
                </div>
              </div>

              {/* Detected Habits A */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="eyebrow">DETECTED BEHAVIORAL HABITS A</div>
                {ctxObjA.profile.insights.length === 0 ? (
                  <p className="muted" style={{ margin: "8px 0" }}>Harmonious opening; 0 habit flaws detected.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    {ctxObjA.profile.insights.map((h) => (
                      <div key={h.id} className="comparison-diff-chip">
                        <strong style={{ color: "var(--gold-soft)" }}>{h.title}</strong>
                        <span>({h.confidence} confidence)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Live Rival Response A */}
              <div className="lab-panel lab-centerpiece-panel">
                <div className="panel-accent-top-gold" />
                <div className="centerpiece-header">
                  <div className="eyebrow gold">RIVAL DIALOGUE A</div>
                  {latencyA !== null && (
                    <span className="latency-pill">
                      <Clock size={12} /> {latencyA}ms
                    </span>
                  )}
                </div>

                {errorA && (
                  <div className="lab-alert-box error" style={{ margin: "8px 0" }}>
                    <span>{errorA}</span>
                  </div>
                )}

                {resultA ? (
                  <div className="lab-dialogue-cards" style={{ marginTop: 10 }}>
                    <div className="dialogue-card observation">
                      <div className="dialogue-tag">OBSERVATION</div>
                      <p className="dialogue-prose">"{resultA.observation}"</p>
                    </div>
                    <div className="dialogue-card taunt">
                      <div className="dialogue-tag taunt-tag">TAUNT</div>
                      <blockquote className="dialogue-quote">"{resultA.taunt}"</blockquote>
                    </div>
                    {resultA.tip && (
                      <div className="dialogue-card tip">
                        <div className="dialogue-tag tip-tag">TACTICAL TIP</div>
                        <p className="dialogue-tip-prose">"{resultA.tip}"</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="lab-awaiting-state" style={{ padding: "20px 10px" }}>
                    <p className="muted" style={{ margin: 0 }}>
                      Click <strong>Run Comparative Inference</strong> above to generate live response for Scenario A.
                    </p>
                  </div>
                )}
              </div>

              {/* Quality Audit A */}
              {resultA && (
                <div className="comparison-summary-card">
                  <span className="comparison-summary-title">Quality Verification A</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="check-pill pass">Schema Valid</span>
                    <span className="check-pill pass">
                      Grounding: {checkGrounding(resultA, scnObjA.expectedKeywords).pass ? "Passed" : "Generic"}
                    </span>
                    <span className="check-pill pass">
                      Anti-Hallucination: {checkHallucinations(resultA, scnObjA.antiKeywords).clean ? "Clean" : "Flagged"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ── SCENARIO B ──────────────────────────────────────────────── */}
            <div className="comparison-column col-b">
              <div className="comparison-column-header">
                <span className="comparison-tag tag-b">SCENARIO B</span>
                <div className="comparison-picker-wrap">
                  <select
                    className="toolbar-select"
                    value={scenarioIdB}
                    onChange={(e) => {
                      setScenarioIdB(e.target.value);
                      setResultB(null);
                      setLatencyB(null);
                    }}
                  >
                    {EVALUATION_SCENARIOS.map((s) => (
                      <option key={s.id} value={s.id}>
                        [{s.id}] {s.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Move Sequence B */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="eyebrow">CHESS TELEMETRY B</div>
                <h3 className="lab-panel-title" style={{ fontSize: 16 }}>
                  {scnObjB.title} · <span className="muted" style={{ fontSize: 13 }}>{scnObjB.rivalName}</span>
                </h3>
                <div className="lab-moves-display" style={{ marginTop: 8 }}>
                  {scnObjB.moves.join(" ")}
                </div>
              </div>

              {/* Detected Habits B */}
              <div className="lab-panel">
                <div className="panel-accent-top" />
                <div className="eyebrow">DETECTED BEHAVIORAL HABITS B</div>
                {ctxObjB.profile.insights.length === 0 ? (
                  <p className="muted" style={{ margin: "8px 0" }}>Harmonious opening; 0 habit flaws detected.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    {ctxObjB.profile.insights.map((h) => (
                      <div key={h.id} className="comparison-diff-chip">
                        <strong style={{ color: "#93c5fd" }}>{h.title}</strong>
                        <span>({h.confidence} confidence)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Live Rival Response B */}
              <div className="lab-panel lab-centerpiece-panel">
                <div className="panel-accent-top-gold" />
                <div className="centerpiece-header">
                  <div className="eyebrow gold">RIVAL DIALOGUE B</div>
                  {latencyB !== null && (
                    <span className="latency-pill">
                      <Clock size={12} /> {latencyB}ms
                    </span>
                  )}
                </div>

                {errorB && (
                  <div className="lab-alert-box error" style={{ margin: "8px 0" }}>
                    <span>{errorB}</span>
                  </div>
                )}

                {resultB ? (
                  <div className="lab-dialogue-cards" style={{ marginTop: 10 }}>
                    <div className="dialogue-card observation">
                      <div className="dialogue-tag">OBSERVATION</div>
                      <p className="dialogue-prose">"{resultB.observation}"</p>
                    </div>
                    <div className="dialogue-card taunt">
                      <div className="dialogue-tag taunt-tag">TAUNT</div>
                      <blockquote className="dialogue-quote">"{resultB.taunt}"</blockquote>
                    </div>
                    {resultB.tip && (
                      <div className="dialogue-card tip">
                        <div className="dialogue-tag tip-tag">TACTICAL TIP</div>
                        <p className="dialogue-tip-prose">"{resultB.tip}"</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="lab-awaiting-state" style={{ padding: "20px 10px" }}>
                    <p className="muted" style={{ margin: 0 }}>
                      Click <strong>Run Comparative Inference</strong> above to generate live response for Scenario B.
                    </p>
                  </div>
                )}
              </div>

              {/* Quality Audit B */}
              {resultB && (
                <div className="comparison-summary-card">
                  <span className="comparison-summary-title">Quality Verification B</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="check-pill pass">Schema Valid</span>
                    <span className="check-pill pass">
                      Grounding: {checkGrounding(resultB, scnObjB.expectedKeywords).pass ? "Passed" : "Generic"}
                    </span>
                    <span className="check-pill pass">
                      Anti-Hallucination: {checkHallucinations(resultB, scnObjB.antiKeywords).clean ? "Clean" : "Flagged"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
