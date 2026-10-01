// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import test from "node:test";
import { boardChanged, canCashOutWithContracts, captureTargets, canSetTrap, damageBreakdown, previewFor } from "./hyperGame";
import type { HyperContract, RoomView } from "./types";

const room = {
  round: 1, boardRevision: 1, phase: "play", turn: 0,
  field: [5, 13, 20], drawnCard: null,
  hyper: { contracts: [[{ id: "chant" }], []] },
} as unknown as RoomView;

test("ribbon contracts show the same cross-month target the server accepts", () => {
  assert.deepEqual(captureTargets(room, 1), [5]);
  assert.deepEqual(captureTargets({ ...room, field: [2, 5] }, 1), [2]);
  assert.deepEqual(captureTargets(room, 24), []);
  assert.deepEqual(captureTargets({ ...room, handTargets: [{ cardId: 1, targets: [13] }] }, 1), [13]);
});

test("draw choices use authoritative targets and never expose hidden stock", () => {
  assert.deepEqual(captureTargets({ ...room, phase: "draw_choice", drawnCard: 1, legalTargets: [5, 13] }, 1), [5, 13]);
});

test("redeals reset animation and role baselines even in the same round", () => {
  assert.equal(boardChanged(room, { ...room, boardRevision: 2 }), true);
  assert.equal(boardChanged(room, { ...room, round: 2 }), true);
  assert.equal(boardChanged(room, { ...room, field: [24] }), false);
  const before = { ...room, boardRevision: undefined, hyper: undefined };
  assert.equal(boardChanged(before, { ...room, boardRevision: undefined }), true);
});

test("cashout uses combined unmultiplied roles and requires koi after the latest contract", () => {
  const five = { id: "feast", name: "宴", source: "花見で一杯", points: 5, description: "" } satisfies HyperContract;
  const one = { ...five, id: "grass", points: 1 };
  assert.equal(canCashOutWithContracts([{ name: "花見で一杯", points: 5 }], [], false), true);
  assert.equal(canCashOutWithContracts([{ name: "花見で一杯", points: 5 }], [five], true), false);
  assert.equal(canCashOutWithContracts([{ name: "花見で一杯", points: 5 }, { name: "赤短", points: 5 }], [five, one], false), false);
  assert.equal(canCashOutWithContracts([{ name: "花見で一杯", points: 5 }, { name: "赤短", points: 5 }], [five, one], true), true);
  assert.equal(canCashOutWithContracts([{ name: "タネ", points: 6 }], [{ ...five, points: 7 }, one], true), false);
});


test("public traps require own play phase and the server turn budget", () => {
  const ready = { ...room, myIndex: 0, hyper: { ...room.hyper!, trapReady: [true, false], traps: [5, null] } };
  assert.equal(canSetTrap(ready), true);
  assert.equal(canSetTrap({ ...ready, myIndex: null }), false);
  assert.equal(canSetTrap({ ...ready, turn: 1 }), false);
  assert.equal(canSetTrap({ ...ready, phase: "draw_choice" }), false);
  assert.equal(canSetTrap({ ...ready, hyper: { ...ready.hyper, trapReady: [false, false] } }), false);
});

test("combat previews distinguish matching choices, damage power and actual HP loss", () => {
  const hit = { attacker: 0, defender: 1, kind: "capture", cards: 2, roles: 5,
    roleGains: [{ name: "赤短", points: 5 }], chain: 1, contract: 5, exposure: 1, blocked: 2,
    power: 12, damage: 3, hpBefore: 3, hpAfter: 0 };
  const trap = { ...hit, kind: "trap", attacker: 1, defender: 0, cards: 0, roles: 0, roleGains: [], chain: 0, contract: 4, exposure: 0, blocked: 0, power: 4, damage: 4, hpBefore: 32, hpAfter: 28 };
  const preview = { ...room, handTargets: [{ cardId: 1, targets: [5, 13] }], hyper: {
    ...room.hyper!, damagePreviews: [{ cardId: 1, targetId: 5, damage: [hit, trap] }, { cardId: 1, targetId: 13, damage: [hit] }],
  } };
  assert.deepEqual(previewFor(preview, 1, 5), [hit, trap]);
  assert.deepEqual(previewFor(preview, 1, 13), [hit]);
  assert.deepEqual(previewFor(preview, 1, 20), []);
  assert.deepEqual(previewFor({ ...room, hyper: undefined }, 1, 5), []);
  assert.match(damageBreakdown(hit), /役5（赤短＋5文）/);
  assert.match(damageBreakdown(hit), /上限16・防御−2 → 威力12 \/ HP減少3（3→0）/);
  assert.match(damageBreakdown(trap), /^罠4/);
});
