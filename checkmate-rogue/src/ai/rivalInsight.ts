/**
 * rivalInsight.ts
 *
 * Provider-independent interface for rival dialogue and tactical insights.
 * Produces structured observations, taunts, and tips based on deterministic
 * player behavior profiles.
 */

import type { EngineDifficulty } from "../engine/stockfish";
import type { PlayerBehaviorProfile } from "./playerBehavior";

export type EncounterPhase = "opening" | "midgame" | "endgame" | "result";

export interface RivalContext {
  rivalName: string;
  rivalIndex: number;
  difficulty: EngineDifficulty;
  phase: EncounterPhase;
  profile: PlayerBehaviorProfile;
  moveCount: number;
  lastPlayerMoveSan?: string;
  isCheck?: boolean;
  outcome?: "win" | "loss" | "draw";
}

export interface RivalInsight {
  observation: string;
  taunt: string;
  tip?: string;
  source: "template" | "model";
}

export const FALLBACK_RIVAL_INSIGHT: RivalInsight = {
  observation: "The rival studies your formation in silent contemplation.",
  taunt: "Every square on this board must be earned in blood.",
  tip: "Develop your pieces smoothly and safeguard your king.",
  source: "template",
};

/**
 * Validates arbitrary input against the RivalInsight contract,
 * returning a safe, fully-populated fallback for missing or malformed fields.
 */
export function validateRivalInsight(
  data: unknown,
  fallbackSource: "template" | "model" = "template"
): RivalInsight {
  if (!data || typeof data !== "object") {
    return { ...FALLBACK_RIVAL_INSIGHT, source: fallbackSource };
  }

  const record = data as Record<string, unknown>;

  const observation =
    typeof record.observation === "string" && record.observation.trim().length > 0
      ? record.observation.trim()
      : FALLBACK_RIVAL_INSIGHT.observation;

  const taunt =
    typeof record.taunt === "string" && record.taunt.trim().length > 0
      ? record.taunt.trim()
      : FALLBACK_RIVAL_INSIGHT.taunt;

  const tip =
    typeof record.tip === "string" && record.tip.trim().length > 0
      ? record.tip.trim()
      : undefined;

  const source: "template" | "model" =
    record.source === "model" ? "model" : fallbackSource;

  return { observation, taunt, tip, source };
}

/**
 * Deterministic template-based insight generator.
 * Works completely offline with zero model dependencies.
 */
export function generateTemplateInsight(context: RivalContext): RivalInsight {
  const { rivalIndex, phase, profile, outcome } = context;

  // 1. Encounter Results (Endgame / Post-match)
  if (phase === "result" || outcome) {
    if (outcome === "win") {
      switch (rivalIndex) {
        case 0:
          return {
            observation: "You broke through my defenses. Do not expect such fortune ahead.",
            taunt: "A single victory does not make you a master of this realm.",
            tip: "Claim your relic wisely; subsequent rivals will exploit your habits.",
            source: "template",
          };
        case 1:
          return {
            observation: "The iron gates have fallen. Your siegecraft proved resilient.",
            taunt: "The Crown Keeper awaits in the throne room. They show no mercy.",
            tip: "Maintain strict king safety against the final rival.",
            source: "template",
          };
        default:
          return {
            observation: "Impossible... The Crown bends to your steel.",
            taunt: "You have conquered the board, challenger. Reign with honor.",
            tip: "You have completed the campaign trial.",
            source: "template",
          };
      }
    }

    if (outcome === "loss") {
      switch (rivalIndex) {
        case 0:
          return {
            observation: "The board claims another soul. Return when your blade is sharper.",
            taunt: "Even the nameless shadow was too formidable for you.",
            tip: "Control the center squares and develop minor pieces early.",
            source: "template",
          };
        case 1:
          return {
            observation: "Disciplined ranks do not break for impetuous assaults.",
            taunt: "You dashed yourself against our battlements.",
            tip: "Patience is key: prepare attacks thoroughly before sacrificing material.",
            source: "template",
          };
        default:
          return {
            observation: "My throne remains absolute. You were never ready for the Crown.",
            taunt: "A glorious collapse beneath royal judgment.",
            tip: "Study your tactical habits to eliminate recurring weaknesses.",
            source: "template",
          };
      }
    }

    // Draw
    return {
      observation: "Neither blade nor bastion gave ground. A stalemate in the mist.",
      taunt: "A draw changes nothing. The trial resumes.",
      tip: "Look for subtle imbalances to break equal positions.",
      source: "template",
    };
  }

  // 2. Insufficient evidence (opening turns, < 3 player moves)
  if (!profile.hasSufficientEvidence || profile.insights.length === 0) {
    switch (rivalIndex) {
      case 0:
        return {
          observation: "Show me what you bring to these checkered stones, wanderer.",
          taunt: "I have seen a hundred challengers fall in these opening strides.",
          tip: "Open with central pawn moves to free your bishops and knights.",
          source: "template",
        };
      case 1:
        return {
          observation: "Lay out your battle lines. The Warden tests every formation.",
          taunt: "Every careless move will be carved into stone.",
          tip: "Prioritize piece harmony and king protection.",
          source: "template",
        };
      default:
        return {
          observation: "You stand before the Crown. Every opening reveals a mind.",
          taunt: "Hesitation is the first concession of defeat.",
          tip: "Seize space without overextending your perimeter.",
          source: "template",
        };
    }
  }

  // 3. Habit-driven observations based on deterministic behavior insights
  const primaryInsight = profile.insights[0];

  switch (primaryInsight.id) {
    case "early-queen-development":
      return {
        observation: "You dispatch your Queen early before your army has formed its ranks.",
        taunt:
          rivalIndex === 0
            ? "A queen exposed early becomes an easy target for lesser pieces."
            : "Royalty wandering alone invites disaster.",
        tip: "Develop knights and bishops before committing your queen to combat.",
        source: "template",
      };

    case "repeated-piece-moves":
      return {
        observation: "You move the same piece repeatedly while the rest of your forces slumber.",
        taunt:
          rivalIndex === 1
            ? "A lone warrior cannot breach a fortified line."
            : "One active piece cannot carry an entire war.",
        tip: "Distribute your moves to activate your entire army.",
        source: "template",
      };

    case "pawn-heavy-opening":
      return {
        observation: "A surge of pawns advances, but leaves your rear ranks vulnerable.",
        taunt: "Pawns cannot retreat once advanced into the dark.",
        tip: "Excessive pawn pushes create lasting square weaknesses.",
        source: "template",
      };

    case "frequent-checks":
      return {
        observation: "You pursue checks relentlessly, seeking immediate disruption.",
        taunt: "A check that fails to trap merely guides my king to safety.",
        tip: "Deliver checks only when they gain material or force a concession.",
        source: "template",
      };

    case "high-capture-rate":
      return {
        observation: "You trade pieces aggressively at every encounter.",
        taunt: "Trading empty pieces will leave you with nowhere left to hide.",
        tip: "Consider maintaining tension instead of immediately trading pieces.",
        source: "template",
      };

    case "early-queen-loss":
      return {
        observation: "Your Queen fell early under tactical crossfire.",
        taunt: "Without your queen, the board belongs to me.",
        tip: "Defend against counter-attacks when leading with high-value pieces.",
        source: "template",
      };

    case "kingside-castle":
    case "queenside-castle":
      return {
        observation: "Your king secures shelter behind well-marshaled ramparts.",
        taunt: "Hide behind your walls; the siege will come all the same.",
        tip: "Castling links your rooks for coordinated central files.",
        source: "template",
      };

    case "uncastled-king":
      return {
        observation: "Your king lingers exposed in the center files.",
        taunt: "A king who neglects shelter will find the battlefield merciless.",
        tip: "Castle your king away from the open center files.",
        source: "template",
      };

    default:
      return {
        observation: `I observe your rhythm on the board: ${primaryInsight.title.toLowerCase()}.`,
        taunt: "I adapt to every cadence you demonstrate.",
        tip: "Vary your play to keep the rival guessing.",
        source: "template",
      };
  }
}
