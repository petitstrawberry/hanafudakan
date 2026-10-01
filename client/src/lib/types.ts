export type Mode = "pvp" | "cpu" | "hyper";
export type RoomSummary = {
  id: string;
  name: string;
  locked: boolean;
  mode: Mode;
  hyperEnabled: boolean;
  rounds: number;
  players: number;
  spectators: number;
  status: "waiting" | "playing" | "finished";
  hostName: string;
};
export type Session = { token: string; playerId: string; name: string };
export type Player = {
  id: string;
  name: string;
  score: number;
  handCount: number;
  captured: number[];
  connected: boolean;
  isCpu: boolean;
};
export type Yaku = { name: string; points: number };
export type HyperContract = {
  id: string;
  name: string;
  source: string;
  points: number;
  description: string;
};
export type HyperOption = {
  role: string;
  contract: HyperContract;
  points: number;
};
export type HyperDamage = {
  attacker: number;
  defender: number;
  kind: string;
  cards: number;
  roles: number;
  roleGains: Yaku[];
  chain: number;
  contract: number;
  exposure: number;
  blocked: number;
  power: number;
  damage: number;
  hpBefore: number;
  hpAfter: number;
};
export type DamagePreview = { uncertain?: boolean; cardId: number; targetId: number | null; damage: HyperDamage[] };
export type TrapKind = "levy" | "reveal" | "bind" | "snatch" | "swap" | "tax" | "misfortune" | "scorch";
export type TrapActivation = { owner: number; victim: number; cardId: number; kind: TrapKind; amount: number };
export type HyperState = {
  contracts: HyperContract[][];
  stake: number[];
  bloom: number[];
  chain: number[];
  sealed: number[][];
  options: HyperOption[];
  multiplier?: number[];
  projected?: number[];
  boosts?: number[];
  cashoutKoiReady?: boolean[];
  hp?: number[] | null;
  hpMax?: number;
  traps?: (number | null)[];
  trapReady?: boolean[];
  trapRemaining?: number[];
  damagePreviews?: DamagePreview[];
  trapChoices?: TrapKind[];
  trapKinds?: (TrapKind | null)[];
  intel?: { opponentHand: number[]; nextCard: number | null };
  growthSealed?: boolean[]; payoutTax?: number[]; multiplierPenalty?: number[];
};
export type RoomView = {
  boardRevision?: number;
  handTargets?: { cardId: number; targets: number[] }[];
  id: string;
  name: string;
  hostId: string;
  mode: Mode;
  hyperEnabled: boolean;
  rounds: number;
  round: number;
  status: "waiting" | "playing" | "finished";
  players: Player[];
  myIndex: number | null;
  hand: number[];
  field: number[];
  deckCount: number;
  turn: number;
  phase:
    | "waiting"
    | "play"
    | "draw_choice"
    | "decision"
    | "round_end"
    | "finished";
  drawnCard: number | null;
  yaku: Yaku[][];
  koikoi: number[];
  winner: number | null;
  matchWinner: number | null;
  roundPoints: number;
  messages: { id: string; name: string; text: string; system: boolean }[];
  log: string[];
  legalTargets?: number[];
  spectators: number;
  dealer: number;
  events: PublicGameEvent[];
  hyper?: HyperState;
};
export type PublicGameEvent = {
  id: number;
  player: number;
  source: "hand" | "draw" | "choice";
  cardId: number;
  targetIds: number[];
  captured: boolean;
  field: number[];
  capturedCards: number[][];
  deckCount: number;
  requiresChoice: boolean;
  hyper?: (Pick<HyperState, "chain" | "bloom" | "multiplier" | "hp"> & { counterDraw?: boolean; traps?: (number | null)[]; damage?: HyperDamage[]; trapActivations?: TrapActivation[]; growthSealed?: boolean[] }) | null;
};
