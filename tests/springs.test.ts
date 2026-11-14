// จุดรองรับสปริงและการทรุดตัวของจุดรองรับ (2D) — เทียบผลเฉลยปิด
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/frame2d.ts";
import { analyzeCase, analyzeCombo } from "../src/core/combos.ts";
import type { Model, Support } from "../src/core/model.ts";

const E = 2.0e7, b = 0.3, h = 0.5, I = (b * h ** 3) / 12, EI = E * I;
const close = (a: number, e: number, rel = 1e-9, label = "") => assert.ok(Math.abs(a - e) <= Math.max(Math.abs(e) * rel, 1e-9), `${label} ได้ ${a} คาด ${e}`);

function beam(L: number, supports: Support[]): Model {
  return {
    name: "t", nodes: [{ id: "A", x: 0, y: 0 }, { id: "B", x: L, y: 0 }], supports,
    materials: [{ id: "M", name: "M", E, gamma: 24 }], sections: [{ id: "S", name: "S", material: "M", b, h }],
    members: [{ id: "B1", i: "A", j: "B", section: "S", kind: "beam" }], loadCases: [], combos: [],
  };
}
const FIX: Support = { node: "A", ux: true, uy: true, rz: true };

test("คานยื่นมีสปริงที่ปลาย: δ = P/(k + 3EI/L³), แรงสปริง = kδ", () => {
  const L = 4, P = 50, k = 5000;
  const m = beam(L, [FIX, { node: "B", ux: false, uy: false, rz: false, ky: k }]);
  const r = analyze(m, [{ type: "nodal", node: "B", fx: 0, fy: -P, mz: 0 }]);
  const d = -P / (k + (3 * EI) / L ** 3);
  close(r.disp.B.uy, d, 1e-9, "δ");
  close(r.reactions.B.fy, -k * d, 1e-9, "Rspring");
  close(r.reactions.A.fy + r.reactions.B.fy, P, 1e-9, "ΣFy");
});

test("สปริงหมุนที่โคนคานยื่น: θ = M/kr เพิ่มจากคานยึดแน่น", () => {
  const L = 3, P = 10, kr = 2e4;
  const m = beam(L, [{ node: "A", ux: true, uy: true, rz: false, kr }]);
  const r = analyze(m, [{ type: "nodal", node: "B", fx: 0, fy: -P, mz: 0 }]);
  close(r.disp.A.rz, (-P * L) / kr, 1e-9, "θA");
  close(r.disp.B.uy, (-P * L ** 3) / (3 * EI) + ((-P * L) / kr) * L, 1e-9, "δB");
  close(r.reactions.A.mz, P * L, 1e-9, "Mr");
});

test("คานยึดแน่นสองปลาย ปลายหนึ่งทรุด Δ: M = 6EIΔ/L², V = 12EIΔ/L³", () => {
  const L = 6, D = -0.01;
  const m = beam(L, [FIX, { node: "B", ux: true, uy: true, rz: true }]);
  const r = analyze(m, [], 0, {}, [{ node: "B", dx: 0, dy: D, rz: 0 }]);
  close(r.disp.B.uy, D, 1e-12, "uy");
  close(Math.abs(r.reactions.A.mz), (6 * EI * Math.abs(D)) / L ** 2, 1e-9, "M");
  close(Math.abs(r.reactions.A.fy), (12 * EI * Math.abs(D)) / L ** 3, 1e-9, "V");
  close(r.reactions.A.fy + r.reactions.B.fy, 0, 1e-9, "ΣFy");
});

test("คานยื่นค้ำปลาย จุดค้ำทรุด Δ: R = 3EIΔ/L³", () => {
  const L = 5, D = -0.02;
  const m = beam(L, [FIX, { node: "B", ux: false, uy: true, rz: false }]);
  const r = analyze(m, [], 0, {}, [{ node: "B", dx: 0, dy: D, rz: 0 }]);
  close(r.reactions.B.fy, (3 * EI * D) / L ** 3, 1e-9, "R");
});

test("ฐานสปริงเลื่อน δ0: u = kδ0/(k + 3EI/L³)", () => {
  const L = 4, k = 8000, d0 = -0.015;
  const m = beam(L, [FIX, { node: "B", ux: false, uy: false, rz: false, ky: k }]);
  const r = analyze(m, [], 0, {}, [{ node: "B", dx: 0, dy: d0, rz: 0 }]);
  const kb = (3 * EI) / L ** 3;
  close(r.disp.B.uy, (k * d0) / (k + kb), 1e-9, "u");
  close(r.reactions.B.fy, -k * (r.disp.B.uy - d0), 1e-9, "R");
});

test("การทรุดตัวใน load case และชุดผสมคูณตัวคูณ", () => {
  const L = 6;
  const m = beam(L, [FIX, { node: "B", ux: true, uy: true, rz: true }]);
  m.loadCases = [{ id: "ST", name: "ทรุดตัว", selfWeight: false, loads: [], settle: [{ node: "B", dx: 0, dy: -0.01, rz: 0 }] }];
  m.combos = [{ id: "C", name: "1.2ST", factors: { ST: 1.2 } }];
  const rc = analyzeCase(m, "ST"), rb = analyzeCombo(m, m.combos[0]);
  close(rb.reactions.A.mz, 1.2 * rc.reactions.A.mz, 1e-9, "scale");
  close(rb.disp.B.uy, -0.012, 1e-12, "uy");
});

test("ทรุดตัวในทิศที่ไม่มีจุดรองรับ → แจ้งข้อผิดพลาด, สปริงติดลบ → แจ้ง", () => {
  const m = beam(4, [FIX, { node: "B", ux: false, uy: true, rz: false }]);
  assert.throws(() => analyze(m, [], 0, {}, [{ node: "B", dx: 0.01, dy: 0, rz: 0 }]), /ไม่มีจุดรองรับหรือสปริง/);
  const m2 = beam(4, [FIX, { node: "B", ux: false, uy: false, rz: false, ky: -5 }]);
  assert.throws(() => analyze(m2, []), /สปริง/);
});

test("P-Delta ทำงานร่วมกับสปริง (ลู่เข้า)", () => {
  const H = 4;
  const m: Model = {
    name: "c", nodes: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 0, y: H }],
    supports: [{ node: "A", ux: true, uy: true, rz: false, kr: 5e4 }],
    materials: [{ id: "M", name: "M", E, gamma: 24 }], sections: [{ id: "S", name: "S", material: "M", b, h }],
    members: [{ id: "C1", i: "A", j: "B", section: "S", kind: "column" }], loadCases: [], combos: [],
  };
  const lin = analyze(m, [{ type: "nodal", node: "B", fx: 5, fy: -200, mz: 0 }]);
  const pd = analyze(m, [{ type: "nodal", node: "B", fx: 5, fy: -200, mz: 0 }], 0, { pDelta: true });
  assert.ok(Math.abs(pd.disp.B.ux) > Math.abs(lin.disp.B.ux));
});
