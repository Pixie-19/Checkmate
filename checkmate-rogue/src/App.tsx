import { useEffect, useMemo, useRef, useState } from "react";
import { StockfishEngine } from "./engine/stockfish";
import { Chess, type Square } from "chess.js";
import {
  Crown,
  RotateCcw,
  Shield,
  Skull,
  Swords,
  Eye,
  Undo2,
  ShieldCheck,
  HelpCircle,
  AlertTriangle,
} from "lucide-react";
import {
  createCampaign,
  recordWin,
  recordLoss,
  chooseRelic,
  getRivalName,
  getEncounterDifficulty,
  applyKnightsEchoPenalty,
  consumeSkipNextRelic,
  recordEncounterBehavior,
  getAggregatedCampaignStats,
  type CampaignState,
  type RelicId,
  type EncounterBehaviorRecord,
} from "./game/campaign";
import { analyzePlayerBehavior } from "./ai/playerBehavior";
import {
  type RivalInsight,
  type RivalContext,
  type EncounterPhase,
} from "./ai/rivalInsight";
import {
  TemplateDialogueProvider,
  GemmaDialogueProvider,
  type GemmaConnectionStatus,
} from "./ai/dialogueProvider";
import {
  createEncounterRelicState,
  type EncounterRelicState,
  type HintHighlight,
} from "./game/encounterState";
import {
  getBestDefensiveMove,
  checkUndoEligibility,
  applyUndo,
} from "./game/relicEffects";
import { RELICS } from "./data/relics";
import HowToPlay from "./components/HowToPlay";
import { ChessPiece } from "./components/ChessPiece";
import "./App.css";

/**
 * When VITE_IS_HOSTED=true the build is served from a public static host.
 * In that mode Local Gemma is hidden and no requests are ever sent to
 * a visitor's localhost.
 */
const IS_HOSTED: boolean =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_IS_HOSTED === "true";

const FILES = "abcdefgh";


function cloneGame(game: Chess): Chess {
  const copy = new Chess();
  copy.loadPgn(game.pgn());
  return copy;
}


function getStatus(game: Chess) {
  if (game.isCheckmate()) {
    return game.turn() === "w"
      ? "Checkmate — The rival wins!"
      : "Checkmate — You win!";
  }

  if (game.isStalemate()) return "Stalemate — The game is a draw.";
  if (game.isInsufficientMaterial()) return "Insufficient material — Draw.";
  if (game.isThreefoldRepetition()) return "Threefold repetition — Draw.";
  if (game.isDraw()) return "The game is a draw.";
  if (game.isCheck()) return "Check! Protect your king.";

  return game.turn() === "w"
    ? "Your turn — White"
    : "The rival is thinking...";
}

// EncounterResult is held in a ref (not state) so it is stable across
// React Strict Mode double-invocations and never goes stale in closures.
type EncounterResult = "win" | "loss" | "draw" | null;

export default function App() {
  const [game, setGame] = useState(() => new Chess());
  const [selected, setSelected] = useState<Square | null>(null);
  const [thinking, setThinking] = useState(false);

  // Last-move highlighting (from/to squares shown after each move)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);

  // Engine ready state drives the loading bar
  const [engineReady, setEngineReady] = useState(false);

  const history = game.history();

  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return Array.from(new Set(game.moves({ square: selected, verbose: true }).map((m) => m.to)));
  }, [game, selected]);

  const movesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (movesContainerRef.current) {
      movesContainerRef.current.scrollTop = movesContainerRef.current.scrollHeight;
    }
  }, [history.length]);

  const engineRef = useRef<StockfishEngine | null>(null);
  const generationRef = useRef(0);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [retryingEngine, setRetryingEngine] = useState(false);

  const [campaign, setCampaign] = useState<CampaignState>(() => createCampaign());

  // Derived encounter information
  const rivalIndex = Math.min(campaign.rivalIndex, 2);
  const rivalName = getRivalName(rivalIndex);
  const encounterDifficulty = getEncounterDifficulty(campaign);

  // Dialogue provider and mode selection.
  // In hosted mode, always use scripted to avoid requests to a visitor's localhost.
  const [dialogueMode, setDialogueMode] = useState<"scripted" | "gemma">("scripted");
  const [gemmaStatus, setGemmaStatus] = useState<GemmaConnectionStatus>("idle");

  const templateProvider = useMemo(() => new TemplateDialogueProvider(), []);
  const gemmaProvider = useMemo(() => new GemmaDialogueProvider(), []);

  // Hosted-mode guard: if IS_HOSTED, force scripted and keep it there.
  // This runs synchronously after state initialization so no network request
  // from a visitor's machine ever reaches localhost Ollama.
  useEffect(() => {
    if (IS_HOSTED && dialogueMode !== "scripted") {
      setDialogueMode("scripted");
    }
  }, [dialogueMode]);

  // How-to-Play modal: shown automatically to first-time visitors (session-scoped).
  const [showHelp, setShowHelp] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem("htp-dismissed") !== "1";
    } catch {
      return true;
    }
  });

  function dismissHelp() {
    try {
      sessionStorage.setItem("htp-dismissed", "1");
    } catch {
      // sessionStorage unavailable — ignore
    }
    setShowHelp(false);
  }

  const dialogueRequestIdRef = useRef(0);
  const dialogueAbortControllerRef = useRef<AbortController | null>(null);

  const [rivalInsight, setRivalInsight] = useState<RivalInsight>(() => {
    const provider = new TemplateDialogueProvider();
    return provider.generateInsightSync({
      rivalName: getRivalName(0),
      rivalIndex: 0,
      difficulty: "apprentice",
      phase: "opening",
      profile: analyzePlayerBehavior([], "w"),
      moveCount: 0,
    });
  });

  const activeProfile = useMemo(() => {
    return analyzePlayerBehavior(game, "w");
  }, [game]);

  const aggregatedStats = useMemo(() => {
    return getAggregatedCampaignStats(campaign);
  }, [campaign]);

  // Popup visibility flags
  const [showRelicChoice, setShowRelicChoice] = useState(false);
  const [pendingRelic, setPendingRelic] = useState<RelicId | null>(null);
  const [showDrawResult, setShowDrawResult] = useState(false);
  const [showLossResult, setShowLossResult] = useState(false);

  // Ref-based guard: prevents duplicate result handling across re-renders /
  // React Strict Mode double-effects. Reset explicitly on new encounter.
  const encounterResultRef = useRef<EncounterResult>(null);

  // ── Per-encounter relic usage ────────────────────────────────────────────
  const [relicState, setRelicState] = useState<EncounterRelicState>(
    createEncounterRelicState
  );

  // Board highlight for hint moves (Oracle's Debt / Fortress Pact)
  const [hintHighlight, setHintHighlight] = useState<HintHighlight | null>(null);

  // True while a hint analysis is running (separate from the rival's thinking)
  const [hintLoading, setHintLoading] = useState(false);

  // Text shown below relic buttons (hint result, undo result, errors)
  const [relicMessage, setRelicMessage] = useState<string | null>(null);

  // engineHasReplied: tracks whether the engine has made its move after the
  // player's last move. Resets when the player makes a move, sets when engine moves.
  // Used by Knight's Echo to determine how many half-moves to undo.
  const engineHasRepliedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Stockfish initialization (once, on mount)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let active = true;
    const engine = new StockfishEngine();
    engineRef.current = engine;

    engine.initialize().then(() => {
      if (!active || engineRef.current !== engine) return;
      setEngineReady(true);
    }).catch((error) => {
      // Discard errors from an unmounted or superseded engine instance
      if (!active || engineRef.current !== engine) {
        return;
      }
      console.error("Stockfish initialization failed:", error);
      setEngineError(error instanceof Error ? error.message : String(error));
      setThinking(false);
      setEngineReady(false);
    });

    return () => {
      active = false;
      generationRef.current++;
      engine.dispose();
      if (engineRef.current === engine) {
        engineRef.current = null;
      }
      setEngineReady(false);
    };
  }, []);

  const handleRetryEngine = async () => {
    if (retryingEngine) return;
    setRetryingEngine(true);
    setEngineError(null);
    setThinking(false);
    setEngineReady(false);

    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }

    const newEngine = new StockfishEngine();
    engineRef.current = newEngine;

    try {
      await newEngine.initialize();
      setEngineReady(true);
      setEngineError(null);

      // If it is currently Black's turn and the game is active, trigger Stockfish move
      if (
        game.turn() === "b" &&
        !game.isGameOver() &&
        campaign.status === "active" &&
        !showRelicChoice &&
        !showDrawResult &&
        !showLossResult
      ) {
        setThinking(true);
        const difficulty = getEncounterDifficulty(campaign);
        const bestMove = await newEngine.getBestMove(game, difficulty);
        if (bestMove) {
          const moveFrom = bestMove.slice(0, 2);
          const moveTo = bestMove.slice(2, 4);
          setGame((current) => {
            if (current.turn() !== "b" || current.isGameOver()) return current;
            const next = cloneGame(current);
            next.move({
              from: moveFrom,
              to: moveTo,
              promotion: bestMove[4] || "q",
            });
            return next;
          });
          engineHasRepliedRef.current = true;
          setLastMove({ from: moveFrom, to: moveTo });
        }
      }
    } catch (err) {
      console.error("Retry Stockfish failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setEngineError(msg);
      setEngineReady(false);
    } finally {
      setThinking(false);
      setRetryingEngine(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Stockfish move effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Do not move when game is over, campaign is finished, or a popup is open.
    if (
      game.turn() !== "b" ||
      game.isGameOver() ||
      campaign.status !== "active" ||
      showRelicChoice ||
      showDrawResult ||
      showLossResult
    ) {
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;

    let cancelled = false;
    const generation = generationRef.current;
    // Derive difficulty at effect-entry time so it's stable in the closure.
    const difficulty = getEncounterDifficulty(campaign);

    const timer = window.setTimeout(async () => {
      setThinking(true);

      try {
        const bestMove = await engine.getBestMove(game, difficulty);

        if (cancelled || generation !== generationRef.current || !bestMove) {
          return;
        }

        let moveApplied = false;
        const moveFrom = bestMove.slice(0, 2);
        const moveTo = bestMove.slice(2, 4);
        setGame((current) => {
          if (current.turn() !== "b" || current.isGameOver()) return current;

          const next = cloneGame(current);
          try {
            next.move({
              from: moveFrom,
              to: moveTo,
              promotion: bestMove[4] || "q",
            });
            moveApplied = true;
            return next;
          } catch {
            console.error("Invalid Stockfish move:", bestMove);
            return current;
          }
        });

        // Set only when move was actually applied successfully
        if (moveApplied) {
          engineHasRepliedRef.current = true;
          setLastMove({ from: moveFrom, to: moveTo });
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Stockfish error:", error);
          setEngineError(String(error));
        }
      } finally {
        if (!cancelled) setThinking(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [game, showRelicChoice, showDrawResult, showLossResult, campaign]);

  // ---------------------------------------------------------------------------
  // Rival Insight update (reacts after moves and results, respecting mode)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const requestId = ++dialogueRequestIdRef.current;
    if (dialogueAbortControllerRef.current) {
      dialogueAbortControllerRef.current.abort("New position or encounter occurred");
      dialogueAbortControllerRef.current = null;
    }

    const moves = game.history({ verbose: true });
    const profile = analyzePlayerBehavior(moves, "w");

    const phase: EncounterPhase = game.isGameOver()
      ? "result"
      : moves.length <= 16
        ? "opening"
        : moves.length <= 36
          ? "midgame"
          : "endgame";

    const outcome = game.isGameOver()
      ? game.isCheckmate()
        ? game.turn() === "b"
          ? "win"
          : "loss"
        : "draw"
      : undefined;

    const playerMoves = moves.filter((m) => m.color === "w");
    const lastPlayerMove = playerMoves[playerMoves.length - 1];

    const context: RivalContext = {
      rivalName,
      rivalIndex,
      difficulty: encounterDifficulty,
      phase,
      profile,
      moveCount: profile.totalPlayerMoves,
      lastPlayerMoveSan: lastPlayerMove?.san,
      isCheck: game.isCheck(),
      outcome,
    };

    if (dialogueMode === "scripted") {
      setGemmaStatus("idle");
      const insight = templateProvider.generateInsightSync(context);
      setRivalInsight(insight);
      return;
    }

    // Local Gemma mode: asynchronous inference with truthful status & fallback
    const abortController = new AbortController();
    dialogueAbortControllerRef.current = abortController;
    setGemmaStatus("loading");

    gemmaProvider
      .generateInsightWithDetails(context, { signal: abortController.signal })
      .then((res) => {
        // Discard stale response if a newer move occurred
        if (dialogueRequestIdRef.current !== requestId) return;
        setRivalInsight(res.insight);
        setGemmaStatus(res.status);
      })
      .catch(() => {
        if (dialogueRequestIdRef.current !== requestId) return;
        const fallback = templateProvider.generateInsightSync(context);
        setRivalInsight(fallback);
        setGemmaStatus("unavailable");
      });

    return () => {
      abortController.abort();
    };
  }, [
    game,
    rivalIndex,
    rivalName,
    encounterDifficulty,
    dialogueMode,
    templateProvider,
    gemmaProvider,
  ]);

  // ---------------------------------------------------------------------------
  // Game-over detection (fires once per encounter via ref guard)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!game.isGameOver()) return;
    // Already resolved this encounter — skip (handles Strict Mode double-fire).
    if (encounterResultRef.current !== null) return;

    const profile = analyzePlayerBehavior(game, "w");
    const baseRecord: EncounterBehaviorRecord = {
      encounterIndex: rivalIndex,
      rivalName,
      outcome: "win",
      playerMoveCount: profile.totalPlayerMoves,
      castled: profile.summary.castled,
      castlingSide: profile.summary.castlingSide,
      openingQueenMoves: profile.summary.openingQueenMoves,
      repeatedPieceMoveCount: profile.summary.repeatedPieceMoveCount,
      pawnMoveCount: profile.summary.pawnMoveCount,
      captureCount: profile.summary.captureCount,
      checkCount: profile.summary.checkCount,
      topInsightIds: profile.insights.map((i) => i.id),
    };

    if (game.isCheckmate()) {
      // turn() returns the side TO MOVE — in checkmate, that side has LOST.
      if (game.turn() === "b") {
        // Black is in checkmate → White (player) wins.
        encounterResultRef.current = "win";
        setCampaign((c) => {
          const updated = recordEncounterBehavior(recordWin(c), {
            ...baseRecord,
            outcome: "win",
          });
          // Only show relic choice if the campaign is continuing (active).
          // If the final rival was defeated, status is "victory" and Run Complete modal displays.
          if (updated.status === "active") {
            setShowRelicChoice(true);
          }
          return updated;
        });
      } else {
        // White is in checkmate → Black (rival) wins → player loses.
        encounterResultRef.current = "loss";
        setCampaign((c) => {
          const updated = recordEncounterBehavior(recordLoss(c), {
            ...baseRecord,
            outcome: "loss",
          });
          // Show loss result modal only if player still has hearts remaining.
          // If zero hearts remain, status is "defeat" and Run Complete modal displays.
          if (updated.status === "active") {
            setShowLossResult(true);
          }
          return updated;
        });
      }
    } else {
      // Draw of any kind.
      encounterResultRef.current = "draw";
      setCampaign((c) =>
        recordEncounterBehavior(c, {
          ...baseRecord,
          outcome: "draw",
        })
      );
      setShowDrawResult(true);
    }
  }, [game, rivalIndex, rivalName]);

  // ---------------------------------------------------------------------------
  // Player move handler
  // ---------------------------------------------------------------------------
  function handleSquareClick(square: Square) {
    // Block clicks when game is over, not the player's turn,
    // the engine is thinking, campaign is over, or a popup is open.
    if (
      game.turn() !== "w" ||
      game.isGameOver() ||
      campaign.status !== "active" ||
      thinking ||
      hintLoading ||
      showRelicChoice ||
      showDrawResult ||
      showLossResult
    ) {
      return;
    }

    const piece = game.get(square);

    if (!selected) {
      if (piece?.color === "w") setSelected(square);
      return;
    }

    if (selected === square) {
      setSelected(null);
      return;
    }

    if (piece?.color === "w") {
      setSelected(square);
      return;
    }

    // Use cloneGame to preserve move history (requirement #14).
    const next = cloneGame(game);
    try {
      next.move({ from: selected, to: square, promotion: "q" });
      // Player moved — engine hasn't replied yet for this move.
      engineHasRepliedRef.current = false;
      setHintHighlight(null);
      setRelicMessage(null);
      setLastMove({ from: selected, to: square });
      setGame(next);
    } catch {
      // Illegal move — keep current position.
    }

    setSelected(null);
  }

  // ---------------------------------------------------------------------------
  // Restart current encounter (must NOT grant win / remove heart / advance)
  // ---------------------------------------------------------------------------
  function resetEncounterUiState() {
    engineRef.current?.stop();
    generationRef.current++;
    encounterResultRef.current = null;
    engineHasRepliedRef.current = false;
    dialogueRequestIdRef.current++;
    if (dialogueAbortControllerRef.current) {
      dialogueAbortControllerRef.current.abort();
      dialogueAbortControllerRef.current = null;
    }
    setGame(new Chess());
    setSelected(null);
    setThinking(false);
    setEngineError(null);
    setShowRelicChoice(false);
    setPendingRelic(null);
    setShowDrawResult(false);
    setShowLossResult(false);
    setRelicState(createEncounterRelicState());
    setHintHighlight(null);
    setRelicMessage(null);
    setHintLoading(false);
    setLastMove(null);
  }

  function restartEncounter() {
    resetEncounterUiState();
    // Campaign state unchanged — no win/loss recorded.
  }

  // ---------------------------------------------------------------------------
  // Continue to next encounter after a win + relic selection
  // ---------------------------------------------------------------------------
  function continueCampaign() {
    if (campaign.status !== "active") return;
    if (pendingRelic && !campaign.selectedRelics.includes(pendingRelic)) {
      setCampaign((c) => chooseRelic(c, pendingRelic));
    }
    resetEncounterUiState();
  }

  // ---------------------------------------------------------------------------
  // Continue after a draw (retry the same encounter, no campaign change)
  // ---------------------------------------------------------------------------
  function retryAfterDraw() {
    resetEncounterUiState();
  }

  // ---------------------------------------------------------------------------
  // Continue after a loss
  // ---------------------------------------------------------------------------
  function continueAfterLoss() {
    resetEncounterUiState();
  }

  // ---------------------------------------------------------------------------
  // Start a completely new run
  // ---------------------------------------------------------------------------
  function startNewRun() {
    setCampaign(createCampaign());
    resetEncounterUiState();
  }

  // ---------------------------------------------------------------------------
  // Relic selection — saved as pending choice until Continue is clicked
  // ---------------------------------------------------------------------------
  function selectRelic(relicId: RelicId) {
    if (campaign.selectedRelics.includes(relicId)) return;
    setPendingRelic((current) => (current === relicId ? null : relicId));
  }

  // ---------------------------------------------------------------------------
  // Oracle's Debt — engine hint (one per encounter)
  // ---------------------------------------------------------------------------
  async function useOraclesDebt() {
    if (relicState.oraclesDebtUsed) return;
    if (game.isGameOver() || game.turn() !== "w") return;

    const engine = engineRef.current;
    if (!engine) { setRelicMessage("Engine not ready."); return; }
    if (engine.isBusy()) {
      setRelicMessage("The engine is still calculating the rival's move. Wait a moment.");
      return;
    }

    setHintLoading(true);
    setRelicMessage(null);
    setHintHighlight(null);
    const capturedGen = generationRef.current;

    try {
      // Use a fixed depth for hints regardless of campaign difficulty.
      const bestMove = await engine.getBestMove(game, "apprentice");

      if (generationRef.current !== capturedGen) return; // encounter changed
      if (!bestMove) {
        setRelicMessage("No hint available for this position.");
        return;
      }

      const from = bestMove.slice(0, 2);
      const to = bestMove.slice(2, 4);
      const prom = bestMove[4] ?? "";
      const label = `${from.toUpperCase()}→${to.toUpperCase()}${prom ? `=${prom.toUpperCase()}` : ""}`;

      setHintHighlight({ from, to, label });
      setRelicMessage(`Oracle's suggestion: ${label}`);
      setRelicState((s) => ({ ...s, oraclesDebtUsed: true }));
    } catch (err) {
      if (generationRef.current === capturedGen) {
        setRelicMessage(`Hint failed: ${String(err)}`);
      }
    } finally {
      if (generationRef.current === capturedGen) setHintLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Fortress Pact — defensive hint (one per encounter, pure local scorer)
  // ---------------------------------------------------------------------------
  function useFortressPact() {
    if (relicState.fortressPactUsed) return;
    if (game.isGameOver() || game.turn() !== "w") return;

    const suggestion = getBestDefensiveMove(game);
    if (!suggestion) {
      setRelicMessage("No legal moves available.");
      return;
    }

    const { move, wasDefensive } = suggestion;
    const label = `${move.from.toUpperCase()}→${move.to.toUpperCase()}`;
    setHintHighlight({ from: move.from, to: move.to, label });

    if (!wasDefensive) {
      setRelicMessage(
        `Fortress Pact: No active threat detected. Suggested: ${label} (positional improvement).`
      );
    } else if (game.isCheck()) {
      setRelicMessage(`Fortress Pact: You are in check! Suggested escape: ${label}`);
    } else {
      setRelicMessage(
        `Fortress Pact: Defensive suggestion — ${label} (protects a threatened piece or improves king safety).`
      );
    }

    setRelicState((s) => ({ ...s, fortressPactUsed: true }));
  }

  // ---------------------------------------------------------------------------
  // Knight's Echo — undo last move (one per encounter)
  // ---------------------------------------------------------------------------
  function useKnightsEcho() {
    if (relicState.knightsEchoUsed) return;

    const eligibility = checkUndoEligibility(game, engineHasRepliedRef.current);
    if (!eligibility.canUndo) {
      setRelicMessage(`Knight's Echo: ${eligibility.reason}`);
      return;
    }

    const undoneGame = applyUndo(game, engineHasRepliedRef.current);

    // Stop engine and bump generation to discard in-flight calculations
    engineRef.current?.stop();
    generationRef.current++;
    engineHasRepliedRef.current = false;
    setHintHighlight(null);
    setRelicMessage("Knight's Echo: Move undone. Your relic reward is forfeit.");
    setGame(undoneGame);
    setSelected(null);
    setRelicState((s) => ({ ...s, knightsEchoUsed: true }));
    // Record penalty so the next relic reward modal skips selection.
    setCampaign((c) => applyKnightsEchoPenalty(c));
  }

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------
  const rivalRomanTag = (["I", "II", "III"] as const)[rivalIndex];
  const difficultyLabel: Record<string, string> = {
    apprentice: "Apprentice",
    knight: "Knight",
    boss: "Boss",
  };

  const hasOraclesDebt = campaign.selectedRelics.includes("oracles-debt");
  const hasFortressPact = campaign.selectedRelics.includes("fortress-pact");
  const hasKnightsEcho = campaign.selectedRelics.includes("knights-echo");

  // Any relic action buttons should be locked when popups are open or it's not White's turn.
  const relicActionsLocked =
    showRelicChoice ||
    showDrawResult ||
    showLossResult ||
    game.isGameOver() ||
    campaign.status !== "active" ||
    thinking ||
    hintLoading;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="app-shell">
      {showHelp && <HowToPlay onClose={dismissHelp} />}

      <header className="topbar">
        <div className="brand">
          <Crown size={27} />
          <span>CHECKMATE <strong>ROGUE</strong></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="help-btn"
            onClick={() => setShowHelp(true)}
            aria-label="How to Play"
            title="How to Play"
          >
            <HelpCircle size={18} />
            <span className="help-btn-label">How to Play</span>
          </button>
          <span className="version">PROTOTYPE · ACT I</span>
        </div>
      </header>

      <main className="game-layout">

        <aside className="panel campaign-panel">
          <div className="eyebrow">THE CAMPAIGN</div>
          <h2>Road to the Crown</h2>
          <p className="muted">
            A chess roguelike where every move leaves a memory.
          </p>

          <div className="divider" />

          <div className="stat-label">CURRENT ENCOUNTER</div>
          <div className="encounter">
            <Skull size={25} />
            <div>
              <strong>
                {campaign.status === "victory" ? "Campaign Champion" : rivalName}
              </strong>
              <small>Encounter {String(rivalIndex + 1).padStart(2, "0")}</small>
            </div>
          </div>

          <div className="divider" />

          <div className="stat-label">YOUR HEARTS</div>
          <div className="hearts">
            {Array.from({ length: 3 }, (_, i) => (
              <span
                key={i}
                style={{ color: i < campaign.hearts ? "#e65c67" : "#55515b" }}
              >
                ♥
              </span>
            ))}
          </div>

          <div className="divider" />

          <div className="stat-label">COLLECTED RELICS</div>
          {campaign.selectedRelics.length === 0 ? (
            <div className="empty-relic">
              <Shield size={20} />
              <span>None collected yet</span>
            </div>
          ) : (
            campaign.selectedRelics.map((id) => {
              const relic = RELICS.find((r) => r.id === id);
              return relic ? (
                <div className="empty-relic" key={id}>
                  <Shield size={20} />
                  <span>{relic.name}</span>
                </div>
              ) : null;
            })
          )}

          <div className="divider" />

          <div className="stat-label">RUN STATISTICS</div>
          <p className="muted">
            Victories: {campaign.wins}
            <br />
            Defeats: {campaign.losses}
          </p>

          {aggregatedStats.encountersCompleted > 0 && (
            <>
              <div className="stat-label" style={{ marginTop: 14 }}>RIVAL INTELLIGENCE</div>
              <p className="muted" style={{ fontSize: "11px", lineHeight: "1.5" }}>
                Moves analyzed: {aggregatedStats.totalPlayerMoves} · Checks: {aggregatedStats.totalChecks}
                <br />
                Castled: {aggregatedStats.timesCastled}/{aggregatedStats.encountersCompleted} encounters
              </p>
            </>
          )}
        </aside>

        <section className="board-section">
          {engineError && (
            <div className="engine-error-banner" role="alert">
              <div className="engine-error-content">
                <AlertTriangle size={18} className="engine-error-icon" />
                <span>
                  <strong>Engine Notice:</strong> {engineError}
                </span>
              </div>
              <button
                type="button"
                id="retry-engine-btn"
                className="engine-retry-btn"
                onClick={handleRetryEngine}
                disabled={retryingEngine}
                title="Reinitialize Stockfish engine without resetting your game"
              >
                <RotateCcw size={14} className={retryingEngine ? "spin" : ""} />
                {retryingEngine ? "Connecting…" : "Retry Engine"}
              </button>
            </div>
          )}

          <div className="opponent">
            <div className="avatar"><Skull size={26} /></div>
            <div>
              <strong>{rivalName}</strong>
              <small>Stockfish 19 · {difficultyLabel[encounterDifficulty]}</small>
            </div>
            <span className="opponent-tag">RIVAL {rivalRomanTag}</span>
          </div>

          <div className="board-frame">
            {!engineReady && <div className="engine-loading-bar" role="progressbar" aria-label="Loading Stockfish engine" />}
            <div className="chessboard" role="group" aria-label="Chessboard">
              {Array.from({ length: 64 }, (_, index) => {
                const row = Math.floor(index / 8);
                const col = index % 8;
                const square = `${FILES[col]}${8 - row}` as Square;
                const piece = game.get(square);
                const isLight = (row + col) % 2 === 0;
                const isSelected = selected === square;
                const isTarget = legalTargets.includes(square);
                const isHintFrom = hintHighlight?.from === square;
                const isHintTo = hintHighlight?.to === square;
                const isCheckSquare = game.isCheck() && piece?.type === "k" && piece.color === game.turn();
                const isLastMoveFrom = lastMove?.from === square;
                const isLastMoveTo = lastMove?.to === square;

                const pieceName = piece
                  ? `${piece.color === "w" ? "White" : "Black"} ${
                      piece.type === "k"
                        ? "king"
                        : piece.type === "q"
                        ? "queen"
                        : piece.type === "r"
                        ? "rook"
                        : piece.type === "b"
                        ? "bishop"
                        : piece.type === "n"
                        ? "knight"
                        : "pawn"
                    }`
                  : "";

                return (
                  <button
                    type="button"
                    key={square}
                    aria-label={`${square}${pieceName ? ` ${pieceName}` : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => handleSquareClick(square)}
                    className={[
                      "square",
                      isLight ? "light" : "dark",
                      isSelected ? "selected" : "",
                      isTarget ? "legal" : "",
                      piece ? "has-piece" : "",
                      isHintFrom ? "hint-from" : "",
                      isHintTo ? "hint-to" : "",
                      isCheckSquare ? "in-check" : "",
                      isLastMoveFrom ? "last-move-from" : "",
                      isLastMoveTo ? "last-move-to" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {col === 0 && (
                      <span className="rank-label">{8 - row}</span>
                    )}
                    {row === 7 && (
                      <span className="file-label">{FILES[col]}</span>
                    )}
                    {isTarget && !piece && <span className="move-dot" />}
                    {piece && (
                      <ChessPiece
                        color={piece.color}
                        type={piece.type}
                      />
                    )}
                    {isHintFrom && <span className="hint-arrow hint-arrow-from">↑</span>}
                    {isHintTo && <span className="hint-label-badge">{hintHighlight!.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="player">
            <div className="avatar player-avatar"><Crown size={25} /></div>
            <div>
              <strong>You — The Challenger</strong>
              <small>White pieces</small>
            </div>
          </div>

          <div className="status" aria-live="polite" aria-atomic="true">
            <Swords size={19} aria-hidden="true" />
            <span>
              {engineError
                ? `Engine error: ${engineError}`
                : hintLoading
                  ? "Oracle is analysing..."
                  : thinking
                    ? "Stockfish is calculating..."
                    : getStatus(game)}
            </span>
          </div>

          {/* ── Relic action panel ─────────────────────────────────────── */}
          {(hasOraclesDebt || hasFortressPact || hasKnightsEcho) && (
            <div className="relic-action-panel">
              <div className="eyebrow" style={{ marginBottom: 10 }}>RELIC ACTIONS</div>

              {hasOraclesDebt && (
                <button
                  type="button"
                  id="btn-oracles-debt"
                  className={[
                    "relic-action-btn",
                    relicState.oraclesDebtUsed ? "relic-action-used" : "",
                  ].join(" ")}
                  onClick={useOraclesDebt}
                  disabled={relicActionsLocked || relicState.oraclesDebtUsed || game.turn() !== "w"}
                  title="Ask Stockfish for the best move in the current position"
                >
                  <Eye size={15} />
                  {relicState.oraclesDebtUsed ? "Hint Used" : hintLoading ? "Analysing…" : "Use Hint"}
                </button>
              )}

              {hasFortressPact && (
                <button
                  type="button"
                  id="btn-fortress-pact"
                  className={[
                    "relic-action-btn",
                    relicState.fortressPactUsed ? "relic-action-used" : "",
                  ].join(" ")}
                  onClick={useFortressPact}
                  disabled={relicActionsLocked || relicState.fortressPactUsed || game.turn() !== "w"}
                  title="Get a defensive move suggestion based on the current position"
                >
                  <ShieldCheck size={15} />
                  {relicState.fortressPactUsed ? "Shield Used" : "Defensive Hint"}
                </button>
              )}

              {hasKnightsEcho && (
                <button
                  type="button"
                  id="btn-knights-echo"
                  className={[
                    "relic-action-btn",
                    relicState.knightsEchoUsed ? "relic-action-used" : "",
                  ].join(" ")}
                  onClick={useKnightsEcho}
                  disabled={relicActionsLocked || relicState.knightsEchoUsed}
                  title="Undo your last move (forfeits your next relic reward)"
                >
                  <Undo2 size={15} />
                  {relicState.knightsEchoUsed ? "Echo Used" : "Undo Move"}
                </button>
              )}

              {relicMessage && (
                <p className="relic-action-message">{relicMessage}</p>
              )}
            </div>
          )}

          <button className="restart" onClick={restartEncounter}>
            <RotateCcw size={17} />
            Restart Encounter
          </button>
        </section>

        <aside className="panel history-panel">
          <div className="eyebrow">THE CHRONICLE</div>
          <h2>Battle Log</h2>
          <p className="muted">Every move tells a story.</p>

          <div className="divider" />

          <div className="moves" ref={movesContainerRef}>
            {history.length === 0 ? (
              <p className="muted">Your first move awaits...</p>
            ) : (
              Array.from(
                { length: Math.ceil(history.length / 2) },
                (_, i) => (
                  <div className="move-row" key={i}>
                    <span>{i + 1}.</span>
                    <strong>{history[i * 2]}</strong>
                    <strong>{history[i * 2 + 1] ?? "—"}</strong>
                  </div>
                )
              )
            )}
          </div>

          <div className="rival-quote">
            <div className="rival-quote-header">
              <div className="eyebrow">RIVAL'S OBSERVATION</div>
              {!IS_HOSTED && (
                <div className="dialogue-mode-switch" role="radiogroup" aria-label="Rival Dialogue Mode">
                  <button
                    type="button"
                    className={`dialogue-mode-btn ${dialogueMode === "scripted" ? "active" : ""}`}
                    onClick={() => setDialogueMode("scripted")}
                    title="Deterministic offline templates"
                  >
                    Scripted
                  </button>
                  <button
                    type="button"
                    className={`dialogue-mode-btn ${dialogueMode === "gemma" ? "active" : ""}`}
                    onClick={() => setDialogueMode("gemma")}
                    title="Local Gemma model inference via Ollama (requires local Ollama installation)"
                  >
                    Local Gemma
                  </button>
                </div>
              )}
              {IS_HOSTED && (
                <span
                  className="dialogue-status-pill scripted"
                  title="Local Gemma requires Ollama installed locally — unavailable in hosted mode."
                >
                  Scripted dialogue
                </span>
              )}
            </div>

            <div className="dialogue-status-row">
              {dialogueMode === "scripted" ? (
                <span className="dialogue-status-pill scripted">
                  Scripted dialogue
                </span>
              ) : gemmaStatus === "loading" ? (
                <span className="dialogue-status-pill loading">
                  Gemma responding…
                </span>
              ) : gemmaStatus === "connected" && rivalInsight.source === "model" ? (
                <span className="dialogue-status-pill connected">
                  Gemma connected · {gemmaProvider.getConfig().modelName}
                </span>
              ) : gemmaStatus === "idle" ? (
                <span className="dialogue-status-pill idle">
                  Gemma ready · Observing opening
                </span>
              ) : (
                <span
                  className="dialogue-status-pill fallback"
                  title={gemmaProvider.getLastError() ?? "Ollama service unavailable"}
                >
                  Gemma unavailable — using scripted fallback
                </span>
              )}
            </div>

            <p>"{rivalInsight.observation}"</p>

            {rivalInsight.taunt && (
              <p className="rival-taunt">"{rivalInsight.taunt}"</p>
            )}

            {rivalInsight.tip && (
              <div className="rival-tip">
                <strong>Tactical note: </strong>{rivalInsight.tip}
              </div>
            )}

            {activeProfile.insights.length > 0 && (
              <div className="rival-habit-tag" title={activeProfile.insights[0].description}>
                Habit noted: {activeProfile.insights[0].title} ({activeProfile.insights[0].confidence} confidence)
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* ── Victory: Relic reward popup ────────────────────────────────── */}
      {showRelicChoice && campaign.status === "active" && (
        <div className="relic-overlay" role="dialog" aria-modal="true" aria-labelledby="relic-modal-title">
          <section className="relic-modal">
            <p className="eyebrow">VICTORY REWARD</p>
            <h2 id="relic-modal-title">Choose Your Relic</h2>

            {campaign.skipNextRelic ? (
              // Knight's Echo penalty: skip relic selection this win.
              <>
                <p className="relic-penalty-notice">
                  ⚠ Knight's Echo penalty: your relic reward is forfeit for this victory.
                </p>
                <p className="muted">You defeated {rivalName}. No relic this time.</p>
                <button
                  type="button"
                  className="campaign-restart"
                  onClick={() => {
                    setCampaign((c) => consumeSkipNextRelic(c));
                    continueCampaign();
                  }}
                >
                  Continue Campaign →
                </button>
              </>
            ) : (
              // Normal relic selection.
              <>
                <p>You defeated {rivalName}. Choose 1 relic reward for the duels ahead:</p>

                <div className="relic-options">
                  {RELICS.map((relic) => {
                    const isSelected = pendingRelic === relic.id;
                    const isOwned = campaign.selectedRelics.includes(relic.id);
                    return (
                      <button
                        type="button"
                        className={`relic-option ${isSelected ? "selected" : ""}`}
                        key={relic.id}
                        onClick={() => selectRelic(relic.id)}
                        disabled={isOwned}
                      >
                        <span className="relic-symbol">{isSelected ? "✓" : "✦"}</span>
                        <strong>{relic.name} {isOwned ? "· Owned" : ""}</strong>
                        <span>{relic.description}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="campaign-restart"
                  onClick={continueCampaign}
                  disabled={!pendingRelic && campaign.selectedRelics.length < RELICS.length}
                >
                  {!pendingRelic && campaign.selectedRelics.length < RELICS.length
                    ? "Select a Relic to Claim"
                    : "Continue Campaign →"}
                </button>
              </>
            )}
          </section>
        </div>
      )}

      {/* ── Draw result popup ─────────────────────────────────────────── */}
      {showDrawResult && (
        <div className="relic-overlay" role="dialog" aria-modal="true" aria-labelledby="draw-modal-title">
          <section className="relic-modal result-modal">
            <p className="eyebrow">ENCOUNTER RESULT</p>
            <h2 id="draw-modal-title">A Draw!</h2>
            <p className="muted">
              Neither side prevailed. No hearts lost, no relic gained.
              <br />
              Face {rivalName} again?
            </p>
            <button
              type="button"
              className="campaign-restart"
              onClick={retryAfterDraw}
            >
              Retry Encounter
            </button>
          </section>
        </div>
      )}

      {/* ── Loss result popup ─────────────────────────────────────────── */}
      {showLossResult && campaign.status === "active" && (
        <div className="relic-overlay" role="dialog" aria-modal="true" aria-labelledby="loss-modal-title">
          <section className="relic-modal result-modal">
            <p className="eyebrow">ENCOUNTER RESULT</p>
            <h2 id="loss-modal-title">Defeated!</h2>
            <p className="muted">
              {rivalName} has bested you. You lost a heart.
              <br />
              Hearts remaining: {campaign.hearts}
            </p>
            <button
              type="button"
              className="campaign-restart"
              onClick={continueAfterLoss}
            >
              Continue Campaign
            </button>
          </section>
        </div>
      )}

      {/* ── Campaign end screen (victory or defeat) ───────────────────── */}
      {campaign.status !== "active" && (
        <div className="relic-overlay" role="dialog" aria-modal="true" aria-labelledby="end-modal-title">
          <section className="relic-modal result-modal">
            <p className="eyebrow">RUN COMPLETE</p>
            <h2 id="end-modal-title">
              {campaign.status === "victory"
                ? "The Board Is Yours"
                : "Your Run Has Ended"}
            </h2>
            <p className="muted">
              {campaign.status === "victory"
                ? "You have conquered all three rivals and claimed the crown!"
                : "All hearts lost. The campaign ends here."}
            </p>
            <p>
              Victories: {campaign.wins} · Defeats: {campaign.losses}
            </p>

            {aggregatedStats.encountersCompleted > 0 && (
              <div style={{ margin: "14px 0", fontSize: "12px", color: "#aaa4b2" }}>
                Moves analyzed: {aggregatedStats.totalPlayerMoves} · Checks delivered: {aggregatedStats.totalChecks} · Castles: {aggregatedStats.timesCastled}
              </div>
            )}

            <button
              type="button"
              className="campaign-restart"
              onClick={startNewRun}
            >
              Start a New Run
            </button>
          </section>
        </div>
      )}

      <footer>
        Built with open-source tools · Chess rules by chess.js
      </footer>
    </div>
  );
}
