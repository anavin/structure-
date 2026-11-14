// ชุดตรวจความถูกต้อง: เทียบผลโปรแกรมกับผลเฉลยปิด (closed-form) ของปัญหามาตรฐาน
// ใช้ทั้งในชุดทดสอบอัตโนมัติ (tests/verification.test.ts) และสร้างตาราง VERIFICATION.md (scripts/verification.ts)

import { analyze3d } from "../core3d/frame3d.ts";
import type { Load3, Model3 } from "../core3d/model3d.ts";
import { sectionProps3, torsionJ } from "../core3d/model3d.ts";
import { modalAnalysis } from "../core3d/modal3d.ts";
import { analyzeCase } from "../core/combos.ts";
import type { Model } from "../core/model.ts";

export interface BenchRow { group: string; name: string; theory: number; program: number; unit: string; tol: number; formula: string }
export const relErr = (r: BenchRow) => (Math.abs(r.theory) < 1e-12 ? Math.abs(r.program) : Math.abs(r.program - r.theory) / Math.abs(r.theory));

const E = 25e6, nu = 0.2, G = E / (2 * (1 + nu)); // kN/m²
const sec = { b: 0.3, h: 0.5 };
const P = sectionProps3({ id: "S", name: "", material: "M", ...sec });

function model(nodes: [string, number, number, number][], members: [string, string, string, "beam" | "column"][], supports: Model3["supports"], extra: Partial<Model3> = {}): Model3 {
  return {
    name: "bench", nodes: nodes.map(([id, x, y, z]) => ({ id, x, y, z })),
    members: members.map(([id, i, j, kind]) => ({ id, i, j, kind, section: "S" })),
    supports, materials: [{ id: "M", name: "", E, nu, gamma: 0 }],
    sections: [{ id: "S", name: "", material: "M", ...sec }], loadCases: [], combos: [], ...extra,
  };
}
const fixed = (node: string) => ({ node, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
const pin = (node: string, roller = false) => ({ node, ux: !roller, uy: true, uz: true, rx: true, ry: false, rz: false });
const nodal = (node: string, f: Partial<Record<"fx" | "fy" | "fz" | "mx" | "my" | "mz", number>>): Load3 => ({ type: "nodal", node, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, ...f });

export function runBenchmarks(): BenchRow[] {
  const rows: BenchRow[] = [];
  const add = (r: BenchRow) => rows.push(r);

  // 1) คานยื่นยาว L รับแรงปลาย (แนวดิ่ง) — δ = PL³/3EI, M ฐาน = PL
  {
    const L = 4, F = 10;
    const m = model([["A", 0, 0, 0], ["B", L, 0, 0]], [["m", "A", "B", "beam"]], [fixed("A")]);
    const r = analyze3d(m, [nodal("B", { fz: -F })]);
    add({ group: "คานยื่น", name: "การแอ่นปลายจากแรงจุด", theory: (F * L ** 3) / (3 * E * P.Iz) * 1000, program: -r.disp.B.uz * 1000, unit: "mm", tol: 1e-6, formula: "PL³/3EI" });
    add({ group: "คานยื่น", name: "โมเมนต์ที่ฐาน", theory: F * L, program: Math.abs(r.reactions.A.my), unit: "kN·m", tol: 1e-9, formula: "PL" });
    const r2 = analyze3d(m, [nodal("B", { mx: 5 })]);
    add({ group: "คานยื่น", name: "มุมบิดปลายจากแรงบิด", theory: (5 * L) / (G * torsionJ(sec.b, sec.h)), program: r2.disp.B.rx, unit: "rad", tol: 1e-9, formula: "TL/GJ" });
    const r3 = analyze3d(m, [nodal("B", { fx: 100 })]);
    add({ group: "คานยื่น", name: "การยืดตามแกน", theory: (100 * L) / (E * P.A) * 1000, program: r3.disp.B.ux * 1000, unit: "mm", tol: 1e-9, formula: "PL/EA" });
    const r4 = analyze3d(m, [{ type: "udl", member: "m", dir: "GZ", w: -12 }]);
    add({ group: "คานยื่น", name: "การแอ่นปลายจากแรงแผ่", theory: (12 * L ** 4) / (8 * E * P.Iz) * 1000, program: -r4.disp.B.uz * 1000, unit: "mm", tol: 1e-6, formula: "wL⁴/8EI" });
  }
  // 2) คานยึดแน่นสองปลายรับแรงแผ่ — M ปลาย wL²/12, M กลาง wL²/24, δ กลาง wL⁴/384EI
  {
    const L = 6, w = 20;
    const m = model([["A", 0, 0, 0], ["C", L / 2, 0, 0], ["B", L, 0, 0]], [["m1", "A", "C", "beam"], ["m2", "C", "B", "beam"]], [fixed("A"), fixed("B")]);
    const r = analyze3d(m, [{ type: "udl", member: "m1", dir: "GZ", w: -w }, { type: "udl", member: "m2", dir: "GZ", w: -w }]);
    add({ group: "คานยึดแน่น", name: "โมเมนต์ที่ปลาย", theory: (w * L * L) / 12, program: Math.abs(r.reactions.A.my), unit: "kN·m", tol: 1e-9, formula: "wL²/12" });
    add({ group: "คานยึดแน่น", name: "โมเมนต์กลางช่วง", theory: (w * L * L) / 24, program: Math.abs(r.members.m1.stations[r.members.m1.stations.length - 1].Mz), unit: "kN·m", tol: 1e-6, formula: "wL²/24" });
    add({ group: "คานยึดแน่น", name: "การแอ่นกลางช่วง", theory: (w * L ** 4) / (384 * E * P.Iz) * 1000, program: -r.disp.C.uz * 1000, unit: "mm", tol: 1e-6, formula: "wL⁴/384EI" });
  }
  // 3) คานช่วงเดียวฐานรองรับธรรมดา — M กลาง wL²/8, δ 5wL⁴/384EI
  {
    const L = 5, w = 15;
    const m = model([["A", 0, 0, 0], ["C", L / 2, 0, 0], ["B", L, 0, 0]], [["m1", "A", "C", "beam"], ["m2", "C", "B", "beam"]], [{ ...pin("A"), rx: true }, { ...pin("B", true), rx: true }]);
    const r = analyze3d(m, [{ type: "udl", member: "m1", dir: "GZ", w: -w }, { type: "udl", member: "m2", dir: "GZ", w: -w }]);
    add({ group: "คานช่วงเดียว", name: "โมเมนต์กลางช่วง", theory: (w * L * L) / 8, program: Math.abs(r.members.m1.stations[r.members.m1.stations.length - 1].Mz), unit: "kN·m", tol: 1e-6, formula: "wL²/8" });
    add({ group: "คานช่วงเดียว", name: "การแอ่นกลางช่วง", theory: (5 * w * L ** 4) / (384 * E * P.Iz) * 1000, program: -r.disp.C.uz * 1000, unit: "mm", tol: 1e-6, formula: "5wL⁴/384EI" });
    add({ group: "คานช่วงเดียว", name: "แรงปฏิกิริยา", theory: (w * L) / 2, program: r.reactions.A.fz, unit: "kN", tol: 1e-9, formula: "wL/2" });
  }
  // 4) โครงข้อแข็งเสายึดแน่น คานแข็งมาก รับแรงด้านข้าง — δ = H·h³/(24EI) (เสา 2 ต้น)
  {
    const h = 3.5, span = 6, H = 50;
    const m = model([["A", 0, 0, 0], ["B", span, 0, 0], ["C", 0, 0, h], ["D", span, 0, h]], [["c1", "A", "C", "column"], ["c2", "B", "D", "column"], ["bm", "C", "D", "beam"]], [fixed("A"), fixed("B")]);
    m.sections.push({ id: "RIG", name: "", material: "M", b: 2, h: 6 });
    m.members[2].section = "RIG";
    const r = analyze3d(m, [nodal("C", { fx: H })]);
    // เสาตั้งมี h ตามแกน X (แกน 2) → การดัดในระนาบ X-Z ใช้ Iz = b·h³/12 · คานแข็งมากแต่ไม่อนันต์ (ต่างเล็กน้อย)
    const Ixx = P.Iz;
    add({ group: "โครงข้อแข็ง", name: "การเคลื่อนตัวด้านข้าง (คานแข็ง)", theory: (H * h ** 3) / (24 * E * Ixx) * 1000, program: r.disp.C.ux * 1000, unit: "mm", tol: 0.01, formula: "Hh³/24EI" });
    add({ group: "โครงข้อแข็ง", name: "โมเมนต์ที่ฐานเสา", theory: (H / 2) * h / 2, program: Math.abs(r.reactions.A.my), unit: "kN·m", tol: 0.01, formula: "(H/2)·h/2" });
  }
  // 5) P-Δ: เสายื่นรับแรงตามแกน + แรงด้านข้างที่ปลาย — ผลเฉลยแม่นตรง δ/δ₀ = 3(tan u − u)/u³, u = L√(P/EI)
  {
    const L = 4, H = 1, Pz = 0.3 * (Math.PI ** 2 * E * P.Iz) / (2 * L) ** 2;
    const nodes: [string, number, number, number][] = Array.from({ length: 9 }, (_, k) => [`N${k}`, 0, 0, (k * L) / 8]);
    const mems: [string, string, string, "column"][] = Array.from({ length: 8 }, (_, k) => [`c${k}`, `N${k}`, `N${k + 1}`, "column"]);
    const m = model(nodes, mems, [fixed("N0")]);
    const lin = analyze3d(m, [nodal("N8", { fx: H, fz: -Pz })]).disp.N8.ux;
    const pd = analyze3d(m, [nodal("N8", { fx: H, fz: -Pz })], 0, { pDelta: true }).disp.N8.ux;
    const u = L * Math.sqrt(Pz / (E * P.Iz));
    add({ group: "อันดับสอง P-Δ", name: "ตัวขยายการเคลื่อนตัว (P = 0.3Pe)", theory: (3 * (Math.tan(u) - u)) / u ** 3, program: pd / lin, unit: "เท่า", tol: 0.01, formula: "3(tan u − u)/u³" });
  }
  // 6) คาบธรรมชาติอาคารชั้นเดียว (พื้นแข็ง เสา 4 ต้น คานแข็งมาก) — T = 2π√(m/k), k = 4·12EI/h³
  {
    const h = 3.5, W = 2000;
    const m = model([["A", 0, 0, 0], ["B", 6, 0, 0], ["C", 6, 5, 0], ["D", 0, 5, 0], ["a", 0, 0, h], ["b", 6, 0, h], ["c", 6, 5, h], ["d", 0, 5, h]],
      [["cA", "A", "a", "column"], ["cB", "B", "b", "column"], ["cC", "C", "c", "column"], ["cD", "D", "d", "column"], ["b1", "a", "b", "beam"], ["b2", "b", "c", "beam"], ["b3", "c", "d", "beam"], ["b4", "d", "a", "beam"]],
      ["A", "B", "C", "D"].map(fixed), { diaphragms: [{ id: "DIA", nodes: ["a", "b", "c", "d"] }] });
    m.sections.push({ id: "RIG", name: "", material: "M", b: 2, h: 6 });
    for (const mm of m.members) if (mm.kind === "beam") mm.section = "RIG";
    const res = modalAnalysis(m, [W], { Bx: 6, By: 5 });
    const k = 4 * 12 * E * P.Iz / h ** 3;
    const Tx = res.modes.find((q) => q.dir === "X")!.T;
    add({ group: "การสั่นอิสระ", name: "คาบธรรมชาติทิศ X", theory: 2 * Math.PI * Math.sqrt((W / 9.80665) / k), program: Tx, unit: "s", tol: 0.01, formula: "2π√(m/k), k = 4·12EI/h³" });
  }
  // 7) โปรแกรม 2D: คานยึดแน่นรับแรงแผ่ — M ปลาย wL²/12
  {
    const L = 6, w = 20;
    const m2: Model = {
      name: "b2", nodes: [{ id: "A", x: 0, y: 0 }, { id: "B", x: L, y: 0 }],
      members: [{ id: "m", i: "A", j: "B", section: "S", kind: "beam" }],
      supports: [{ node: "A", ux: true, uy: true, rz: true }, { node: "B", ux: true, uy: true, rz: true }],
      materials: [{ id: "M", name: "", E, gamma: 0 }], sections: [{ id: "S", name: "", material: "M", b: 0.3, h: 0.5 }],
      loadCases: [{ id: "L", name: "", selfWeight: false, loads: [{ type: "udl", member: "m", dir: "globalY", w: -w }] }], combos: [],
    };
    const r = analyzeCase(m2, "L");
    const Mend = Math.abs(r.members.m.endForces[2]);
    add({ group: "โปรแกรม 2D", name: "โมเมนต์ปลายคานยึดแน่น", theory: (w * L * L) / 12, program: Mend, unit: "kN·m", tol: 1e-6, formula: "wL²/12" });
  }
  return rows;
}
