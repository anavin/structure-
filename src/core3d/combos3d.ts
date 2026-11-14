// Load case / ชุดผสม สำหรับตัววิเคราะห์ 3D — รวมแรงตามตัวคูณแล้ววิเคราะห์ครั้งเดียว (ถูกต้องทั้งเชิงเส้นและ P-Delta)

import { modalAnalysis } from "./modal3d.ts";
import { linearResults, mapResults, responseSpectrum, type RsaResult3 } from "./rsa3d.ts";
import { Sa } from "../loads/seismicTH.ts";
import { analyze3d, type AnalysisResult3, type Analyze3Options } from "./frame3d.ts";
import type { Combo3, Load3, Model3 } from "./model3d.ts";

export function scaleLoad3(l: Load3, f: number): Load3 {
  switch (l.type) {
    case "nodal": return { ...l, fx: l.fx * f, fy: l.fy * f, fz: l.fz * f, mx: l.mx * f, my: l.my * f, mz: l.mz * f };
    case "udl": return { ...l, w: l.w * f };
    case "dist": return { ...l, pts: l.pts.map(([x, w]) => [x, w * f] as [number, number]) };
    case "point": return { ...l, P: l.P * f };
  }
}

export const CRACKED_J_BEAM = 0.1;

export function modelOptions3(model: Model3): Analyze3Options {
  const a = model.analysis;
  return {
    pDelta: !!a?.pDelta,
    // ACI 6.6.3.1.1: เสา 0.70Ig · คาน 0.35Ig · ผนัง 0.70Ig (ไม่แตกร้าว) — แขนแข็ง 1.0
    iFactor: a?.cracked ? (m) => (m.kind === "column" || m.kind === "wall" ? 0.7 : m.kind === "beam" ? 0.35 : 1) : undefined,
    // แรงบิดแบบสอดคล้อง (compatibility torsion, ACI 22.7.3.2): หลังแตกร้าวความแข็งบิดของคานลดลงมาก — ใช้ 0.10J
    jFactor: a?.cracked ? (m) => (m.kind === "beam" ? CRACKED_J_BEAM : 1) : undefined,
  };
}

export function analyzeCombo3(model: Model3, factors: Record<string, number>): AnalysisResult3 {
  const loads: Load3[] = [];
  let sw = 0;
  for (const [id, f] of Object.entries(factors)) {
    if (!f) continue;
    const lc = model.loadCases.find((c) => c.id === id);
    if (!lc) throw new Error(`ไม่พบ load case ${id}`);
    for (const l of lc.loads) loads.push(scaleLoad3(l, f));
    if (lc.selfWeight) sw += f;
  }
  return analyze3d(model, loads, sw, modelOptions3(model));
}

export interface Run3 {
  results: Record<string, AnalysisResult3>; // key: "case:ID" หรือ "combo:ID"
  ms: number;
}

export function runAll3(model: Model3, onProgress?: (done: number, total: number) => void): Run3 {
  const t0 = performance.now();
  const results: Record<string, AnalysisResult3> = {};
  const total = model.loadCases.length + model.combos.length;
  let done = 0;
  for (const lc of model.loadCases) { results[`case:${lc.id}`] = analyzeCombo3(model, { [lc.id]: 1 }); onProgress?.(++done, total); }
  // แผ่นดินไหวแบบ RSA: แทนผล EX/EY ด้วยผลสเปกตรัม (ค่าบวก) แล้วรวมในชุดผสมแบบ ±
  const rsaCases = model.rsa ? applyRsa(model, results) : new Set<string>();
  for (const c of model.combos as Combo3[]) {
    const eKeys = Object.keys(c.factors).filter((k) => rsaCases.has(k) && c.factors[k]);
    if (!eKeys.length) results[`combo:${c.id}`] = analyzeCombo3(model, c.factors);
    else {
      const rest = Object.fromEntries(Object.entries(c.factors).filter(([k]) => !rsaCases.has(k)));
      const base = analyzeCombo3(model, rest);
      results[`combo:${c.id}`] = linearResults([base, ...eKeys.map((k) => results[`case:${k}`])], [1, ...eKeys.map((k) => c.factors[k])]);
    }
    onProgress?.(++done, total);
  }
  return { results, ms: performance.now() - t0 };
}

/** คำนวณ RSA ทิศ X, Y แทนผลของ load case EX, EY — คืนรหัส load case ที่ถูกแทน */
function applyRsa(model: Model3, results: Record<string, AnalysisResult3>): Set<string> {
  const s = model.rsa!;
  const out = new Set<string>();
  const nDia = model.diaphragms?.length ?? 0;
  if (!nDia) return out;
  const modal = modalAnalysis(model, s.weights, { Bx: s.Bx, By: s.By }, 3 * nDia);
  const spec = { Fa: 0, Fv: 0, SDS: s.SDS, SD1: s.SD1, T0: s.T0, Ts: s.Ts };
  const lin = { ...modelOptions3(model), pDelta: false };
  for (const dir of ["X", "Y"] as const) {
    const id = `E${dir}`;
    const lc = model.loadCases.find((c) => c.id === id);
    if (!lc) continue;
    const r = responseSpectrum(modal, dir, (T) => Sa(spec, T), s.Ie, s.R);
    const scale = r.V > 0 ? Math.max(1, (s.minScale * s.Vstatic) / r.V) : 1;
    // แรงบิดจากการเยื้องศูนย์โดยบังเอิญ (สถิต) บวกค่าสัมบูรณ์เข้ากับผล RSA
    const torLoads = lc.loads.filter((l) => l.type === "nodal" && l.mz).map((l) => (l.type === "nodal" ? { ...l, fx: 0, fy: 0 } : l));
    const tor = torLoads.length ? analyze3d(model, torLoads, 0, lin) : null;
    const scaled = linearResults([r.result], [scale]);
    const total: RsaResult3 = tor ? mapResults([scaled, tor], ([a, b]) => a + Math.abs(b)) : scaled;
    total.rsa = { dir, V: r.V * scale, Vstatic: s.Vstatic, scale, nModes: modal.modes.length, mass: r.mass, drifts: r.drifts, modes: r.modes }; // drift ไม่ต้องปรับตามแรง (ASCE 7 §12.9.1.4.2)
    results[`case:${id}`] = total;
    out.add(id);
  }
  return out;
}

export interface StoreyDrift { id: string; z: number; h: number; ux: number; uy: number; driftX: number; driftY: number }

/** การเคลื่อนตัวและอัตราส่วนการเคลื่อนตัวสัมพัทธ์ระหว่างชั้น จากจุดอ้างอิง diaphragm */
export function storeyDrifts(model: Model3, r: AnalysisResult3): StoreyDrift[] {
  const ds = Object.entries(r.diaphragms).sort((a, b) => a[1].z - b[1].z);
  const zBase = Math.min(...model.nodes.map((n) => n.z));
  return ds.map(([id, d], k) => {
    const prev = k === 0 ? { z: zBase, ux: 0, uy: 0 } : ds[k - 1][1];
    const h = d.z - prev.z;
    return { id, z: d.z, h, ux: d.ux, uy: d.uy, driftX: (d.ux - prev.ux) / h, driftY: (d.uy - prev.uy) / h };
  });
}
