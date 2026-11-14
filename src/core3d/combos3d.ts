// Load case / ชุดผสม สำหรับตัววิเคราะห์ 3D (เชิงเส้น: รวมแรงแล้ววิเคราะห์ครั้งเดียว)

import { analyze3d, type AnalysisResult3 } from "./frame3d.ts";
import type { Combo3, Load3, Model3 } from "./model3d.ts";

function scale(l: Load3, f: number): Load3 {
  switch (l.type) {
    case "nodal": return { ...l, fx: l.fx * f, fy: l.fy * f, fz: l.fz * f, mx: l.mx * f, my: l.my * f, mz: l.mz * f };
    case "udl": return { ...l, w: l.w * f };
    case "point": return { ...l, P: l.P * f };
  }
}

export function analyzeCombo3(model: Model3, factors: Record<string, number>): AnalysisResult3 {
  const loads: Load3[] = [];
  let sw = 0;
  for (const [id, f] of Object.entries(factors)) {
    if (!f) continue;
    const lc = model.loadCases.find((c) => c.id === id);
    if (!lc) throw new Error(`ไม่พบ load case ${id}`);
    for (const l of lc.loads) loads.push(scale(l, f));
    if (lc.selfWeight) sw += f;
  }
  return analyze3d(model, loads, sw);
}

export interface Run3 {
  results: Record<string, AnalysisResult3>; // key: "case:ID" หรือ "combo:ID"
  ms: number;
}

export function runAll3(model: Model3): Run3 {
  const t0 = performance.now();
  const results: Record<string, AnalysisResult3> = {};
  for (const lc of model.loadCases) results[`case:${lc.id}`] = analyzeCombo3(model, { [lc.id]: 1 });
  for (const c of model.combos as Combo3[]) results[`combo:${c.id}`] = analyzeCombo3(model, c.factors);
  return { results, ms: performance.now() - t0 };
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
