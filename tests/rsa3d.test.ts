import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, generateBuilding } from "../src/app3d/generator.ts";
import { runAll3 } from "../src/core3d/combos3d.ts";
import { cqcRho, responseSpectrum, type RsaResult3 } from "../src/core3d/rsa3d.ts";
import { modalAnalysis } from "../src/core3d/modal3d.ts";
import { defaultSeismic, Sa, spectrum } from "../src/loads/seismicTH.ts";
import { checkDrifts } from "../src/design/drift3d.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test("CQC: ρii = 1, สมมาตร, ลดลงเมื่อความถี่ห่างกัน", () => {
  near(cqcRho(10, 10), 1);
  near(cqcRho(10, 12), cqcRho(12, 10), 1e-3);
  assert.ok(cqcRho(10, 20) < 0.02);
});

test("อาคารชั้นเดียว: RSA แรงเฉือนฐาน = Sa(T1)·W·Ie/R (มวลประสิทธิผล 100% ในโหมดเดียว)", () => {
  const p = { ...defaultGrid, storeys: "4", pDelta: false };
  const { model } = generateBuilding(p);
  const W = 1500;
  const res = modalAnalysis(model, [W], { Bx: 15, By: 9 }, 3);
  const spec = spectrum({ ...defaultSeismic });
  const r = responseSpectrum(res, "X", (T) => Sa(spec, T), 1, 3);
  const T1 = res.modes.find((m) => m.dir === "X")!.T;
  near(r.V, (Sa(spec, T1) * W) / 3, 1e-3);
  near(r.mass, 1, 1e-6);
});

test("อาคาร 4 ชั้นแบบ RSA: ผล EX ถูกแทน ปรับแรงเฉือนฐาน ≥ 85% ของวิธีสถิต และ drift ใช้ CQC", () => {
  const p = { ...defaultGrid, seismic: { ...defaultSeismic, enabled: true, method: "RSA" as const } };
  const { model, seismic } = generateBuilding(p);
  assert.ok(model.rsa);
  const run = runAll3(model);
  const ex = (run.results["case:EX"] as RsaResult3).rsa!;
  assert.ok(ex);
  assert.ok(ex.V >= 0.85 * seismic!.result.V - 1e-6);
  near(ex.mass, 1, 1e-6);
  assert.equal(ex.drifts.length, 4);
  // ชุดผสม + และ − ต่างกันที่เครื่องหมายผล E: เฉลี่ยได้ผลชุดที่ไม่มี E
  const plus = run.results["combo:U14"].members["C-A1-0"].endForces[0], minus = run.results["combo:U15"].members["C-A1-0"].endForces[0];
  assert.ok(Math.abs(plus - minus) > 1);
  const dc = checkDrifts(model, run, { windLimit: 1 / 500, eqLimit: 0.02, Cd: 2.5, Ie: 1 });
  near(dc.eq[0].deX, ex.drifts[0], 1e-9);
  // วิธีสถิตยังทำงานตามเดิม
  const elf = generateBuilding({ ...p, seismic: { ...p.seismic, method: "ELF" } });
  assert.equal(elf.model.rsa, undefined);
});
