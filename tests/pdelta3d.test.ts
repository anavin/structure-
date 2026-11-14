import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze3d } from "../src/core3d/frame3d.ts";
import type { Model3 } from "../src/core3d/model3d.ts";
import { analyze } from "../src/core/frame2d.ts";
import { sampleModel } from "../src/ui/sample.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-9), `${msg}: ได้ ${a} คาด ${b}`);

const E = 2e7, b = 0.3, h = 0.45, L = 4;
const IzX = (b * h ** 3) / 12; // h ตามแกน 2 = global X → ดัดรับแรง X ใช้ Iz
const IyY = (h * b ** 3) / 12;

function column(nEl: number): Model3 {
  const nodes = Array.from({ length: nEl + 1 }, (_, k) => ({ id: `N${k}`, x: 0, y: 0, z: (L * k) / nEl }));
  return {
    name: "col", nodes,
    members: nodes.slice(0, -1).map((n, k) => ({ id: `C${k}`, i: n.id, j: nodes[k + 1].id, section: "S", kind: "column" as const })),
    supports: [{ node: "N0", ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    materials: [{ id: "M", name: "M", E, nu: 0.2, gamma: 0 }],
    sections: [{ id: "S", name: "S", material: "M", b, h }],
    loadCases: [], combos: [],
  };
}
const exact = (H: number, P: number, EI: number) => { const u = Math.sqrt(P / EI); return (H * (Math.tan(u * L) - u * L)) / (P * u); };

test("P-Delta 3D เสายื่นรับ P + แรงด้านข้างสองแกน: δx (Iz) และ δy (Iy) ตรงผลเฉลยปิด (< 0.5%)", () => {
  const P = 500, Hx = 10, Hy = 6;
  const m = column(4);
  const r = analyze3d(m, [{ type: "nodal", node: "N4", fx: Hx, fy: Hy, fz: -P, mx: 0, my: 0, mz: 0 }], 0, { pDelta: true });
  near(r.disp.N4.ux, exact(Hx, P, E * IzX), 5e-3, "δx");
  near(r.disp.N4.uy, exact(Hy, P, E * IyY), 5e-3, "δy");
  // สมดุลบนรูปที่เสียรูป: My ฐาน = −(Hx·L + P·δx), Mx ฐาน = Hy·L + P·δy
  near(r.reactions.N0.my, -(Hx * L + P * r.disp.N4.ux), 5e-3, "My ฐาน");
  near(r.reactions.N0.mx, Hy * L + P * r.disp.N4.uy, 5e-3, "Mx ฐาน");
  assert.ok(r.info.pDelta && r.info.iterations > 2);
});

test("P-δ ตามความยาว: เสาชิ้นเดียว M ที่ฐานจากแรงภายในต่อเนื่องกับแรงปฏิกิริยา", () => {
  const P = 500, Hx = 10;
  const r = analyze3d(column(1), [{ type: "nodal", node: "N1", fx: Hx, fy: 0, fz: -P, mx: 0, my: 0, mz: 0 }], 0, { pDelta: true });
  const st = r.members.C0.stations;
  near(Math.abs(st[0].Mz), Math.abs(r.reactions.N0.my), 1e-6, "M ฐาน");
  near(st[st.length - 1].Mz, 0, 1e-6, "M ยอด");
  near(r.disp.N1.ux, exact(Hx, P, E * IzX), 0.02, "δ (1 ชิ้น < 2%)");
});

test("P-Delta 3D = P-Delta 2D บนโครงตัวอย่างในระนาบ XZ", () => {
  const m2 = sampleModel();
  const m: Model3 = {
    name: "from2d",
    nodes: m2.nodes.map((n) => ({ id: n.id, x: n.x, y: 0, z: n.y })),
    supports: m2.supports.map((s) => ({ node: s.node, ux: s.ux, uy: true, uz: s.uy, rx: true, ry: s.rz, rz: true })),
    materials: m2.materials.map((x) => ({ id: x.id, name: x.name, E: x.E, nu: 0.2, gamma: x.gamma })),
    sections: m2.sections.map((s) => ({ ...s })),
    members: m2.members.map((x) => ({ id: x.id, i: x.i, j: x.j, section: x.section, kind: x.kind })),
    loadCases: [], combos: [],
  };
  // DL × 3 (รวมน้ำหนักตัวเอง) + ลม × 10 เพื่อให้ผล P-Δ ชัดเจน
  const loads2 = [...m2.loadCases[0].loads, ...m2.loadCases[2].loads].map((l) =>
    l.type === "nodal" ? { ...l, fx: l.fx * 10 } : l.type === "udl" ? { ...l, w: l.w * 3 } : l);
  const r2 = analyze(m2, loads2, 3, { pDelta: true });
  const r3 = analyze3d(m, loads2.map((l) => l.type === "nodal"
    ? { type: "nodal" as const, node: l.node, fx: l.fx, fy: 0, fz: l.fy, mx: 0, my: -l.mz, mz: 0 }
    : l.type === "udl" ? { type: "udl" as const, member: l.member, dir: "GZ" as const, w: l.w }
    : { type: "point" as const, member: l.member, dir: "GZ" as const, P: l.P, a: l.a }), 3, { pDelta: true });
  for (const n of m2.nodes) near(r3.disp[n.id].ux, r2.disp[n.id].ux, 1e-6, `ux ${n.id}`);
  for (const s of m2.supports) near(-r3.reactions[s.node].my, r2.reactions[s.node].mz, 1e-6, `M ${s.node}`);
});

test("หน้าตัดแตกร้าว (iFactor 0.7) ทำให้การเคลื่อนตัวจากการดัดเพิ่มเป็น 1/0.7 เท่า", () => {
  const H = 10;
  const a = analyze3d(column(1), [{ type: "nodal", node: "N1", fx: H, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }]);
  const c = analyze3d(column(1), [{ type: "nodal", node: "N1", fx: H, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }], 0, { iFactor: () => 0.7 });
  near(c.disp.N1.ux, a.disp.N1.ux / 0.7, 1e-9, "δ แตกร้าว");
});

test("P-Delta 3D แรงอัดเกิน Pcr ของแกนอ่อนต้องแจ้งไม่มีเสถียรภาพ", () => {
  const Pcr = (Math.PI ** 2 * E * IyY) / (4 * L * L);
  assert.throws(() => analyze3d(column(4), [{ type: "nodal", node: "N4", fx: 0, fy: 1, fz: -1.1 * Pcr, mx: 0, my: 0, mz: 0 }], 0, { pDelta: true }), /P-Delta/);
});
