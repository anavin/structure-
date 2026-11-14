import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/frame2d.ts";
import type { Member, Model } from "../src/core/model.ts";

const E = 2e7;
const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-9), `${msg}: ได้ ${a} คาด ${b}`);

function base(nodes: Model["nodes"], members: Member[], supports: Model["supports"], b = 0.3, h = 0.3): Model {
  return {
    name: "t", nodes, supports, members,
    materials: [{ id: "M", name: "M", E, gamma: 0 }],
    sections: [{ id: "S", name: "S", material: "M", b, h }],
    loadCases: [], combos: [],
  };
}
const FIX = (node: string) => ({ node, ux: true, uy: true, rz: true });

// ---------- ปลดปลาย ----------
test("ปลดโมเมนต์ทั้งสองปลายบนฐานยึดแน่น = คานช่วงเดียว: M = wL²/8, Mreaction = 0", () => {
  const L = 6, w = 10;
  const m = base([{ id: "A", x: 0, y: 0 }, { id: "B", x: L, y: 0 }],
    [{ id: "B1", i: "A", j: "B", section: "S", kind: "beam", releaseI: true, releaseJ: true }], [FIX("A"), FIX("B")]);
  const r = analyze(m, [{ type: "udl", member: "B1", dir: "globalY", w: -w }]);
  near(r.members.B1.maxM, (w * L * L) / 8, 1e-9, "Mmax");
  near(r.reactions.A.mz, 0, 1e-9, "Mz A");
  near(r.members.B1.endForces[2], 0, 1e-12, "M ปลาย i");
});

test("ปลดโมเมนต์ปลาย j = propped cantilever: Rj = 3wL/8, Mi = wL²/8", () => {
  const L = 5, w = 8;
  const m = base([{ id: "A", x: 0, y: 0 }, { id: "B", x: L, y: 0 }],
    [{ id: "B1", i: "A", j: "B", section: "S", kind: "beam", releaseJ: true }], [FIX("A"), FIX("B")]);
  const r = analyze(m, [{ type: "udl", member: "B1", dir: "globalY", w: -w }]);
  near(r.reactions.B.fy, (3 * w * L) / 8, 1e-9, "Rj");
  near(r.reactions.A.mz, (w * L * L) / 8, 1e-9, "Mi");
  near(r.reactions.B.mz, 0, 1e-9, "Mj");
});

test("โครงถักสามเหลี่ยม (ปลดทุกปลาย): จุดต่อหมุนอิสระไม่ทำให้เมทริกซ์เอกฐาน และแรงตามแกนตรงสถิตศาสตร์", () => {
  const m = base([{ id: "A", x: 0, y: 0 }, { id: "B", x: 4, y: 0 }, { id: "C", x: 2, y: 3 }],
    ["AB", "AC", "BC"].map((id) => ({ id, i: id[0], j: id[1], section: "S", kind: "other" as const, releaseI: true, releaseJ: true })),
    [{ node: "A", ux: true, uy: true, rz: false }, { node: "B", ux: false, uy: true, rz: false }]);
  const r = analyze(m, [{ type: "nodal", node: "C", fx: 0, fy: -10, mz: 0 }]);
  const Lac = Math.hypot(2, 3);
  const Fac = 10 / (2 * (3 / Lac));
  near(r.members.AC.minN, -Fac, 1e-9, "N AC (อัด)");
  near(r.members.AB.maxN, Fac * (2 / Lac), 1e-9, "N AB (ดึง)");
  near(Math.abs(r.members.AC.maxM), 0, 1e-9, "ไม่มีโมเมนต์");
});

test("ปลดโมเมนต์ตรงกลางคานยื่นสองท่อน (Gerber) — โมเมนต์ที่ hinge = 0", () => {
  const m = base([{ id: "A", x: 0, y: 0 }, { id: "B", x: 4, y: 0 }, { id: "C", x: 6, y: 0 }],
    [{ id: "B1", i: "A", j: "B", section: "S", kind: "beam" }, { id: "B2", i: "B", j: "C", section: "S", kind: "beam", releaseI: true }],
    [FIX("A"), { node: "C", ux: false, uy: true, rz: false }]);
  const r = analyze(m, [{ type: "udl", member: "B1", dir: "globalY", w: -10 }, { type: "udl", member: "B2", dir: "globalY", w: -10 }]);
  // B2 เป็นคานช่วงเดียว 2 m: แรงที่ hinge = wL/2 = 10 kN, R_C = 10
  near(r.reactions.C.fy, 10, 1e-9, "Rc");
  near(r.members.B1.endForces[5], 0, 1e-9, "M ที่ hinge ฝั่ง B1");
  near(r.reactions.A.mz, 10 * 4 * 2 + 10 * 4, 1e-9, "M ฐาน = wL²/2 + V·L");
});

// ---------- P-Delta ----------
function cantilever(nEl: number, L: number): Model {
  const nodes = Array.from({ length: nEl + 1 }, (_, k) => ({ id: `N${k}`, x: 0, y: (L * k) / nEl }));
  const members = nodes.slice(0, -1).map((n, k) => ({ id: `C${k}`, i: n.id, j: nodes[k + 1].id, section: "S", kind: "column" as const }));
  return base(nodes, members, [FIX("N0")]);
}
const EI = E * 0.3 ** 4 / 12;
const L = 4, H = 10;
function exactTip(P: number) {
  const u = Math.sqrt(P / EI);
  return (H * (Math.tan(u * L) - u * L)) / (P * u);
}

test("P-Delta คานยื่นรับแรงอัด P = 0.29Pcr + แรงด้านข้าง: δ ตรงผลเฉลยปิด (4 ชิ้นย่อย < 0.5%)", () => {
  const P = 600;
  const m = cantilever(4, L);
  const top = "N4";
  const r = analyze(m, [{ type: "nodal", node: top, fx: H, fy: -P, mz: 0 }], 0, { pDelta: true });
  near(r.disp[top].ux, exactTip(P), 5e-3, "δ ยอด");
  // M ฐาน = H·L + P·δ (สมดุลบนรูปร่างที่เสียรูป)
  near(r.reactions.N0.mz, H * L + P * r.disp[top].ux, 5e-3, "M ฐาน (ทวนเข็ม)");
  assert.ok(r.info!.iterations > 2 && r.info!.converged);
});

test("P-Delta ชิ้นเดียว: ความคลาดเคลื่อน < 2% และขยายมากกว่าวิเคราะห์เชิงเส้น", () => {
  const P = 600;
  const m = cantilever(1, L);
  const lin = analyze(m, [{ type: "nodal", node: "N1", fx: H, fy: -P, mz: 0 }]);
  const r = analyze(m, [{ type: "nodal", node: "N1", fx: H, fy: -P, mz: 0 }], 0, { pDelta: true });
  near(r.disp.N1.ux, exactTip(P), 0.02, "δ ยอด");
  assert.ok(r.disp.N1.ux > lin.disp.N1.ux * 1.3);
  // โมเมนต์ตามความยาวต่อเนื่องถึงปลายบน (M ที่ยอด ≈ 0)
  const st = r.members.C0.stations;
  near(st[st.length - 1].M, 0, 1e-6, "M ยอด");
});

test("P-Delta แรงดึงทำให้การโก่งน้อยลง", () => {
  const m = cantilever(4, L);
  const lin = analyze(m, [{ type: "nodal", node: "N4", fx: H, fy: 600, mz: 0 }]);
  const r = analyze(m, [{ type: "nodal", node: "N4", fx: H, fy: 600, mz: 0 }], 0, { pDelta: true });
  assert.ok(r.disp.N4.ux < lin.disp.N4.ux);
});

test("P-Delta แรงอัดเกิน Pcr ต้องแจ้งไม่มีเสถียรภาพ", () => {
  const Pcr = (Math.PI ** 2 * EI) / (4 * L * L);
  const m = cantilever(4, L);
  assert.throws(() => analyze(m, [{ type: "nodal", node: "N4", fx: H, fy: -1.2 * Pcr, mz: 0 }], 0, { pDelta: true }), /P-Delta/);
});
