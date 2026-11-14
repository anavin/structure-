import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSeismic, kExponent, Sa, seismicForces, siteFa, siteFv, spectrum } from "../src/loads/seismicTH.ts";

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test("Fa/Fv: ประมาณค่าในช่วงและค่าปลาย", () => {
  near(siteFa("D", 0.6), 1.4 + (1.2 - 1.4) * 0.4); // 1.32
  near(siteFa("D", 0.1), 1.6);
  near(siteFa("D", 2.0), 1.0);
  near(siteFv("D", 0.25), 1.9);
  near(siteFv("B", 0.33), 1.0);
});

test("สเปกตรัม: SDS, SD1, T0, Ts และ Sa แต่ละช่วง", () => {
  const p = spectrum({ ...defaultSeismic, Ss: 0.6, S1: 0.2, site: "D" });
  near(p.SDS, (2 / 3) * 1.32 * 0.6);
  near(p.SD1, (2 / 3) * 2.0 * 0.2);
  near(p.Ts, p.SD1 / p.SDS);
  near(p.T0, 0.2 * p.Ts);
  near(Sa(p, 0), 0.4 * p.SDS);
  near(Sa(p, (p.T0 + p.Ts) / 2), p.SDS);
  near(Sa(p, 2), p.SD1 / 2);
});

test("k: 1 → 2 เชิงเส้นระหว่าง 0.5–2.5 s", () => {
  near(kExponent(0.3), 1);
  near(kExponent(1.5), 1.5);
  near(kExponent(3), 2);
});

test("V = Cs·W, ΣF = V และการกระจายเป็นสามเหลี่ยมเมื่อ k = 1", () => {
  const s = { ...defaultSeismic, Ss: 0.6, S1: 0.2, site: "D" as const, R: 3, Ie: 1 };
  const r = seismicForces(s, [{ z: 3, W: 1000 }, { z: 6, W: 1000 }, { z: 9, W: 800 }]);
  near(r.T, 0.18);
  assert.equal(r.k, 1);
  const spec = spectrum(s);
  near(r.Cs, Sa(spec, 0.18) / 3);
  near(r.W, 2800);
  near(r.V, r.Cs * 2800);
  near(r.levels.reduce((a, l) => a + l.F, 0), r.V, 1e-9);
  const den = 1000 * 3 + 1000 * 6 + 800 * 9;
  near(r.levels[2].F, (800 * 9 / den) * r.V);
});

test("Cs ไม่ต่ำกว่า 0.01 และใช้คาบที่กำหนดเอง", () => {
  const r = seismicForces({ ...defaultSeismic, Ss: 0.05, S1: 0.02, R: 8, Tuser: 3 }, [{ z: 50, W: 100 }]);
  near(r.T, 3);
  near(r.Cs, 0.01);
  assert.equal(r.k, 2);
});

import { defaultGrid, generateBuilding, storeyWeights } from "../src/app3d/generator.ts";

test("generator: EX/EY รวมแรง = V, แรงบิด 5%, ชุดผสมเพิ่ม 8 ชุด", () => {
  const p = { ...defaultGrid, seismic: { ...defaultSeismic, enabled: true } };
  const { model, seismic } = generateBuilding(p);
  assert.ok(seismic);
  const ex = model.loadCases.find((c) => c.id === "EX")!;
  assert.ok(ex.lateral);
  const sum = ex.loads.reduce((a, l) => a + (l.type === "nodal" ? l.fx : 0), 0);
  near(sum, seismic.result.V, 0.01);
  const l0 = ex.loads[0];
  if (l0.type === "nodal") near(l0.mz, l0.fx * 0.05 * 9, 0.01); // By = 2@4.5
  assert.equal(model.combos.length, 9 + 8);
  // น้ำหนักชั้นล่าง: คาน 3 แถว×15 + 4 แถว×9 = 81 m
  const W = storeyWeights(p, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25);
  near(W[0], (24 * 0.25 * 0.5 + 15 + 0.25 * 8) * 81 + 24 * 0.16 * 12 * (2 + 1.75), 1e-6);
  assert.equal(generateBuilding(defaultGrid).seismic, null);
});
