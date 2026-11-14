// วิเคราะห์ประวัติเวลาแบบรวมโหมด (linear modal response history)
//   โหมด n: q̈ + 2ζωq̇ + ω²q = −Γ·ag(t),  Γ = φᵀM·r / φᵀMφ  (Newmark ค่าเฉลี่ยความเร่ง)
//   การเคลื่อนตัวจุดอ้างอิงพื้น u(t) = Σ φₙ·qₙ(t) · แรงเฉือนฐาน V(t) = Σ ωₙ²·qₙ·Σ(Mφₙ)ทิศนั้น
//   ผลทั้งโครง ณ เวลา t = Σ qₙ(t) × ผลของโหมด n ที่ q = 1 (แรง ω²Mφ ที่จุดอ้างอิง)
//   ผลยืดหยุ่น (ไม่หาร R) — เทียบแรงออกแบบด้วย V·Ie/R

import type { AnalysisResult3 } from "./frame3d.ts";
import type { ModalResult } from "./modal3d.ts";
import { linearResults } from "./rsa3d.ts";
import type { GroundMotion } from "../loads/groundMotion.ts";

const G = 9.80665;

export interface TimeHistoryResult {
  dir: "X" | "Y"; dt: number; n: number;
  ag: number[]; // g
  roof: number[]; // m
  V: number[]; // kN (ยืดหยุ่น)
  q: number[][]; // [โหมด][ขั้นเวลา]
  unit: AnalysisResult3[]; // ผลของแต่ละโหมดที่ q = 1
  driftMax: number[]; // m (ล่าง → บน) ค่าสูงสุดตลอดเวลา
  storeyH: number[];
  max: { roof: number; tRoof: number; V: number; tV: number };
}

export function modalTimeHistory(modal: ModalResult, gm: GroundMotion, dir: "X" | "Y", zeta = 0.05): TimeHistoryResult {
  const c = dir === "X" ? 0 : 1;
  const dt = gm.dt, N = gm.ag.length;
  const dias = [...new Set(modal.dofs.map((d) => d.dia))];
  const unit0 = modal.unit[0];
  const diaZ = dias.map((id) => unit0.diaphragms[id].z);
  const order = dias.map((_, k) => k).sort((a, b) => diaZ[a] - diaZ[b]);
  const dofIdx = (dia: string) => modal.dofs.findIndex((d) => d.dia === dia && d.c === c);
  const roofDof = dofIdx(dias[order[order.length - 1]]);
  const q: number[][] = [], unit: AnalysisResult3[] = [], Vcoef: number[] = [];
  for (const m of modal.modes) {
    const mphi = m.shape.reduce((a, v, i) => a + modal.masses[i] * v * v, 0);
    const L = m.shape.reduce((a, v, i) => a + (modal.dofs[i].c === c ? modal.masses[i] * v : 0), 0);
    const gamma = L / mphi;
    const w = m.omega, k = w * w, cc = 2 * zeta * w;
    const a0 = 4 / (dt * dt), a1 = 2 / dt, kh = k + a0 + a1 * cc;
    const qs = new Array<number>(N).fill(0);
    let u = 0, v = 0, a = -gamma * gm.ag[0] * G;
    for (let i = 1; i < N; i++) {
      const p = -gamma * gm.ag[i] * G + (a0 * u + (4 / dt) * v + a) + cc * (a1 * u + v);
      const un = p / kh, vn = (2 / dt) * (un - u) - v, an = a0 * (un - u) - (4 / dt) * v - a;
      u = un; v = vn; a = an; qs[i] = u;
    }
    q.push(qs);
    const f = m.shape.map((p, i) => k * modal.masses[i] * p);
    unit.push(linearResults(modal.unit, f));
    Vcoef.push(f.reduce((s, x, i) => s + (modal.dofs[i].c === c ? x : 0), 0));
  }
  const roof = new Array<number>(N).fill(0), V = new Array<number>(N).fill(0);
  const ns = order.length;
  const driftMax = new Array<number>(ns).fill(0);
  const dofsOrdered = order.map((k) => dofIdx(dias[k]));
  for (let i = 0; i < N; i++) {
    let r = 0, vb = 0;
    const u = new Array<number>(ns).fill(0);
    modal.modes.forEach((m, n) => {
      const qi = q[n][i];
      r += m.shape[roofDof] * qi; vb += Vcoef[n] * qi;
      for (let s = 0; s < ns; s++) u[s] += m.shape[dofsOrdered[s]] * qi;
    });
    roof[i] = r; V[i] = vb;
    for (let s = 0; s < ns; s++) { const d = Math.abs(u[s] - (s ? u[s - 1] : 0)); if (d > driftMax[s]) driftMax[s] = d; }
  }
  const zSorted = order.map((k) => diaZ[k]);
  const storeyH = zSorted.map((z, s) => z - (s ? zSorted[s - 1] : 0)); // ฐานอยู่ที่ z = 0
  const iR = roof.reduce((bi, x, i) => (Math.abs(x) > Math.abs(roof[bi]) ? i : bi), 0);
  const iV = V.reduce((bi, x, i) => (Math.abs(x) > Math.abs(V[bi]) ? i : bi), 0);
  return { dir, dt, n: N, ag: gm.ag, roof, V, q, unit, driftMax, storeyH, max: { roof: Math.abs(roof[iR]), tRoof: iR * dt, V: Math.abs(V[iV]), tV: iV * dt } };
}

/** ผลทั้งโครง ณ ขั้นเวลา i */
export function thResultAt(th: TimeHistoryResult, i: number): AnalysisResult3 {
  return linearResults(th.unit, th.q.map((qs) => qs[Math.max(0, Math.min(th.n - 1, i))]));
}
