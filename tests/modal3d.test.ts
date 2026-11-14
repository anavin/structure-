import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, generateBuilding, storeyWeights, parseSpacing } from "../src/app3d/generator.ts";
import { analyzeCombo3 } from "../src/core3d/combos3d.ts";
import { dominantPeriods, jacobiEigen, modalAnalysis, modeShapeResult } from "../src/core3d/modal3d.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test("Jacobi: ค่าเฉพาะของเมทริกซ์ 2×2 และ 3×3", () => {
  const r = jacobiEigen([[2, 1], [1, 2]]);
  assert.deepEqual(r.values.map((v) => Math.round(v * 1e9) / 1e9).sort(), [1, 3]);
  const s = jacobiEigen([[4, 1, 0], [1, 3, 1], [0, 1, 2]]);
  near(s.values.reduce((a, v) => a + v, 0), 9); // trace
  near(s.values.reduce((a, v) => a * v, 1), 4 * (6 - 1) - 1 * 2); // det = 18
});

test("อาคารชั้นเดียว: T = 2π√(M·δ) เมื่อโหมด X ไม่คู่ควบ และมวลประสิทธิผล 100%", () => {
  const p = { ...defaultGrid, storeys: "4", pDelta: false };
  const { model } = generateBuilding(p);
  const W = 1000; // kN
  const res = modalAnalysis(model, [W], { Bx: 15, By: 9 });
  const x = res.modes.find((m) => m.dir === "X")!;
  const dia = model.diaphragms![0].id;
  const d = analyzeCombo3({ ...model, analysis: { ...model.analysis!, pDelta: false }, loadCases: [{ id: "U", name: "", selfWeight: false, loads: [{ type: "nodal", node: dia, fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }] }] }, { U: 1 }).diaphragms[dia].ux;
  near(x.T, 2 * Math.PI * Math.sqrt((W / 9.80665) * d), 1e-6);
  near(x.mx, 1, 1e-6);
  assert.equal(res.modes.length, 3);
});

test("อาคาร 4 ชั้น: คาบเรียงจากมากไปน้อย มวลประสิทธิผลรวมแต่ละทิศ = 100% และรูปร่างโหมดปรับเป็น 1", () => {
  const { model } = generateBuilding(defaultGrid);
  const W = storeyWeights(defaultGrid, parseSpacing("3@5"), parseSpacing("2@4.5"), parseSpacing("4,3@3.5"), 0.25);
  const res = modalAnalysis(model, W, { Bx: 15, By: 9 });
  assert.equal(res.modes.length, 12);
  for (let k = 1; k < res.modes.length; k++) assert.ok(res.modes[k].T <= res.modes[k - 1].T + 1e-12);
  near(res.modes.reduce((a, m) => a + m.mx, 0), 1, 1e-6);
  near(res.modes.reduce((a, m) => a + m.my, 0), 1, 1e-6);
  const { Tx, Ty } = dominantPeriods(res);
  assert.ok(Ty > Tx); // ทิศ Y มีช่วงน้อยกว่า (2 ช่วง) → อ่อนกว่า
  assert.ok(Tx > 0.1 && Tx < 3);
  const sh = modeShapeResult(res, res.modes[0]);
  const mx = Math.max(...Object.values(sh.disp).map((d) => Math.hypot(d.ux, d.uy, d.uz)));
  near(mx, 1, 1e-9);
});
