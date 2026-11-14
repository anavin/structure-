import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, generateBuilding, standardCombos3 } from "../src/app3d/generator.ts";
import { defaultSeismic } from "../src/loads/seismicTH.ts";

test("ชุดผสมมาตรฐาน วสท. และ ACI (ลมระดับใช้งาน 1.6W, แผ่นดินไหว 1.0E)", () => {
  const eit = standardCombos3("EIT", true), aci = standardCombos3("ACI", true);
  assert.equal(eit.length, 1 + 4 + 4 + 4 + 4);
  assert.equal(aci.length, 2 + 4 + 4 + 4 + 4);
  assert.deepEqual(aci[0].factors, { DL: 1.4 });
  assert.deepEqual(aci[1].factors, { DL: 1.2, LL: 1.6 });
  assert.ok(aci.some((c) => c.factors.WX === 1.6 && c.factors.LL === 1.0 && c.factors.DL === 1.2));
  assert.ok(aci.some((c) => c.factors.EY === -1 && c.factors.DL === 0.9));
  assert.ok(eit.some((c) => c.factors.EX === 1.4025));
  assert.equal(standardCombos3("ACI", false).length, 10);
  assert.deepEqual(aci.map((c) => c.id), aci.map((_, i) => `U${i + 1}`));
});

test("generator: ชุดผสมตามมาตรฐานที่ส่งเข้า และชุดที่ผู้ใช้กำหนดเอง (ตัด load case ที่ไม่มีออก)", () => {
  assert.equal(generateBuilding(defaultGrid, "ACI").model.combos[0].name, "1.4D");
  assert.equal(generateBuilding(defaultGrid).model.combos[0].name, "1.4D + 1.7L");
  const custom = [{ id: "U1", name: "D + L", factors: { DL: 1, LL: 1 } }, { id: "U2", name: "D + EX", factors: { DL: 1, EX: 1 } }];
  const m = generateBuilding({ ...defaultGrid, combos: custom }).model;
  assert.equal(m.combos.length, 2);
  assert.deepEqual(m.combos[1].factors, { DL: 1 }); // ไม่มี EX เพราะปิดแผ่นดินไหว
  const m2 = generateBuilding({ ...defaultGrid, combos: custom, seismic: { ...defaultSeismic, enabled: true } }).model;
  assert.deepEqual(m2.combos[1].factors, { DL: 1, EX: 1 });
});

test("ลมเยื้องศูนย์: TWX/TWY = F·0.15B ต่อชั้น และชุดผสม 0.75W ± 0.75TW", async () => {
  const { parseSpacing } = await import("../src/app3d/generator.ts");
  const p = { ...defaultGrid, windTorsion: true, diaphragm: true };
  const { model, wind } = generateBuilding(p, "ACI");
  const twx = model.loadCases.find((c) => c.id === "TWX")!, twy = model.loadCases.find((c) => c.id === "TWY")!;
  assert.ok(twx && twy);
  const xs = parseSpacing(p.xSpacing).reduce((a, v) => a + v, 0);
  const ys = parseSpacing(p.ySpacing).reduce((a, v) => a + v, 0);
  const sumMz = (c: typeof twx) => c.loads.reduce((a, l) => a + (l.type === "nodal" ? l.mz : 0), 0);
  const sumF = (id: string, k: "fx" | "fy") => model.loadCases.find((c) => c.id === id)!.loads.reduce((a, l) => a + (l.type === "nodal" ? l[k] : 0), 0);
  assert.ok(Math.abs(sumMz(twx) - 0.15 * ys * sumF("WX", "fx")) < 0.05, "TWX");
  assert.ok(Math.abs(sumMz(twy) + 0.15 * xs * sumF("WY", "fy")) < 0.05, "TWY");
  assert.ok(wind.length > 0);
  // ACI: 8 ชุดลม → แต่ละชุดเพิ่ม 2 ชุด (0.75W ± บิด)
  assert.equal(model.combos.length, 10 + 16);
  const c = model.combos.find((x) => x.factors.TWX)!;
  assert.equal(Math.abs(c.factors.TWX), Math.abs(c.factors.WX));
  assert.ok(Math.abs(Math.abs(c.factors.WX) - 0.75 * 1.6) < 1e-12);
  // ปิดพื้นแข็ง → ไม่สร้าง
  assert.ok(!generateBuilding({ ...p, diaphragm: false }, "ACI").model.loadCases.some((x) => x.id === "TWX"));
});
