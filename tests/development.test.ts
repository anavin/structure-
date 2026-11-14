import { test } from "node:test";
import assert from "node:assert/strict";
import { lapCompression, lapTension, ldHook, ldStraight, roundUp50 } from "../src/design/development.ts";

const near = (a: number, b: number, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test("ระยะฝัง ACI 25.4 เทียบมือ (fc' 28 MPa, fy 400 MPa)", () => {
  const sq = Math.sqrt(28);
  near(ldStraight({ db: 16, fc: 28, fy: 400 }), (400 / (2.1 * sq)) * 16);
  near(ldStraight({ db: 16, fc: 28, fy: 400, top: true }), (400 * 1.3 / (2.1 * sq)) * 16);
  near(ldStraight({ db: 25, fc: 28, fy: 400 }), (400 / (1.7 * sq)) * 25);
  assert.equal(ldStraight({ db: 6, fc: 40, fy: 300 }), 300); // ขั้นต่ำ
  near(ldHook({ db: 16, fc: 28, fy: 400 }), ((400 * (28 / 105 + 0.6)) / (23 * sq)) * 16 ** 1.5);
  assert.equal(ldHook({ db: 10, fc: 28, fy: 400 }), 150);
  near(lapTension({ db: 20, fc: 28, fy: 400 }), 1.3 * (400 / (1.7 * sq)) * 20);
  near(lapCompression({ db: 16, fc: 28, fy: 400 }), 0.071 * 400 * 16);
  near(lapCompression({ db: 25, fc: 28, fy: 500 }), (0.13 * 500 - 24) * 25);
  assert.equal(roundUp50(576), 600);
  assert.equal(roundUp50(600), 600);
});
