// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import test from "node:test";
import { fitFieldLayout } from "./fieldLayout";

const rectangles = [
  [500, 200],
  [250, 140],
  [300, 75],
  [160, 180],
] as const;

test("all cards and a reserved ninth landing slot fit desktop and phone fields", () => {
  for (const count of [1, 8, 9, 16, 24]) {
    for (const [width, height] of rectangles) {
      for (const maximum of [64, 52]) {
        const layout = fitFieldLayout(count, width, height, maximum);
        const context = JSON.stringify({ count, width, height, maximum, layout });
        assert.ok(layout.cardWidth > 0, context);
        assert.ok(layout.cardWidth <= maximum, context);
        assert.ok(layout.width <= width, context);
        assert.ok(layout.height <= height, context);
        assert.ok(layout.columns * layout.rows >= count, context);
        assert.equal(layout.rows, Math.ceil(count / layout.columns), context);
        assert.ok(Math.abs(layout.cardWidth / layout.cardHeight - 240 / 380) < 1e-12, context);
        assert.equal(layout.width, layout.columns * layout.cardWidth + (layout.columns - 1) * layout.gap, context);
        assert.equal(layout.height, layout.rows * layout.cardHeight + (layout.rows - 1) * layout.gap, context);
      }
    }
  }
});

test("an empty field and unmeasured containers always return finite zero dimensions", () => {
  assert.deepEqual(fitFieldLayout(0, 500, 200), {
    columns: 1, rows: 0, cardWidth: 0, cardHeight: 0, gap: 0, width: 0, height: 0,
  });
  for (const [count, width, height, maximum] of [
    [8, 0, 100, 64], [8, 100, 0, 64], [8, 0, 0, 64],
    [8, -5, 100, 64], [8, 100, Number.NaN, 64],
    [8, Infinity, 100, 64], [8, 100, 100, 0],
    [Number.NaN, 100, 100, 64], [Infinity, 100, 100, 64],
    [-4, 100, 100, 64],
  ]) {
    const layout = fitFieldLayout(count, width, height, maximum);
    assert.ok(Object.values(layout).every(Number.isFinite));
    assert.equal(layout.cardWidth, 0);
    assert.equal(layout.width, 0);
    assert.equal(layout.height, 0);
  }
});

test("one card uses the requested maximum or its limiting dimension", () => {
  assert.equal(fitFieldLayout(1, 500, 200).cardWidth, 64);
  assert.equal(fitFieldLayout(1, 500, 200, 52).cardWidth, 52);
  assert.equal(fitFieldLayout(1, 20, 200).cardWidth, 20);
  assert.equal(fitFieldLayout(1, 200, 38).cardWidth, 24);
});

test("rotation reallocates columns so a wide shallow field remains within its height", () => {
  const landscape = fitFieldLayout(16, 300, 75);
  const portrait = fitFieldLayout(16, 75, 300);
  assert.ok(landscape.columns > portrait.columns);
  assert.ok(landscape.rows < portrait.rows);
  assert.ok(landscape.height <= 75);
  assert.ok(portrait.width <= 75);
});

test("very tight fields shrink gaps as well as cards without overflow", () => {
  for (const [width, height] of [[8, 5], [0.1, 0.2], [1, 1]]) {
    const layout = fitFieldLayout(24, width, height);
    assert.ok(layout.cardWidth > 0);
    assert.ok(layout.gap < 2);
    assert.ok(layout.width <= width);
    assert.ok(layout.height <= height);
  }
});

test("when maximum card sizes tie, complete rows beat empty cells", () => {
  const layout = fitFieldLayout(8, 500, 500);
  assert.equal(layout.cardWidth, 64);
  assert.equal(layout.columns * layout.rows, 8);
});

test("chosen card size is maximal across every column count with responsive spacing", () => {
  for (const count of [8, 9, 16, 24]) {
    for (const [width, height] of rectangles) {
      const layout = fitFieldLayout(count, width, height);
      if (layout.cardWidth === 64) continue;
      const larger = layout.cardWidth + 0.0002;
      const gap = Math.min(10, Math.max(2, larger * 0.14), larger * 0.25);
      for (let columns = 1; columns <= count; columns += 1) {
        const rows = Math.ceil(count / columns);
        assert.ok(
          columns * larger + (columns - 1) * gap > width ||
            rows * larger * 380 / 240 + (rows - 1) * gap > height,
          JSON.stringify({ count, width, height, columns, layout }),
        );
      }
    }
  }
});
