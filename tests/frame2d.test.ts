// ชุดทดสอบเทียบผลเฉลยปิด (closed-form) จากตำรากลศาสตร์โครงสร้าง
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/frame2d.ts";
import { analyzeCase, analyzeCombo } from "../src/core/combos.ts";
import type { Load, Model, Support } from "../src/core/model.ts";

const E = 2.0e7; // kN/m²
const b = 0.3, h = 0.5;
const A = b * h, I = (b * h ** 3) / 12;
const EI = E * I, EA = E * A;

function close(actual: number, expected: number, rel = 1e-6, label = "") {
  const tol = Math.max(Math.abs(expected) * rel, 1e-9);
  assert.ok(Math.abs(actual - expected) <= tol, `${label} ได้ ${actual} คาด ${expected}`);
}

const FIX = (node: string): Support => ({ node, ux: true, uy: true, rz: true });
const PIN = (node: string): Support => ({ node, ux: true, uy: true, rz: false });
const ROLLER = (node: string): Support => ({ node, ux: false, uy: true, rz: false });

function beam(L: number, supports: Support[], nSpans = 1, Ib = I): Model {
  const nodes = Array.from({ length: nSpans + 1 }, (_, k) => ({ id: `N${k + 1}`, x: (L * k) / nSpans, y: 0 }));
  return {
    name: "test",
    nodes,
    supports,
    materials: [{ id: "M", name: "M", E, gamma: 24 }],
    sections: [{ id: "S", name: "S", material: "M", b, h: Math.cbrt((12 * Ib) / b) }],
    members: nodes.slice(0, -1).map((n, k) => ({ id: `B${k + 1}`, i: n.id, j: nodes[k + 1].id, section: "S", kind: "beam" as const })),
    loadCases: [],
    combos: [],
  };
}

test("1) คานยื่น: แรงจุดที่ปลาย δ=PL³/3EI, θ=PL²/2EI", () => {
  const L = 4, P = -10;
  const m = beam(L, [FIX("N1")]);
  const r = analyze(m, [{ type: "nodal", node: "N2", fx: 0, fy: P, mz: 0 }]);
  close(r.disp.N2.uy, (P * L ** 3) / (3 * EI), 1e-9, "δ");
  close(r.disp.N2.rz, (P * L ** 2) / (2 * EI), 1e-9, "θ");
  close(r.reactions.N1.fy, 10, 1e-9, "Ry");
  close(r.reactions.N1.mz, 40, 1e-9, "Mr");
  close(r.members.B1.minM, -40, 1e-9, "M ที่โคน");
});

test("2) คานช่วงเดียว UDL: M=wL²/8, δ=5wL⁴/384EI", () => {
  const L = 6, w = 10;
  const m = beam(L, [PIN("N1"), ROLLER("N2")]);
  const r = analyze(m, [{ type: "udl", member: "B1", dir: "globalY", w: -w }]);
  close(r.reactions.N1.fy, 30, 1e-9);
  close(r.reactions.N2.fy, 30, 1e-9);
  close(r.members.B1.maxM, (w * L * L) / 8, 1e-9, "Mmax");
  close(r.members.B1.maxAbsV, (w * L) / 2, 1e-9, "Vmax");
  const mid = r.members.B1.stations.find((s) => Math.abs(s.x - L / 2) < 1e-9)!;
  close(mid.v, (-5 * w * L ** 4) / (384 * EI), 1e-3, "δ กลางช่วง");
});

test("3) คานยึดแน่นสองปลาย UDL: Mend=−wL²/12, Mmid=+wL²/24, δ=wL⁴/384EI", () => {
  const L = 6, w = 10;
  const m = beam(L, [FIX("N1"), FIX("N3")], 2);
  const r = analyze(m, [
    { type: "udl", member: "B1", dir: "globalY", w: -w },
    { type: "udl", member: "B2", dir: "globalY", w: -w },
  ]);
  close(r.reactions.N1.mz, (w * L * L) / 12, 1e-9, "M ปลาย (reaction)");
  close(r.members.B1.minM, (-w * L * L) / 12, 1e-9, "M ปลาย");
  close(r.members.B1.maxM, (w * L * L) / 24, 1e-9, "M กลาง");
  close(r.disp.N2.uy, (-w * L ** 4) / (384 * EI), 1e-9, "δ กลาง");
});

test("4) คานช่วงเดียว แรงจุดที่ a: M=Pab/L, R1=Pb/L", () => {
  const L = 6, P = 12, a = 2;
  const m = beam(L, [PIN("N1"), ROLLER("N2")]);
  const r = analyze(m, [{ type: "point", member: "B1", dir: "globalY", P: -P, a }]);
  close(r.reactions.N1.fy, (P * (L - a)) / L, 1e-9);
  close(r.reactions.N2.fy, (P * a) / L, 1e-9);
  close(r.members.B1.maxM, (P * a * (L - a)) / L, 1e-9);
  // ค่าเฉือนกระโดดที่ตำแหน่งแรง
  const st = r.members.B1.stations;
  const before = st.find((s) => s.x < a && s.x > a - 1e-6)!;
  const after = st.find((s) => s.x > a && s.x < a + 1e-6)!;
  close(before.V - after.V, P, 1e-6, "ΔV");
});

test("5) Propped cantilever UDL: R=3wL/8, Mfix=wL²/8", () => {
  const L = 5, w = 8;
  const m = beam(L, [FIX("N1"), ROLLER("N2")]);
  const r = analyze(m, [{ type: "udl", member: "B1", dir: "globalY", w: -w }]);
  close(r.reactions.N2.fy, (3 * w * L) / 8, 1e-9);
  close(r.reactions.N1.mz, (w * L * L) / 8, 1e-9);
  close(r.members.B1.maxM, (9 * w * L * L) / 128, 1e-6, "M+ สูงสุด");
});

test("6) คานต่อเนื่อง 2 ช่วงเท่ากัน UDL: Rกลาง=10wL/8, Mกลาง=−wL²/8", () => {
  const L = 4, w = 15;
  const m = beam(2 * L, [PIN("N1"), ROLLER("N2"), ROLLER("N3")], 2);
  const r = analyze(m, [
    { type: "udl", member: "B1", dir: "globalY", w: -w },
    { type: "udl", member: "B2", dir: "globalY", w: -w },
  ]);
  close(r.reactions.N2.fy, (10 * w * L) / 8, 1e-9);
  close(r.reactions.N1.fy, (3 * w * L) / 8, 1e-9);
  close(r.members.B1.minM, (-w * L * L) / 8, 1e-9);
});

test("7) เสารับแรงอัดตามแกน: δ=PL/EA", () => {
  const H = 3, P = -500;
  const m: Model = {
    ...beam(1, []),
    nodes: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 0, y: H }],
    supports: [FIX("A")],
    members: [{ id: "C1", i: "A", j: "B", section: "S", kind: "column" }],
  };
  const r = analyze(m, [{ type: "nodal", node: "B", fx: 0, fy: P, mz: 0 }]);
  close(r.disp.B.uy, (P * H) / EA, 1e-9);
  close(r.members.C1.minN, P, 1e-9, "N (อัด)");
});

test("8) Portal frame ฐานยึดแน่น คานแข็งมาก แรงด้านข้าง H: V=H/2, M=Hh/4", () => {
  const Hf = 20, hgt = 3.5, span = 6;
  const m: Model = {
    name: "portal",
    nodes: [
      { id: "A", x: 0, y: 0 }, { id: "B", x: 0, y: hgt },
      { id: "C", x: span, y: hgt }, { id: "D", x: span, y: 0 },
    ],
    supports: [FIX("A"), FIX("D")],
    materials: [{ id: "M", name: "M", E, gamma: 0 }],
    sections: [
      { id: "COL", name: "c", material: "M", b: 0.3, h: 0.3 },
      { id: "RIG", name: "r", material: "M", b: 1, h: 30 },
    ],
    members: [
      { id: "C1", i: "A", j: "B", section: "COL", kind: "column" },
      { id: "B1", i: "B", j: "C", section: "RIG", kind: "beam" },
      { id: "C2", i: "D", j: "C", section: "COL", kind: "column" },
    ],
    loadCases: [], combos: [],
  };
  const r = analyze(m, [{ type: "nodal", node: "B", fx: Hf, fy: 0, mz: 0 }]);
  close(r.reactions.A.fx, -Hf / 2, 1e-3);
  close(r.reactions.D.fx, -Hf / 2, 1e-3);
  close(r.reactions.A.mz, (Hf * hgt) / 4, 1e-3);
  const Ic = 0.3 ** 4 / 12;
  close(r.disp.B.ux, (Hf * hgt ** 3) / (24 * E * Ic), 5e-3, "drift (ต่างเล็กน้อยจากการหดตัวตามแกนของเสา)");
});

test("9) คานเอียง: น้ำหนักแนวดิ่งต่อความยาวชิ้นส่วน — แรงปฏิกิริยาแนวดิ่ง = wL/2", () => {
  const w = 5;
  const m: Model = {
    ...beam(1, []),
    nodes: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 4, y: 3 }],
    supports: [PIN("A"), ROLLER("B")],
    members: [{ id: "R1", i: "A", j: "B", section: "S", kind: "beam" }],
  };
  const r = analyze(m, [{ type: "udl", member: "R1", dir: "globalY", w: -w }]);
  close(r.reactions.A.fy + r.reactions.B.fy, w * 5, 1e-9, "ΣRy");
  close(r.reactions.B.fy, (w * 5) / 2, 1e-9);
  // M สูงสุด = (w cosθ) L² / 8 สำหรับองค์ประกอบตั้งฉาก
  close(r.members.R1.maxM, (w * 0.8 * 25) / 8, 1e-9);
});

test("10) สมดุลรวม: Σแรงกระทำ + Σปฏิกิริยา = 0 (โครง 2 ชั้น แรงผสม)", () => {
  const m: Model = {
    name: "eq",
    nodes: [
      { id: "1", x: 0, y: 0 }, { id: "2", x: 0, y: 3 }, { id: "3", x: 0, y: 6 },
      { id: "4", x: 5, y: 0 }, { id: "5", x: 5, y: 3 }, { id: "6", x: 5, y: 6 },
    ],
    supports: [FIX("1"), PIN("4")],
    materials: [{ id: "M", name: "M", E, gamma: 24 }],
    sections: [{ id: "S", name: "S", material: "M", b: 0.3, h: 0.4 }],
    members: [
      { id: "a", i: "1", j: "2", section: "S", kind: "column" },
      { id: "b", i: "2", j: "3", section: "S", kind: "column" },
      { id: "c", i: "4", j: "5", section: "S", kind: "column" },
      { id: "d", i: "5", j: "6", section: "S", kind: "column" },
      { id: "e", i: "2", j: "5", section: "S", kind: "beam" },
      { id: "f", i: "3", j: "6", section: "S", kind: "beam" },
    ],
    loadCases: [], combos: [],
  };
  const loads: Load[] = [
    { type: "udl", member: "e", dir: "globalY", w: -12 },
    { type: "point", member: "f", dir: "globalY", P: -30, a: 1.5 },
    { type: "nodal", node: "3", fx: 8, fy: 0, mz: 5 },
    { type: "udl", member: "a", dir: "globalX", w: 2 },
  ];
  const r = analyze(m, loads, 1);
  const sumRx = Object.values(r.reactions).reduce((s, x) => s + x.fx, 0);
  const sumRy = Object.values(r.reactions).reduce((s, x) => s + x.fy, 0);
  close(sumRx + r.appliedTotal.fx, 0, 1e-9, "ΣFx");
  close(sumRy + r.appliedTotal.fy, 0, 1e-9, "ΣFy");
  // สมดุลที่จุดต่อ 2: ผลรวมแรงปลายชิ้นส่วน (global) = 0
  const forceAtNode = (mid: string, end: "i" | "j") => {
    const mr = r.members[mid];
    const o = end === "i" ? 0 : 3;
    const [n, v, mm] = mr.endForces.slice(o, o + 3);
    return { fx: mr.c * n - mr.s * v, fy: mr.s * n + mr.c * v, mz: mm };
  };
  const parts = [forceAtNode("a", "j"), forceAtNode("b", "i"), forceAtNode("e", "i")];
  close(parts.reduce((s, p) => s + p.fx, 0), 0, 1e-6, "จุดต่อ 2 ΣFx");
  close(parts.reduce((s, p) => s + p.mz, 0), 0, 1e-6, "จุดต่อ 2 ΣM");
});

test("11) น้ำหนักตัวเอง: R = γ·A·L/2", () => {
  const L = 6;
  const m = beam(L, [PIN("N1"), ROLLER("N2")]);
  const r = analyze(m, [], 1);
  close(r.reactions.N1.fy, (24 * A * L) / 2, 1e-9);
});

test("12) ชุดผสมน้ำหนักเป็นเชิงเส้น: 1.4D+1.7L = 1.4·D + 1.7·L", () => {
  const m = beam(6, [PIN("N1"), ROLLER("N2")]);
  m.loadCases = [
    { id: "D", name: "DL", selfWeight: true, loads: [{ type: "udl", member: "B1", dir: "globalY", w: -5 }] },
    { id: "L", name: "LL", selfWeight: false, loads: [{ type: "point", member: "B1", dir: "globalY", P: -10, a: 2 }] },
  ];
  const combo = { id: "C1", name: "1.4D+1.7L", factors: { D: 1.4, L: 1.7 } };
  m.combos = [combo];
  const rd = analyzeCase(m, "D"), rl = analyzeCase(m, "L"), rc = analyzeCombo(m, combo);
  close(rc.reactions.N1.fy, 1.4 * rd.reactions.N1.fy + 1.7 * rl.reactions.N1.fy, 1e-9);
  close(rc.disp.N2.rz, 1.4 * rd.disp.N2.rz + 1.7 * rl.disp.N2.rz, 1e-9);
});

test("13) ตรวจจับโครงสร้างไม่มีเสถียรภาพ (มีแต่ roller)", () => {
  const m = beam(6, [ROLLER("N1"), ROLLER("N2")]);
  assert.throws(() => analyze(m, [{ type: "nodal", node: "N2", fx: 0, fy: -1, mz: 0 }]), /ไม่มีเสถียรภาพ/);
});

test("14) แรงจุดนอกชิ้นส่วนต้องแจ้งข้อผิดพลาด", () => {
  const m = beam(6, [PIN("N1"), ROLLER("N2")]);
  assert.throws(() => analyze(m, [{ type: "point", member: "B1", dir: "globalY", P: -1, a: 7 }]), /นอกชิ้นส่วน/);
});
