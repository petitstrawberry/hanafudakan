import type { HyperContract, HyperDamage, RoomView, TrapActivation, TrapKind, Yaku } from "./types";

export function canCashOutWithContracts(roles: Yaku[], contracts: HyperContract[], koiReady: boolean): boolean {
  if (contracts.length === 0) return true;
  const cost = Math.max(...contracts.map(contract => contract.points));
  return koiReady && roles.reduce((sum, role) => sum + role.points, 0) > cost;
}

export function captureTargets(room: RoomView, cardId: number): number[] {
  if (room.phase === "draw_choice" && cardId === room.drawnCard)
    return room.legalTargets ?? [];
  const authoritative = room.handTargets?.find((item) => item.cardId === cardId);
  if (authoritative) return authoritative.targets;
  const matches = room.field.filter((id) => Math.floor(id / 4) === Math.floor(cardId / 4));
  if (matches.length) return matches;
  // Retained snapshots from earlier servers still honour the ribbon contract.
  const ribbons = [1, 5, 9, 13, 17, 21, 25, 33, 37, 42];
  if (ribbons.includes(cardId) && room.hyper?.contracts[room.turn]?.some((c) => c.id === "chant")) {
    const ribbon = room.field.find((id) => ribbons.includes(id));
    return ribbon === undefined ? [] : [ribbon];
  }
  return [];
}

export function boardChanged(previous: RoomView, next: RoomView): boolean {
  return previous.round !== next.round ||
    (previous.boardRevision ?? 0) !== (next.boardRevision ?? 0) ||
    // Compatibility with older snapshots that have no revision counter.
    next.hyper?.contracts.some((items, i) => items.length > (previous.hyper?.contracts[i]?.length ?? 0)) === true;
}

export function canSetTrap(room: RoomView): boolean {
  return room.myIndex !== null && room.turn === room.myIndex && room.phase === "play" &&
    room.hyper?.trapReady?.[room.myIndex] === true;
}

export function damageBreakdown(hit: HyperDamage): string {
  const parts = hit.kind === "trap" ? [`罠${hit.contract}`] : [`札${hit.cards}`,
    ...(hit.roles ? [`役${hit.roles}（${hit.roleGains.map(r => `${r.name}＋${r.points}文`).join("・")}）`] : []),
    ...(hit.chain ? [`CHAIN${hit.chain}`] : []), ...(hit.contract ? [`初撃${hit.contract}`] : [])];
  if (hit.exposure) parts.push(`被ダメ増${hit.exposure}`);
  return `${parts.join("＋")} → 上限16${hit.blocked ? `・防御−${hit.blocked}` : ""} → 威力${hit.power} / HP減少${hit.damage}（${hit.hpBefore}→${hit.hpAfter}）`;
}

export function previewFor(room: RoomView, card: number, target: number): HyperDamage[] {
  return room.hyper?.damagePreviews?.find(p => p.cardId === card && (p.targetId === target ||
    takesAllTargets(card, captureTargets(room, card))))?.damage ?? [];
}


export const trapEffects: Record<TrapKind, { name: string; description: string }> = {
  levy: { name: "徴収", description: "相手の花力を最大4奪う" },
  reveal: { name: "暴露", description: "相手の残り手札2枚を自分だけ見る（次の自分手番終了まで）" },
  snatch: { name: "奪還", description: "相手が取った罠札を自分の取り札へ。その札の役・攻撃・取得報酬も相手から奪う" },
  swap: { name: "すり替え", description: "相手の残り手札1枚をランダムに山札の底と交換。札の内容は非公開" },
  tax: { name: "徴税", description: "相手がこの手番に勝った場合、勝利配当の25%を奪う（切り捨て）。こいこいで解除" },
  misfortune: { name: "凶運", description: "相手の手番終了まで倍率−0.5（最低×0.5）。CHAIN・めくりは継続" },
  scorch: { name: "焼却", description: "相手が蓄積した成長倍率を最大0.5削る。CHAINは維持・再成長可能" },
  bind: { name: "足枷", description: "この取得から相手の手番終了まで倍率の永久成長を停止。CHAIN・めくりは継続" },
};

export function trapResult(hit: TrapActivation): string {
  if (hit.kind === "levy") return `花力${hit.amount}を奪取`;
  if (hit.kind === "reveal") return `残り手札${hit.amount}枚を罠の所有者へ開示`;
  if (hit.kind === "snatch") return `罠札${hit.amount}枚を所有者の取り札へ奪還`;
  if (hit.kind === "swap") return `残り手札${hit.amount}枚を山札の底と交換`;
  if (hit.kind === "tax") return `この手番に勝った場合、配当${hit.amount}%を奪取（切り捨て）`;
  if (hit.kind === "misfortune") return `手番終了まで倍率−${hit.amount / 4} · 最低×0.5 · CHAIN継続`;
  if (hit.kind === "scorch") return `蓄積した成長倍率−${hit.amount / 4} · 再成長可能 · CHAIN継続`;
  return "手番終了まで倍率成長を封印 · CHAIN継続";
}

export function takesAllTargets(card: number, targets: number[]): boolean {
  return targets.length === 3 && targets.every(id => Math.floor(id / 4) === Math.floor(card / 4));
}

export function previewUncertain(room: RoomView, card: number, target: number): boolean {
  return room.hyper?.damagePreviews?.find(p => p.cardId === card && (p.targetId === target ||
    takesAllTargets(card, captureTargets(room, card))))?.uncertain === true;
}
