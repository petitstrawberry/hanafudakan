import { cards } from "./cards";
import type { Yaku } from "./types";

export type YakuTheme =
  | "light"
  | "rain"
  | "flowers"
  | "moon"
  | "red"
  | "blue"
  | "nature"
  | "ribbon"
  | "plain";

export interface YakuAnnouncement {
  kind: "role" | "increment";
  name: string;
  points: number;
  delta: number;
  cardIds: number[];
  theme: YakuTheme;
}

const fixedRoles: Record<string, { pool: number[]; theme: YakuTheme }> = {
  五光: { pool: [0, 8, 28, 40, 44], theme: "light" },
  四光: { pool: [0, 8, 28, 44], theme: "light" },
  雨四光: { pool: [0, 8, 28, 40, 44], theme: "rain" },
  三光: { pool: [0, 8, 28, 44], theme: "light" },
  猪鹿蝶: { pool: [24, 36, 20], theme: "nature" },
  赤短: { pool: [1, 5, 9], theme: "red" },
  青短: { pool: [21, 33, 37], theme: "blue" },
  花見で一杯: { pool: [8, 32], theme: "flowers" },
  月見で一杯: { pool: [28, 32], theme: "moon" },
};

function roleCards(name: string, captured: number[]) {
  const own = new Set(captured.filter((id) => Number.isInteger(id) && cards[id]));
  const fixed = fixedRoles[name];
  if (fixed) {
    return {
      cardIds: fixed.pool.filter((id) => own.has(id)),
      theme: fixed.theme,
    };
  }
  const category =
    name === "タネ"
      ? "animal"
      : name === "短冊"
        ? "ribbon"
        : name === "カス"
          ? "chaff"
          : null;
  return {
    cardIds: category
      ? cards
          .filter(
            (card) =>
              own.has(card.id) &&
              (card.kind === category || (category === "chaff" && card.id === 32)),
          )
          .map((card) => card.id)
      : [],
    theme: (category === "animal"
      ? "nature"
      : category === "ribbon"
        ? "ribbon"
        : "plain") as YakuTheme,
  };
}

/**
 * Diff server-confirmed roles against the roles already announced this round.
 * The caller retains the highest seen points by name, resets that baseline for
 * a new round, and seeds it from the current state when joining or reconnecting.
 * A decision/koikoi message with unchanged roles therefore produces no replay.
 */
export function buildYakuAnnouncements(
  previousEarned: Yaku[],
  nextEarned: Yaku[],
  captured: number[],
): YakuAnnouncement[] {
  const seen = new Map<string, number>();
  for (const role of previousEarned) {
    seen.set(role.name, Math.max(seen.get(role.name) ?? 0, role.points));
  }
  const announcements: YakuAnnouncement[] = [];
  for (const role of nextEarned) {
    const previousPoints = seen.get(role.name);
    // Also deduplicate repeated entries in a snapshot, should one reach us.
    seen.set(role.name, Math.max(previousPoints ?? 0, role.points));
    if (previousPoints !== undefined && role.points <= previousPoints) continue;
    announcements.push({
      kind: previousPoints === undefined ? "role" : "increment",
      name: role.name,
      points: role.points,
      delta: role.points - (previousPoints ?? 0),
      ...roleCards(role.name, captured),
    });
  }
  return announcements;
}

export function yakuAnnouncementDuration(
  announcement: YakuAnnouncement,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 450;
  return announcement.kind === "role" ? 1600 : 650;
}
