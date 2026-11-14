// ออกแบบคานและเสา ค.ส.ล. จากผลวิเคราะห์ 3D (ทุกชุดผสม)
//  - คาน: โมเมนต์แกนแข็ง M33 + แรงเฉือน V2 (ใช้ designRcBeam เดิม), ตรวจเกณฑ์แรงบิด (ACI 22.7.4)
//  - เสา: P–M33–M22 ที่ปลายทั้งสองของทุกชุดผสม (designBiaxial)
// ยังไม่คิดผลความชะลูด/การเซใน 3D — เสาที่ kLu/r > 22 จะถูกแจ้งเตือน

import type { Run3 } from "../core3d/combos3d.ts";
import { sectionProps3, type Model3 } from "../core3d/model3d.ts";
import { KSC_TO_MPA } from "../core/model.ts";
import { designRcBeam, type BeamDesignResult, type DesignCode } from "./rcBeam.ts";
import { designBiaxial, type BiaxDemand, type BiaxDesign } from "./rcColumnBiaxial.ts";

export interface Design3Settings { code: DesignCode; cover: number; stirrupDia: number; stirrupLegs: number }
export const defaultDesign3: Design3Settings = { code: "EIT", cover: 40, stirrupDia: 9, stirrupLegs: 2 };

export interface BeamDesign3 {
  kind: "beam";
  result: BeamDesignResult;
  Tu: number; Tth: number; torsionOk: boolean;
  M22max: number; M33max: number;
  ratio: number; ok: boolean; warnings: string[];
}
export interface ColumnDesign3 {
  kind: "column";
  result: BiaxDesign;
  klur: number;
  ties: string;
  ratio: number; ok: boolean; warnings: string[];
}
export type MemberDesign3 = BeamDesign3 | ColumnDesign3;

export function design3d(model: Model3, run: Run3, set: Design3Settings): Record<string, MemberDesign3> {
  const combos = model.combos.length ? model.combos.map((c) => ({ name: c.name, r: run.results[`combo:${c.id}`] })) : model.loadCases.map((c) => ({ name: c.name, r: run.results[`case:${c.id}`] }));
  const secs = new Map(model.sections.map((s) => [s.id, s]));
  const mats = new Map(model.materials.map((m) => [m.id, m]));
  const out: Record<string, MemberDesign3> = {};
  for (const mem of model.members) {
    const sec = secs.get(mem.section);
    const mat = sec && mats.get(sec.material);
    if (!sec || !mat?.fc || !mat.fy) continue;
    const fc = mat.fc * KSC_TO_MPA;
    if (mem.kind === "beam") {
      let MuPos = 0, MuNeg = 0, Vu = 0, Tu = 0, M22 = 0;
      for (const { r } of combos) {
        for (const s of r.members[mem.id].stations) {
          MuPos = Math.max(MuPos, s.Mz); MuNeg = Math.max(MuNeg, -s.Mz);
          Vu = Math.max(Vu, Math.abs(s.Vy)); Tu = Math.max(Tu, Math.abs(s.T)); M22 = Math.max(M22, Math.abs(s.My));
        }
      }
      const result = designRcBeam({
        code: set.code, b: sec.b * 1000, h: sec.h * 1000, cover: set.cover,
        fcKsc: mat.fc, fyKsc: mat.fy, fytKsc: mat.fyt ?? 2400, stirrupDia: set.stirrupDia, stirrupLegs: set.stirrupLegs,
        MuPos, MuNeg, Vu,
      });
      // เกณฑ์แรงบิดที่ไม่ต้องคิด: Tth = φ·0.083√fc'·Acp²/pcp
      const Acp = sec.b * sec.h * 1e6, pcp = 2 * (sec.b + sec.h) * 1000;
      const phiT = set.code === "ACI" ? 0.75 : 0.85;
      const Tth = (phiT * 0.083 * Math.sqrt(fc) * (Acp * Acp) / pcp) / 1e6;
      const warnings: string[] = [];
      const torsionOk = Tu <= Tth;
      if (!torsionOk) warnings.push(`แรงบิด ${Tu.toFixed(2)} > ${Tth.toFixed(2)} kN·m — ต้องออกแบบเหล็กรับแรงบิด (ยังไม่รองรับ)`);
      const M33 = Math.max(MuPos, MuNeg);
      if (M22 > 0.1 * Math.max(M33, 1e-9) && M22 > 1) warnings.push(`โมเมนต์แกนอ่อน M22 = ${M22.toFixed(2)} kN·m ยังไม่ได้ตรวจ`);
      // อัตราส่วนกำลัง: max(Mu/φMn บน-ล่าง, Vu/φVn) — φVn = φ(Vc + Av·fyt·d/s) ของเหล็กปลอกที่เลือก
      const phiV = set.code === "ACI" ? 0.75 : 0.85;
      const d = Math.min(result.bottom.d, result.top.d);
      const Av = set.stirrupLegs * Math.PI * set.stirrupDia ** 2 / 4;
      const fyt = (mat.fyt ?? 2400) * KSC_TO_MPA;
      const phiVn = result.shear.spacing ? result.shear.phiVc + (phiV * Av * fyt * d) / result.shear.spacing / 1e3 : 0;
      const ratio = Math.max(
        result.bottom.phiMn > 0 ? result.bottom.Mu / result.bottom.phiMn : result.bottom.ok ? 0 : Infinity,
        result.top.phiMn > 0 ? result.top.Mu / result.top.phiMn : result.top.ok ? 0 : Infinity,
        phiVn > 0 ? Vu / phiVn : Infinity,
      );
      out[mem.id] = { kind: "beam", result, Tu, Tth, torsionOk, M22max: M22, M33max: M33, ratio, ok: result.ok && torsionOk, warnings };
    } else if (mem.kind === "column") {
      const demands: BiaxDemand[] = [];
      for (const { name, r } of combos) {
        const mr = r.members[mem.id];
        const st = mr.stations, s0 = st[0], s1 = st[st.length - 1];
        demands.push({ combo: name, end: "i", Pu: -s0.N, M3: s0.Mz, M2: s0.My });
        demands.push({ combo: name, end: "j", Pu: -s1.N, M3: s1.Mz, M2: s1.My });
      }
      // ตรวจกรณีแรงมากก่อน เพื่อตัดแบบที่ไม่ผ่านได้เร็ว
      demands.sort((a, b) => Math.hypot(b.M3, b.M2) + b.Pu / 50 - (Math.hypot(a.M3, a.M2) + a.Pu / 50));
      const result = designBiaxial({ code: set.code, b: sec.b * 1000, h: sec.h * 1000, cover: set.cover, tieDia: set.stirrupDia, fcKsc: mat.fc, fyKsc: mat.fy }, demands);
      const L = run.results[Object.keys(run.results)[0]].members[mem.id].L;
      const p = sectionProps3(sec);
      const rmin = Math.sqrt(Math.min(p.Iy, p.Iz) / p.A);
      const klur = L / rmin;
      const warnings: string[] = [];
      if (klur > 22) warnings.push(`kLu/r = ${klur.toFixed(1)} > 22 (k = 1) — ยังไม่คิดผลความชะลูด/การเซใน 3D`);
      const db = result.layout?.dia ?? 16;
      const s = Math.floor(Math.min(16 * db, 48 * set.stirrupDia, Math.min(sec.b, sec.h) * 1000) / 25) * 25;
      const ties = `${set.stirrupDia <= 9 ? "RB" : "DB"}${set.stirrupDia} @ ${(s / 1000).toFixed(3)} m`;
      out[mem.id] = { kind: "column", result, klur, ties, ratio: result.ratio, ok: result.ok, warnings };
    }
  }
  return out;
}
