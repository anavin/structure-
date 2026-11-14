import { test } from "node:test";
import assert from "node:assert/strict";
import { allowFa, buildTruss, defaultRoof, designRoof, lipChannel, boxSection, roofGeom, roofLoads, solveTruss, roofCpCg } from "../src/design/roof.ts";
import { defaultGrid, generateBuilding, parseSpacing, storeyWeights } from "../src/app3d/generator.ts";
import { defaultWind } from "../src/loads/windTH.ts";
import { frameFrom3D } from "../src/shared/frameFrom3d.ts";

const near = (a: number, b: number, tol: number, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

test("โครงถักจั่ว: แรงในคอร่าที่จุดรองรับตรงกับการคำนวณมือ", () => {
  // ช่วง 8 m ชัน 20° → 8 ช่อง 1 m · แรง 1 kN ทุกจุดคอร่า (9 จุด)
  const tm = buildTruss(8, 20, "gable", 1.2);
  assert.equal(tm.panel, 1);
  const r = solveTruss(tm, tm.top.map((node) => ({ node, fx: 0, fy: -1 })));
  near(r.R[0], 4.5, 1e-9); near(r.R[1], 4.5, 1e-9);
  const s20 = Math.sin((20 * Math.PI) / 180), t20 = Math.tan((20 * Math.PI) / 180);
  const top = r.N.filter((_, k) => tm.members[k].group === "top"), bot = r.N.filter((_, k) => tm.members[k].group === "bottom");
  near(Math.min(...top), -3.5 / s20, 1e-6, "คอร่าบนอัด (R − P/2)/sinθ");
  near(Math.max(...bot), 3.5 / t20, 1e-6, "คอร่าล่างดึง (R − P/2)/tanθ");
  // ทแยงแบบแพรตต์รับแรงดึงภายใต้น้ำหนักกดลง
  const diag = r.N.filter((_, k) => { const m = tm.members[k]; return m.group === "web" && tm.nodes[m.i].x !== tm.nodes[m.j].x; });
  assert.ok(diag.every((n) => n > -1e-9), "ทแยงต้องเป็นแรงดึง");
});

test("โครงถักเพิง/จั่ว: สมดุลแรงภายใต้แรงลมเอียง", () => {
  for (const type of ["gable", "shed"] as const) {
    const tm = buildTruss(9, 15, type, 1.0);
    const loads = tm.top.map((node, k) => ({ node, fx: 0.3 * (k % 3), fy: 0.8 - 0.1 * k }));
    const r = solveTruss(tm, loads);
    near(r.R[0] + r.R[1], -loads.reduce((a, l) => a + l.fy, 0), 1e-8, `${type} ΣFy`);
    near(r.H, -loads.reduce((a, l) => a + l.fx, 0), 1e-8, `${type} ΣFx`);
  }
});

test("หน้าตัดเหล็ก: ใกล้ตาราง JIS (ภายใน 4%) และ Fa ตาม AISC", () => {
  const c = lipChannel(100, 50, 20, 2.3); // JIS: A 5.172 cm², Ix 80.7 cm⁴, Zx 16.1 cm³
  near(c.A / 5.172, 1, 0.04, "A"); near(c.Ix / 80.7, 1, 0.04, "Ix"); near(c.Sx / 16.1, 1, 0.04, "Sx");
  const b = boxSection(50, 2.3); // JIS: A 4.252, I 15.9
  near(b.A / 4.252, 1, 0.04, "A box"); near(b.Ix / 15.9, 1, 0.04, "I box");
  near(allowFa(0, 2450), 0.6 * 2450, 1e-6, "Fa(0) = 0.6Fy");
  const Cc = Math.sqrt((2 * Math.PI ** 2 * 2.04e6) / 2450);
  near(allowFa(Cc - 1e-6, 2450), allowFa(Cc + 1e-6, 2450), 0.01, "ต่อเนื่องที่ Cc");
  assert.deepEqual(roofCpCg(3), [-1.3, -0.7]);
  near(roofCpCg(25)[0], -0.45, 1e-9, "ประมาณค่าเชิงเส้น 20–30°");
});

test("หลังคา: แปผ่านตามสูตรดัดสองแกน และน้ำหนักกระจายครบ", () => {
  const s = { ...defaultRoof, enabled: true, covering: "tile" as const, coverKg: 55 };
  const r = designRoof([4, 4, 4], [4, 4], 6, s, defaultWind);
  assert.ok(r.ok, r.message);
  // ตรวจแปด้วยมือ (D + Lr)
  const th = (20 * Math.PI) / 180, sp = r.purlin.spacing, sec = r.purlin.sec, L = 400;
  const w = 55 * sp + sec.w + 30 * sp * Math.cos(th);
  const Mx = ((w * Math.cos(th)) / 100) * L * L / 8, My = ((w * Math.sin(th)) / 100) * (L / 2) ** 2 / 8;
  assert.ok(r.purlin.ratioG >= Mx / (sec.Sx * 1470) + My / (sec.Sy * 1470) - 1e-9);
  // แรงที่หัวเสา: ผลรวมทุกโครงถัก × 2 ด้าน = น้ำหนักหลังคาทั้งหมด
  const sumD = r.loads.perTruss.reduce((a, t) => a + 2 * t.D, 0);
  near(sumD, r.loads.weight, 1e-6);
  assert.equal(r.loads.perTruss.length, 4);
  assert.ok(r.anchor.bolts >= 2 && r.steelTotal > 0);
});

test("หลังคาเข้าโมเดล 3D และโครง 2D: น้ำหนักหัวเสา ลมด้านข้าง และมวลแผ่นดินไหว", () => {
  const roof = { ...defaultRoof, enabled: true, ridge: "X" as const };
  const p0 = { ...defaultGrid, seismic: { ...defaultGrid.seismic!, enabled: true } };
  const p1 = { ...p0, roof };
  const a = generateBuilding(p0), b = generateBuilding(p1);
  const dx = parseSpacing(p1.xSpacing), dy = parseSpacing(p1.ySpacing), dz = parseSpacing(p1.storeys);
  const rf = roofLoads(roofGeom(dx, dy, dz.reduce((s, v) => s + v, 0), roof), roof, p1.wind);
  const fz = (m: typeof a.model, id: string) => m.loadCases.find((c) => c.id === id)!.loads.reduce((s, l) => s + (l.type === "nodal" ? l.fz : 0), 0);
  near(fz(b.model, "DL") - fz(a.model, "DL"), -rf.weight, 0.01, "ΣD หลังคา");
  const fx = (m: typeof a.model) => m.loadCases.find((c) => c.id === "WX")!.loads.reduce((s, l) => s + (l.type === "nodal" ? l.fx : 0), 0);
  near(fx(b.model) - fx(a.model), rf.FX, 0.01, "ลม X บนหน้าจั่ว");
  // ridge X → โครงถักแนวกริด 1..n ตั้งฉาก → แรงอยู่ที่หัวเสาแถว A และแถวสุดท้าย
  const top = dz.length, last = String.fromCharCode(65 + dy.length);
  const dl = b.model.loadCases[0].loads.filter((l) => l.type === "nodal" && l.fz < 0).map((l) => (l.type === "nodal" ? l.node : ""));
  assert.ok(dl.includes(`A1-${top}`) && dl.includes(`${last}1-${top}`) && !dl.includes(`B1-${top}`));
  const W0 = storeyWeights(p0, dx, dy, dz, 0.25), W1 = storeyWeights(p1, dx, dy, dz, 0.25);
  near(W1[W1.length - 1] - W0[W0.length - 1], rf.weight, 1e-6, "มวลชั้นบนสุด");
  near(W1[0], W0[0], 1e-9);
  // โครง 2D แนวกริด 1 (ตามแกน Y) มีโครงถัก → แรงที่หัวเสาริมทั้งสองข้าง
  const sumFy = (m: ReturnType<typeof frameFrom3D>) => m.loadCases[0].loads.reduce((s, l) => s + (l.type === "nodal" ? l.fy : 0), 0);
  const fr = frameFrom3D(p1, { dir: "Y", line: 0 }), fr0 = frameFrom3D({ ...p1, roof: { ...roof, enabled: false } }, { dir: "Y", line: 0 });
  near(sumFy(fr0) - sumFy(fr), 2 * rf.perTruss[0].D, 0.01, "แรงหลังคาที่หัวเสาริมสองข้าง");
});

test("ปริมาณวัสดุหลังคา: น้ำหนักเหล็ก พื้นที่มุง และค่าใช้จ่ายใน BOQ", async () => {
  const { roofQty } = await import("../src/design/roof.ts");
  const { boq3d, boqCost, defaultPrices } = await import("../src/design/boq3d.ts");
  const s = { ...defaultRoof, enabled: true, overhang: 1, pitch: 20 };
  const r = designRoof([4, 4, 4], [4, 4], 6, s, defaultWind);
  const q = roofQty(r, s);
  near(q.steelKg, r.steelTotal, 1e-6, "เหล็กรวมตรงกับผลออกแบบ");
  near(q.coverArea, (14 * 10) / Math.cos((20 * Math.PI) / 180), 1e-9, "พื้นที่ผิวลาด");
  assert.equal(q.trusses, 4);
  assert.equal(q.bolts, 2 * r.anchor.bolts * 4);
  const { model } = generateBuilding(defaultGrid);
  const b = boq3d(model, {}, null, { cover: 40, roof: q });
  const c = boqCost(b, { conc: 1, form: 1, steel: 1 }); // ราคาเดิม (ไม่มีราคาหลังคา) → ใช้ค่าตั้งต้น
  near(c.roofSteel, q.steelKg * defaultPrices.roofSteel, 1e-6);
  near(c.roofCover, q.coverArea * defaultPrices.roofCover, 1e-6);
  near(c.total, c.conc + c.form + c.steel + c.roofSteel + c.roofCover, 1e-9);
  assert.equal(boqCost(boq3d(model, {}, null, { cover: 40 }), defaultPrices).roofSteel, 0);
});

test("DXF: แปลนหลังคาและรูปด้านโครงถัก", async () => {
  const { buildDxf } = await import("../src/app3d/dxf.ts");
  const { model } = generateBuilding(defaultGrid);
  const s = { ...defaultRoof, enabled: true, type: "hip" as const };
  const xs = [0, 5, 10, 15], ys = [0, 4.5, 9];
  const r = designRoof([5, 5, 5], [4.5, 4.5], 14.5, s, defaultWind);
  const base = { name: "t", model, design: null, footings: null, slabs: [], xs, ys, zs: [0, 4, 7.5, 11, 14.5], openings: () => false, pileSize: 0.3 };
  const no = buildDxf(base), yes = buildDxf({ ...base, roof: { r, s } });
  assert.ok(!no.includes("\r\n8\r\nTRUSS\r\n") && yes.includes("\r\n8\r\nTRUSS\r\n") && yes.includes("\r\n8\r\nPURLIN\r\n"));
  const count = (t: string, layer: string) => t.split(`\r\nLINE\r\n8\r\n${layer}\r\n`).length - 1;
  // แป = จุดคอร่าทุกจุด + แปชายคา 2 แถว (แปลน) · ปั้นหยา: ขอบ 4 + สัน 1 + ตะเฆ่ 4
  assert.equal(count(yes, "ROOF"), 9);
  assert.equal(count(yes, "TRUSS"), 4 + r.truss.members.filter((m) => m.group !== "web").length + 2 * 3);
  assert.ok(/[^\x00-\x7f]/.test(yes) === false);
});

test("โครง 2D: มีภาพหลังคา — ระนาบโครงถักเห็นโครงถัก, ระนาบขนานสันเห็นรูปด้าน", () => {
  const p1 = { ...defaultGrid, roof: { ...defaultRoof, enabled: true, ridge: "X" as const } };
  const across = frameFrom3D(p1, { dir: "Y", line: 1 }), along = frameFrom3D(p1, { dir: "X", line: 0 });
  const tm = buildTruss(9, 20, "gable", 1.2);
  assert.equal(across.roof2d!.lines.length, tm.members.length + 2); // + ชายคา 2 ข้าง
  assert.match(across.roof2d!.note, /โครงถัก/);
  assert.match(along.roof2d!.note, /รูปด้าน/);
  const zTop = parseSpacing(p1.storeys).reduce((s, v) => s + v, 0);
  near(Math.max(...across.roof2d!.lines.flatMap((l) => [l[1], l[3]])), zTop + 4.5 * Math.tan((20 * Math.PI) / 180), 1e-9, "ยอดจั่ว");
  assert.equal(frameFrom3D(defaultGrid, { dir: "Y", line: 1 }).roof2d, undefined);
});


test("โครง 2D จากอาคาร 3D: แรงอัดเสาจากน้ำหนักคงที่ใกล้เคียง 3D (รวมแรงจากคานขวาง)", async () => {
  const { defaultSlab } = await import("../src/app3d/generator.ts");
  const { analyzeCombo3 } = await import("../src/core3d/combos3d.ts");
  const { analyzeCase } = await import("../src/core/combos.ts");
  const p = { ...defaultGrid, pDelta: false, cracked: false, slab: { ...defaultSlab, enabled: true } };
  const r3 = analyzeCombo3(generateBuilding(p).model, { DL: 1 });
  for (const [dir, line, col] of [["X", 1, "C-B2-0"], ["Y", 0, "C-B1-0"]] as const) {
    const n2 = analyzeCase(frameFrom3D(p, { dir, line }), "DL").members[col].stations[0].N, n3 = r3.members[col].stations[0].N;
    near(n2 / n3, 1, 0.02, `${dir}${line} ${col}`);
  }
});
