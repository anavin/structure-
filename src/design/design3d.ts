// ออกแบบคานและเสา ค.ส.ล. จากผลวิเคราะห์ 3D (ทุกชุดผสม)
//  - คาน: โมเมนต์แกนแข็ง M33 + แรงเฉือน V2 (ใช้ designRcBeam เดิม), ตรวจเกณฑ์แรงบิด (ACI 22.7.4)
//  - เสา: P–M33–M22 ที่ปลายทั้งสองของทุกชุดผสม (designBiaxial)
// ความชะลูด: ถ้าวิเคราะห์ P-Delta (P-Δ + P-δ) แล้ว ใช้โมเมนต์อันดับสองโดยตรงรวมค่าสูงสุดตามความยาว (ACI 6.7)
//             ถ้ายังไม่ได้วิเคราะห์ เสาที่ kLu/r > 22 จะถูกแจ้งเตือน

import { designWall, type WallDemand, type WallResult } from "./wall.ts";
import { lapCompression, lapTension, roundUp50 } from "./development.ts";
import { detailBeam, type BeamDetail } from "./beamDetail.ts";
import { designTorsion, type TorsionResult } from "./torsion.ts";
import type { Run3 } from "../core3d/combos3d.ts";
import { sectionProps3, type Model3 } from "../core3d/model3d.ts";
import { KSC_TO_MPA } from "../core/model.ts";
import { designRcBeam, type BeamDesignResult, type DesignCode } from "./rcBeam.ts";
import { designBiaxial, type BiaxDemand, type BiaxDesign, type BiaxSection } from "./rcColumnBiaxial.ts";

export interface Design3Settings {
  code: DesignCode; cover: number; stirrupDia: number; stirrupLegs: number;
  /** เกณฑ์การเคลื่อนตัวจากแรงลม Δ/h ≤ 1/n */
  windDriftDen?: number;
  /** ราคาต่อหน่วยสำหรับ BOQ (บาท/m³, บาท/m², บาท/kg) */
  prices?: import("./boq3d.ts").BoqPrices;
}
export const defaultDesign3: Design3Settings = { code: "EIT", cover: 40, stirrupDia: 9, stirrupLegs: 2, windDriftDen: 500 };

export interface BeamDesign3 {
  kind: "beam";
  result: BeamDesignResult;
  Tu: number; Tth: number; torsionOk: boolean;
  /** ออกแบบเหล็กรับแรงบิด (เมื่อ Tu > Tth) */
  torsion?: TorsionResult;
  /** รายละเอียดเหล็ก: จุดตัดเหล็กบน/ล่าง */
  detail?: BeamDetail;
  /** เหล็กตามยาวเพิ่มจากแรงบิด (จำนวนเส้นเพิ่มบน/ล่าง ขนาดเดียวกับเหล็กหลัก) */
  torsionBars?: { top: number; bottom: number };
  M22max: number; M33max: number;
  ratio: number; ok: boolean; warnings: string[];
}
export interface ColumnDesign3 {
  kind: "column";
  result: BiaxDesign;
  /** หน้าตัดและแรงทุกกรณี (ใช้ทำรายการคำนวณ) */
  section: BiaxSection;
  demands: BiaxDemand[];
  /** ตรวจแรงเฉือนสองทิศ: Vu/φVn สูงสุด, ระยะปลอกตามแรงเฉือน (mm), กรณีวิกฤต */
  shear?: { ratio: number; sNeed: number; Vu: number; phiVn: number; dir: "2" | "3"; combo: string; ok: boolean };
  L: number;
  klur: number;
  ties: string;
  /** ระยะทาบเหล็กยืนเหนือพื้น (mm) — แรงอัด หรือแรงดึง Class B ถ้าเสามีแรงดึง */
  lap?: { mm: number; kind: "compression" | "tension" };
  ratio: number; ok: boolean; warnings: string[];
}
export interface WallDesign3 {
  kind: "wall";
  result: WallResult;
  t: number; Lw: number; hw: number; // mm
  L: number;
  ratio: number; ok: boolean; warnings: string[];
}
export type MemberDesign3 = BeamDesign3 | ColumnDesign3 | WallDesign3;

export function design3d(model: Model3, run: Run3, set: Design3Settings): Record<string, MemberDesign3> {
  const combos = model.combos.length ? model.combos.map((c) => ({ name: c.name, r: run.results[`combo:${c.id}`] })) : model.loadCases.map((c) => ({ name: c.name, r: run.results[`case:${c.id}`] }));
  const secs = new Map(model.sections.map((s) => [s.id, s]));
  const mats = new Map(model.materials.map((m) => [m.id, m]));
  const out: Record<string, MemberDesign3> = {};
  const secondOrder = !!model.analysis?.pDelta;
  // จำนวนคานแต่ละแนว (X/Y) ที่จุดต่อ — ใช้ดูว่าปลายคานต่อเนื่องหรือเป็นปลายริม
  const beamAxisAt = new Map<string, number>();
  for (const m of model.members) if (m.kind === "beam") {
    const a = model.nodes.find((n) => n.id === m.i), b = model.nodes.find((n) => n.id === m.j);
    if (!a || !b) continue;
    const k = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? "X" : "Y";
    for (const n of [m.i, m.j]) beamAxisAt.set(`${n}|${k}`, (beamAxisAt.get(`${n}|${k}`) ?? 0) + 1);
  }
  // ขนาดเสาที่จุดต่อ (ใช้หาผิวฐานรองรับของคาน)
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const colAt = new Map<string, { b: number; h: number }>();
  for (const m of model.members) if (m.kind === "column") {
    const s = secs.get(m.section); if (!s) continue;
    for (const n of [m.i, m.j]) { const c = colAt.get(n); if (!c || s.b * s.h > c.b * c.h) colAt.set(n, { b: s.b, h: s.h }); }
  }
  for (const mem of model.members) {
    const sec = secs.get(mem.section);
    const mat = sec && mats.get(sec.material);
    if (!sec || !mat?.fc || !mat.fy) continue;
    const fc = mat.fc * KSC_TO_MPA;
    if (mem.kind === "beam") {
      let MuPos = 0, MuNeg = 0, Vu = 0, Tu = 0, M22 = 0;
      const st0 = combos[0]?.r.members[mem.id].stations ?? [];
      const env = { x: st0.map((s) => s.x), mPos: st0.map(() => 0), mNeg: st0.map(() => 0) };
      for (const { r } of combos) {
        r.members[mem.id].stations.forEach((s, k) => { if (k < env.x.length) { env.mPos[k] = Math.max(env.mPos[k], s.Mz); env.mNeg[k] = Math.max(env.mNeg[k], -s.Mz); } });
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
      let torsionOk = Tu <= Tth;
      let torsion: TorsionResult | undefined, torsionBars: BeamDesign3["torsionBars"];
      if (!torsionOk) {
        const dd = Math.min(result.bottom.d, result.top.d);
        torsion = designTorsion({
          code: set.code, b: sec.b * 1000, h: sec.h * 1000, cover: set.cover, stirrupDia: set.stirrupDia, legs: set.stirrupLegs,
          fc, fy: mat.fy * KSC_TO_MPA, fyt: (mat.fyt ?? 2400) * KSC_TO_MPA, Tu, Vu, d: dd,
        });
        torsionOk = torsion.ok;
        if (torsion.ok && torsion.s) {
          // เหล็กปลอก = ค่าน้อยของระยะแรงเฉือนและแรงบิด (ปลอกปิด)
          const sp = Math.min(result.shear.spacing ?? torsion.s, torsion.s);
          const nm = set.stirrupDia <= 9 ? `RB${set.stirrupDia}` : `DB${set.stirrupDia}`;
          result.shear = { ...result.shear, spacing: sp, message: `เหล็กปลอกปิด ${nm} @ ${(sp / 1000).toFixed(3)} m (รวมแรงบิด)`, steps: [...result.shear.steps, { label: "ใช้ระยะรวมแรงบิด", expr: "min(ระยะรับแรงเฉือน, ระยะรับแรงบิด) — ดูหัวข้อแรงบิด", value: `${sp} mm`, ok: true }] };
          // เหล็กตามยาวเพิ่ม: เทียบ As ที่ใส่กับ As ที่ต้องการ + Al ส่วนบน/ล่าง
          const extra = (fl: typeof result.bottom, add: number) => {
            const bar = fl.bars; if (!bar) return 0;
            const Ab = Math.PI * bar.dia ** 2 / 4;
            return Math.max(0, Math.ceil((fl.AsReq + add - fl.AsProv) / Ab - 1e-9));
          };
          torsionBars = { top: extra(result.top, torsion.AlTop), bottom: extra(result.bottom, torsion.AlBottom) };
        } else warnings.push(torsion.message);
      }
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
      const ratioT = torsion?.required ? Math.max(ratio, torsion.sectionRatio) : ratio;
      // รายละเอียดเหล็ก (ผิวฐานรองรับ = ครึ่งความกว้างเสาตามแนวคาน)
      const ni = nodeById.get(mem.i)!, nj = nodeById.get(mem.j)!;
      const alongX = Math.abs(nj.x - ni.x) > Math.abs(nj.y - ni.y);
      const w = (n: string) => { const c = colAt.get(n); return c ? (alongX ? c.h : c.b) : 0; };
      const Lm = env.x.length ? env.x[env.x.length - 1] : Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
      // ปลายต่อเนื่อง = มีคานแนวเดียวกันอีกตัวที่จุดต่อนั้น
      const dirKey = alongX ? "X" : "Y";
      const cont = (n: string) => (beamAxisAt.get(`${n}|${dirKey}`) ?? 0) > 1;
      const detail = env.x.length ? detailBeam(result, env, Lm, w(mem.i), w(mem.j), { contI: cont(mem.i), contJ: cont(mem.j) }) : undefined;
      if (detail?.dev?.hooks.some((h) => !h.ok)) warnings.push("ระยะงอฝังเหล็กที่ปลายริมไม่พอ — ดูรายละเอียดเหล็ก");
      out[mem.id] = { kind: "beam", result, Tu, Tth, torsionOk, torsion, torsionBars, detail, M22max: M22, M33max: M33, ratio: ratioT, ok: result.ok && torsionOk, warnings };
    } else if (mem.kind === "wall") {
      // ผนัง: ดัดและเฉือนในระนาบ — ผนังแนว X (h = Lw ตามแกน 2) ใช้ Mz/Vy, ผนังแนว Y (b = Lw ตามแกน 3) ใช้ My/Vz
      const inX = sec.h >= sec.b;
      const t = Math.min(sec.b, sec.h) * 1000, Lw = Math.max(sec.b, sec.h) * 1000;
      const stack = mem.id.replace(/-\d+$/, "");
      const zs = model.members.filter((x) => x.kind === "wall" && x.id.replace(/-\d+$/, "") === stack).flatMap((x) => [nodeById.get(x.i)!.z, nodeById.get(x.j)!.z]);
      const hw = (Math.max(...zs) - Math.min(...zs)) * 1000;
      const demands: WallDemand[] = [];
      for (const { name, r } of combos) {
        const st = r.members[mem.id].stations;
        for (const s of [st[0], st[st.length - 1]]) demands.push({ combo: name, Pu: -s.N, Mu: Math.abs(inX ? s.Mz : s.My), Vu: Math.abs(inX ? s.Vy : s.Vz) });
      }
      const result = designWall({ code: set.code, t, Lw, hw, cover: 25, fc, fy: mat.fy * KSC_TO_MPA, demands });
      const L = run.results[Object.keys(run.results)[0]].members[mem.id].L;
      const warnings = result.ok ? [] : [result.message];
      warnings.push("ผนังธรรมดา (ACI บทที่ 11) — ยังไม่ตรวจ boundary element และการดัดนอกระนาบ");
      out[mem.id] = { kind: "wall", result, t, Lw, hw, L, ratio: result.ratio, ok: result.ok, warnings };
    } else if (mem.kind === "column") {
      const demands: BiaxDemand[] = [];
      for (const { name, r } of combos) {
        const mr = r.members[mem.id];
        const st = mr.stations, s0 = st[0], s1 = st[st.length - 1];
        demands.push({ combo: name, end: "i", Pu: -s0.N, M3: s0.Mz, M2: s0.My });
        demands.push({ combo: name, end: "j", Pu: -s1.N, M3: s1.Mz, M2: s1.My });
        if (secondOrder) {
          // P-δ อาจทำให้โมเมนต์สูงสุดอยู่กลางเสา
          const sm = st.reduce((a, p) => (Math.hypot(p.Mz, p.My) > Math.hypot(a.Mz, a.My) ? p : a), s0);
          if (sm !== s0 && sm !== s1) demands.push({ combo: name, end: "กลาง", Pu: -sm.N, M3: sm.Mz, M2: sm.My });
        }
      }
      // ตรวจกรณีแรงมากก่อน เพื่อตัดแบบที่ไม่ผ่านได้เร็ว
      demands.sort((a, b) => Math.hypot(b.M3, b.M2) + b.Pu / 50 - (Math.hypot(a.M3, a.M2) + a.Pu / 50));
      const bsec: BiaxSection = { code: set.code, b: sec.b * 1000, h: sec.h * 1000, cover: set.cover, tieDia: set.stirrupDia, fcKsc: mat.fc, fyKsc: mat.fy };
      const result = designBiaxial(bsec, demands);
      const L = run.results[Object.keys(run.results)[0]].members[mem.id].L;
      const p = sectionProps3(sec);
      const rmin = Math.sqrt(Math.min(p.Iy, p.Iz) / p.A);
      const klur = L / rmin;
      const warnings: string[] = [];
      if (!secondOrder && klur > 22) warnings.push(`kLu/r = ${klur.toFixed(1)} > 22 (k = 1) — ยังไม่คิดผลความชะลูด: เปิด P-Δ เพื่อใช้โมเมนต์อันดับสอง`);
      if (secondOrder && !model.analysis?.cracked) warnings.push("วิเคราะห์ P-Δ ด้วย Ig เต็ม — ACI 6.7 กำหนดให้ใช้ความแข็งแตกร้าว");
      const db = result.layout?.dia ?? 16;
      // แรงเฉือนสองทิศ (ACI 22.5.6.1): Vc = 0.17(1 + Nu/14Ag)√fc' bw d (แรงดึง: 1 + Nu/3.5Ag ≥ 0) · Vs ≤ 0.66√fc' bw d
      //   Vy (แกน 2) → ลึก h กว้าง b · Vz (แกน 3) → ลึก b กว้าง h · ปลอก 2 ขาทั้งสองทิศ
      const phiV = set.code === "ACI" ? 0.75 : 0.85;
      const fytC = (mat.fyt ?? 2400) * KSC_TO_MPA, Ag = sec.b * sec.h * 1e6, Av2 = 2 * Math.PI * set.stirrupDia ** 2 / 4;
      const dirs = [{ dir: "2" as const, bw: sec.b * 1000, d: sec.h * 1000 - set.cover - set.stirrupDia - db / 2 }, { dir: "3" as const, bw: sec.h * 1000, d: sec.b * 1000 - set.cover - set.stirrupDia - db / 2 }];
      let sNeed = Infinity, vsOver = false;
      const shearDem: { V: number; Nu: number; dir: (typeof dirs)[number]; combo: string }[] = [];
      for (const { name, r } of combos) for (const st of [r.members[mem.id].stations[0], r.members[mem.id].stations.at(-1)!]) {
        shearDem.push({ V: Math.abs(st.Vy), Nu: -st.N, dir: dirs[0], combo: name }, { V: Math.abs(st.Vz), Nu: -st.N, dir: dirs[1], combo: name });
      }
      const vcOf = (q: (typeof shearDem)[number]) => { const Nu = q.Nu * 1e3; return 0.17 * Math.max(0, 1 + Nu / ((Nu >= 0 ? 14 : 3.5) * Ag)) * Math.sqrt(fc) * q.dir.bw * q.dir.d; };
      for (const q of shearDem) {
        const Vs = Math.max(0, (q.V * 1e3) / phiV - vcOf(q));
        if (Vs > 0.66 * Math.sqrt(fc) * q.dir.bw * q.dir.d) vsOver = true;
        if (Vs > 0) sNeed = Math.min(sNeed, (Av2 * fytC * q.dir.d) / Vs);
      }
      const sDetail = Math.min(16 * db, 48 * set.stirrupDia, Math.min(sec.b, sec.h) * 1000);
      const s = Math.max(75, Math.floor(Math.min(sDetail, sNeed) / 25) * 25);
      let shear: ColumnDesign3["shear"] = { ratio: 0, sNeed, Vu: 0, phiVn: 0, dir: "2", combo: "-", ok: true };
      for (const q of shearDem) {
        const phiVn = Math.min(phiV * (vcOf(q) + (Av2 * fytC * q.dir.d) / s), phiV * (vcOf(q) + 0.66 * Math.sqrt(fc) * q.dir.bw * q.dir.d)) / 1e3;
        const rt = phiVn > 0 ? q.V / phiVn : Infinity;
        if (rt > shear.ratio) shear = { ratio: rt, sNeed, Vu: q.V, phiVn, dir: q.dir.dir, combo: q.combo, ok: true };
      }
      shear.ok = !vsOver && sNeed >= 75 - 1e-9 && shear.ratio <= 1 + 1e-9;
      const ties = `${set.stirrupDia <= 9 ? "RB" : "DB"}${set.stirrupDia} @ ${(s / 1000).toFixed(3)} m`;
      if (!shear.ok) {
        result.message = vsOver ? "หน้าตัดเสาเล็กเกินไปสำหรับแรงเฉือน — ขยายหน้าตัด" : `ปลอกเสาต้องการระยะ ${sNeed.toFixed(0)} mm < 75 mm — เพิ่มขนาดเหล็กปลอกหรือขยายหน้าตัด`;
      }
      const lay = result.layout;
      let lap: ColumnDesign3["lap"];
      if (lay) {
        const tension = demands.some((q) => q.Pu < 0);
        const dv = { db: lay.dia, fc, fy: mat.fy * KSC_TO_MPA };
        lap = { mm: roundUp50(tension ? lapTension(dv) : lapCompression(dv)), kind: tension ? "tension" : "compression" };
      }
      out[mem.id] = { kind: "column", result, section: bsec, demands, shear, L, klur, ties, lap, ratio: Math.max(result.ratio, shear.ratio), ok: result.ok && shear.ok, warnings };
    }
  }
  return out;
}
