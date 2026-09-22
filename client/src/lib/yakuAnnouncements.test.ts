// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import test from "node:test";
import {
  buildYakuAnnouncements,
  yakuAnnouncementDuration,
} from "./yakuAnnouncements";

test("announces each newly earned role with its own constituent cards in server order", () => {
  const actual = buildYakuAnnouncements(
    [{ name: "赤短", points: 5 }],
    [
      { name: "赤短", points: 5 },
      { name: "花見で一杯", points: 5 },
      { name: "月見で一杯", points: 5 },
    ],
    [1, 5, 9, 8, 28, 32, 3],
  );
  assert.deepEqual(
    actual.map(({ kind, name, cardIds, theme }) => ({ kind, name, cardIds, theme })),
    [
      { kind: "role", name: "花見で一杯", cardIds: [8, 32], theme: "flowers" },
      { kind: "role", name: "月見で一杯", cardIds: [28, 32], theme: "moon" },
    ],
  );
});

test("koikoi, decision, and extra unrelated captures do not replay an unchanged role", () => {
  const earned = [{ name: "猪鹿蝶", points: 5 }];
  assert.deepEqual(buildYakuAnnouncements(earned, earned, [20, 24, 36, 2]), []);
  assert.deepEqual(buildYakuAnnouncements(earned, earned, [20, 24, 36, 2, 3]), []);
  assert.deepEqual(buildYakuAnnouncements(earned, [], []), []);
});

test("a higher bright role is a new named cut-in without replaying the lower role", () => {
  assert.deepEqual(
    buildYakuAnnouncements(
      [{ name: "三光", points: 5 }],
      [{ name: "四光", points: 8 }],
      [0, 8, 28, 44],
    ).map(({ name, kind, points, cardIds }) => ({ name, kind, points, cardIds })),
    [{ name: "四光", kind: "role", points: 8, cardIds: [0, 8, 28, 44] }],
  );
});

test("growing category points use only a short delta badge", () => {
  const [increment] = buildYakuAnnouncements(
    [{ name: "タネ", points: 1 }],
    [{ name: "タネ", points: 3 }],
    [4, 12, 16, 20, 24, 29, 32],
  );
  assert.equal(increment.kind, "increment");
  assert.equal(increment.delta, 2);
  assert.equal(increment.points, 3);
  assert.equal(yakuAnnouncementDuration(increment, false), 650);
  assert.equal(yakuAnnouncementDuration(increment, true), 450);
});

test("maximum previously announced points prevent replay on stale snapshots", () => {
  const previous = [{ name: "カス", points: 3 }, { name: "カス", points: 1 }];
  assert.deepEqual(buildYakuAnnouncements(previous, [{ name: "カス", points: 2 }], []), []);
  assert.deepEqual(buildYakuAnnouncements(previous, [{ name: "カス", points: 3 }], []), []);
});

test("a reset baseline permits the same role next round while a reconnect baseline skips it", () => {
  const earned = [{ name: "青短", points: 5 }];
  const [nextRound] = buildYakuAnnouncements([], earned, [21, 33, 37]);
  assert.equal(nextRound.kind, "role");
  assert.deepEqual(nextRound.cardIds, [21, 33, 37]);
  assert.equal(yakuAnnouncementDuration(nextRound, false), 1600);
  assert.deepEqual(buildYakuAnnouncements(earned, earned, [21, 33, 37]), []);
});

test("constituent cards are restricted to valid public captures and are deduplicated", () => {
  const [role] = buildYakuAnnouncements([], [{ name: "三光", points: 5 }], [0, 0, 8, 44, 100, -1, 0.5]);
  assert.deepEqual(role.cardIds, [0, 8, 44]);
  const [partial] = buildYakuAnnouncements([], [{ name: "赤短", points: 5 }], [1, 5]);
  assert.deepEqual(partial.cardIds, [1, 5]);
});

test("category card groups include the sake cup for both animals and chaff", () => {
  const captured = [2, 3, 4, 5, 6, 7, 10, 11, 14, 15, 18, 19, 32];
  const actual = buildYakuAnnouncements([], [
    { name: "タネ", points: 1 },
    { name: "カス", points: 2 },
    { name: "短冊", points: 1 },
  ], captured);
  assert.deepEqual(actual[0].cardIds, [4, 32]);
  assert.deepEqual(actual[1].cardIds, [2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 32]);
  assert.deepEqual(actual[2].cardIds, [5]);
});

test("a repeated identical role in one snapshot produces a single announcement", () => {
  assert.equal(buildYakuAnnouncements([], [
    { name: "赤短", points: 5 },
    { name: "赤短", points: 5 },
  ], [1, 5, 9]).length, 1);
});
