// แรงลมตาม มยผ. 1311-50 — วิธีการอย่างง่าย (Simplified Procedure) สำหรับระบบโครงสร้างหลัก
//   p = Iw · q · Ce · Cg · Cp
//   q  = ½ρV₅₀² · TF  (ρ = 1.25 kg/m³)
//   Ce: ภูมิประเทศ A  = (z/10)^0.2 ≥ 0.9
//       ภูมิประเทศ B  = 0.7(z/12)^0.3 ≥ 0.7
//   Cg = 2.0 (ระบบโครงสร้างหลัก), Cp ด้านต้นลม/ท้ายลมตามรูปร่างอาคาร
//   ด้านท้ายลมใช้ Ce ที่ความสูง 0.5H
// ค่าตั้งต้นทั้งหมดแก้ไขได้ในหน้าจอ — ผู้ออกแบบต้องตรวจกับมาตรฐานฉบับจริงก่อนใช้งาน
// หน่วย: m, kN (ความดันเก็บเป็น kN/m²)

import type { LoadCase, Model, NodalLoad } from "../core/model.ts";

export type WindZone = "1" | "2" | "3" | "4A" | "4B";
export type Importance = "low" | "normal" | "high" | "veryhigh";

export const ZONES: Record<WindZone, { V50: number; TF: number; label: string }> = {
  "1": { V50: 25, TF: 1.0, label: "กลุ่ม 1 (V₅₀ = 25 m/s)" },
  "2": { V50: 27, TF: 1.0, label: "กลุ่ม 2 (V₅₀ = 27 m/s)" },
  "3": { V50: 29, TF: 1.0, label: "กลุ่ม 3 (V₅₀ = 29 m/s)" },
  "4A": { V50: 25, TF: 1.2, label: "กลุ่ม 4A (V₅₀ = 25 m/s, TF = 1.2)" },
  "4B": { V50: 25, TF: 1.08, label: "กลุ่ม 4B (V₅₀ = 25 m/s, TF = 1.08)" },
};

/** ค่าประกอบความสำคัญสำหรับสภาวะจำกัดด้านกำลัง */
export const IMPORTANCE: Record<Importance, { Iw: number; label: string }> = {
  low: { Iw: 0.8, label: "น้อย (Iw = 0.8)" },
  normal: { Iw: 1.0, label: "ปกติ (Iw = 1.0)" },
  high: { Iw: 1.15, label: "มาก (Iw = 1.15)" },
  veryhigh: { Iw: 1.15, label: "สูงมาก (Iw = 1.15)" },
};

export interface WindSettings {
  zone: WindZone;
  V50: number; // m/s
  TF: number;
  importance: Importance;
  Iw: number;
  exposure: "A" | "B";
  Cg: number;
  CpW: number; // ด้านต้นลม (+)
  CpL: number; // ด้านท้ายลม (−)
  /** ระยะห่างโครงข้อแข็ง = ความกว้างรับลม (m) */
  spacing: number;
  /** ความสูงผนังกันตก/หลังคาเหนือระดับบนสุด (m) */
  parapet: number;
}

export const defaultWind: WindSettings = {
  zone: "1", V50: 25, TF: 1.0, importance: "normal", Iw: 1.0, exposure: "B",
  Cg: 2.0, CpW: 0.8, CpL: -0.5, spacing: 4, parapet: 0,
};

/** ความดันลมอ้างอิง q (kN/m²) */
export function refPressure(V50: number, TF: number): number {
  return (0.5 * 1.25 * V50 * V50 * TF) / 1000;
}

export function exposureFactor(z: number, exp: "A" | "B"): number {
  const zz = Math.max(z, 0);
  return exp === "A" ? Math.max(0.9, Math.pow(zz / 10, 0.2)) : Math.max(0.7, 0.7 * Math.pow(zz / 12, 0.3));
}

export interface WindLevel {
  y: number; // ระดับในโมเดล
  z: number; // ความสูงจากพื้นดิน
  zBot: number; zTop: number; // ช่วงความสูงที่รับลม
  CeW: number; // Ce ด้านต้นลมที่ระดับ z (แสดงผล)
  pW: number; pL: number; // kN/m² (เฉลี่ยด้านต้นลมในช่วง / ด้านท้ายลม)
  F: number; // kN ต่อโครง
  nodeLR: string; // จุดต่อซ้ายสุด (ลม +X)
  nodeRL: string; // จุดต่อขวาสุด (ลม −X)
}

export interface WindResult {
  q: number; H: number; D: number;
  CeL: number;
  levels: WindLevel[];
  baseShear: number;
  warnings: string[];
}

/** แรงลมรายชั้นของโครง 2 มิติ */
export function windForces(model: Model, w: WindSettings): WindResult {
  const warnings: string[] = [];
  if (!model.nodes.length) return { q: 0, H: 0, D: 0, CeL: 0, levels: [], baseShear: 0, warnings: ["ยังไม่มีโมเดล"] };
  const base = Math.min(...model.nodes.map((n) => n.y));
  const ys = [...new Set(model.nodes.map((n) => +n.y.toFixed(4)))].sort((a, b) => a - b).filter((y) => y > base + 1e-6);
  const xs = model.nodes.map((n) => n.x);
  const D = Math.max(...xs) - Math.min(...xs);
  const Htop = ys.length ? ys[ys.length - 1] - base : 0;
  const H = Htop + w.parapet;
  const q = refPressure(w.V50, w.TF);
  const CeL = exposureFactor(0.5 * H, w.exposure);
  const pL = w.Iw * q * CeL * w.Cg * Math.abs(w.CpL);
  const pWat = (z: number) => w.Iw * q * exposureFactor(z, w.exposure) * w.Cg * w.CpW;

  if (H > 80) warnings.push(`อาคารสูง ${H.toFixed(1)} m เกิน 80 m — ต้องใช้วิธีการละเอียด`);
  if (D > 0 && H / D > 3) warnings.push(`H/D = ${(H / D).toFixed(2)} > 3 — ต้องใช้วิธีการละเอียด`);

  const zs = ys.map((y) => y - base);
  const levels: WindLevel[] = zs.map((z, k) => {
    const zBot = k === 0 ? z / 2 : (zs[k - 1] + z) / 2;
    const zTop = k === zs.length - 1 ? z + w.parapet : (z + zs[k + 1]) / 2;
    // อินทิเกรตความดันด้านต้นลมตามความสูง (Simpson 40 ช่วง)
    const n = 40, h = (zTop - zBot) / n;
    let sum = pWat(zBot) + pWat(zTop);
    for (let i = 1; i < n; i++) sum += pWat(zBot + i * h) * (i % 2 ? 4 : 2);
    const intW = zTop > zBot ? (sum * h) / 3 : 0;
    const band = zTop - zBot;
    const F = w.spacing * (intW + pL * band);
    const y = ys[k];
    const atLevel = model.nodes.filter((nd) => Math.abs(nd.y - y) < 1e-4).sort((a, b) => a.x - b.x);
    return {
      y, z, zBot, zTop, CeW: exposureFactor(z, w.exposure),
      pW: band > 0 ? intW / band : 0, pL, F,
      nodeLR: atLevel[0].id, nodeRL: atLevel[atLevel.length - 1].id,
    };
  });
  return { q, H, D, CeL, levels, baseShear: levels.reduce((a, l) => a + l.F, 0), warnings };
}

export const WIND_CASE_POS = "WX";
export const WIND_CASE_NEG = "WXN";

/** สร้าง/แทนที่ load case ลม +X และ −X ในโมเดล (แรงที่จุดต่อด้านต้นลมของแต่ละชั้น) */
export function applyWind(model: Model, w: WindSettings): WindResult {
  const r = windForces(model, w);
  const mk = (id: string, name: string, sign: 1 | -1): LoadCase => ({
    id, name, selfWeight: false, lateral: true,
    loads: r.levels.map((l): NodalLoad => ({ type: "nodal", node: sign > 0 ? l.nodeLR : l.nodeRL, fx: +(sign * l.F).toFixed(3), fy: 0, mz: 0 })),
  });
  const pos = mk(WIND_CASE_POS, "ลม มยผ.1311-50 (+X)", 1);
  const neg = mk(WIND_CASE_NEG, "ลม มยผ.1311-50 (−X)", -1);
  for (const lc of [pos, neg]) {
    const i = model.loadCases.findIndex((c) => c.id === lc.id);
    if (i >= 0) model.loadCases[i] = lc; else model.loadCases.push(lc);
  }
  model.wind = { ...w };
  return r;
}
