import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBiaxial, designBiaxial, phiPnMaxBiax, type BiaxSection } from "../src/design/rcColumnBiaxial.ts";
import { interactionDiagram, phiMnAt, type ColumnSection } from "../src/design/rcColumn.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${msg}: ได้ ${a} คาด ${b}`);

const s: BiaxSection = { code: "EIT", b: 300, h: 300, cover: 40, tieDia: 9, fcKsc: 240, fyKsc: 4000 };
const l4 = { dia: 16, n2: 2, n3: 2 };
const uni: ColumnSection = { code: "EIT", b: 300, h: 300, cover: 40, tieDia: 9, fcKsc: 240, fyKsc: 4000, fytKsc: 2400 };

test("แกนเดียว (M22 = 0) ตรงกับแผนภาพ P–M เดิม: Pu = 0 และ Pu = 800 kN", () => {
  const dg = interactionDiagram(uni, { dia: 16, nFace: 2, nSide: 0 });
  for (const Pu of [0, 800]) {
    const ref = phiMnAt(dg.points, Pu);
    const c = checkBiaxial(s, l4, Pu, 10, 0);
    near(c.phiMn, ref, 0.01, `φMn ที่ Pu = ${Pu}`);
    assert.ok(Math.abs(c.phiM2) < 0.01, `M22 ≈ 0 (ได้ ${c.phiM2})`);
  }
});

test("φPn,max = 0.8·0.70·P0 และหน้าตัดสมมาตร: M33 อย่างเดียว = M22 อย่างเดียว", () => {
  near(phiPnMaxBiax(s, l4), 0.8 * 0.7 * 2099.9, 1e-3, "φPn,max");
  const a = checkBiaxial(s, l4, 300, 20, 0), b = checkBiaxial(s, l4, 300, 0, 20);
  near(a.phiMn, b.phiMn, 1e-6, "สมมาตร");
});

test("ดัดสองแกนที่ 45°: กำลังรวมน้อยกว่าแกนเดียวแต่มากกว่าเส้นตรง (load contour)", () => {
  const Pu = 300;
  const one = checkBiaxial(s, l4, Pu, 1, 0).phiMn;
  const diag = checkBiaxial(s, l4, Pu, 1, 1);
  assert.ok(diag.phiMn < one, `${diag.phiMn} < ${one}`);
  // เส้นตรง Mx/φMnx + My/φMny = 1 ที่ 45° ให้ |M| = φMn/√2
  assert.ok(diag.phiMn > one / Math.SQRT2, `${diag.phiMn} > ${one / Math.SQRT2}`);
  near(Math.atan2(diag.phiM2, diag.phiM3), Math.PI / 4, 1e-4, "ทิศโมเมนต์ตรงกับแรงกระทำ");
});

test("ออกแบบ: เลือกเหล็กที่ผ่านทุกกรณีและ ρ อยู่ในช่วง 1–4%", () => {
  const d = designBiaxial(s, [
    { combo: "U1", end: "i", Pu: 900, M3: 30, M2: 10 },
    { combo: "U2", end: "j", Pu: 500, M3: 15, M2: 45 },
  ]);
  assert.ok(d.ok, d.message);
  assert.ok(d.ratio <= 1 && d.rho >= 0.01 && d.rho <= 0.04);
  const bad = designBiaxial(s, [{ combo: "U1", end: "i", Pu: 2500, M3: 0, M2: 0 }]);
  assert.equal(bad.ok, false);
});
