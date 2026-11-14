import { test } from "node:test";
import assert from "node:assert/strict";
import { designWall, pmRatio, wallInteraction } from "../src/design/wall.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test("เส้นโค้ง P–M ผนัง: แรงอัดสูงสุด 0.8φP0, แรงดึงล้วน φAsfy, โมเมนต์ดัดล้วนใกล้ค่าประมาณ", () => {
  const t = 200, Lw = 4000, fc = 28, fy = 400, As = 0.0025 * t * Lw;
  const c = wallInteraction(t, Lw, As, fc, fy);
  const P0 = 0.85 * fc * (t * Lw - As) + fy * As;
  near(Math.max(...c.map((p) => p.P)), (0.8 * 0.65 * P0) / 1e3, 1e-9);
  near(Math.min(...c.map((p) => p.P)), (-0.9 * fy * As) / 1e3, 1e-9);
  // ดัดล้วน: Mn ≈ 0.5·As·fy·Lw·(1 − c/Lw) (Cardenas) — c เล็ก
  const M0 = pmRatio(c, 0, 1);
  const approx = 0.9 * 0.5 * As * fy * Lw * 0.9 / 1e6;
  assert.ok(Math.abs(1 / M0 - approx) / approx < 0.15, `φMn ${1 / M0} vs ${approx}`);
  near(pmRatio(c, 1000, 0), 1000 / ((0.8 * 0.65 * P0) / 1e3), 1e-6);
});

test("ออกแบบผนัง: เหล็กขั้นต่ำเมื่อแรงน้อย, แรงเฉือนตาม ACI 11.5.4.3, ไม่ผ่านเมื่อแรงเฉือนเกิน", () => {
  const base = { code: "ACI" as const, t: 200, Lw: 4000, hw: 14000, cover: 25, fc: 28, fy: 400 };
  const r = designWall({ ...base, demands: [{ combo: "U1", Pu: 800, Mu: 300, Vu: 100 }] });
  assert.ok(r.ok);
  assert.equal(r.vertical!.curtains, 1);
  assert.ok(r.vertical!.rho >= 0.0012 - 1e-9 && r.horizontal!.rho >= 0.002 - 1e-9);
  near(r.phiVn, (0.75 * 200 * 4000 * (0.17 * Math.sqrt(28) + r.horizontal!.rho * 400)) / 1e3, 1e-6);
  const big = designWall({ ...base, t: 300, demands: [{ combo: "E", Pu: 2000, Mu: 6000, Vu: 1500 }] });
  assert.equal(big.vertical!.curtains, 2);
  assert.ok(big.vertical!.rho > 0.0025);
  const fail = designWall({ ...base, demands: [{ combo: "E", Pu: 500, Mu: 500, Vu: 3000 }] });
  assert.equal(fail.ok, false);
  assert.ok(fail.ratioV > 1);
});
