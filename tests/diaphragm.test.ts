// ชุดทดสอบพื้นแข็งในระนาบ (rigid diaphragm)
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze3d } from "../src/core3d/frame3d.ts";
import { autoDiaphragms, torsionJ, type Model3 } from "../src/core3d/model3d.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-12), `${msg}: ได้ ${a} คาด ${b}`);

const E = 2e7, nu = 0.2, G = E / (2 * (1 + nu));
const h = 3.5, c = 0.4; // เสา 0.4×0.4
const Ic = c ** 4 / 12, Jc = torsionJ(c, c);
const kCol = (12 * E * Ic) / h ** 3; // เสายึดแน่นสองปลาย (คานแข็งมาก)

/** โครงชั้นเดียว: เสาที่ (x, y) ตามรายการ, คานแข็งมากเชื่อมรอบรูป, ฐานยึดแน่น */
function storey(pts: [number, number][], withDia = true, beamH = 3): Model3 {
  const nodes = pts.flatMap(([x, y], k) => [{ id: `B${k}`, x, y, z: 0 }, { id: `T${k}`, x, y, z: h }]);
  const members: Model3["members"] = pts.map((_, k) => ({ id: `C${k}`, i: `B${k}`, j: `T${k}`, section: "COL", kind: "column" }));
  pts.forEach((_, k) => members.push({ id: `G${k}`, i: `T${k}`, j: `T${(k + 1) % pts.length}`, section: "RIG", kind: "beam" }));
  const m: Model3 = {
    name: "storey", nodes, members,
    supports: pts.map((_, k) => ({ node: `B${k}`, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true })),
    materials: [{ id: "M", name: "M", E, nu, gamma: 0 }],
    sections: [{ id: "COL", name: "c", material: "M", b: c, h: c }, { id: "RIG", name: "r", material: "M", b: 2, h: beamH }],
    loadCases: [], combos: [],
  };
  if (withDia) m.diaphragms = autoDiaphragms(m);
  return m;
}
const square: [number, number][] = [[0, 0], [6, 0], [6, 6], [0, 6]];

test("autoDiaphragms: หนึ่งชุดต่อชั้น ไม่รวมจุดที่ฐาน", () => {
  const d = autoDiaphragms(storey(square, false));
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].nodes.sort(), ["T0", "T1", "T2", "T3"]);
});

test("แรงแนวราบที่จุดอ้างอิง: 4 เสาเท่ากัน → Δ = H/(4·12EI/h³), เสาแต่ละต้นรับ H/4", () => {
  const H = 100;
  const m = storey(square);
  const r = analyze3d(m, [{ type: "nodal", node: m.diaphragms![0].id, fx: H, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }]);
  const dia = Object.values(r.diaphragms)[0];
  near(dia.x, 3, 1e-12, "จุดอ้างอิง x");
  near(dia.ux, H / (4 * kCol), 1e-2, "Δ (คานแข็งมาก; ต่างเล็กน้อยจากการหดตัวตามแกนของเสา)");
  near(dia.rz, 0, 1e-9, "ไม่หมุน (สมมาตร)");
  for (let k = 0; k < 4; k++) near(-r.reactions[`B${k}`].fx, H / 4, 1e-3, `แรงเฉือนเสา ${k}`);
});

test("โมเมนต์บิดที่จุดอ้างอิง: θ = M / [Σk(dx² + dy²) + ΣGJ/h]", () => {
  const M = 200;
  const m = storey(square);
  const r = analyze3d(m, [{ type: "nodal", node: m.diaphragms![0].id, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: M }]);
  const r2 = 3 * 3 + 3 * 3;
  const Ktheta = 4 * kCol * r2 + (4 * G * Jc) / h;
  near(Object.values(r.diaphragms)[0].rz, M / Ktheta, 2e-3, "θz");
});

test("จุดต่อใน diaphragm เคลื่อนตามสมการวัตถุแข็ง: ux = uxm − dy·θ, uy = uym + dx·θ", () => {
  const m = storey(square);
  const r = analyze3d(m, [{ type: "nodal", node: "T1", fx: 50, fy: 20, fz: -10, mx: 0, my: 0, mz: 0 }]);
  const d = Object.values(r.diaphragms)[0];
  for (const [k, [x, y]] of square.entries()) {
    const u = r.disp[`T${k}`];
    near(u.ux, d.ux - (y - d.y) * d.rz, 1e-9, `ux T${k}`);
    near(u.uy, d.uy + (x - d.x) * d.rz, 1e-9, `uy T${k}`);
    near(u.rz, d.rz, 1e-9, `rz T${k}`);
  }
  // สมดุลรวม
  const R = Object.values(r.reactions);
  near(R.reduce((a, x) => a + x.fx, 0), -50, 1e-9, "ΣRx");
  near(R.reduce((a, x) => a + x.fy, 0), -20, 1e-9, "ΣRy");
  near(R.reduce((a, x) => a + x.fz, 0), 10, 1e-9, "ΣRz");
});

test("เยื้องศูนย์: เสาแข็งด้านเดียว → ศูนย์กลางความแข็งเลื่อน พื้นหมุน และสมดุลแรงเฉือน = H", () => {
  const m = storey(square);
  // เสา C1, C2 (ด้าน x = 6) ใหญ่ขึ้น
  m.sections.push({ id: "BIG", name: "big", material: "M", b: 0.6, h: 0.6 });
  m.members.find((x) => x.id === "C1")!.section = "BIG";
  m.members.find((x) => x.id === "C2")!.section = "BIG";
  const H = 100;
  const r = analyze3d(m, [{ type: "nodal", node: m.diaphragms![0].id, fx: 0, fy: H, fz: 0, mx: 0, my: 0, mz: 0 }]);
  const d = Object.values(r.diaphragms)[0];
  assert.ok(Math.abs(d.rz) > 1e-6, "พื้นต้องหมุน");
  // แรง +Y ที่กึ่งกลาง แต่ความแข็งอยู่ด้าน +X → พื้นหมุนตามเข็ม (rz < 0)
  assert.ok(d.rz < 0, `rz = ${d.rz}`);
  near(-Object.values(r.reactions).reduce((a, x) => a + x.fy, 0), H, 1e-9, "ΣVy");
});

test("diaphragm เทียบกับคานแข็งมาก (ไม่มี diaphragm): การเคลื่อนตัวใกล้เคียงกัน", () => {
  const H = 100;
  const a = storey(square, true, 3);
  const b = storey(square, false, 3);
  const ra = analyze3d(a, [{ type: "nodal", node: "T0", fx: H, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }]);
  const rb = analyze3d(b, [{ type: "nodal", node: "T0", fx: H, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }]);
  near(ra.disp.T2.ux, rb.disp.T2.ux, 0.01, "ux มุมตรงข้าม");
});

test("จุดที่ถูกยึดในแนวราบไม่ถูกรวมใน diaphragm และหลายชั้นวิเคราะห์ได้", () => {
  // อาคาร 3 ชั้น 2×2 ช่วง พร้อม diaphragm ทุกชั้น
  const nodes: Model3["nodes"] = [], members: Model3["members"] = [], supports: Model3["supports"] = [];
  const id = (i: number, j: number, k: number) => `N${i}${j}${k}`;
  for (let k = 0; k <= 3; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) nodes.push({ id: id(i, j, k), x: i * 5, y: j * 4, z: k * 3.2 });
  let n = 0;
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) members.push({ id: `C${n++}`, i: id(i, j, k), j: id(i, j, k + 1), section: "COL", kind: "column" });
  for (let k = 1; k <= 3; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    if (i < 2) members.push({ id: `B${n++}`, i: id(i, j, k), j: id(i + 1, j, k), section: "RIG", kind: "beam" });
    if (j < 2) members.push({ id: `B${n++}`, i: id(i, j, k), j: id(i, j + 1, k), section: "RIG", kind: "beam" });
  }
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) supports.push({ node: id(i, j, 0), ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
  const m: Model3 = {
    name: "3s", nodes, members, supports,
    materials: [{ id: "M", name: "M", E, nu, gamma: 24 }],
    sections: [{ id: "COL", name: "c", material: "M", b: 0.4, h: 0.4 }, { id: "RIG", name: "b", material: "M", b: 0.3, h: 0.6 }],
    loadCases: [], combos: [],
  };
  m.diaphragms = autoDiaphragms(m);
  assert.equal(m.diaphragms.length, 3);
  const loads = m.diaphragms.map((d, k) => ({ type: "nodal" as const, node: d.id, fx: 10 * (k + 1), fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }));
  const r = analyze3d(m, loads, 1);
  near(-Object.values(r.reactions).reduce((a, x) => a + x.fx, 0), 60, 1e-9, "แรงเฉือนฐาน");
  const ux = m.diaphragms.map((d) => r.diaphragms[d.id].ux);
  assert.ok(ux[0] < ux[1] && ux[1] < ux[2], "การเคลื่อนตัวเพิ่มตามความสูง");
});
