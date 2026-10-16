
import type { EngineDifficulty } from "../engine/stockfish";

export type RelicId =
  | "oracles-debt"
  | "fortress-pact"
  | "knights-echo";

export type Relic = {
  id: RelicId;
  name: string;
  description: string;
};

export interface EncounterBehaviorRecord {
  encounterIndex: number;
  rivalName: string;
  outcome: "win" | "loss" | "draw";
  playerMoveCount: number;
  castled: boolean;
  castlingSide: "kingside" | "queenside" | null;
  openingQueenMoves: number;
  repeatedPieceMoveCount: number;
  pawnMoveCount: number;
  captureCount: number;
  checkCount: number;
  topInsightIds: string[];
}

export interface CampaignBehaviorStats {
  encountersCompleted: number;
  totalPlayerMoves: number;
  totalCaptures: number;
  totalChecks: number;
  timesCastled: number;
  earlyQueenEncounters: number;
  records: EncounterBehaviorRecord[];
}

export type CampaignState = {
  runId: string;
  rivalIndex: number;
  hearts: number;
  wins: number;
  losses: number;
  selectedRelics: RelicId[];
  status: "active" | "victory" | "defeat";
  /**
   * Knight's Echo penalty: when true, the next relic reward popup will skip
   * the relic selection step and show a penalty notice instead.
   */
  skipNextRelic: boolean;
  /**
   * Aggregated records of completed encounters in the current campaign run.
   */
  encounterBehaviors?: EncounterBehaviorRecord[];
};

export const MAX_HEARTS = 3;
export const TOTAL_RIVALS = 3;

/** Canonical rival names, indexed 0–2. */
export const RIVAL_NAMES = [
  "The Nameless Rival",
  "The Iron Warden",
  "The Crown Keeper",
] as const;

/**
 * Returns the rival name for a given rivalIndex (0-based, clamped to valid range).
 */
export function getRivalName(rivalIndex: number): string {
  const i = Math.min(Math.max(0, rivalIndex), RIVAL_NAMES.length - 1);
  return RIVAL_NAMES[i];
}

export function createCampaign(): CampaignState {
  return {
    runId: `${Date.now()}`,
    rivalIndex: 0,
    hearts: MAX_HEARTS,
    wins: 0,
    losses: 0,
    selectedRelics: [],
    status: "active",
    skipNextRelic: false,
    encounterBehaviors: [],
  };
}

/**
 * Appends a completed encounter's behavior record to the campaign state.
 */
export function recordEncounterBehavior(
  campaign: CampaignState,
  record: EncounterBehaviorRecord
): CampaignState {
  const current = campaign.encounterBehaviors ?? [];
  return {
    ...campaign,
    encounterBehaviors: [...current, record],
  };
}

/**
 * Computes aggregated behavioral totals across all completed encounters in the run.
 */
export function getAggregatedCampaignStats(
  campaign: CampaignState
): CampaignBehaviorStats {
  const records = campaign.encounterBehaviors ?? [];
  return {
    encountersCompleted: records.length,
    totalPlayerMoves: records.reduce((acc, r) => acc + r.playerMoveCount, 0),
    totalCaptures: records.reduce((acc, r) => acc + r.captureCount, 0),
    totalChecks: records.reduce((acc, r) => acc + r.checkCount, 0),
    timesCastled: records.filter((r) => r.castled).length,
    earlyQueenEncounters: records.filter((r) => r.openingQueenMoves > 0).length,
    records,
  };
}

/**
 * Returns the Stockfish difficulty for the current encounter.
 *
 * Base level: apprentice for rival 0, knight for rival 1, boss for rival 2.
 * Oracle's Debt adds one tier of difficulty to the *next* rival (i.e. the
 * rival at rivalIndex after a win has been recorded and rivalIndex advanced).
 * Since rivalIndex is already advanced by recordWin before continueCampaign
 * is called, we compare against the current rivalIndex.
 */
export function getEncounterDifficulty(
  campaign: CampaignState
): EngineDifficulty {
  const hasOraclesDebt = campaign.selectedRelics.includes("oracles-debt");

  // Base difficulty by rival slot.
  const base: EngineDifficulty[] = ["apprentice", "knight", "boss"];
  const idx = Math.min(campaign.rivalIndex, 2);
  const baseDiff = base[idx];

  if (!hasOraclesDebt) return baseDiff;

  // Oracle's Debt: bump one tier.
  if (baseDiff === "apprentice") return "knight";
  if (baseDiff === "knight") return "boss";
  return "boss"; // already at max
}

/**
 * Marks that the Knight's Echo penalty should apply to the next relic reward.
 * Called when the player uses the undo ability.
 */
export function applyKnightsEchoPenalty(
  campaign: CampaignState
): CampaignState {
  return { ...campaign, skipNextRelic: true };
}

/**
 * Clears the skipNextRelic flag after it has been enforced.
 * Called when the player acknowledges the penalty in the relic modal.
 */
export function consumeSkipNextRelic(
  campaign: CampaignState
): CampaignState {
  return { ...campaign, skipNextRelic: false };
}

export function recordWin(
  campaign: CampaignState
): CampaignState {
  if (campaign.status !== "active") return campaign;

  const nextRival = campaign.rivalIndex + 1;
  const completedAllRivals = nextRival >= TOTAL_RIVALS;

  return {
    ...campaign,
    rivalIndex: nextRival,
    wins: campaign.wins + 1,
    status: completedAllRivals ? "victory" : "active",
  };
}

export function recordLoss(
  campaign: CampaignState
): CampaignState {
  if (campaign.status !== "active") return campaign;

  const remainingHearts = Math.max(0, campaign.hearts - 1);

  return {
    ...campaign,
    hearts: remainingHearts,
    losses: campaign.losses + 1,
    status: remainingHearts === 0 ? "defeat" : "active",
  };
}

export function chooseRelic(
  campaign: CampaignState,
  relicId: RelicId
): CampaignState {
  if (campaign.status !== "active") return campaign;

  if (campaign.selectedRelics.includes(relicId)) {
    return campaign;
  }

  return {
    ...campaign,
    selectedRelics: [...campaign.selectedRelics, relicId],
  };
}
