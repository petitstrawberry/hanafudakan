import type { HyperContract, RoomView, Yaku } from "./types";

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
