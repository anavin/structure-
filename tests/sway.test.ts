import { test } from "node:test";
import assert from "node:assert/strict";
import { kSwayFromPsi, swayAnalysis } from "../src/design/sway.ts";
import type { Model } from "../src/core/model.ts";

const near = (a: number, b: number, rel: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${msg}: ได้ ${a} คาด ${b}`);

const E = 2e7, h = 3.5, H = 20;
function portal(P: number): Model {
  return {
    name: "portal",
    nodes: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 0, y: h }, { id: "C", x: 6, y: h }, { id: "D", x: 6, y: 0 }],
    supports: [{ node: "A", ux: true, uy: true, rz: true }, { node: "D", ux: true, uy: true, rz: true }],
    materials: [{ id: "M", name: "M", E, gamma: 0 }],
    sections: [
      { id: "COL", name: "c", material: "M", b: 0.3, h: 0.3 },
      { id: "RIG", name: "r", material: "M", b: 2, h: 40 },
    ],
    members: [
      { id: "C1", i: "A", j: "B", section: "COL", kind: "column" },
      { id: "B1", i: "B", j: "C", section: "RIG", kind: "beam" },
      { id: "C2", i: "D", j: "C", section: "COL", kind: "column" },
    ],
    loadCases: [
      { id: "G", name: "G", selfWeight: false, loads: [{ type: "nodal", node: "B", fx: 0, fy: -P, mz: 0 }, { type: "nodal", node: "C", fx: 0, fy: -P, mz: 0 }] },
      { id: "W", name: "W", selfWeight: false, loads: [{ type: "nodal", node: "B", fx: H, fy: 0, mz: 0 }] },
    ],
    combos: [{ id: "U", name: "G+W", factors: { G: 1, W: 1 } }],
  };
}
const Ieff = 0.7 * 0.3 ** 4 / 12;
const drift = (H * h ** 3) / (24 * E * Ieff);

test("k แบบเซจาก ψ: ψ = 1, 1 → k = 0.95√2; ψm = 10 → 0.9√11", () => {
  near(kSwayFromPsi(1, 1), 0.95 * Math.SQRT2, 1e-12, "k");
  near(kSwayFromPsi(10, 10), 0.9 * Math.sqrt(11), 1e-12, "k");
});

test("Portal คานแข็ง: Q = ΣPu·Δo/(Vus·lc) ใช้ 0.70Ig, δs = 1/(1−Q), M = δs·Hh/4", () => {
  const P = 925;
  const r = swayAnalysis(portal(P), portal(P).combos);
  const st = r.storeys[0].combos[0];
  const Qhand = (2 * P * drift) / (H * h);
  near(st.drift, drift, 5e-3, "Δo");
  near(st.Vus, H, 1e-6, "Vus");
  near(st.Q, Qhand, 5e-3, "Q");
  assert.equal(st.sway, true);
  assert.equal(st.method, "Q");
  near(st.deltaS, 1 / (1 - Qhand), 5e-3, "δs");
  const c1 = r.columns.C1.combos[0];
  near(Math.abs(c1.Mtop), (1 / (1 - Qhand)) * (H * h) / 4, 1e-2, "M ปลายบนหลังขยาย");
  assert.ok(Math.abs(c1.MtopNs) < 1e-6, "แรงในแนวดิ่งที่จุดต่อไม่ทำให้เกิดโมเมนต์ในเสา");
});

test("แรงแนวดิ่งน้อย → Q ≤ 0.05 ชั้นไม่เซ δs = 1", () => {
  const r = swayAnalysis(portal(100), portal(100).combos);
  assert.equal(r.storeys[0].combos[0].sway, false);
  assert.equal(r.columns.C1.combos[0].deltaS, 1);
});

test("Q สูง (δs จาก Q > 1.5) → ใช้วิธี ΣPc และตรวจพบชั้นไม่มีเสถียรภาพ", () => {
  const r = swayAnalysis(portal(3700), portal(3700).combos);
  const st = r.storeys[0].combos[0];
  assert.equal(st.method, "ΣPc");
  // k จาก ψบน ≈ 0 (คานแข็งมาก), ψล่าง = 1 (ยึดแน่น) → Pc ≈ 3051 kN ต่อต้น
  near(st.sumPc, 2 * 3051, 5e-3, "ΣPc");
  assert.equal(st.unstable, true);
});
