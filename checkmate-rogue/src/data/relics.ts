
import type { Relic } from "../game/campaign";

export const RELICS: Relic[] = [
  {
    id: "oracles-debt",
    name: "Oracle's Debt",
    description:
      "Gain access to one engine hint per match. Your next rival is more difficult.",
  },
  {
    id: "fortress-pact",
    name: "Fortress Pact",
    description:
      "Start each match with one defensive hint. Aggressive rivals become more likely.",
  },
  {
    id: "knights-echo",
    name: "Knight's Echo",
    description:
      "Once per match, undo your last move. Forfeit your next relic reward.",
  },
];
