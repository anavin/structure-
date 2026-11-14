import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, generateBuilding } from "../src/app3d/generator.ts";
import { runAll3 } from "../src/core3d/combos3d.ts";
import { defaultDesign3, design3d } from "../src/design/design3d.ts";
import { pushover } from "../src/design/pushover3d.ts";

test("Pushover อาคารชั้นเดียว: กลไกการพังแบบโยก V·h = ΣMp (งานเสมือน) และแรงเพิ่มขึ้นทุกขั้น", () => {
  // 1 ช่วง × 1 ช่วง สูง 3.5 m ไม่มีน้ำหนักบนคาน (คานไม่ต้องรับแรงเฉือนจากน้ำหนัก)
  const p = { ...defaultGrid, xSpacing: "5", ySpacing: "5", storeys: "3.5", sdl: 0, ll: 0, sdlRoof: 0, llRoof: 0, pDelta: false };
  const { model } = generateBuilding(p);
  const run = runAll3(model);
  const ds = design3d(model, run, defaultDesign3);
  // ไม่คิดแรงเฉือนคาน (ให้พังแบบดัด)
  for (const d of Object.values(ds)) if (d.kind === "beam") d.result.shear = { ...d.result.shear, phiVc: 1e9 };
  const r = pushover(model, ds, { dir: "X", pattern: "seismic", forces: [1], Vdesign: 100, driftLimit: 0.2 });
  assert.equal(r.end, "mechanism");
  for (let k = 1; k < r.steps.length; k++) assert.ok(r.steps[k].V >= r.steps[k - 1].V - 1e-9);
  const sumMp = r.hinges.reduce((a, h) => a + h.Mp, 0);
  const Vc = r.steps[r.steps.length - 1].V;
  assert.ok(Math.abs(Vc * 3.5 - sumMp) / sumMp < 0.03, `V·h ${Vc * 3.5} vs ΣMp ${sumMp}`);
  assert.ok(r.hinges.length >= 4);
});
