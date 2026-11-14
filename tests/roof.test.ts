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
  const fr = frameFrom3D(p1, { dir: "Y", line: 0 });
  const nod = fr.loadCases[0].loads.filter((l) => l.type === "nodal");
  assert.equal(nod.length, 2);
  near(-nod.reduce((s, l) => s + (l.type === "nodal" ? l.fy : 0), 0), 2 * rf.perTruss[0].D, 0.01);
});
