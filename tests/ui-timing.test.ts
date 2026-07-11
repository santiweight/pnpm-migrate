import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsedTime } from "../src/ui/timing.ts";

test("formats elapsed agent time for the spinner", () => {
  assert.equal(formatElapsedTime(-1), "0s");
  assert.equal(formatElapsedTime(999), "0s");
  assert.equal(formatElapsedTime(12_345), "12s");
  assert.equal(formatElapsedTime(72_000), "1m 12s");
  assert.equal(formatElapsedTime(3_723_000), "1h 2m 3s");
});
