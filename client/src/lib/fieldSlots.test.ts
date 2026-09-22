// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import test from "node:test";
import { reconcileFieldSlots } from "./fieldSlots";

test("keeps an empty hole when a field card is captured", () => {
  assert.deepEqual(
    reconcileFieldSlots([10, 20, 30], [10, 30], null),
    [10, null, 30],
  );
});

test("lands a new card in the first available hole", () => {
  assert.deepEqual(
    reconcileFieldSlots([10, null, 30], [10, 30, 40], null),
    [10, 40, 30],
  );
});

test("reserves a no-match landing slot before the snapshot arrives", () => {
  assert.deepEqual(
    reconcileFieldSlots([10, null, 30], [10, 30], 40),
    [10, 40, 30],
  );
});

test("does not carry slots into a new round when the caller resets them", () => {
  assert.deepEqual(reconcileFieldSlots([], [7, 8], null), [7, 8]);
});
