import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, generateBuilding, parseSpacing, windStoreys } from "../src/app3d/generator.ts";
import { analyzeCombo3, runAll3, storeyDrifts } from "../src/core3d/combos3d.ts";
import { defaultWind } from "../src/loads/windTH.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-9), `${msg}: ได้ ${a} คาด ${b}`);

test("parseSpacing: '3@5, 4' → [5,5,5,4]; ค่าผิดต้องแจ้ง", () => {
  assert.deepEqual(parseSpacing("3@5, 4"), [5, 5, 5, 4]);
  assert.throws(() => parseSpacing("a"), /ไม่ถูกต้อง/);
});

test("สร้างอาคาร 3×2 ช่วง 4 ชั้น: จำนวนจุดต่อ/ชิ้นส่วน/diaphragm ถูกต้อง", () => {
  const { model } = generateBuilding(defaultGrid);
  assert.equal(model.nodes.length, 4 * 3 * 5);
  const cols = model.members.filter((m) => m.kind === "column").length;
  const beams = model.members.filter((m) => m.kind === "beam").length;
  assert.equal(cols, 12 * 4);
  assert.equal(beams, 4 * (3 * 3 + 4 * 2));
  assert.equal(model.diaphragms?.length, 4);
});

test("แรงลมรายชั้น: ลม X ใช้ความกว้าง Y; ชั้นเดียว ภูมิประเทศ A = (pW+pL)·B·h/2", () => {
  const w = { ...defaultWind, exposure: "A" as const };
  const r = windStoreys([3.5], 10, 6, w, ["D1"]);
  const per = 0.390625 * 0.9 * 2 * (0.8 + 0.5) * 1.75;
  near(r[0].FX, per * 6, 1e-9, "FX");
  near(r[0].FY, per * 10, 1e-9, "FY");
});

test("วิเคราะห์อาคารตัวอย่าง: ΣRz = แรงแนวดิ่งทั้งหมด, แรงเฉือนฐาน WX = ΣF ลม, drift เพิ่มตามความสูง", () => {
  const { model, wind } = generateBuilding(defaultGrid);
  const r = analyzeCombo3(model, { DL: 1 });
  near(Object.values(r.reactions).reduce((a, x) => a + x.fz, 0), -r.appliedTotal.fz, 1e-9, "ΣRz");
  const rw = analyzeCombo3(model, { WX: 1 });
  near(-Object.values(rw.reactions).reduce((a, x) => a + x.fx, 0), wind.reduce((a, l) => a + l.FX, 0), 1e-4, "แรงเฉือนฐาน (แรงปัดเศษ 3 ตำแหน่ง)");
  const d = storeyDrifts(model, rw);
  assert.equal(d.length, 4);
  for (let k = 1; k < d.length; k++) assert.ok(d[k].ux > d[k - 1].ux);
  assert.ok(Math.abs(d[0].uy) < 1e-9, "ลม X ไม่ทำให้เคลื่อนในแกน Y (อาคารสมมาตร)");
  const all = runAll3(model);
  assert.equal(Object.keys(all.results).length, model.loadCases.length + model.combos.length);
});
