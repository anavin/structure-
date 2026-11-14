import { test } from "node:test";
import assert from "node:assert/strict";
import { designRcBeam, type BeamDesignInput } from "../src/design/rcBeam.ts";

const base: BeamDesignInput = {
  code: "EIT", b: 250, h: 500, cover: 40, fcKsc: 240, fyKsc: 4000, fytKsc: 2400,
  stirrupDia: 9, stirrupLegs: 2, MuPos: 100, MuNeg: 0, Vu: 80,
};

test("คาน 25×50 cm, Mu=100 kN·m (คำนวณมือ: As≈680 mm² → 4DB16)", () => {
  const r = designRcBeam(base);
  assert.ok(Math.abs(r.bottom.AsReq - 680.4) < 1.5, `As=${r.bottom.AsReq}`);
  assert.deepEqual(r.bottom.bars, { n: 4, dia: 16 });
  assert.ok(r.bottom.phiMn >= 100);
  assert.ok(r.ok);
});

test("แรงเฉือน Vu=80 kN: ควบคุมด้วย s ≤ d/2 → RB9@0.200", () => {
  const r = designRcBeam(base);
  assert.equal(r.shear.spacing, 200);
  assert.ok(Math.abs(r.shear.phiVc - 77.6) < 0.2, `φVc=${r.shear.phiVc}`);
});

test("หน้าตัดเล็กเกินไปต้องแจ้งเตือน", () => {
  const r = designRcBeam({ ...base, MuPos: 500 });
  assert.equal(r.bottom.ok, false);
  assert.equal(r.ok, false);
});

test("ACI 318-19 ใช้ φ เฉือน 0.75 (φVc น้อยกว่า วสท.)", () => {
  const eit = designRcBeam(base), aci = designRcBeam({ ...base, code: "ACI" });
  assert.ok(aci.shear.phiVc < eit.shear.phiVc);
  assert.ok(Math.abs(aci.shear.phiVc / eit.shear.phiVc - 0.75 / 0.85) < 1e-9);
});

test("โมเมนต์ลบเป็นศูนย์ → 2DB12 เหล็กยึดปลอก", () => {
  const r = designRcBeam(base);
  assert.deepEqual(r.top.bars, { n: 2, dia: 12 });
});
