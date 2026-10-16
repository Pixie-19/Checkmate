/**
 * campaign.test.ts
 *
 * Unit tests for pure campaign state functions, focused on:
 *  - Knight's Echo penalty: applyKnightsEchoPenalty / consumeSkipNextRelic
 *  - Oracle's Debt difficulty scaling: getEncounterDifficulty
 *  - Penalty survives recordWin (encounter transition)
 *  - Penalty is idempotent (applying twice has no extra effect)
 *  - Consuming clears the flag without touching other state
 */

import { describe, it, expect } from "vitest";
import {
  createCampaign,
  applyKnightsEchoPenalty,
  consumeSkipNextRelic,
  getEncounterDifficulty,
  recordWin,
  recordLoss,
  chooseRelic,
  type CampaignState,
} from "./campaign";

// Helper: fresh campaign
function fresh(): CampaignState {
  return createCampaign();
}

// ---------------------------------------------------------------------------
// Knight's Echo penalty: applyKnightsEchoPenalty
// ---------------------------------------------------------------------------
describe("applyKnightsEchoPenalty", () => {
  it("sets skipNextRelic to true", () => {
    const c = fresh();
    expect(c.skipNextRelic).toBe(false);
    const penalised = applyKnightsEchoPenalty(c);
    expect(penalised.skipNextRelic).toBe(true);
  });

  it("does not mutate the original campaign object", () => {
    const c = fresh();
    applyKnightsEchoPenalty(c);
    expect(c.skipNextRelic).toBe(false); // original unchanged
  });

  it("does not alter other campaign fields", () => {
    const c = fresh();
    const penalised = applyKnightsEchoPenalty(c);
    expect(penalised.hearts).toBe(c.hearts);
    expect(penalised.wins).toBe(c.wins);
    expect(penalised.losses).toBe(c.losses);
    expect(penalised.rivalIndex).toBe(c.rivalIndex);
    expect(penalised.status).toBe(c.status);
    expect(penalised.selectedRelics).toEqual(c.selectedRelics);
  });

  it("is idempotent — applying twice has no extra effect", () => {
    const c = fresh();
    const once = applyKnightsEchoPenalty(c);
    const twice = applyKnightsEchoPenalty(once);
    expect(twice.skipNextRelic).toBe(true);
    // No other fields change between once and twice
    expect(twice.hearts).toBe(once.hearts);
    expect(twice.wins).toBe(once.wins);
  });
});

// ---------------------------------------------------------------------------
// Knight's Echo penalty: consumeSkipNextRelic
// ---------------------------------------------------------------------------
describe("consumeSkipNextRelic", () => {
  it("clears skipNextRelic back to false", () => {
    const c = applyKnightsEchoPenalty(fresh());
    expect(c.skipNextRelic).toBe(true);
    const cleared = consumeSkipNextRelic(c);
    expect(cleared.skipNextRelic).toBe(false);
  });

  it("is a no-op when flag is already false", () => {
    const c = fresh();
    expect(c.skipNextRelic).toBe(false);
    const cleared = consumeSkipNextRelic(c);
    expect(cleared.skipNextRelic).toBe(false);
  });

  it("does not mutate the original object", () => {
    const c = applyKnightsEchoPenalty(fresh());
    consumeSkipNextRelic(c);
    expect(c.skipNextRelic).toBe(true); // still set on the original
  });

  it("does not alter other campaign fields", () => {
    const c = applyKnightsEchoPenalty(fresh());
    const cleared = consumeSkipNextRelic(c);
    expect(cleared.hearts).toBe(c.hearts);
    expect(cleared.wins).toBe(c.wins);
    expect(cleared.rivalIndex).toBe(c.rivalIndex);
    expect(cleared.status).toBe(c.status);
  });
});

// ---------------------------------------------------------------------------
// Penalty survives encounter transition (recordWin)
// ---------------------------------------------------------------------------
describe("Knight's Echo penalty — encounter transition", () => {
  it("skipNextRelic flag is preserved through recordWin", () => {
    // Player used Knight's Echo this encounter, then wins.
    // recordWin advances rivalIndex but must not touch skipNextRelic.
    const c = applyKnightsEchoPenalty(fresh());
    const afterWin = recordWin(c);
    expect(afterWin.skipNextRelic).toBe(true);
    expect(afterWin.rivalIndex).toBe(1);
  });

  it("consumeSkipNextRelic after recordWin restores normal state", () => {
    const c = applyKnightsEchoPenalty(fresh());
    const afterWin = recordWin(c);
    const consumed = consumeSkipNextRelic(afterWin);
    expect(consumed.skipNextRelic).toBe(false);
    expect(consumed.rivalIndex).toBe(1); // still advanced
    expect(consumed.wins).toBe(1);
  });

  it("penalty does not carry over to a third encounter after being consumed", () => {
    let c = fresh();
    // Win 1: no penalty
    c = recordWin(c);
    expect(c.skipNextRelic).toBe(false);

    // Win 2: player used Knight's Echo, wins, penalty applied, then consumed
    c = applyKnightsEchoPenalty(c);
    c = recordWin(c);
    // Penalty is still present (it's consumed in the modal, not on recordWin)
    expect(c.skipNextRelic).toBe(true);
    c = consumeSkipNextRelic(c); // player acknowledged penalty in modal
    expect(c.skipNextRelic).toBe(false);

    // Win 3: no pending penalty
    c = recordWin(c); // would trigger victory
    expect(c.skipNextRelic).toBe(false);
    expect(c.status).toBe("victory");
  });
});

// ---------------------------------------------------------------------------
// Oracle's Debt — getEncounterDifficulty
// ---------------------------------------------------------------------------
describe("getEncounterDifficulty", () => {
  it("returns apprentice for rival 0 without Oracle's Debt", () => {
    const c = fresh(); // rivalIndex = 0
    expect(getEncounterDifficulty(c)).toBe("apprentice");
  });

  it("returns knight for rival 1 without Oracle's Debt", () => {
    const c = recordWin(fresh()); // rivalIndex = 1
    expect(getEncounterDifficulty(c)).toBe("knight");
  });

  it("returns boss for rival 2 without Oracle's Debt", () => {
    let c = recordWin(fresh());
    c = recordWin(c); // rivalIndex = 2
    expect(getEncounterDifficulty(c)).toBe("boss");
  });

  it("bumps rival 0 to knight when Oracle's Debt is held", () => {
    const c = chooseRelic(fresh(), "oracles-debt");
    expect(getEncounterDifficulty(c)).toBe("knight");
  });

  it("bumps rival 1 to boss when Oracle's Debt is held", () => {
    let c = chooseRelic(fresh(), "oracles-debt");
    c = recordWin(c); // rivalIndex = 1
    expect(getEncounterDifficulty(c)).toBe("boss");
  });

  it("caps at boss even when Oracle's Debt is held at rival 2", () => {
    let c = chooseRelic(fresh(), "oracles-debt");
    c = recordWin(c); // rivalIndex 1
    c = recordWin(c); // rivalIndex 2
    expect(getEncounterDifficulty(c)).toBe("boss"); // already max, not beyond
  });

  it("clamps rivalIndex >= 3 to boss without panic", () => {
    // After all rivals beaten, rivalIndex = 3 but status = victory.
    // getEncounterDifficulty should still return a valid value.
    let c = fresh();
    c = recordWin(c); c = recordWin(c); c = recordWin(c); // status = victory
    expect(c.rivalIndex).toBe(3);
    // Should not throw; clamped to index 2 = boss
    const diff = getEncounterDifficulty(c);
    expect(["apprentice", "knight", "boss"]).toContain(diff);
  });
});

// ---------------------------------------------------------------------------
// Campaign Progression, Final Victory, Defeat & Freeze Guards
// ---------------------------------------------------------------------------
describe("Campaign State Machine — Progression & Terminal States", () => {
  it("transitions sequentially from Rival 0 to Rival 1 to Rival 2, then triggers victory", () => {
    let c = fresh();
    expect(c.rivalIndex).toBe(0);
    expect(c.status).toBe("active");
    expect(c.wins).toBe(0);

    // Defeat Rival 0 (Apprentice)
    c = recordWin(c);
    expect(c.rivalIndex).toBe(1);
    expect(c.wins).toBe(1);
    expect(c.status).toBe("active");

    // Defeat Rival 1 (Knight)
    c = recordWin(c);
    expect(c.rivalIndex).toBe(2);
    expect(c.wins).toBe(2);
    expect(c.status).toBe("active");

    // Defeat Rival 2 (Boss, Crown Keeper)
    c = recordWin(c);
    expect(c.rivalIndex).toBe(3);
    expect(c.wins).toBe(3);
    expect(c.status).toBe("victory");
  });

  it("freezes campaign progression once victory is reached", () => {
    let c = fresh();
    c = recordWin(c);
    c = recordWin(c);
    c = recordWin(c); // victory
    expect(c.status).toBe("victory");

    // Subsequent recordWin or recordLoss are strict no-ops
    const extraWin = recordWin(c);
    expect(extraWin).toBe(c);
    expect(extraWin.wins).toBe(3);

    const extraLoss = recordLoss(c);
    expect(extraLoss).toBe(c);
    expect(extraLoss.losses).toBe(0);
  });

  it("decrements hearts on loss and triggers defeat at zero hearts", () => {
    let c = fresh();
    expect(c.hearts).toBe(3);
    expect(c.status).toBe("active");

    c = recordLoss(c);
    expect(c.hearts).toBe(2);
    expect(c.losses).toBe(1);
    expect(c.status).toBe("active");

    c = recordLoss(c);
    expect(c.hearts).toBe(1);
    expect(c.losses).toBe(2);
    expect(c.status).toBe("active");

    c = recordLoss(c);
    expect(c.hearts).toBe(0);
    expect(c.losses).toBe(3);
    expect(c.status).toBe("defeat");
  });

  it("freezes campaign once defeat is reached and does not drop hearts below 0", () => {
    let c = fresh();
    c = recordLoss(c);
    c = recordLoss(c);
    c = recordLoss(c);
    expect(c.status).toBe("defeat");
    expect(c.hearts).toBe(0);

    // Subsequent recordLoss is a strict no-op
    const afterDefeat = recordLoss(c);
    expect(afterDefeat).toBe(c);
    expect(afterDefeat.hearts).toBe(0);

    // Cannot win after defeat
    const winAfterDefeat = recordWin(c);
    expect(winAfterDefeat).toBe(c);
  });

  it("chooseRelic is idempotent and prevents duplicate relics", () => {
    let c = fresh();
    c = chooseRelic(c, "oracles-debt");
    expect(c.selectedRelics).toEqual(["oracles-debt"]);

    // Attempting to add same relic again is a no-op
    const duplicate = chooseRelic(c, "oracles-debt");
    expect(duplicate.selectedRelics).toEqual(["oracles-debt"]);

    // Adding second relic works
    c = chooseRelic(c, "fortress-pact");
    expect(c.selectedRelics).toEqual(["oracles-debt", "fortress-pact"]);
  });

  it("chooseRelic does not allow adding relics when campaign is inactive", () => {
    let c = fresh();
    c = recordLoss(c);
    c = recordLoss(c);
    c = recordLoss(c); // defeat
    expect(c.status).toBe("defeat");

    const attemptedRelic = chooseRelic(c, "oracles-debt");
    expect(attemptedRelic.selectedRelics).toEqual([]);
  });
});

