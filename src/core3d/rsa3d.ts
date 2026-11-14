// วิเคราะห์แบบสเปกตรัมการตอบสนอง (Response Spectrum Analysis) — มยผ. 1301/1302-61 / ASCE 7 §12.9.1
//   โหมด n ทิศ d: Γ = φᵀM·r / φᵀMφ, A = Sa(Tn)·g·Ie/R → แรงสถิตเทียบเท่าของโหมด f = M·φ·Γ·A ที่จุดอ้างอิงพื้น
//   ผลของโหมด = Σ f_q × ผลของแรงหนึ่งหน่วยที่ q (เชิงเส้น) · รวมโหมดด้วย CQC (ความหน่วง 5%)
//     ρij = 8ζ²(1 + r)r^1.5 / [(1 − r²)² + 4ζ²r(1 + r)²], r = ωj/ωi
//   drift รายชั้นรวม CQC จาก drift ของแต่ละโหมด (ไม่ใช่ผลต่างของการเคลื่อนตัวที่รวมแล้ว)
//   ผลรวมเป็นค่าบวก (ขนาด) — ในชุดผสมใช้ ± ตามเครื่องหมายตัวประกอบ

import type { AnalysisResult3, MemberResult3 } from "./frame3d.ts";
import type { ModalResult } from "./modal3d.ts";

const G = 9.80665;

export function cqcRho(wi: number, wj: number, z = 0.05): number {
  const r = wj / wi;
  return (8 * z * z * (1 + r) * r ** 1.5) / ((1 - r * r) ** 2 + 4 * z * z * r * (1 + r) ** 2);
}

/** ใช้ฟังก์ชันกับค่าที่ตำแหน่งเดียวกันของผลหลายชุด (โครงสร้างข้อมูลเหมือน rs[0]) */
export function mapResults(rs: AnalysisResult3[], fn: (v: number[]) => number): AnalysisResult3 {
  const b = rs[0];
  const disp: AnalysisResult3["disp"] = {};
  for (const id of Object.keys(b.disp)) {
    const o = { ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 };
    for (const k of Object.keys(o) as (keyof typeof o)[]) o[k] = fn(rs.map((r) => r.disp[id][k]));
    disp[id] = o;
  }
  const reactions: AnalysisResult3["reactions"] = {};
  for (const id of Object.keys(b.reactions)) {
    const o = { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
    for (const k of Object.keys(o) as (keyof typeof o)[]) o[k] = fn(rs.map((r) => r.reactions[id][k]));
    reactions[id] = o;
  }
  const members: AnalysisResult3["members"] = {};
  for (const id of Object.keys(b.members)) {
    const m0 = b.members[id];
    const endForces = m0.endForces.map((_, i) => fn(rs.map((r) => r.members[id].endForces[i])));
    const stations = m0.stations.map((s, i) => {
      const g = (k: "N" | "Vy" | "Vz" | "T" | "My" | "Mz" | "v" | "w") => fn(rs.map((r) => r.members[id].stations[i][k]));
      return { x: s.x, N: g("N"), Vy: g("Vy"), Vz: g("Vz"), T: g("T"), My: g("My"), Mz: g("Mz"), v: g("v"), w: g("w") };
    });
    const mx = (f: (s: (typeof stations)[number]) => number) => Math.max(...stations.map((s) => Math.abs(f(s))));
    const mr: MemberResult3 = {
      ...m0, endForces, stations,
      maxAbs: { N: mx((s) => s.N), Vy: mx((s) => s.Vy), Vz: mx((s) => s.Vz), T: mx((s) => s.T), My: mx((s) => s.My), Mz: mx((s) => s.Mz) },
      minN: Math.min(...stations.map((s) => s.N)), maxN: Math.max(...stations.map((s) => s.N)),
    };
    members[id] = mr;
  }
  const diaphragms: AnalysisResult3["diaphragms"] = {};
  for (const [id, d0] of Object.entries(b.diaphragms)) diaphragms[id] = { ...d0, ux: fn(rs.map((r) => r.diaphragms[id].ux)), uy: fn(rs.map((r) => r.diaphragms[id].uy)), rz: fn(rs.map((r) => r.diaphragms[id].rz)) };
  return { ...b, disp, reactions, members, diaphragms, appliedTotal: { fx: 0, fy: 0, fz: 0 } };
}

/** รวมเชิงเส้น Σ cᵢ·Rᵢ */
export const linearResults = (rs: AnalysisResult3[], cs: number[]) => mapResults(rs, (v) => v.reduce((a, x, i) => a + cs[i] * x, 0));

export interface RsaInfo {
  dir: "X" | "Y"; V: number; Vstatic: number; scale: number; nModes: number; mass: number;
  /** δe รายชั้น (m, รวม CQC แล้ว — ไม่คูณ scale ตาม ASCE 7 §12.9.1.4.2) ล่าง → บน */
  drifts: number[];
  modes: { n: number; T: number; Sa: number; V: number }[];
}
export type RsaResult3 = AnalysisResult3 & { rsa?: RsaInfo };

/**
 * @param saG ฟังก์ชันสเปกตรัมออกแบบ Sa(T) หน่วย g
 */
export function responseSpectrum(res: ModalResult, dir: "X" | "Y", saG: (T: number) => number, Ie: number, R: number, zeta = 0.05): { result: AnalysisResult3; V: number; drifts: number[]; modes: RsaInfo["modes"]; mass: number } {
  const c = dir === "X" ? 0 : 1;
  const modes = res.modes;
  const per = modes.map((m) => {
    const mphi = m.shape.reduce((a, v, q) => a + res.masses[q] * v * v, 0);
    const L = m.shape.reduce((a, v, q) => a + (res.dofs[q].c === c ? res.masses[q] * v : 0), 0);
    const gamma = L / mphi;
    const Sa = saG(m.T);
    const A = (Sa * G * Ie) / R;
    const f = m.shape.map((v, q) => res.masses[q] * v * gamma * A);
    const V = f.reduce((a, x, q) => a + (res.dofs[q].c === c ? x : 0), 0);
    return { m, f, V, Sa };
  });
  const rho = per.map((a) => per.map((b) => cqcRho(a.m.omega, b.m.omega, zeta)));
  const cqc = (xs: number[]) => { let s = 0; for (let i = 0; i < xs.length; i++) for (let j = 0; j < xs.length; j++) s += rho[i][j] * xs[i] * xs[j]; return Math.sqrt(Math.max(0, s)); };
  const modal = per.map((p) => linearResults(res.unit, p.f));
  const result = mapResults(modal, cqc);
  // drift รายชั้น: ผลต่างของจุดอ้างอิงพื้นในแต่ละโหมด แล้วรวม CQC
  const dias = Object.entries(modal[0].diaphragms).sort((a, b) => a[1].z - b[1].z).map(([id]) => id);
  const drifts = dias.map((id, k) => cqc(modal.map((r) => {
    const u = dir === "X" ? r.diaphragms[id].ux : r.diaphragms[id].uy;
    const u0 = k ? (dir === "X" ? r.diaphragms[dias[k - 1]].ux : r.diaphragms[dias[k - 1]].uy) : 0;
    return u - u0;
  })));
  const mass = modes.reduce((a, m) => a + (dir === "X" ? m.mx : m.my), 0);
  return { result, V: cqc(per.map((p) => p.V)), drifts, modes: per.map((p) => ({ n: p.m.n, T: p.m.T, Sa: p.Sa, V: Math.abs(p.V) })), mass };
}
