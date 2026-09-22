import { cards } from "./cards";

export interface YakuStatus {
  id: string;
  name: string;
  points: number;
  required: number;
  have: number;
  state: "possible" | "complete" | "impossible" | "upgraded";
  missing: number[];
  reason: string;
}

interface YakuDefinition {
  id: string;
  name: string;
  serverName?: string;
  points: number;
  required: number;
  pool: number[];
  bright?: boolean;
}

const nonRainBrights = [0, 8, 28, 44];
const definitions: YakuDefinition[] = [
  {
    id: "goko",
    name: "五光",
    points: 10,
    required: 5,
    pool: [0, 8, 28, 40, 44],
    bright: true,
  },
  {
    id: "shiko",
    name: "四光",
    points: 8,
    required: 4,
    pool: nonRainBrights,
    bright: true,
  },
  {
    id: "ame-shiko",
    name: "雨四光",
    points: 7,
    required: 4,
    pool: [40, ...nonRainBrights],
    bright: true,
  },
  {
    id: "sanko",
    name: "三光",
    points: 5,
    required: 3,
    pool: nonRainBrights,
    bright: true,
  },
  {
    id: "inoshikacho",
    name: "猪鹿蝶",
    points: 5,
    required: 3,
    pool: [20, 24, 36],
  },
  { id: "akatan", name: "赤短", points: 5, required: 3, pool: [1, 5, 9] },
  { id: "aotan", name: "青短", points: 5, required: 3, pool: [21, 33, 37] },
  { id: "hanami", name: "花見で一杯", points: 5, required: 2, pool: [8, 32] },
  { id: "tsukimi", name: "月見で一杯", points: 5, required: 2, pool: [28, 32] },
  {
    id: "tane",
    name: "たね",
    serverName: "タネ",
    points: 1,
    required: 5,
    pool: cards.filter((card) => card.kind === "animal").map((card) => card.id),
  },
  {
    id: "tan",
    name: "たん",
    serverName: "短冊",
    points: 1,
    required: 5,
    pool: cards.filter((card) => card.kind === "ribbon").map((card) => card.id),
  },
  {
    id: "kasu",
    name: "かす",
    serverName: "カス",
    points: 1,
    required: 10,
    pool: cards
      .filter((card) => card.kind === "chaff" || card.id === 32)
      .map((card) => card.id),
  },
];

/** Reachability uses public captured cards only, never a hand or the deck. */
export function getYakuStatuses(
  captured: number[],
  opponentCaptured: number[],
  earned: { name: string; points: number }[],
): YakuStatus[] {
  const own = new Set(captured);
  const opponent = new Set(opponentCaptured);
  const nonRainCount = nonRainBrights.filter((id) => own.has(id)).length;
  const earnedFor = (definition: YakuDefinition) =>
    earned.find(
      (yaku) =>
        yaku.name === definition.name || yaku.name === definition.serverName,
    );
  const highestBright = definitions.find(
    (definition) => definition.bright && earnedFor(definition),
  );

  return definitions.map((definition): YakuStatus => {
    const { id, name, points, required, pool } = definition;
    const earnedYaku = earnedFor(definition);
    // Rain is mandatory: four dry brights must not look like completed rain-four.
    const have =
      id === "ame-shiko"
        ? Math.min(3, nonRainCount) + Number(own.has(40))
        : pool.filter((card) => own.has(card)).length;
    // After three dry brights, only rain advances rain-four. A fourth dry
    // bright would instead make dry-four and eliminate the rain-four route.
    const neededPool = id === "ame-shiko" && nonRainCount >= 3 ? [40] : pool;
    const missing = neededPool.filter((card) => !own.has(card));
    const status: YakuStatus = {
      id,
      name,
      points: earnedYaku?.points ?? points,
      required,
      have,
      state: "possible",
      missing,
      reason: "",
    };

    // The server is authoritative for completed roles and their growing points.
    if (earnedYaku) {
      return { ...status, state: "complete", missing: [], reason: "成立済み" };
    }
    if (definition.bright && highestBright && highestBright.points > points) {
      return {
        ...status,
        state: "upgraded",
        missing: [],
        reason: `上位役「${highestBright.name}」が成立済み`,
      };
    }
    if ((id === "sanko" || id === "shiko") && own.has(40)) {
      return {
        ...status,
        state: "impossible",
        reason: "雨札を獲得済みのため成立しません",
      };
    }
    if (id === "ame-shiko" && nonRainCount === 4) {
      return {
        ...status,
        state: "impossible",
        reason: "雨以外の光札を4枚獲得済み。雨札を取ると五光になります",
      };
    }

    const available = pool.filter((card) => !opponent.has(card));
    if (id === "ame-shiko" && opponent.has(40)) {
      return {
        ...status,
        state: "impossible",
        reason: "必須の雨札を相手が獲得済みです",
      };
    }
    if (available.length < required) {
      const blocked = pool.filter((card) => opponent.has(card));
      const reason =
        pool.length === required
          ? `必要な札「${cards[blocked[0]].name}」を相手が獲得済みです`
          : `相手の獲得札を除くと${available.length}枚。成立には${required}枚必要です`;
      return { ...status, state: "impossible", reason };
    }

    // Flexible roles show only candidates still reachable; blocked roles retain
    // their missing cards above so the UI can explain why they cannot be made.
    status.missing = missing.filter((card) => !opponent.has(card));
    const remaining = Math.max(0, required - have);
    status.reason =
      remaining === 0
        ? "必要な札が揃っています"
        : id === "ame-shiko" && !own.has(40)
          ? `あと${remaining}枚（雨札が必須）`
          : `あと${remaining}枚`;
    return status;
  });
}
