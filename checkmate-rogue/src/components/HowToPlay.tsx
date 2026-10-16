/**
 * HowToPlay.tsx
 *
 * Dismissible "How to Play" modal for first-time players.
 * Matches the game's gothic aesthetic. Stores dismissal in sessionStorage
 * so experienced players are not interrupted on every page load.
 */

import { useEffect, useRef } from "react";
import { Crown, Skull, Shield, Swords, Eye, X } from "lucide-react";

interface HowToPlayProps {
  onClose: () => void;
}

export default function HowToPlay({ onClose }: HowToPlayProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Focus the close button on open (accessibility)
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Trap focus inside the modal
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = overlay!.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    overlay.addEventListener("keydown", handleKeyDown);
    return () => overlay.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="relic-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="htp-title"
    >
      <section className="relic-modal htp-modal">
        <div className="htp-header">
          <p className="eyebrow">THE CHALLENGER'S CODEX</p>
          <button
            ref={closeRef}
            type="button"
            className="htp-close"
            onClick={onClose}
            aria-label="Close How to Play"
          >
            <X size={18} />
          </button>
        </div>

        <h2 id="htp-title">How to Play</h2>
        <p className="muted" style={{ marginBottom: 20 }}>
          Checkmate Rogue is a single-player chess roguelike. You play as White
          against three rival adversaries of increasing strength.
        </p>

        <div className="htp-rules">
          <div className="htp-rule">
            <span className="htp-icon"><Skull size={18} /></span>
            <div>
              <strong>Three Rivals</strong>
              <p>Defeat The Nameless Rival, The Iron Warden, and The Crown Keeper in sequence to complete the run.</p>
            </div>
          </div>

          <div className="htp-rule">
            <span className="htp-icon" style={{ color: "#e65c67" }}>♥</span>
            <div>
              <strong>Three Hearts</strong>
              <p>You start with 3 hearts. Losing a chess game costs one heart. Reach zero and the run ends.</p>
            </div>
          </div>

          <div className="htp-rule">
            <span className="htp-icon"><Swords size={18} /></span>
            <div>
              <strong>Chess Encounters</strong>
              <p>Each encounter is a full game of chess. Win by checkmate, lose your king, or draw and retry.</p>
            </div>
          </div>

          <div className="htp-rule">
            <span className="htp-icon"><Shield size={18} /></span>
            <div>
              <strong>Relics</strong>
              <p>Win an encounter to choose a relic. Relics grant one special ability per game:</p>
              <ul className="htp-relic-list">
                <li><Eye size={12} style={{ display:"inline", verticalAlign:"middle" }} /> <strong>Oracle's Debt</strong> — Ask Stockfish for the best move once.</li>
                <li>🛡 <strong>Fortress Pact</strong> — Get a defensive move suggestion once.</li>
                <li>↩ <strong>Knight's Echo</strong> — Undo your last move once (forfeits your next relic reward).</li>
              </ul>
            </div>
          </div>

          <div className="htp-rule">
            <span className="htp-icon"><Eye size={18} /></span>
            <div>
              <strong>Rival Intelligence</strong>
              <p>
                Each rival observes your playing habits — early queen use, pawn pushes, castling patterns,
                and capture frequency. Their dialogue adapts to what they notice about your style.
              </p>
            </div>
          </div>

          <div className="htp-rule">
            <span className="htp-icon"><Crown size={18} /></span>
            <div>
              <strong>Victory</strong>
              <p>Defeat all three rivals in a single run to claim the crown. Good luck, Challenger.</p>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="campaign-restart"
          onClick={onClose}
          style={{ width: "100%", marginTop: 20 }}
        >
          Begin the Campaign
        </button>
      </section>
    </div>
  );
}
