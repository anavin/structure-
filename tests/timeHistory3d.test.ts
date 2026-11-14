import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, generateBuilding } from "../src/app3d/generator.ts";
import { modalAnalysis } from "../src/core3d/modal3d.ts";
import { modalTimeHistory, thResultAt } from "../src/core3d/timeHistory3d.ts";
import { sdofPeak, syntheticMotion } from "../src/loads/groundMotion.ts";
import { defaultSeismic, Sa, spectrum } from "../src/loads/seismicTH.ts";

test("ประวัติเวลาอาคารชั้นเดียว: ยอดเคลื่อนตัวสูงสุด = Sd(T1) ของคลื่น และแรงเฉือนฐาน = M·Sa", () => {
  const { model } = generateBuilding({ ...defaultGrid, storeys: "4", pDelta: false });
  const W = 1200;
  const modal = modalAnalysis(model, [W], { Bx: 15, By: 9 }, 3);
  const spec = spectrum({ ...defaultSeismic });
  const gm = syntheticMotion((T) => Sa(spec, T), { duration: 15 });
  const th = modalTimeHistory(modal, gm, "X");
  const T1 = modal.modes.find((m) => m.dir === "X")!.T;
  const ref = sdofPeak(gm.ag.map((a) => a * 9.80665), gm.dt, T1);
  assert.ok(Math.abs(th.max.roof - ref.umax) / ref.umax < 0.01, `${th.max.roof} vs ${ref.umax}`);
  assert.ok(Math.abs(th.max.V - (W / 9.80665) * ref.Sa) / th.max.V < 0.01);
  assert.equal(th.driftMax.length, 1);
  // ผลทั้งโครง ณ เวลาสูงสุด: การเคลื่อนตัวจุดอ้างอิงตรงกับ roof
  const r = thResultAt(th, Math.round(th.max.tRoof / gm.dt));
  const dia = model.diaphragms![0].id;
  assert.ok(Math.abs(Math.abs(r.diaphragms[dia].ux) - th.max.roof) / th.max.roof < 1e-6);
});
