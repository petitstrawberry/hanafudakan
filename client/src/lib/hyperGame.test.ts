// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import test from "node:test";
import { boardChanged, canCashOutWithContracts, captureTargets } from "./hyperGame";
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
