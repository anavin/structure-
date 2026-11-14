// ชุดทดสอบตัววิเคราะห์ 3D: ผลเฉลยปิด, เทียบกับตัว 2D, ตัวแก้สมการ skyline และความเร็ว
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze3d } from "../src/core3d/frame3d.ts";
import { factorize, reverseCuthillMcKee, SkylineMatrix, solveFactored } from "../src/core3d/skyline.ts";
import { memberAxes, sectionProps3, torsionJ, type Model3, type Support3 } from "../src/core3d/model3d.ts";
import { analyze } from "../src/core/frame2d.ts";
import { sampleModel } from "../src/ui/sample.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-9), `${msg}: ได้ ${a} คาด ${b}`);

const E = 2e7, nu = 0.2, G = E / (2 * (1 + nu));
const FIX = (node: string): Support3 => ({ node, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
const PIN = (node: string): Support3 => ({ node, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false });

function m3(nodes: Model3["nodes"], members: Model3["members"], supports: Support3[], b = 0.3, h = 0.5): Model3 {
  return {
    name: "t", nodes, supports, members,
    materials: [{ id: "M", name: "M", E, nu, gamma: 24 }],
    sections: [{ id: "S", name: "S", material: "M", b, h }],
    loadCases: [], combos: [],
  };
}
const P3 = sectionProps3({ id: "S", name: "S", material: "M", b: 0.3, h: 0.5 });

// ---------- ตัวแก้สมการ ----------
test("skyline LDLᵀ = ผลจากการคูณกลับ บนเมทริกซ์แถบสุ่ม", () => {
  const n = 60, bw = 7;
  const dense = Array.from({ length: n }, () => new Float64Array(n));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < n; i++) for (let j = i; j < Math.min(n, i + bw); j++) {
    const v = i === j ? 10 + Math.abs(rnd()) * 5 : rnd();
    dense[i][j] = v; dense[j][i] = v;
  }
  const first = new Int32Array(n).map((_, j) => Math.max(0, j - bw + 1));
  const K = new SkylineMatrix(first);
  for (let j = 0; j < n; j++) for (let i = first[j]; i <= j; i++) K.add(i, j, dense[i][j]);
  const xTrue = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
  const b = Float64Array.from({ length: n }, (_, i) => dense[i].reduce((s, v, j) => s + v * xTrue[j], 0));
  factorize(K);
  const x = solveFactored(K, b);
  for (let i = 0; i < n; i++) near(x[i], xTrue[i], 1e-9, `x${i}`);
});

test("RCM ให้ลำดับครบทุกจุดต่อ ไม่ซ้ำ", () => {
  const ord = reverseCuthillMcKee(6, [[0, 5], [5, 1], [1, 4], [4, 2], [2, 3]]);
  assert.deepEqual([...ord].sort(), [0, 1, 2, 3, 4, 5]);
});

// ---------- แกน local ----------
test("แกน local: คานตาม X → แกน 2 ชี้ขึ้น (+Z); เสาตั้งดิ่ง → แกน 2 = +X", () => {
  const b = memberAxes({ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 5, y: 0, z: 0 });
  assert.deepEqual(b.ey.map((v) => +v.toFixed(12)), [0, 0, 1]);
  const c = memberAxes({ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 0, y: 0, z: 3 });
  assert.deepEqual(c.ey.map((v) => +v.toFixed(12)), [1, 0, 0]);
});

// ---------- ผลเฉลยปิด ----------
test("คานยื่นตาม X: แรงจุดปลาย −Z → δ = PL³/3EIz (แกนแข็ง) ; แรง +Y → δ = PL³/3EIy (แกนอ่อน)", () => {
  const L = 4, P = 10;
  const m = m3([{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: L, y: 0, z: 0 }], [{ id: "B1", i: "A", j: "B", section: "S", kind: "beam" }], [FIX("A")]);
  const r = analyze3d(m, [{ type: "nodal", node: "B", fx: 0, fy: P, fz: -P, mx: 0, my: 0, mz: 0 }]);
  near(r.disp.B.uz, (-P * L ** 3) / (3 * E * P3.Iz), 1e-9, "δz");
  near(r.disp.B.uy, (P * L ** 3) / (3 * E * P3.Iy), 1e-9, "δy");
  near(r.reactions.A.fz, P, 1e-9, "Rz");
  near(r.reactions.A.my, -P * L, 1e-9, "My ฐาน"); // แรง −Z ที่ +X ทำให้ต้องการโมเมนต์ปฏิกิริยารอบ Y เป็นลบ
  near(r.members.B1.maxAbs.Mz, P * L, 1e-9, "|Mz| ที่ฐาน");
});

test("คานยื่นรับแรงบิดปลาย: θx = TL/GJ", () => {
  const L = 3, T = 5;
  const m = m3([{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: L, y: 0, z: 0 }], [{ id: "B1", i: "A", j: "B", section: "S", kind: "beam" }], [FIX("A")]);
  const r = analyze3d(m, [{ type: "nodal", node: "B", fx: 0, fy: 0, fz: 0, mx: T, my: 0, mz: 0 }]);
  near(r.disp.B.rx, (T * L) / (G * torsionJ(0.3, 0.5)), 1e-9, "θx");
  near(Math.abs(r.members.B1.maxAbs.T), T, 1e-9, "T");
});

test("ชิ้นส่วนเอียงในอวกาศรับแรงตามแกน: การยืดตามแกน = PL/EA", () => {
  const A = { id: "A", x: 0, y: 0, z: 0 }, B = { id: "B", x: 2, y: 3, z: 6 };
  const L = 7, P = 100;
  const e = [2 / L, 3 / L, 6 / L];
  const m = m3([A, B], [{ id: "X", i: "A", j: "B", section: "S", kind: "brace" }], [FIX("A")]);
  const r = analyze3d(m, [{ type: "nodal", node: "B", fx: P * e[0], fy: P * e[1], fz: P * e[2], mx: 0, my: 0, mz: 0 }]);
  const d = r.disp.B;
  near(d.ux * e[0] + d.uy * e[1] + d.uz * e[2], (P * L) / (E * P3.A), 1e-9, "δ ตามแกน");
  near(r.members.X.maxN, P, 1e-9, "N");
});

test("คานยื่นรูปตัว L ในแนวราบ (grillage): δ = PL₁³/3EI + PL₂³/3EI + PL₂²L₁/GJ", () => {
  const L1 = 3, L2 = 2, P = 8;
  const m = m3(
    [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: L1, y: 0, z: 0 }, { id: "C", x: L1, y: L2, z: 0 }],
    [{ id: "M1", i: "A", j: "B", section: "S", kind: "beam" }, { id: "M2", i: "B", j: "C", section: "S", kind: "beam" }],
    [FIX("A")],
  );
  const r = analyze3d(m, [{ type: "nodal", node: "C", fx: 0, fy: 0, fz: -P, mx: 0, my: 0, mz: 0 }]);
  const J = torsionJ(0.3, 0.5);
  const expect = (P * L1 ** 3) / (3 * E * P3.Iz) + (P * L2 ** 3) / (3 * E * P3.Iz) + (P * L2 * L2 * L1) / (G * J);
  near(-r.disp.C.uz, expect, 1e-9, "δ ปลาย");
  near(Math.abs(r.members.M1.maxAbs.T), P * L2, 1e-9, "แรงบิดใน M1");
});

test("แรงแผ่ในแกน global และแกน local + ปลดโมเมนต์ทั้งสองปลาย = คานช่วงเดียว wL²/8", () => {
  const L = 6, w = 10;
  const rel = { m2: true, m3: true };
  const m = m3([{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: L, y: 0, z: 0 }],
    [{ id: "B1", i: "A", j: "B", section: "S", kind: "beam", releaseI: rel, releaseJ: rel }], [FIX("A"), FIX("B")]);
  const r = analyze3d(m, [{ type: "udl", member: "B1", dir: "GZ", w: -w }]);
  const mid = r.members.B1.stations.find((s) => Math.abs(s.x - L / 2) < 1e-9)!;
  near(mid.Mz, (w * L * L) / 8, 1e-9, "Mz กลางช่วง (ท้องช้างเป็นบวก)");
  near(mid.v, (-5 * w * L ** 4) / (384 * E * P3.Iz), 1e-3, "การโก่งกลางช่วง");
  near(r.reactions.A.my, 0, 1e-9, "ไม่มีโมเมนต์ที่ปลายที่ปลด");
  // แรงแผ่ตามแกน L3 (แนวราบ) → ดัดแกนอ่อน
  const r2 = analyze3d(m, [{ type: "udl", member: "B1", dir: "L3", w: w }]);
  near(r2.members.B1.maxAbs.My, (w * L * L) / 8, 1e-9, "My แกนอ่อน");
});

test("น้ำหนักตัวเอง −Z: ΣRz = γ·A·L", () => {
  const m = m3([{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 5, y: 0, z: 0 }, { id: "C", x: 5, y: 4, z: 0 }],
    [{ id: "1", i: "A", j: "B", section: "S", kind: "beam" }, { id: "2", i: "B", j: "C", section: "S", kind: "beam" }], [FIX("A"), PIN("C")]);
  const r = analyze3d(m, [], 1);
  near(r.reactions.A.fz + r.reactions.C.fz, 24 * P3.A * 9, 1e-9, "ΣRz");
});

test("โครงถัก 3 มิติ (ปลดทุกปลาย): หมุนอิสระถูกยึดอัตโนมัติ และแรงตามแกนตรงสถิตศาสตร์", () => {
  // ขาตั้ง 3 ขา รับแรงดิ่งที่ยอด
  const h = 4, rad = 2;
  const legs = [0, 120, 240].map((deg, k) => ({ id: `G${k}`, x: rad * Math.cos((deg * Math.PI) / 180), y: rad * Math.sin((deg * Math.PI) / 180), z: 0 }));
  const rel = { t: true, m2: true, m3: true };
  const m = m3([...legs, { id: "T", x: 0, y: 0, z: h }],
    legs.map((g, k) => ({ id: `L${k}`, i: g.id, j: "T", section: "S", kind: "brace" as const, releaseI: rel, releaseJ: { m2: true, m3: true } })),
    legs.map((g) => PIN(g.id)));
  const P = 30;
  const r = analyze3d(m, [{ type: "nodal", node: "T", fx: 0, fy: 0, fz: -P, mx: 0, my: 0, mz: 0 }]);
  const Lleg = Math.hypot(rad, h);
  near(r.members.L0.minN, -(P / 3) * (Lleg / h), 1e-9, "N ขา (อัด)");
  assert.ok(r.info.autoRestrained.some((x) => x.startsWith("T.")), "ยึดการหมุนที่ยอดอัตโนมัติ");
});

test("ตรวจจับกลไก (ไม่มีจุดรองรับที่พอ)", () => {
  const m = m3([{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 5, y: 0, z: 0 }], [{ id: "B1", i: "A", j: "B", section: "S", kind: "beam" }],
    [{ node: "A", ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }]);
  assert.throws(() => analyze3d(m, [{ type: "nodal", node: "B", fx: 0, fy: 0, fz: -1, mx: 0, my: 0, mz: 0 }]), /ไม่มีเสถียรภาพ/);
});

// ---------- เทียบกับตัว 2D ----------
test("โครง 2 มิติตัวอย่าง วางในระนาบ XZ: แรงปฏิกิริยาและโมเมนต์ตรงกับตัววิเคราะห์ 2D", () => {
  const m2 = sampleModel();
  const nu0 = 0.2;
  const m: Model3 = {
    name: "from2d",
    nodes: m2.nodes.map((n) => ({ id: n.id, x: n.x, y: 0, z: n.y })),
    supports: m2.supports.map((s) => ({ node: s.node, ux: s.ux, uy: true, uz: s.uy, rx: true, ry: s.rz, rz: true })),
    materials: m2.materials.map((x) => ({ id: x.id, name: x.name, E: x.E, nu: nu0, gamma: x.gamma })),
    sections: m2.sections.map((s) => ({ ...s })),
    members: m2.members.map((x) => ({ id: x.id, i: x.i, j: x.j, section: x.section, kind: x.kind })),
    loadCases: [], combos: [],
  };
  const lc = m2.loadCases.find((c) => c.id === "DL")!;
  const wl = m2.loadCases.find((c) => c.id === "WL")!;
  const loads2 = [...lc.loads, ...wl.loads];
  const r2 = analyze(m2, loads2, 1);
  const r3 = analyze3d(m, loads2.map((l) => l.type === "nodal"
    ? { type: "nodal" as const, node: l.node, fx: l.fx, fy: 0, fz: l.fy, mx: 0, my: -l.mz, mz: 0 }
    : l.type === "udl" ? { type: "udl" as const, member: l.member, dir: (l.dir === "globalY" ? "GZ" : "GX") as "GZ" | "GX", w: l.w }
    : { type: "point" as const, member: l.member, dir: (l.dir === "globalY" ? "GZ" : "GX") as "GZ" | "GX", P: l.P, a: l.a }), 1);
  for (const s of m2.supports) {
    near(r3.reactions[s.node].fx, r2.reactions[s.node].fx, 1e-9, `Rx ${s.node}`);
    near(r3.reactions[s.node].fz, r2.reactions[s.node].fy, 1e-9, `Rz ${s.node}`);
    near(-r3.reactions[s.node].my, r2.reactions[s.node].mz, 1e-9, `M ${s.node}`); // โมเมนต์ทวนเข็มในระนาบ XZ = −My
  }
  for (const mem of m2.members) {
    near(r3.members[mem.id].maxAbs.Mz, Math.max(Math.abs(r2.members[mem.id].maxM), Math.abs(r2.members[mem.id].minM)), 1e-6, `|M| ${mem.id}`);
  }
  for (const n of m2.nodes) near(r3.disp[n.id].ux, r2.disp[n.id].ux, 1e-9, `ux ${n.id}`);
});

// ---------- ความเร็ว ----------
test("อาคาร 10 ชั้น 5×5 ช่วง (960 ชิ้นส่วน, 2,160 สมการ) วิเคราะห์เสร็จในเวลาสั้น", () => {
  const nx = 6, ny = 6, nz = 11, sp = 5, hz = 3.5;
  const nodes: Model3["nodes"] = [];
  const id = (i: number, j: number, k: number) => `N${i}_${j}_${k}`;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nodes.push({ id: id(i, j, k), x: i * sp, y: j * sp, z: k * hz });
  const members: Model3["members"] = [];
  let c = 0;
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) members.push({ id: `C${c++}`, i: id(i, j, k), j: id(i, j, k + 1), section: "S", kind: "column" });
  for (let k = 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (i < nx - 1) members.push({ id: `BX${c++}`, i: id(i, j, k), j: id(i + 1, j, k), section: "S", kind: "beam" });
    if (j < ny - 1) members.push({ id: `BY${c++}`, i: id(i, j, k), j: id(i, j + 1, k), section: "S", kind: "beam" });
  }
  const supports = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) supports.push(FIX(id(i, j, 0)));
  const m = m3(nodes, members, supports);
  const loads = members.filter((x) => x.kind === "beam").map((x) => ({ type: "udl" as const, member: x.id, dir: "GZ" as const, w: -15 }));
  const t0 = Date.now();
  const r = analyze3d(m, loads, 1);
  const ms = Date.now() - t0;
  const sumRz = Object.values(r.reactions).reduce((s, x) => s + x.fz, 0);
  near(sumRz, -r.appliedTotal.fz, 1e-9, "ΣRz");
  assert.ok(ms < 5000, `ใช้เวลา ${ms} ms`);
  console.log(`  3D: ${members.length} ชิ้นส่วน, ${r.info.neq} สมการ, profile ${r.info.profile.toLocaleString()} ค่า, ${ms} ms`);
});
