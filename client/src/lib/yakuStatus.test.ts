// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import test from "node:test";
import { cards } from "./cards";
import { getYakuStatuses } from "./yakuStatus";

const status = (
  id: string,
  own: number[] = [],
  opponent: number[] = [],
  earned: { name: string; points: number }[] = [],
) => {
  const result = getYakuStatuses(own, opponent, earned).find(
    (yaku) => yaku.id === id,
  );
  if (!result) throw new Error(`Unknown role: ${id}`);
  return result;
};

test("returns the twelve roles in their stable display order", () => {
  assert.deepEqual(
    getYakuStatuses([], [], []).map(({ name, points }) => [name, points]),
    [
      ["五光", 10],
      ["四光", 8],
      ["雨四光", 7],
      ["三光", 5],
      ["猪鹿蝶", 5],
      ["赤短", 5],
      ["青短", 5],
      ["花見で一杯", 5],
      ["月見で一杯", 5],
      ["たね", 1],
      ["たん", 1],
      ["かす", 1],
    ],
  );
});

test("a fixed role becomes impossible when the opponent has a required card", () => {
  const boarDeerButterfly = status("inoshikacho", [20, 24], [36]);
  assert.equal(boarDeerButterfly.state, "impossible");
  assert.equal(boarDeerButterfly.have, 2);
  assert.deepEqual(boarDeerButterfly.missing, [36]);
  assert.match(boarDeerButterfly.reason, /紅葉に鹿/);
  assert.equal(status("hanami", [8], [32]).state, "impossible");
});

test("three brights remains possible with one of four non-rain brights blocked", () => {
  const possible = status("sanko", [0], [8]);
  assert.equal(possible.state, "possible");
  assert.equal(possible.have, 1);
  assert.deepEqual(possible.missing, [28, 44]);
  assert.equal(status("sanko", [0], [8, 28]).state, "impossible");
  assert.equal(status("shiko", [0], [8]).state, "impossible");
});

test("own rain blocks three and dry four brights exactly as on the server", () => {
  assert.equal(status("sanko", [0, 8, 40]).state, "impossible");
  assert.equal(status("shiko", [0, 8, 40]).state, "impossible");
  assert.equal(status("sanko", [0, 8], [40]).state, "possible");
});

test("rain-four needs rain plus three non-rain brights", () => {
  const waitingForRain = status("ame-shiko", [0, 8, 28]);
  assert.equal(waitingForRain.state, "possible");
  assert.equal(waitingForRain.have, 3);
  assert.match(waitingForRain.reason, /雨札が必須/);
  assert.equal(status("ame-shiko", [0, 8], [40]).state, "impossible");
  assert.equal(status("ame-shiko", [40, 0], [8]).state, "possible");
  assert.equal(status("ame-shiko", [40, 0], [8, 28]).state, "impossible");
  assert.equal(status("ame-shiko", [0, 8, 28, 44]).state, "impossible");
  assert.equal(
    status("ame-shiko", [0, 8, 28, 40], [], [{ name: "雨四光", points: 7 }])
      .state,
    "complete",
  );
});

test("rain-four shows only rain after collecting three dry brights", () => {
  const waitingForRain = status("ame-shiko", [0, 8, 28]);
  assert.equal(waitingForRain.state, "possible");
  assert.equal(waitingForRain.have, 3);
  assert.deepEqual(waitingForRain.missing, [40]);
  assert.deepEqual(status("ame-shiko", [0, 8, 28], [44]).missing, [40]);

  const blockedRain = status("ame-shiko", [0, 8, 28], [40]);
  assert.equal(blockedRain.state, "impossible");
  assert.deepEqual(blockedRain.missing, [40]);
  assert.deepEqual(status("ame-shiko", [40, 0, 8]).missing, [28, 44]);
});

test("threshold roles become impossible only when too few cards remain available", () => {
  for (const [id, kind, required] of [
    ["tane", "animal", 5],
    ["tan", "ribbon", 5],
    ["kasu", "chaff", 10],
  ] as const) {
    const pool = cards
      .filter((card) => card.kind === kind || (id === "kasu" && card.id === 32))
      .map((card) => card.id);
    const blocked = pool.slice(0, pool.length - required);
    assert.equal(status(id, [], blocked).state, "possible", id);
    assert.equal(
      status(id, [], [...blocked, pool[pool.length - required]]).state,
      "impossible",
      id,
    );
  }
});

test("completed category points and naming come from the server", () => {
  const earned = [
    { name: "タネ", points: 3 },
    { name: "短冊", points: 4 },
    { name: "カス", points: 2 },
  ];
  const own = [
    4, 12, 16, 20, 24, 29, 32, 1, 5, 9, 13, 17, 21, 25, 33, 2, 3, 6, 7, 10, 11,
    14, 15, 18, 19,
  ];
  for (const [id, expectedPoints] of [
    ["tane", 3],
    ["tan", 4],
    ["kasu", 2],
  ] as const) {
    const actual = status(id, own, [], earned);
    assert.equal(actual.state, "complete");
    assert.equal(actual.points, expectedPoints);
    assert.deepEqual(actual.missing, []);
  }
});

test("higher bright roles supersede lower ones before rain exclusion", () => {
  const allBrights = [0, 8, 28, 40, 44];
  const five = [{ name: "五光", points: 10 }];
  assert.equal(status("goko", allBrights, [], five).state, "complete");
  for (const id of ["shiko", "ame-shiko", "sanko"]) {
    const lower = status(id, allBrights, [], five);
    assert.equal(lower.state, "upgraded");
    assert.match(lower.reason, /上位役「五光」/);
    assert.deepEqual(lower.missing, []);
  }
  assert.equal(
    status("sanko", [0, 8, 28, 40], [], [{ name: "雨四光", points: 7 }]).state,
    "upgraded",
  );
  assert.equal(
    status("shiko", [0, 8, 28, 40], [], [{ name: "雨四光", points: 7 }]).state,
    "impossible",
  );
  assert.equal(
    status("ame-shiko", [0, 8, 28, 44], [], [{ name: "四光", points: 8 }])
      .state,
    "upgraded",
  );
});

test("sake cup counts toward both animal and chaff progress", () => {
  const own = [4, 12, 16, 29, 32, 2, 3, 6, 7, 10, 11, 14, 15, 18];
  const earned = [
    { name: "タネ", points: 1 },
    { name: "カス", points: 1 },
  ];
  assert.equal(status("tane", own, [], earned).have, 5);
  assert.equal(status("kasu", own, [], earned).have, 10);
  assert.equal(status("kasu", [32]).have, 1);
  assert.equal(status("tane", [29]).have, 1);
});

test("does not mutate public input or claim completion before server confirmation", () => {
  const own = Object.freeze([20, 24, 36]);
  const opponent = Object.freeze([0]);
  const earned = Object.freeze([{ name: "カス", points: 2 }]);
  const result = getYakuStatuses(
    own as number[],
    opponent as number[],
    earned as { name: string; points: number }[],
  );
  assert.equal(
    result.find((role) => role.id === "inoshikacho")?.state,
    "possible",
  );
  assert.deepEqual(own, [20, 24, 36]);
  assert.deepEqual(opponent, [0]);
  assert.deepEqual(earned, [{ name: "カス", points: 2 }]);
});
