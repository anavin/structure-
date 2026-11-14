// ผลการเซของโครง (sway) ต่อเสา — ACI 318-19 §6.6.4.4 และ §6.6.4.6 (วสท. ใช้หลักการเดียวกัน)
//  1) แบ่งเสาเป็นชั้นตามระดับปลายล่าง/บน
//  2) ดัชนีเสถียรภาพ Q = ΣPu·Δo / (Vus·lc) จากผลวิเคราะห์อันดับหนึ่ง — Q ≤ 0.05 ถือเป็นชั้นไม่เซ
//  3) k แบบเซจากค่า ψ ของปลายเสา (สูตรประมาณใน ACI R6.2.5) โดยใช้ 0.70Ig เสา / 0.35Ig คาน
//  4) δs = 1/(1 − Q) ถ้า ≤ 1.5 มิฉะนั้น δs = 1/(1 − ΣPu/(0.75ΣPc))
//  5) M = Mns + δs·Ms ที่ปลายเสาแต่ละด้าน

import { analyzeCombo, analyzeComboSplit, modelOptions } from "../core/combos.ts";
import type { AnalysisResult } from "../core/frame2d.ts";
import { isLateralCase, sectionProps, type Combo, type Model } from "../core/model.ts";

export interface StoreyCombo {
  combo: string;
  sumPu: number; // kN
  Vus: number; // kN
  drift: number; // m (Δo จากส่วนแรงด้านข้าง)
  Q: number;
  sway: boolean;
  deltaS: number;
  method: "Q" | "ΣPc" | "-";
  sumPc: number; // kN
  unstable: boolean;
}

export interface Storey {
  key: string;
  yBot: number; yTop: number; lc: number;
  columns: string[];
  combos: StoreyCombo[];
}

export interface ColumnSwayCombo {
  combo: string;
  Pu: number; Vu: number;
  MtopNs: number; MtopS: number; MbotNs: number; MbotS: number;
  /** โมเมนต์ปลายหลังรวมผลการเซ */
  Mtop: number; Mbot: number;
  deltaS: number; // ที่ใช้กับเสานี้ (1 ถ้าไม่ต้องคิด)
  Q: number;
  note: string;
}

export interface ColumnSway {
  id: string;
  storey: string;
  psiTop: number; psiBot: number;
  kSway: number;
  kLuR: number; // kSway·Lu/r
  neglect: boolean; // kLu/r ≤ 22 → ไม่ต้องคิดผลชะลูดแบบเซ
  combos: ColumnSwayCombo[];
}

export interface SwayResult {
  storeys: Storey[];
  columns: Record<string, ColumnSway>;
}

const PSI_FIXED = 1.0; // ACI R6.2.5: ฐานยึดแน่นในทางปฏิบัติใช้ ψ ≈ 1.0
const PSI_PINNED = 10;
const PSI_MAX = 100;

/** k แบบเซจาก ψA, ψB (ACI R6.2.5 สูตรประมาณ Furlong) */
export function kSwayFromPsi(psiA: number, psiB: number): number {
  const m = (psiA + psiB) / 2;
  return m < 2 ? ((20 - m) / 20) * Math.sqrt(1 + m) : 0.9 * Math.sqrt(1 + m);
}

function ecOf(model: Model, sectionId: string) {
  const sec = model.sections.find((s) => s.id === sectionId)!;
  const mat = model.materials.find((m) => m.id === sec.material)!;
  return { sec, mat, Ig: sectionProps(sec).I };
}

export function swayAnalysis(model: Model, combos: Combo[], betaDs = 0): SwayResult {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const cols = model.members.filter((m) => m.kind === "column");
  const len = (id1: string, id2: string) => {
    const a = nodes.get(id1)!, b = nodes.get(id2)!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };

  // ---------- ψ และ k ----------
  const psiAt = (nodeId: string): number => {
    const sup = model.supports.find((s) => s.node === nodeId);
    if (sup?.rz && sup.ux && sup.uy) return PSI_FIXED;
    let sc = 0, sb = 0;
    for (const m of model.members) {
      if (m.i !== nodeId && m.j !== nodeId) continue;
      const { mat, Ig } = ecOf(model, m.section);
      const L = len(m.i, m.j);
      if (m.kind === "column") sc += (mat.E * 0.7 * Ig) / L;
      else sb += (mat.E * 0.35 * Ig) / L;
    }
    if (sup && (sup.ux || sup.uy) && !sup.rz) return PSI_PINNED;
    return sb > 0 ? Math.min(PSI_MAX, sc / sb) : PSI_MAX;
  };

  const lowHigh = (m: (typeof cols)[number]) => {
    const a = nodes.get(m.i)!, b = nodes.get(m.j)!;
    return a.y <= b.y ? { bot: m.i, top: m.j, yb: a.y, yt: b.y, iIsBot: true } : { bot: m.j, top: m.i, yb: b.y, yt: a.y, iIsBot: false };
  };

  // ---------- แบ่งชั้น ----------
  const storeyMap = new Map<string, Storey>();
  for (const c of cols) {
    const lh = lowHigh(c);
    const key = `${lh.yb.toFixed(3)}→${lh.yt.toFixed(3)}`;
    if (!storeyMap.has(key)) storeyMap.set(key, { key, yBot: lh.yb, yTop: lh.yt, lc: lh.yt - lh.yb, columns: [], combos: [] });
    storeyMap.get(key)!.columns.push(c.id);
  }
  const storeys = [...storeyMap.values()].sort((a, b) => a.yBot - b.yBot);

  const colSway: Record<string, ColumnSway> = {};
  for (const c of cols) {
    const lh = lowHigh(c);
    const psiTop = psiAt(lh.top), psiBot = psiAt(lh.bot);
    const kSway = kSwayFromPsi(psiTop, psiBot);
    const { sec } = ecOf(model, c.section);
    const r = 0.3 * sec.h;
    const Lu = len(c.i, c.j);
    const kLuR = (kSway * Lu) / r;
    colSway[c.id] = {
      id: c.id, storey: `${lh.yb.toFixed(3)}→${lh.yt.toFixed(3)}`,
      psiTop, psiBot, kSway, kLuR, neglect: kLuR <= 22, combos: [],
    };
  }

  // ---------- ต่อชุดผสม ----------
  for (const combo of combos) {
    const { ns, s } = analyzeComboSplit(model, combo, { ...modelOptions(model), pDelta: false });
    // Δo และ Vus สำหรับ Q ใช้ความแข็งแตกร้าว (ACI 6.6.3.1.1) หารด้วย (1 + βds) สำหรับเสา
    const sc = analyzeCombo(model, combo, (lc) => isLateralCase(lc), {
      iFactor: (m) => (m.kind === "column" ? 0.7 / (1 + betaDs) : 0.35),
    });
    const endM = (r: AnalysisResult, id: string) => {
      const st = r.members[id].stations;
      return { atI: st[0].M, atJ: st[st.length - 1].M };
    };
    for (const sty of storeys) {
      let sumPu = 0, Vus = 0, dTop = 0, dBot = 0, sumPc = 0;
      for (const id of sty.columns) {
        const m = model.members.find((x) => x.id === id)!;
        const lh = lowHigh(m);
        const total = -(ns.members[id].minN + s.members[id].minN);
        sumPu += Math.max(0, total);
        const ef = sc.members[id].endForces;
        const mr = sc.members[id];
        const o = lh.iIsBot ? 0 : 3;
        Vus += mr.c * ef[o] - mr.s * ef[o + 1]; // แรงแนวราบที่ปลายล่าง (จุดต่อกระทำต่อเสา)
        dTop += sc.disp[lh.top].ux;
        dBot += sc.disp[lh.bot].ux;
        // Pc สำหรับวิธี ΣPc
        const { mat, Ig } = ecOf(model, m.section);
        const EI = (0.4 * mat.E * Ig) / (1 + betaDs); // kN·m²
        const Lu = len(m.i, m.j);
        sumPc += (Math.PI ** 2 * EI) / (colSway[id].kSway * Lu) ** 2;
      }
      const n = sty.columns.length;
      const drift = Math.abs(dTop / n - dBot / n);
      Vus = Math.abs(Vus);
      const Q = Vus > 1e-9 ? (sumPu * drift) / (Vus * sty.lc) : 0;
      const sway = Q > 0.05;
      let deltaS = 1;
      let method: StoreyCombo["method"] = "-";
      let unstable = false;
      if (sway) {
        const dq = Q < 1 ? 1 / (1 - Q) : Infinity;
        if (dq <= 1.5) { deltaS = dq; method = "Q"; }
        else {
          method = "ΣPc";
          const den = 1 - sumPu / (0.75 * sumPc);
          if (den <= 0) { unstable = true; deltaS = Infinity; } else deltaS = Math.max(1, 1 / den);
        }
      }
      sty.combos.push({ combo: combo.name, sumPu, Vus, drift, Q, sway, deltaS, method, sumPc, unstable });

      for (const id of sty.columns) {
        const cs = colSway[id];
        const m = model.members.find((x) => x.id === id)!;
        const lh = lowHigh(m);
        const mns = endM(ns, id), ms = endM(s, id);
        const MtopNs = lh.iIsBot ? mns.atJ : mns.atI, MbotNs = lh.iIsBot ? mns.atI : mns.atJ;
        const MtopS = lh.iIsBot ? ms.atJ : ms.atI, MbotS = lh.iIsBot ? ms.atI : ms.atJ;
        const apply = sway && !cs.neglect;
        const dS = apply ? deltaS : 1;
        let note = "";
        if (!sway) note = Vus > 1e-9 ? "ชั้นไม่เซ (Q ≤ 0.05)" : "ไม่มีแรงด้านข้าง";
        else if (cs.neglect) note = "kLu/r ≤ 22 ไม่ต้องขยาย";
        else if (unstable) note = "ΣPu ≥ 0.75ΣPc — ชั้นไม่มีเสถียรภาพ";
        else note = `δs จากวิธี ${method}`;
        const Pu = -(ns.members[id].minN + s.members[id].minN);
        // ขอบบนแบบเผื่อปลอดภัย (ตำแหน่งสถานีของสองส่วนอาจไม่ตรงกัน)
        const Vu = ns.members[id].maxAbsV + s.members[id].maxAbsV;
        cs.combos.push({
          combo: combo.name, Pu, Vu, MtopNs, MtopS, MbotNs, MbotS,
          Mtop: MtopNs + dS * MtopS, Mbot: MbotNs + dS * MbotS,
          deltaS: dS, Q, note,
        });
      }
    }
  }
  return { storeys, columns: colSway };
}
