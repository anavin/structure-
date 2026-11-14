// ทดสอบกันถดถอยจากการตรวจระบบ (พ.ย. 2569): กรณีที่เคยรายงานผ่านทั้งที่ไม่ผ่าน
import { test } from "node:test";
import assert from "node:assert/strict";
import { designRcBeam } from "../src/design/rcBeam.ts";
import { designFooting, defaultFoundation } from "../src/design/footing.ts";
import { designFooting3 } from "../src/design/footing3d.ts";
import { designSlab } from "../src/design/slab3d.ts";
import { sanitizeLike } from "../src/shared/sanitize.ts";
import { cleanParams3D } from "../src/shared/frameFrom3d.ts";
import { defaultGrid, generateBuilding } from "../src/app3d/generator.ts";
import { runAll3 } from "../src/core3d/combos3d.ts";
import { defaultDesign3, design3d } from "../src/design/design3d.ts";

test("คาน: ปลอกที่ต้องการถี่กว่า 75 mm ต้องไม่ผ่าน (ไม่ปัดขึ้นแล้วบอกผ่าน)", () => {
  const r = designRcBeam({ code: "EIT", b: 200, h: 400, cover: 40, fcKsc: 240, fyKsc: 4000, fytKsc: 2400, stirrupDia: 9, stirrupLegs: 2, MuPos: 10, MuNeg: 10, Vu: 200 });
  assert.equal(r.shear.ok, false);
  assert.equal(r.ok, false);
  assert.match(r.shear.message, /75 mm/);
});

test("เสา 3D: ตรวจแรงเฉือนสองทิศ และรวมในอัตราส่วน", () => {
  const p = { ...defaultGrid, wind: { ...defaultGrid.wind, V50: 60 } }; // ลมแรงมากให้เสารับแรงเฉือนสูง
  const { model } = generateBuilding(p);
  const d = design3d(model, runAll3(model), defaultDesign3);
  const c = Object.values(d).find((x) => x.kind === "column")!;
  assert.ok(c.kind === "column" && c.shear && c.shear.Vu > 0 && c.shear.phiVn > 0);
  if (c.kind === "column") assert.ok(c.ratio >= c.shear!.ratio - 1e-12);
});

test("ฐานแผ่ 2D: แรงประลัยที่ทำให้ฐานยกหรือแรงลัพธ์นอกฐาน → ไม่ผ่าน", () => {
  const base = { code: "EIT" as const, c1: 0.3, c2: 0.3, fcKsc: 240, fyKsc: 4000, settings: { ...defaultFoundation, type: "spread" as const }, service: [{ name: "D+L", P: 300, M: 5, H: 0, wind: false }] };
  assert.equal(designFooting({ ...base, strength: [{ name: "0.9D−1.3W", Pu: -20, Mu: 60, Hu: 0 }] }).ok, false);
  assert.equal(designFooting({ ...base, strength: [{ name: "U", Pu: 100, Mu: 200, Hu: 0 }] }).ok, false);
  assert.equal(designFooting({ ...base, strength: [{ name: "U", Pu: 420, Mu: 7, Hu: 0 }] }).ok, true);
});

test("ฐานเข็ม 3D: เข็มแถวเดียวรับโมเมนต์ประลัยตั้งฉากแถวไม่ได้ → เลือกวางเข็มหลายแถว", () => {
  const r = designFooting3({
    code: "EIT", cx: 0.3, cy: 0.3, fcKsc: 240, fyKsc: 4000, settings: { ...defaultFoundation, type: "pile" },
    service: [{ name: "S", P: 500, Mx: 15, My: 0, Hx: 0, Hy: 0 }],
    strength: [{ name: "U", P: 300, Mx: 150, My: 0, Hx: 0, Hy: 0 }],
  });
  assert.ok(r.piles && r.piles.ny >= 2, `วางเข็ม ${r.piles?.nx}×${r.piles?.ny}`);
});

test("พื้นทางเดียวช่วงเดี่ยว (ไม่ต่อเนื่องสองขอบ) ใช้ wL²/8", () => {
  const r = designSlab({ code: "EIT", Lx: 3, Ly: 6.2, t: 0.15, wD: 4.6, wL: 2, fcKsc: 240, fyKsc: 4000, edges: { x0: false, x1: false, y0: false, y1: false } });
  const wu = r.wu;
  assert.ok(Math.abs(r.short.pos!.Mu - (wu * 9) / 8) < 1e-6, `Mu ${r.short.pos!.Mu} vs ${(wu * 9) / 8}`);
});

test("ข้อมูลจากไฟล์/ลิงก์: ข้อความแปลกปลอมในช่องตัวเลขถูกแทนด้วยค่าตั้งต้น และพารามิเตอร์ใช้งานได้", () => {
  const d = sanitizeLike({ ...defaultDesign3 }, { cover: '"><img src=x onerror=alert(1)>', stirrupLegs: "4", code: "ACI" });
  assert.equal(d.cover, defaultDesign3.cover);
  assert.equal(d.stirrupLegs, 4);
  const p = cleanParams3D({ ...defaultGrid, name: 'A<script>"', info: { owner: 1 }, wind: { zone: "zz" }, xSpacing: "3@5", roof: { enabled: true, covering: "x" } });
  assert.equal(p.name, "Ascript");
  assert.equal(typeof p.info!.owner, "string");
  assert.equal(p.wind.zone, defaultGrid.wind.zone);
  assert.equal(p.roof!.covering, "metal");
  assert.doesNotThrow(() => generateBuilding(p));
});
