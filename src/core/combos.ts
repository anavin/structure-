// Load case / ชุดผสมน้ำหนัก — วิเคราะห์เชิงเส้นจึงรวมแรงก่อนแล้ววิเคราะห์ครั้งเดียว

import { analyze, type AnalysisResult, type AnalyzeOptions } from "./frame2d.ts";
import { isLateralCase, type Combo, type Load, type LoadCase, type Model } from "./model.ts";

function scaleLoad(l: Load, f: number): Load {
  switch (l.type) {
    case "nodal": return { ...l, fx: l.fx * f, fy: l.fy * f, mz: l.mz * f };
    case "udl": return { ...l, w: l.w * f };
    case "point": return { ...l, P: l.P * f };
  }
}

/** ตัวเลือกการวิเคราะห์ตามการตั้งค่าของโมเดล (P-Delta, หน้าตัดแตกร้าว) */
export function modelOptions(model: Model): AnalyzeOptions {
  const a = model.analysis;
  return {
    pDelta: !!a?.pDelta,
    iFactor: a?.cracked ? (m) => (m.kind === "column" ? 0.7 : m.kind === "beam" ? 0.35 : 1) : undefined,
  };
}

export function analyzeCase(model: Model, caseId: string): AnalysisResult {
  const lc = model.loadCases.find((c) => c.id === caseId);
  if (!lc) throw new Error(`ไม่พบ load case ${caseId}`);
  return analyze(model, lc.loads, lc.selfWeight ? 1 : 0, modelOptions(model));
}

export function analyzeCombo(model: Model, combo: Combo, filter?: (lc: LoadCase) => boolean, opts?: AnalyzeOptions): AnalysisResult {
  const loads: Load[] = [];
  let sw = 0;
  for (const [caseId, f] of Object.entries(combo.factors)) {
    if (!f) continue;
    const lc = model.loadCases.find((c) => c.id === caseId);
    if (!lc) throw new Error(`ชุดผสม ${combo.name}: ไม่พบ load case ${caseId}`);
    if (filter && !filter(lc)) continue;
    for (const l of lc.loads) loads.push(scaleLoad(l, f));
    if (lc.selfWeight) sw += f;
  }
  return analyze(model, loads, sw, opts ?? modelOptions(model));
}

/** แยกผลชุดผสมเป็นส่วนไม่เซ (ns: แรงแนวดิ่ง) และส่วนเซ (s: แรงด้านข้าง) — ns + s = ผลรวม */
export function analyzeComboSplit(model: Model, combo: Combo, opts?: AnalyzeOptions): { ns: AnalysisResult; s: AnalysisResult } {
  return {
    ns: analyzeCombo(model, combo, (lc) => !isLateralCase(lc), opts),
    s: analyzeCombo(model, combo, (lc) => isLateralCase(lc), opts),
  };
}

export interface MemberEnvelope {
  maxM: number; maxMCombo: string;
  minM: number; minMCombo: string;
  maxAbsV: number; maxVCombo: string;
  maxComp: number; maxCompCombo: string; // แรงอัดสูงสุด (ค่าบวก)
}

export interface RunResult {
  cases: Record<string, AnalysisResult>;
  combos: Record<string, AnalysisResult>;
  envelope: Record<string, MemberEnvelope>;
}

/** วิเคราะห์ทุก load case และชุดผสม แล้วหาค่าสุดขีด (envelope) ของแต่ละชิ้นส่วนจากชุดผสม */
export function runAll(model: Model): RunResult {
  const cases: Record<string, AnalysisResult> = {};
  for (const lc of model.loadCases) cases[lc.id] = analyzeCase(model, lc.id);
  const combos: Record<string, AnalysisResult> = {};
  for (const c of model.combos) combos[c.id] = analyzeCombo(model, c);

  const envelope: Record<string, MemberEnvelope> = {};
  const source = model.combos.length ? Object.entries(combos) : Object.entries(cases);
  for (const m of model.members) {
    const e: MemberEnvelope = {
      maxM: 0, maxMCombo: "-", minM: 0, minMCombo: "-",
      maxAbsV: 0, maxVCombo: "-", maxComp: 0, maxCompCombo: "-",
    };
    for (const [id, r] of source) {
      const mr = r.members[m.id];
      if (mr.maxM > e.maxM) { e.maxM = mr.maxM; e.maxMCombo = id; }
      if (mr.minM < e.minM) { e.minM = mr.minM; e.minMCombo = id; }
      if (mr.maxAbsV > e.maxAbsV) { e.maxAbsV = mr.maxAbsV; e.maxVCombo = id; }
      if (-mr.minN > e.maxComp) { e.maxComp = -mr.minN; e.maxCompCombo = id; }
    }
    envelope[m.id] = e;
  }
  return { cases, combos, envelope };
}
