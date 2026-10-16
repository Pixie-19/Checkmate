/**
 * encounterState.ts
 *
 * Per-encounter mutable state for relic usage. This resets every time a new
 * encounter begins (restartEncounter / continueCampaign / retryAfterDraw /
 * continueAfterLoss / startNewRun).
 *
 * Kept separate from CampaignState (which persists across encounters) and
 * from React state that drives the board (game, selected, thinking).
 */

export type EncounterRelicState = {
  /** Oracle's Debt: hint used this encounter? */
  oraclesDebtUsed: boolean;
  /** Fortress Pact: defensive hint used this encounter? */
  fortressPactUsed: boolean;
  /** Knight's Echo: undo used this encounter? */
  knightsEchoUsed: boolean;
};

export function createEncounterRelicState(): EncounterRelicState {
  return {
    oraclesDebtUsed: false,
    fortressPactUsed: false,
    knightsEchoUsed: false,
  };
}

/** The move highlighted on the board as a hint. */
export type HintHighlight = {
  from: string;
  to: string;
  label: string;
};
