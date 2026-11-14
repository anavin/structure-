import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultFoundation, designFooting, pileForces, pileLayout, pressureAt, type FootingInput } from "../src/design/footing.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-9), `${msg}: ได้ ${a} คาด ${b}`);

const base = (over: Partial<FootingInput> = {}): FootingInput => ({
  code: "EIT", c1: 0.3, c2: 0.3, fcKsc: 240, fyKsc: 4000,
  settings: { ...defaultFoundation },
  service: [{ name: "D+L", P: 500, M: 0, H: 0, wind: false }],
  strength: [{ name: "U1", Pu: 750, Mu: 0, Hu: 0 }],
  ...over,
});

test("แรงดันดิน: ศูนย์กลาง = P/A; e > L/6 → สามเหลี่ยม qmax = 2P/(3B(L/2−e))", () => {
  near(pressureAt(400, 0, 2, 2, 0.3), 100, 1e-12, "q สม่ำเสมอ");
  const P = 400, B = 2, L = 2, e = 0.5, M = P * e;
  near(pressureAt(P, M, B, L, -L / 2), (2 * P) / (3 * B * (L / 2 - e)), 1e-12, "qmax ที่ขอบ −x");
  near(pressureAt(P, M, B, L, L / 2), 0, 1e-12, "ขอบที่ยก");
});

test("ฐานแผ่ P = 500 kN, qa = 15 t/m²: คำนวณมือ B = 2.10 m, t = 0.35 m (t = 0.30 ไม่ผ่านแรงเฉือนทะลุ)", () => {
  const r = designFooting(base());
  assert.equal(r.type, "spread");
  near(r.B, 2.1, 1e-9, "B");
  near(r.L, 2.1, 1e-9, "L");
  near(r.t, 0.35, 1e-9, "t");
  near(r.service[0].qmax, 500 / 4.41 + 24 * 0.35 + 18 * 1.15, 1e-9, "qmax");
  assert.ok(r.service[0].qmax <= 15 * 9.80665);
  assert.ok(r.crit.punch > 0.8 && r.crit.punch <= 1, `punch ratio ${r.crit.punch}`);
  assert.ok(r.ok, r.message);
});

test("ฐานแผ่รับโมเมนต์: ขนาดใหญ่ขึ้นและไม่ยกในกรณีแรงแนวดิ่ง (e ≤ L/6)", () => {
  const r0 = designFooting(base());
  const r = designFooting(base({ service: [{ name: "D+L", P: 500, M: 80, H: 0, wind: false }], strength: [{ name: "U1", Pu: 750, Mu: 120, Hu: 0 }] }));
  assert.ok(r.B > r0.B);
  assert.ok(Math.abs(r.service[0].e) <= r.L / 6 + 1e-12);
  assert.ok(r.ok, r.message);
});

test("แรงในเข็ม P/n ± M·x/Σx²: ผลรวม = P", () => {
  const lay = pileLayout(2, 2, 0.66, 0.25);
  const pf = pileForces(400, 100, lay);
  near(pf.reduce((a, b) => a + b, 0), 400, 1e-12, "ΣP");
  near(Math.max(...pf), 100 + (100 * 0.33) / (4 * 0.33 ** 2), 1e-12, "Pmax");
});

test("ฐานเข็ม P = 600 kN, Ra = 30 ตัน: 2 ต้นไม่พอ (309 > 294 kN) → 4 ต้น", () => {
  const r = designFooting(base({ settings: { ...defaultFoundation, type: "pile" }, service: [{ name: "D+L", P: 600, M: 0, H: 0, wind: false }], strength: [{ name: "U1", Pu: 900, Mu: 0, Hu: 0 }] }));
  assert.equal(r.piles?.coords.length, 4);
  assert.ok(r.service[0].qmax <= 30 * 9.80665);
  assert.ok(r.ok, r.message);
});

test("ฐานเข็มรับโมเมนต์ (กรณีลม ×1.33): 2 ต้น Pmax = 209 + 100·0.33/0.218 ≈ 360 ≤ 391 kN, ไม่มีแรงถอน", () => {
  const r = designFooting(base({ settings: { ...defaultFoundation, type: "pile" }, service: [{ name: "D+L+W", P: 400, M: 100, H: 0, wind: true }], strength: [{ name: "U2", Pu: 550, Mu: 150, Hu: 0 }] }));
  assert.equal(r.piles!.coords.length, 2);
  near(r.service[0].allow, 1.33 * 30 * 9.80665, 1e-9, "Ra ×1.33");
  const noWind = designFooting(base({ settings: { ...defaultFoundation, type: "pile" }, service: [{ name: "D+L+W", P: 400, M: 100, H: 0, wind: false }], strength: [{ name: "U2", Pu: 550, Mu: 150, Hu: 0 }] }));
  assert.equal(noWind.piles!.coords.length, 4, "ไม่เพิ่มค่ายอมให้ → 4 ต้น");
  assert.ok(r.service.every((s) => s.qmin >= 0));
  assert.ok(r.ok, r.message);
});

test("ดินรับน้ำหนักไม่ได้ (qa ต่ำเกิน) → ขนาดใหญ่มากแต่ยังผ่าน/หรือแจ้งเตือน ไม่ค้าง", () => {
  const r = designFooting(base({ settings: { ...defaultFoundation, qaTon: 3 } }));
  assert.ok(r.B > 3);
});
