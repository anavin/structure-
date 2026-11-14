import { test } from "node:test";
import assert from "node:assert/strict";
import { coef, designSlab, METHOD2, pickBar, rhoMin } from "../src/design/slab3d.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const all = { x0: true, x1: true, y0: true, y1: true };

test("ตารางวิธีที่ 2: ค่าที่คอลัมน์และการประมาณค่า", () => {
  near(coef(METHOD2[1].short.pos, 1.0), 0.025);
  near(coef(METHOD2[1].short.pos, 0.5), 0.062);
  near(coef(METHOD2[1].short.negC!, 0.85), (0.040 + 0.048) / 2);
  near(coef(METHOD2[5].short.pos, 0.3), 0.083);
});

test("แผ่นกลาง 4×5 m: กรณี 1, M = C·wu·S², เหล็กไม่น้อยกว่าขั้นต่ำ", () => {
  const r = designSlab({ code: "EIT", Lx: 4, Ly: 5, t: 0.12, edges: all, wD: 3.86, wL: 1.96, fcKsc: 240, fyKsc: 4000 });
  assert.equal(r.caseNo, 1);
  assert.equal(r.oneWay, false);
  near(r.m, 0.8);
  const wu = 1.4 * 3.86 + 1.7 * 1.96;
  near(r.wu, wu);
  near(r.short.pos.Mu, 0.036 * wu * 16);
  near(r.short.negC!.Mu, 0.048 * wu * 16);
  assert.equal(r.short.negD, null);
  near(r.long.pos.Mu, 0.025 * wu * 16);
  for (const b of [r.short.pos, r.short.negC!, r.long.pos]) assert.ok(b.As >= Math.max(b.AsReq, rhoMin(4000) * 1000 * 120) - 1e-6);
  assert.ok(r.short.pos.s <= 240);
  near(r.tMin, (2 * 9 * 1000) / 180);
  assert.ok(r.ok);
});

test("แผ่นมุม: กรณี 3 มีลบที่ขอบไม่ต่อเนื่อง · แผ่นบางเกินไม่ผ่าน · พื้นทางเดียว", () => {
  const r = designSlab({ code: "EIT", Lx: 4, Ly: 4, t: 0.12, edges: { x0: false, x1: true, y0: false, y1: true }, wD: 3.86, wL: 1.96, fcKsc: 240, fyKsc: 4000 });
  assert.equal(r.caseNo, 3);
  assert.ok(r.short.negD && r.short.negC && r.long.negD);
  const thin = designSlab({ code: "EIT", Lx: 6, Ly: 6, t: 0.1, edges: all, wD: 3.4, wL: 2, fcKsc: 240, fyKsc: 4000 });
  assert.equal(thin.ok, false);
  const one = designSlab({ code: "EIT", Lx: 2, Ly: 6, t: 0.12, edges: all, wD: 3.86, wL: 1.96, fcKsc: 240, fyKsc: 4000 });
  assert.ok(one.oneWay);
  near(one.short.pos.Mu, one.wu * 4 / 16);
});

test("เลือกเหล็ก: ขนาดเล็กสุดที่ระยะ ≥ 100 mm ไม่เกิน smax", () => {
  const p = pickBar(300, 240, 4000);
  assert.equal(p.dia, 10);
  assert.equal(p.s, 250 > 240 ? 240 : 250);
  assert.ok(p.As >= 300);
});

import { defaultGrid } from "../src/app3d/generator.ts";
import { designBuildingSlabs } from "../src/design/slab3d.ts";
import { defaultSlab } from "../src/app3d/generator.ts";

test("แผ่นพื้นทั้งอาคาร: นับครบทุกช่องทุกชั้น และขอบต่อเนื่องตามตำแหน่ง", () => {
  const types = designBuildingSlabs({ ...defaultGrid, slab: { ...defaultSlab, enabled: true } }, "EIT");
  const n = types.reduce((a, t) => a + t.panels.length, 0);
  assert.equal(n, 3 * 2 * 4); // 3×2 ช่อง × 4 ชั้น
  assert.ok(types.every((t, k) => t.mark === `S-${k + 1}`));
  // กริด 3×2: ไม่มีแผ่นกลาง (ทุกแผ่นอยู่ริม) → กรณี ≥ 2
  assert.ok(types.every((t) => t.result.caseNo >= 2));
  assert.deepEqual(designBuildingSlabs(defaultGrid, "EIT"), []);
});
