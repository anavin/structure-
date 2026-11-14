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

// ---------- รอบที่ 2: ข้อปรับปรุง 6 ข้อ ----------
import { analyze } from "../src/core/frame2d.ts";
import { analyzeCase } from "../src/core/combos.ts";
import { analyzeCombo3 } from "../src/core3d/combos3d.ts";
import { punchRatio } from "../src/design/footing.ts";
import { defaultSlab, storeyWeights, storeyWeightsModel } from "../src/app3d/generator.ts";
import { frameFrom3D } from "../src/shared/frameFrom3d.ts";

test("แรงแผ่เป็นช่วง (สามเหลี่ยม): โมเมนต์ w0L²/12 และแรงปฏิกิริยา w0L/4 ตรงสูตรปิด", () => {
  const L = 6, w0 = 10;
  const model = { name: "t", nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: L, y: 0 }], members: [{ id: "m", i: "a", j: "b", section: "S", kind: "beam" as const }],
    supports: [{ node: "a", ux: true, uy: true, rz: false }, { node: "b", ux: false, uy: true, rz: false }],
    materials: [{ id: "M", name: "m", E: 2e7, gamma: 0 }], sections: [{ id: "S", name: "s", material: "M", b: 0.3, h: 0.5 }], loadCases: [], combos: [] };
  const r = analyze(model, [{ type: "dist", member: "m", dir: "globalY", pts: [[0, 0], [L / 2, -w0], [L, 0]] }]);
  assert.ok(Math.abs(Math.max(...r.members.m.stations.map((s) => Math.abs(s.M))) - (w0 * L * L) / 12) < 1e-6);
  assert.ok(Math.abs(r.reactions.a.fy - (w0 * L) / 4) < 1e-9);
});

test("น้ำหนักแผ่นดินไหวจากโมเดล: เท่าวิธีพื้นที่เมื่ออาคารปกติ และเพิ่มเมื่อมีคานยื่น", () => {
  const p = { ...defaultGrid, sdl: 0, ll: 0, sdlRoof: 0, llRoof: 0, slab: { ...defaultSlab, enabled: true } };
  const zs = [4, 7.5, 11, 14.5];
  const a = storeyWeights(p, [5, 5, 5], [4.5, 4.5], [4, 3.5, 3.5, 3.5], 0.25), b = storeyWeightsModel(generateBuilding(p).model, zs, 0.25);
  a.forEach((w, k) => assert.ok(Math.abs(w - b[k]) < 1e-6 * w, `ชั้น ${k + 1}: ${w} vs ${b[k]}`));
  const c = storeyWeightsModel(generateBuilding({ ...p, layout: { cantilevers: [{ side: "x1", length: 2, fromLevel: 1 }] } }).model, zs, 0.25);
  assert.ok(c[0] > b[0] * 1.05);
});

test("แรงเฉือนทะลุรวมโมเมนต์ถ่าย: M = 0 เท่ากับ Vu/φVc และโมเมนต์ทำให้อัตราส่วนเพิ่ม", () => {
  const fc = 24, d = 400;
  const r0 = punchRatio(fc, 0.75, 800, 0.4, 0.4, d, 0, 0);
  const bo = 4 * (400 + d), vc = 0.33 * Math.sqrt(fc);
  assert.ok(Math.abs(r0 - (800e3 / (bo * d)) / (0.75 * vc)) < 1e-9);
  assert.ok(punchRatio(fc, 0.75, 800, 0.4, 0.4, d, 150, 0) > r0 * 1.2);
});

test("โครง 2D: แรงลมตามที่โครงรับจริงในอาคาร 3D และแนวที่มีผนังมีผนังในโครง", () => {
  const p = { ...defaultGrid, pDelta: false, cracked: false, layout: { walls: [{ dir: "X" as const, line: 0, span: 1, t: 0.2 }] } };
  const m3 = generateBuilding(p).model, r3 = analyzeCombo3(m3, { WX: 1 });
  const fr = frameFrom3D(p, { dir: "X", line: 0 });
  assert.ok(fr.members.some((m) => m.id === "WX-A2-0") && !fr.members.some((m) => m.id === "BX-A2-1"));
  const ids = ["C-A1-0", "C-A2-0", "C-A3-0", "C-A4-0", "WX-A2-0"];
  const v3 = Math.abs(ids.reduce((a, id) => a + r3.members[id].stations[0].Vy, 0));
  const w2 = fr.loadCases.find((c) => c.id === "WX")!.loads.reduce((a, l) => a + (l.type === "nodal" ? l.fx : 0), 0);
  assert.ok(Math.abs(w2 - v3) < 0.01 * v3, `2D ${w2} vs 3D ${v3}`);
  const r2 = analyzeCase(fr, "WX");
  assert.ok(Math.abs(Math.abs(r2.members["WX-A2-0"].stations[0].V) - Math.abs(r3.members["WX-A2-0"].stations[0].Vy)) < 0.03 * v3);
});

test("ค่าน้ำหนักรายชิ้นรุ่นเก่า (รวมพื้นเทียบเท่า) ถูกหักน้ำหนักพื้นออกเมื่อเปิดไฟล์", () => {
  const p = { ...defaultGrid, sdl: 0, ll: 0, slab: { ...defaultSlab, enabled: true }, overrides: { load: { "BX-B1-1": { sdl: 30, ll: 10 } } } };
  const c = cleanParams3D(p);
  assert.equal(c.overrides?.loadBasis, "beam");
  assert.ok(c.overrides!.load!["BX-B1-1"].sdl < 30 && c.overrides!.load!["BX-B1-1"].sdl >= 0);
  assert.deepEqual(cleanParams3D(c).overrides, c.overrides); // แปลงครั้งเดียว
});
