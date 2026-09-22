// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import assert from "node:assert/strict";
// @ts-expect-error Node built-ins are supplied by the test runner; the browser app has no Node typings.
import test from "node:test";
import { cardImage } from "./cards";

test("card images can switch between the recolored and original palettes", () => {
  assert.equal(cardImage(8, "recolored"), "/cards/8.svg");
  assert.equal(cardImage(8, "classic"), "/cards-classic/8.svg");
  assert.equal(cardImage(-1, "classic"), "/cards-classic/back.svg");
});
