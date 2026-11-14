// วิเคราะห์การสั่นอิสระ (modal analysis) ของอาคารที่มีพื้นแข็ง
//   มวลรวมที่จุดอ้างอิงพื้นแต่ละชั้น: M (ux, uy) และโมเมนต์ความเฉื่อยมวล J = M·(Bx² + By²)/12 (rz)
//   ความยืดหยุ่น F: ใส่แรงหนึ่งหน่วยที่ DOF ของจุดอ้างอิงทีละตัว แล้วอ่านการเคลื่อนตัวของทุกจุดอ้างอิง (สถิตเชิงเส้น)
//   แก้ D = M^½·F·M^½ (สมมาตร) ด้วย Jacobi → λ = 1/ω², φ = M^-½·v
//   รูปร่างโหมดทั้งโครง = Σ (ω²·m_q·φ_q) × ผลของแรงหนึ่งหน่วยที่ q
//   สัดส่วนมวลประสิทธิผล = (φᵀMr)² / (φᵀMφ) / ΣM

import { analyze3d, type AnalysisResult3, type MemberResult3 } from "./frame3d.ts";
import { modelOptions3 } from "./combos3d.ts";
import type { Model3 } from "./model3d.ts";

export interface ModalMode { n: number; T: number; f: number; omega: number; mx: number; my: number; mr: number; dir: "X" | "Y" | "R"; shape: number[] }
export interface ModalResult { modes: ModalMode[]; dofs: { dia: string; c: 0 | 1 | 2 }[]; masses: number[]; unit: AnalysisResult3[]; total: { M: number; J: number } }

const G = 9.80665;

/** Jacobi eigen ของเมทริกซ์สมมาตร → ค่าเฉพาะ + เวกเตอร์เฉพาะ (คอลัมน์) */
export function jacobiEigen(Ain: number[][], tol = 1e-12, maxSweep = 100): { values: number[]; vectors: number[][] } {
  const n = Ain.length;
  const A = Ain.map((r) => [...r]);
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < maxSweep; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < tol * tol) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

/**
 * @param weights น้ำหนักรายชั้น (kN) ตามลำดับพื้นจากล่างขึ้นบน (เท่ากับจำนวน diaphragm)
 * @param plan ขนาดผังอาคาร (m) สำหรับโมเมนต์ความเฉื่อยมวล
 */
export function modalAnalysis(model: Model3, weights: number[], plan: { Bx: number; By: number }, nModes = 12): ModalResult {
  const dias = [...(model.diaphragms ?? [])];
  if (!dias.length) throw new Error("ต้องเปิดพื้นแข็ง (rigid diaphragm) เพื่อวิเคราะห์การสั่น");
  const z = (id: string) => model.nodes.find((n) => n.id === model.diaphragms!.find((d) => d.id === id)!.nodes[0])!.z;
  dias.sort((a, b) => z(a.id) - z(b.id));
  const opts = { ...modelOptions3(model), pDelta: false };
  const dofs: ModalResult["dofs"] = [];
  const masses: number[] = [];
  let Mt = 0, Jt = 0;
  dias.forEach((d, k) => {
    const M = (weights[k] ?? 0) / G; // kN·s²/m (ตัน)
    const J = (M * (plan.Bx ** 2 + plan.By ** 2)) / 12;
    Mt += M; Jt += J;
    for (const c of [0, 1, 2] as const) { dofs.push({ dia: d.id, c }); masses.push(c === 2 ? J : M); }
  });
  const n = dofs.length;
  // ผลของแรงหนึ่งหน่วยที่แต่ละ DOF
  const unit = dofs.map((q) => analyze3d(model, [{ type: "nodal", node: q.dia, fx: q.c === 0 ? 1 : 0, fy: q.c === 1 ? 1 : 0, fz: 0, mx: 0, my: 0, mz: q.c === 2 ? 1 : 0 }], 0, opts));
  const F = unit.map((r) => dofs.map((p) => { const d = r.diaphragms[p.dia]; return p.c === 0 ? d.ux : p.c === 1 ? d.uy : d.rz; }));
  // ทำให้สมมาตร (ความคลาดเคลื่อนเชิงตัวเลข) แล้ว D = M^½ F M^½ (F[q][p] = การเคลื่อนตัวที่ p จากแรงที่ q)
  const sq = masses.map((m) => Math.sqrt(Math.max(m, 1e-12)));
  const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => sq[i] * 0.5 * (F[i][j] + F[j][i]) * sq[j]));
  const { values, vectors } = jacobiEigen(D);
  const order = values.map((v, i) => [v, i] as const).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]);
  const modes: ModalMode[] = order.slice(0, nModes).map(([lam, idx], k) => {
    const phi = vectors.map((row, i) => row[idx] / sq[i]);
    const omega = 1 / Math.sqrt(lam);
    const mphi = phi.reduce((a, v, i) => a + masses[i] * v * v, 0);
    const L = (c: number) => phi.reduce((a, v, i) => a + (dofs[i].c === c ? masses[i] * v : 0), 0);
    const mx = (L(0) ** 2 / mphi) / Mt, my = (L(1) ** 2 / mphi) / Mt, mr = (L(2) ** 2 / mphi) / Jt;
    const dir = mx >= my && mx >= mr ? "X" : my >= mr ? "Y" : "R";
    return { n: k + 1, T: (2 * Math.PI) / omega, f: omega / (2 * Math.PI), omega, mx, my, mr, dir, shape: phi };
  });
  return { modes, dofs, masses, unit, total: { M: Mt, J: Jt } };
}

/** รวมผลเชิงเส้น Σ cᵢ·Rᵢ (การเคลื่อนตัว แรงในชิ้นส่วน) — ใช้สร้างรูปร่างโหมดทั้งโครง */
export function combineResults(rs: AnalysisResult3[], cs: number[]): AnalysisResult3 {
  const base = rs[0];
  const disp: AnalysisResult3["disp"] = {};
  for (const id of Object.keys(base.disp)) {
    const o = { ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 };
    rs.forEach((r, k) => { const d = r.disp[id]; for (const key of Object.keys(o) as (keyof typeof o)[]) o[key] += cs[k] * d[key]; });
    disp[id] = o;
  }
  const members: AnalysisResult3["members"] = {};
  for (const id of Object.keys(base.members)) {
    const m0 = base.members[id];
    const endForces = m0.endForces.map((_, i) => rs.reduce((a, r, k) => a + cs[k] * r.members[id].endForces[i], 0));
    const stations = m0.stations.map((s, i) => {
      const o = { ...s, N: 0, Vy: 0, Vz: 0, T: 0, My: 0, Mz: 0, v: 0, w: 0 };
      rs.forEach((r, k) => { const t = r.members[id].stations[i]; o.N += cs[k] * t.N; o.Vy += cs[k] * t.Vy; o.Vz += cs[k] * t.Vz; o.T += cs[k] * t.T; o.My += cs[k] * t.My; o.Mz += cs[k] * t.Mz; o.v += cs[k] * t.v; o.w += cs[k] * t.w; });
      return o;
    });
    const mx = (f: (s: typeof stations[number]) => number) => Math.max(...stations.map((s) => Math.abs(f(s))));
    const mr: MemberResult3 = {
      ...m0, endForces, stations,
      maxAbs: { N: mx((s) => s.N), Vy: mx((s) => s.Vy), Vz: mx((s) => s.Vz), T: mx((s) => s.T), My: mx((s) => s.My), Mz: mx((s) => s.Mz) },
      minN: Math.min(...stations.map((s) => s.N)), maxN: Math.max(...stations.map((s) => s.N)),
    };
    members[id] = mr;
  }
  const diaphragms: AnalysisResult3["diaphragms"] = {};
  for (const [id, d0] of Object.entries(base.diaphragms)) {
    diaphragms[id] = { ...d0, ux: 0, uy: 0, rz: 0 };
    rs.forEach((r, k) => { const d = r.diaphragms[id]; diaphragms[id].ux += cs[k] * d.ux; diaphragms[id].uy += cs[k] * d.uy; diaphragms[id].rz += cs[k] * d.rz; });
  }
  return { ...base, disp, members, diaphragms, reactions: base.reactions, appliedTotal: { fx: 0, fy: 0, fz: 0 } };
}

/** รูปร่างโหมดทั้งโครง (ปรับให้การเคลื่อนตัวสูงสุดเป็น 1) */
export function modeShapeResult(res: ModalResult, mode: ModalMode): AnalysisResult3 {
  const cs = mode.shape.map((p, q) => mode.omega * mode.omega * res.masses[q] * p);
  const r = combineResults(res.unit, cs);
  let mx = 0;
  for (const d of Object.values(r.disp)) mx = Math.max(mx, Math.hypot(d.ux, d.uy, d.uz));
  return mx > 0 ? combineResults([r], [1 / mx]) : r;
}

/** คาบหลักตามทิศ (โหมดที่มีมวลประสิทธิผลทิศนั้นมากที่สุด) */
export function dominantPeriods(res: ModalResult): { Tx: number; Ty: number } {
  const best = (k: "mx" | "my") => res.modes.reduce((a, m) => (m[k] > a[k] ? m : a), res.modes[0]);
  return { Tx: best("mx")?.T ?? 0, Ty: best("my")?.T ?? 0 };
}
