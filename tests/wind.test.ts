import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWind, defaultWind, exposureFactor, refPressure, windForces } from "../src/loads/windTH.ts";
import { isLateralCase, type Model } from "../src/core/model.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-12), `${msg}: ได้ ${a} คาด ${b}`);

function frame(levels: number[], bays = [0, 5]): Model {
  const nodes = levels.flatMap((y, i) => bays.map((x, j) => ({ id: `N${i}_${j}`, x, y })));
  return {
    name: "w", nodes, supports: [], materials: [], sections: [], members: [], loadCases: [], combos: [],
  };
}

test("q = ½·1.25·V²·TF: V = 25 m/s → 0.3906 kN/m²; กลุ่ม 4A ×1.2", () => {
  near(refPressure(25, 1), 0.390625, 1e-12, "q");
  near(refPressure(25, 1.2), 0.46875, 1e-12, "q 4A");
});

test("Ce: A = (z/10)^0.2 ≥ 0.9, B = 0.7(z/12)^0.3 ≥ 0.7", () => {
  near(exposureFactor(10, "A"), 1, 1e-12, "A z=10");
  near(exposureFactor(5, "A"), 0.9, 1e-12, "A ขั้นต่ำ");
  near(exposureFactor(12, "B"), 0.7, 1e-12, "B z=12");
  near(exposureFactor(24, "B"), 0.7 * Math.pow(2, 0.3), 1e-12, "B z=24");
});

test("โครงชั้นเดียว สูง 3.5 m ระยะห่าง 4 m ภูมิประเทศ A: F = (0.5625 + 0.3516)·4·1.75 = 6.40 kN", () => {
  const w = { ...defaultWind, exposure: "A" as const, spacing: 4 };
  const r = windForces(frame([0, 3.5]), w);
  assert.equal(r.levels.length, 1);
  const pW = 0.390625 * 0.9 * 2 * 0.8, pL = 0.390625 * 0.9 * 2 * 0.5;
  near(r.levels[0].F, (pW + pL) * 4 * 1.75, 1e-9, "F");
});

test("หลายชั้น ภูมิประเทศ B: ความดันด้านต้นลมเพิ่มตามความสูง และแรงเฉือนฐาน = ผลรวม", () => {
  const r = windForces(frame([0, 4, 8, 12, 16, 20]), { ...defaultWind, exposure: "B" });
  for (let k = 1; k < r.levels.length; k++) assert.ok(r.levels[k].pW >= r.levels[k - 1].pW);
  near(r.baseShear, r.levels.reduce((a, l) => a + l.F, 0), 1e-12, "ΣF");
  // ช่วงความสูงต่อเนื่องจาก z₁/2 ถึงยอด
  near(r.levels[0].zBot, 2, 1e-12, "zBot ชั้นแรก");
  near(r.levels[r.levels.length - 1].zTop, 20, 1e-12, "zTop");
});

test("applyWind สร้าง load case +X/−X เป็นแรงด้านข้าง ที่จุดต่อซ้ายสุด/ขวาสุด และแทนที่ของเดิม", () => {
  const m = frame([0, 3.5, 7]);
  applyWind(m, defaultWind);
  applyWind(m, { ...defaultWind, spacing: 6 });
  assert.equal(m.loadCases.length, 2);
  const [pos, neg] = m.loadCases;
  assert.ok(isLateralCase(pos) && isLateralCase(neg));
  assert.equal(pos.loads[0].type === "nodal" && pos.loads[0].node, "N1_0");
  assert.equal(neg.loads[0].type === "nodal" && neg.loads[0].node, "N1_1");
  assert.equal(m.wind?.spacing, 6);
});

test("เตือนเมื่อ H/D > 3", () => {
  const r = windForces(frame([0, 4, 8, 12, 16], [0, 4]), defaultWind);
  assert.ok(r.warnings.some((x) => x.includes("H/D")));
});
