export type Mode = "pvp" | "cpu";
export type RoomSummary = {
  id: string;
  name: string;
  locked: boolean;
  mode: Mode;
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
export type RoomView = {
  id: string;
  name: string;
  hostId: string;
  mode: Mode;
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
};
