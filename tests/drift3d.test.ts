import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGrid, generateBuilding } from "../src/app3d/generator.ts";
import { runAll3, storeyDrifts } from "../src/core3d/combos3d.ts";
import { checkDrifts, defaultDrift } from "../src/design/drift3d.ts";
import { defaultSeismic } from "../src/loads/seismicTH.ts";

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test("drift ลม: ใช้ Δ/h ของ WX/WY เทียบเกณฑ์", () => {
  const { model } = generateBuilding(defaultGrid);
  const run = runAll3(model);
  const c = checkDrifts(model, run, { ...defaultDrift, windLimit: 1 / 500 });
  const d = storeyDrifts(model, run.results["case:WX"]);
  assert.equal(c.wind.length, 4);
  near(c.wind[0].dx, Math.abs(d[0].driftX));
  assert.equal(c.eq.length, 0); // ไม่เปิดแผ่นดินไหว
  const strict = checkDrifts(model, run, { ...defaultDrift, windLimit: 1e-6 });
  assert.equal(strict.ok, false);
});

test("drift แผ่นดินไหว: Δ = Cd·δe/Ie, แรงเฉือนชั้นสะสม และ θ", () => {
  const p = { ...defaultGrid, seismic: { ...defaultSeismic, enabled: true } };
  const { model, seismic } = generateBuilding(p);
  const run = runAll3(model);
  const c = checkDrifts(model, run, { ...defaultDrift, Cd: 2.5, Ie: 1.25 });
  assert.equal(c.eq.length, 4);
  const r = c.eq[0];
  near(r.DX, 2.5 * r.deX / 1.25);
  near(r.limit, 0.02 * 4);
  near(r.VX, seismic!.result.V, 1e-3);            // ชั้นล่างรับแรงเฉือนทั้งหมด
  near(c.eq[3].VX, seismic!.levels[3].F, 1e-3);    // ชั้นบนสุดรับเฉพาะแรงชั้นบน
  near(r.thetaX, r.Px * r.DX * 1.25 / (r.VX * 4 * 2.5));
  near(r.thetaMax, 0.2);
  assert.ok(r.Px > c.eq[3].Px);                    // แรงตามแกนสะสมจากชั้นบน
});
