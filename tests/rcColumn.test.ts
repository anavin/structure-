import { test } from "node:test";
import assert from "node:assert/strict";
import { designRcColumn, interactionDiagram, phiMnAt, type ColumnSection } from "../src/design/rcColumn.ts";

const sec: ColumnSection = { code: "EIT", b: 300, h: 300, cover: 40, tieDia: 9, fcKsc: 240, fyKsc: 4000, fytKsc: 2400 };
const lay4 = { dia: 16, nFace: 2, nSide: 0 };
const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${msg}: ได้ ${a} คาด ${b}`);

test("P0 = 0.85fc'(Ag−Ast) + fy·Ast และ φPn,max = 0.8·0.70·P0 (วสท.)", () => {
  const dg = interactionDiagram(sec, lay4);
  near(dg.P0, 2099.9, 1e-3, "P0");
  near(dg.phiPnMax, 0.8 * 0.7 * 2099.9, 1e-3, "φPn,max");
});

test("แรงดึงล้วน = −0.9·fy·Ast", () => {
  const dg = interactionDiagram(sec, lay4);
  const minP = Math.min(...dg.points.map((p) => p.phiPn));
  near(minP, -0.9 * 392.266 * 804.25 / 1000, 1e-3, "φPt");
});

test("ดัดล้วน (Pu = 0): คำนวณมือ c ≈ 44.4 mm, Mn ≈ 37.97 kN·m → φMn ≈ 34.2 kN·m", () => {
  const dg = interactionDiagram(sec, lay4);
  near(phiMnAt(dg.points, 0), 0.9 * 37.97, 0.015, "φMn ที่ Pu=0");
});

test("ACI 318-19 ใช้ φ = 0.65 สำหรับแรงอัดสูงสุดของเสาปลอกเดี่ยว", () => {
  const e = interactionDiagram(sec, lay4), a = interactionDiagram({ ...sec, code: "ACI" }, lay4);
  near(a.phiPnMax / e.phiPnMax, 0.65 / 0.7, 1e-9, "อัตราส่วน φPn,max");
});

test("ออกแบบอัตโนมัติ: Pu = 800 kN, M = 60 kN·m → ผ่านด้วย ρ 1%–4%", () => {
  const r = designRcColumn(sec, [{ combo: "U1", Pu: 800, Mtop: 60, Mbot: -40, Vu: 30 }], { Lu: 3000, k: 1, betaDns: 0.6 });
  assert.ok(r.ok, r.message);
  assert.ok(r.maxRatio <= 1);
  assert.ok(r.rho >= 0.01 && r.rho <= 0.04);
  assert.equal(r.slender.slender, false);
});

test("เสาชะลูด (Lu = 6 m): ต้องขยายโมเมนต์ δ > 1", () => {
  const r = designRcColumn(sec, [{ combo: "U1", Pu: 500, Mtop: 20, Mbot: 20, Vu: 5 }], { Lu: 6000, k: 1, betaDns: 0.6 });
  assert.equal(r.slender.slender, true);
  assert.ok(r.checks[0].delta > 1, `δ=${r.checks[0].delta}`);
  assert.ok(r.checks[0].Mc > 20);
});

test("แรงอัดเกินกำลังสูงสุด ต้องไม่ผ่าน", () => {
  const r = designRcColumn(sec, [{ combo: "U1", Pu: 3000, Mtop: 0, Mbot: 0, Vu: 0 }], { Lu: 3000, k: 1, betaDns: 0.6 });
  assert.equal(r.ok, false);
});
