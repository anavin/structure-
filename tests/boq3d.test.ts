import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, generateBuilding } from "../src/app3d/generator.ts";
import { runAll3 } from "../src/core3d/combos3d.ts";
import { defaultDesign3, design3d } from "../src/design/design3d.ts";
import { barKgPerM, boq3d, boqCost, defaultPrices } from "../src/design/boq3d.ts";
import { designFoundations3 } from "../src/design/foundation3d.ts";
import { defaultFoundation } from "../src/design/footing.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test("น้ำหนักเหล็กต่อเมตร 0.00617d²", () => {
  near(barKgPerM(12), 0.888, 1e-3);
  near(barKgPerM(25), 3.856, 1e-3);
});

test("BOQ: ปริมาณคอนกรีต/แบบหล่อเทียบมือ และเหล็กครบทุกชิ้น", () => {
  const { model } = generateBuilding(defaultGrid); // 3@5 × 2@4.5, ชั้น 4 + 3@3.5, เสา 40×40, คาน 25×50
  const run = runAll3(model);
  const design = design3d(model, run, defaultDesign3);
  const ft = designFoundations3(model, run, defaultFoundation, "EIT").footings;
  const b = boq3d(model, design, ft, { cover: 40 });
  const g = (n: string) => b.rows.find((r) => r.group === n)!;
  near(g("เสา").conc, 12 * 0.16 * 14.5);
  assert.equal(g("เสา").count, 48);
  // คาน X: 36 ตัว ช่วงสุทธิ 4.6 m, คาน Y: 32 ตัว ช่วงสุทธิ 4.1 m
  near(g("คาน").conc, 36 * 0.25 * 0.5 * 4.6 + 32 * 0.25 * 0.5 * 4.1);
  near(g("คาน").form, 36 * (2 * 0.5 + 0.25) * 4.6 + 32 * (2 * 0.5 + 0.25) * 4.1);
  near(g("ฐานราก").conc, Object.values(ft).reduce((a, x) => a + x.L * x.B * x.t, 0));
  assert.ok(Object.keys(g("คาน").steel).length >= 2 && g("เสา").steel && g("ฐานราก").steel);
  near(b.total.steelKg, Object.values(b.total.steel).reduce((a, v) => a + v, 0));
  // เหล็กเฉลี่ยต่อคอนกรีตอยู่ในช่วงที่สมเหตุสมผลสำหรับอาคาร ค.ส.ล. (60–250 kg/m³)
  const ratio = b.total.steelKg / b.total.conc;
  assert.ok(ratio > 60 && ratio < 250, `เหล็ก ${ratio.toFixed(0)} kg/m³`);
  const cost = boqCost(b, defaultPrices);
  near(cost.total, b.total.conc * 2600 + b.total.form * 350 + b.total.steelKg * 28);
});

test("BOQ: มีพื้น → คานลึกใต้พื้น และนับคอนกรีตพื้น", () => {
  const { model } = generateBuilding(defaultGrid);
  const b0 = boq3d(model, {}, null, { cover: 40 });
  const b1 = boq3d(model, {}, null, { cover: 40, slabT: 0.12 });
  const g = (b: typeof b0, n: string) => b.rows.find((r) => r.group === n)!;
  near(g(b1, "คาน").conc, g(b0, "คาน").conc * (0.38 / 0.5));
  near(g(b1, "พื้น").conc, 4 * 15 * 9 * 0.12);
});
