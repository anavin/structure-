import { test } from "node:test";
import assert from "node:assert/strict";
import { designTorsion } from "../src/design/torsion.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const base = { code: "ACI" as const, b: 300, h: 600, cover: 40, stirrupDia: 10, legs: 2, fc: 28, fy: 420, fyt: 280, d: 540 };

test("Tu ≤ Tth: ไม่ต้องออกแบบ", () => {
  const Tth = (0.75 * 0.083 * Math.sqrt(28) * (300 * 600) ** 2 / (2 * 900)) / 1e6;
  const r = designTorsion({ ...base, Tu: Tth * 0.9, Vu: 50 });
  assert.equal(r.required, false);
  near(r.Tth, Tth);
});

test("คำนวณ At/s, Al, ระยะปลอก ตาม ACI 22.7 (เทียบมือ)", () => {
  const r = designTorsion({ ...base, Tu: 25, Vu: 120 });
  assert.ok(r.required && r.ok);
  const x1 = 300 - 2 * 45, y1 = 600 - 2 * 45, Aoh = x1 * y1, ph = 2 * (x1 + y1), Ao = 0.85 * Aoh;
  const AtS = 25e6 / (0.75 * 2 * Ao * 280);
  near(r.AtS, AtS);
  const Vc = 0.17 * Math.sqrt(28) * 300 * 540;
  near(r.AvS, Math.max(0, 120e3 / 0.75 - Vc) / (280 * 540));
  const A1 = Math.PI * 25;
  const s = Math.min(A1 / (AtS + r.AvS / 2), (2 * A1) / (Math.max(0.062 * Math.sqrt(28), 0.35) * 300 / 280), ph / 8, 300);
  assert.equal(r.s, Math.max(75, Math.floor(s / 25) * 25));
  near(r.Al, Math.max(AtS * ph * 280 / 420, 0.42 * Math.sqrt(28) * 180000 / 420 - Math.max(AtS, 0.175 * 300 / 280) * ph * 280 / 420));
  assert.ok(r.side && r.side.n >= 1); // คานลึก 600 → มีเหล็กข้าง
  near(r.AlTop, r.Al / 4);
});

test("หน้าตัดเล็กเกินไป → ไม่ผ่าน", () => {
  const r = designTorsion({ ...base, b: 200, h: 300, d: 250, Tu: 30, Vu: 150 });
  assert.equal(r.ok, false);
  assert.ok(r.sectionRatio > 1);
});
