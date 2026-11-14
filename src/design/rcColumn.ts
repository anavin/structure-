// ออกแบบเสา ค.ส.ล. สี่เหลี่ยมปลอกเดี่ยว (tied) รับแรงอัดร่วมกับแรงดัดในระนาบ
// - แผนภาพ P–M ด้วยความเข้ากันได้ของความเครียด (εcu = 0.003, Es = 200,000 MPa)
// - ตัวคูณ φ: ACI 318-19 ตาม εt (0.65–0.90) / วสท. 1008-38: 0.70 เพิ่มเป็น 0.90 เมื่อแรงอัดต่ำ
// - ความชะลูด: วิธีขยายโมเมนต์สำหรับโครงที่ค้ำยัน (non-sway) ACI 318-19 §6.6.4
// หน่วยภายใน: N, mm, MPa

import { KSC_TO_MPA } from "../core/model.ts";
import { beta1, type DesignCode, type Step } from "./rcBeam.ts";

const ES = 200000;
const ECU = 0.003;
const BAR_SIZES = [12, 16, 20, 25, 28];
const barArea = (d: number) => (Math.PI * d * d) / 4;
const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "-");

export interface ColumnLayout {
  dia: number;
  /** จำนวนเหล็กต่อด้านที่ตั้งฉากระนาบดัด (ด้านกว้าง b) รวมมุม */
  nFace: number;
  /** จำนวนเหล็กกลางด้านข้าง (ตามความลึก h) ต่อด้าน ไม่รวมมุม */
  nSide: number;
}

export interface ColumnSection {
  code: DesignCode;
  b: number; h: number; // mm (h = ความลึกในระนาบดัด)
  cover: number; tieDia: number; // mm
  fcKsc: number; fyKsc: number; fytKsc: number;
}

export interface ColumnDemand {
  combo: string;
  Pu: number; // kN อัดเป็นบวก
  Mtop: number; Mbot: number; // kN·m ตามอนุสัญญาคาน (ปลาย j / ปลาย i)
  Vu: number; // kN
  /** ตัวขยายโมเมนต์จากการเซที่ใช้แล้วกับ Mtop/Mbot (1 = ไม่เซ) */
  deltaS?: number;
  Q?: number;
  swayNote?: string;
  /** |M| สูงสุดตามความยาว (ใช้เมื่อวิเคราะห์อันดับสองแล้ว) */
  Mmax?: number;
}

export interface PMPoint { Pn: number; Mn: number; phi: number; phiPn: number; phiMn: number; c: number }

export interface DemandCheck extends ColumnDemand {
  M2: number; // kN·m ก่อนขยาย
  delta: number;
  Mc: number; // kN·m หลังขยาย/ขั้นต่ำ
  phiMnAtPu: number;
  ratio: number;
  note: string;
}

export interface ColumnDesignResult {
  section: ColumnSection;
  layout: ColumnLayout | null;
  Ast: number; rho: number;
  diagram: PMPoint[];
  phiPnMax: number; // kN
  checks: DemandCheck[];
  maxRatio: number;
  slender: { klu_r: number; limit: number; slender: boolean; k: number; Lu: number };
  ties: { dia: number; spacing: number; note: string };
  ok: boolean;
  message: string;
  steps: Step[];
}

/** ตำแหน่งเหล็ก (ระยะจากผิวรับแรงอัด, พื้นที่) */
export function barLayers(sec: ColumnSection, lay: ColumnLayout): { d: number; As: number }[] {
  const dPrime = sec.cover + sec.tieDia + lay.dia / 2;
  const a = barArea(lay.dia);
  const layers = [{ d: dPrime, As: lay.nFace * a }, { d: sec.h - dPrime, As: lay.nFace * a }];
  for (let k = 1; k <= lay.nSide; k++) {
    layers.push({ d: dPrime + ((sec.h - 2 * dPrime) * k) / (lay.nSide + 1), As: 2 * a });
  }
  return layers.sort((x, y) => x.d - y.d);
}

export function totalBars(lay: ColumnLayout) { return 2 * lay.nFace + 2 * lay.nSide; }

function phiFor(code: DesignCode, et: number, Pn: number, fy: number, sec: ColumnSection, Pb: number): number {
  if (code === "ACI") {
    const ety = fy / ES;
    if (et <= ety) return 0.65;
    if (et >= ety + 0.003) return 0.9;
    return 0.65 + (0.25 * (et - ety)) / 0.003;
  }
  // วสท. 1008-38 (ACI 318-99 §9.3.2)
  if (Pn <= 0) return 0.9;
  const fc = sec.fcKsc * KSC_TO_MPA;
  const Pt = Math.min(0.1 * fc * sec.b * sec.h, 0.7 * Pb);
  const phiPn = 0.7 * Pn;
  if (phiPn >= Pt) return 0.7;
  return 0.9 - (0.2 * phiPn) / Pt;
}

/** สร้างแผนภาพ P–M (เรียงจาก P มากไปน้อย) */
export function interactionDiagram(sec: ColumnSection, lay: ColumnLayout): { points: PMPoint[]; phiPnMax: number; P0: number } {
  const fc = sec.fcKsc * KSC_TO_MPA;
  const fy = sec.fyKsc * KSC_TO_MPA;
  const b1 = beta1(fc);
  const { b, h } = sec;
  const layers = barLayers(sec, lay);
  const Ast = layers.reduce((s, l) => s + l.As, 0);
  const Ag = b * h;
  const P0 = 0.85 * fc * (Ag - Ast) + fy * Ast;
  const dt = Math.max(...layers.map((l) => l.d));

  const section = (c: number) => {
    const a = Math.min(b1 * c, h);
    let Pn = 0.85 * fc * a * b;
    let Mn = 0.85 * fc * a * b * (h / 2 - a / 2);
    for (const l of layers) {
      const es = (ECU * (c - l.d)) / c;
      let fs = Math.max(-fy, Math.min(fy, ES * es));
      if (l.d < a) fs -= 0.85 * fc; // หักพื้นที่คอนกรีตที่เหล็กแทนที่
      Pn += fs * l.As;
      Mn += fs * l.As * (h / 2 - l.d);
    }
    const et = (ECU * (dt - c)) / c;
    return { Pn, Mn, et };
  };
  const cb = (ECU * dt) / (ECU + fy / ES);
  const Pb = section(cb).Pn;
  const phiMax = sec.code === "ACI" ? 0.65 : 0.7;
  const phiPnMax = 0.8 * phiMax * P0;

  const cs: number[] = [];
  for (let k = 0; k <= 90; k++) cs.push(h * 0.03 * Math.pow(10 / 0.03, k / 90)); // 0.03h … 10h
  const pts: PMPoint[] = cs.map((c) => {
    const s = section(c);
    const phi = phiFor(sec.code, s.et, s.Pn, fy, sec, Pb);
    return { Pn: s.Pn / 1e3, Mn: s.Mn / 1e6, phi, phiPn: Math.min((phi * s.Pn) / 1e3, phiPnMax / 1e3), phiMn: (phi * s.Mn) / 1e6, c };
  });
  pts.push({ Pn: P0 / 1e3, Mn: 0, phi: phiMax, phiPn: phiPnMax / 1e3, phiMn: 0, c: Infinity });
  pts.push({ Pn: (-fy * Ast) / 1e3, Mn: 0, phi: 0.9, phiPn: (-0.9 * fy * Ast) / 1e3, phiMn: 0, c: 0 });
  pts.sort((x, y) => y.phiPn - x.phiPn || x.phiMn - y.phiMn);
  return { points: pts, phiPnMax: phiPnMax / 1e3, P0: P0 / 1e3 };
}

/** φMn ที่ระดับแรงอัด Pu (kN) — ค่าสูงสุดบนเส้นโค้งที่ระดับนั้น; NaN ถ้า Pu เกินขีด */
export function phiMnAt(points: PMPoint[], Pu: number): number {
  let best = NaN;
  for (let k = 0; k < points.length - 1; k++) {
    const p = points[k], q = points[k + 1];
    const hi = Math.max(p.phiPn, q.phiPn), lo = Math.min(p.phiPn, q.phiPn);
    if (Pu > hi || Pu < lo) continue;
    const t = hi === lo ? 1 : (Pu - p.phiPn) / (q.phiPn - p.phiPn);
    const m = hi === lo ? Math.max(p.phiMn, q.phiMn) : p.phiMn + t * (q.phiMn - p.phiMn);
    if (!(m <= best)) best = m;
  }
  return best;
}

export interface SlenderInput {
  Lu: number; k: number; betaDns: number;
  /** โมเมนต์มาจากการวิเคราะห์อันดับสอง (P-Δ และ P-δ) แล้ว — ไม่ต้องขยายซ้ำ */
  secondOrder?: boolean;
}

function checkDemand(sec: ColumnSection, d: ColumnDemand, pts: PMPoint[], phiPnMax: number, sl: SlenderInput, slender: boolean): DemandCheck {
  const fc = sec.fcKsc * KSC_TO_MPA;
  const absTop = Math.abs(d.Mtop), absBot = Math.abs(d.Mbot);
  const M2 = Math.max(absTop, absBot);
  let delta = 1;
  let Mc = M2;
  let note = "";
  if (sl.secondOrder) {
    Mc = Math.max(M2, d.Mmax ?? 0);
    note = "โมเมนต์จากการวิเคราะห์อันดับสอง";
  } else if (slender && d.Pu > 0) {
    const Ec = 4700 * Math.sqrt(fc); // ACI (MPa) — ใช้คำนวณ EI ประสิทธิผล
    const Ig = (sec.b * sec.h ** 3) / 12;
    const EIeff = (0.4 * Ec * Ig) / (1 + sl.betaDns);
    const Pc = (Math.PI ** 2 * EIeff) / (sl.k * sl.Lu) ** 2 / 1e3; // kN
    const small = absTop <= absBot ? d.Mtop : d.Mbot;
    const large = absTop <= absBot ? d.Mbot : d.Mtop;
    // M1/M2 ตาม ACI: ลบเมื่อโค้งทางเดียว (single curvature) = ปลายมีเครื่องหมายเดียวกันในอนุสัญญาคาน
    const r = Math.abs(large) < 1e-9 ? 1 : -small / large;
    const Cm = 0.6 - 0.4 * r;
    const M2min = (d.Pu * 1e3 * (15 + 0.03 * sec.h)) / 1e6;
    if (d.Pu >= 0.75 * Pc) {
      return { ...d, M2, delta: Infinity, Mc: Infinity, phiMnAtPu: 0, ratio: Infinity, note: "Pu ≥ 0.75Pc — เสาไม่มีเสถียรภาพ" };
    }
    // เมื่อ M2,min ควบคุม ใช้ Cm = 1.0 (ACI 6.6.4.5.4)
    const useMin = M2min > M2;
    if (useMin) note = "ใช้ M2,min";
    delta = Math.max(1, (useMin ? 1 : Cm) / (1 - d.Pu / (0.75 * Pc)));
    Mc = delta * Math.max(M2, M2min);
  }
  if (d.Pu > phiPnMax) {
    return { ...d, M2, delta, Mc, phiMnAtPu: 0, ratio: d.Pu / phiPnMax, note: "Pu เกิน φPn,max" };
  }
  const cap = phiMnAt(pts, d.Pu);
  const ratio = !Number.isFinite(cap) ? Infinity : Mc <= 1e-9 ? d.Pu / phiPnMax : Mc / Math.max(cap, 1e-9);
  return { ...d, M2, delta, Mc, phiMnAtPu: cap, ratio, note };
}

export function designRcColumn(
  sec: ColumnSection,
  demands: ColumnDemand[],
  sl: SlenderInput,
  fixedLayout?: ColumnLayout,
): ColumnDesignResult {
  const fc = sec.fcKsc * KSC_TO_MPA;
  const fy = sec.fyKsc * KSC_TO_MPA;
  const fyt = sec.fytKsc * KSC_TO_MPA;
  const r = 0.3 * sec.h;
  const klu_r = (sl.k * sl.Lu) / r;
  // ขีดจำกัดความชะลูด non-sway: 34 + 12(M1/M2) ≤ 40 — ใช้กรณีวิกฤตที่สุดจากทุกชุดผสม
  let limit = 40;
  for (const d of demands) {
    const at = Math.abs(d.Mtop), ab = Math.abs(d.Mbot);
    const small = at <= ab ? d.Mtop : d.Mbot, large = at <= ab ? d.Mbot : d.Mtop;
    const rr = Math.abs(large) < 1e-9 ? 1 : -small / large;
    limit = Math.min(limit, 34 + 12 * rr);
  }
  limit = Math.min(40, Math.max(limit, 22));
  const slender = klu_r > limit;

  const Ag = sec.b * sec.h;
  const clearMin = (db: number) => Math.max(1.5 * db, 40);
  const fitsFace = (n: number, db: number) => n < 2 ? false : (sec.b - 2 * sec.cover - 2 * sec.tieDia - n * db) / (n - 1) >= clearMin(db);
  const fitsSide = (n: number, db: number) => (sec.h - 2 * sec.cover - 2 * sec.tieDia - (n + 2) * db) / (n + 1) >= clearMin(db);

  const evaluate = (lay: ColumnLayout) => {
    const dg = interactionDiagram(sec, lay);
    const checks = demands.map((d) => checkDemand(sec, d, dg.points, dg.phiPnMax, sl, slender));
    const maxRatio = Math.max(0, ...checks.map((c) => c.ratio));
    const Ast = totalBars(lay) * barArea(lay.dia);
    return { lay, dg, checks, maxRatio, Ast };
  };

  let chosen: ReturnType<typeof evaluate> | null = null;
  if (fixedLayout) {
    chosen = evaluate(fixedLayout);
  } else {
    const cands: ColumnLayout[] = [];
    for (const dia of BAR_SIZES) for (let nFace = 2; nFace <= 8; nFace++) for (let nSide = 0; nSide <= 6; nSide++) {
      if (!fitsFace(nFace, dia) || (nSide > 0 && !fitsSide(nSide, dia))) continue;
      const lay = { dia, nFace, nSide };
      const rho = (totalBars(lay) * barArea(dia)) / Ag;
      if (rho < 0.01 || rho > 0.04) continue; // ใช้งานจริง 1%–4% (มาตรฐานยอมถึง 8%)
      // ระยะห่างเหล็กตามความลึก ไม่ควรเกิน 150 mm จากเหล็กที่มีปลอกยึด — คุมด้วย nSide ขั้นต่ำแบบง่าย
      cands.push(lay);
    }
    cands.sort((x, y) => totalBars(x) * barArea(x.dia) - totalBars(y) * barArea(y.dia) || totalBars(x) - totalBars(y));
    let fallback: ReturnType<typeof evaluate> | null = null;
    for (const lay of cands) {
      const ev = evaluate(lay);
      if (ev.maxRatio <= 1) { chosen = ev; break; }
      if (!fallback || ev.maxRatio < fallback.maxRatio) fallback = ev;
    }
    chosen = chosen ?? fallback;
  }

  // ปลอกเดี่ยว: s ≤ 16db, 48dtie, ด้านแคบ (ACI 25.7.2.1) และตรวจแรงเฉือน
  const steps: Step[] = [];
  if (!chosen) {
    return {
      section: sec, layout: null, Ast: 0, rho: 0, diagram: [], phiPnMax: 0, checks: [], maxRatio: Infinity,
      slender: { klu_r, limit, slender, k: sl.k, Lu: sl.Lu }, ties: { dia: sec.tieDia, spacing: 0, note: "" },
      ok: false, message: "หน้าตัดเล็กเกินไปสำหรับวางเหล็ก 1%–4% — เพิ่มขนาดเสา", steps,
    };
  }
  const { lay, dg, checks, maxRatio, Ast } = chosen;
  const rho = Ast / Ag;
  const d = sec.h - sec.cover - sec.tieDia - lay.dia / 2;
  const phiV = sec.code === "ACI" ? 0.75 : 0.85;
  const Av = 2 * barArea(sec.tieDia);
  let sShear = Infinity;
  let shearOk = true;
  for (const dm of demands) {
    const Nu = Math.max(0, dm.Pu) * 1e3;
    const Vc = 0.17 * (1 + Nu / (14 * Ag)) * Math.sqrt(fc) * sec.b * d;
    const Vs = Math.max(0, (dm.Vu * 1e3) / phiV - Vc);
    if (Vs > 0.66 * Math.sqrt(fc) * sec.b * d) shearOk = false;
    if (Vs > 0) sShear = Math.min(sShear, (Av * fyt * d) / Vs);
  }
  const sDetail = Math.min(16 * lay.dia, 48 * sec.tieDia, Math.min(sec.b, sec.h));
  const sTie = Math.max(75, Math.floor(Math.min(sDetail, sShear) / 25) * 25);
  if (sShear < 75 - 1e-9) shearOk = false; // ต้องการปลอกถี่กว่า 75 mm — ไม่ปัดขึ้นแล้วบอกว่าผ่าน
  const tieName = sec.tieDia <= 9 ? `RB${sec.tieDia}` : `DB${sec.tieDia}`;

  const crit = checks.reduce((a, c) => (c.ratio > a.ratio ? c : a), checks[0]);
  steps.push({ label: "หน้าตัด", expr: `b × h = ${sec.b} × ${sec.h} mm, Ag`, value: `${f(Ag, 0)} mm²` });
  steps.push({ label: "เหล็กยืน", expr: `${totalBars(lay)}DB${lay.dia} (ด้านละ ${lay.nFace} + ข้างละ ${lay.nSide})`, value: `Ast = ${f(Ast, 0)} mm²` });
  steps.push({ label: "ρg", expr: "Ast/Ag (ช่วงที่ใช้ 1%–4%)", value: `${f(rho * 100, 2)} %`, ok: rho >= 0.01 && rho <= 0.08 });
  steps.push({ label: "P0", expr: "0.85fc'(Ag − Ast) + fy·Ast", value: `${f(dg.P0)} kN` });
  steps.push({ label: "φPn,max", expr: `0.80·φ·P0, φ = ${sec.code === "ACI" ? "0.65" : "0.70"} (ปลอกเดี่ยว)`, value: `${f(dg.phiPnMax)} kN` });
  steps.push({ label: "ความชะลูด kLu/r", expr: `k = ${sl.k}, Lu = ${f(sl.Lu, 0)} mm, r = 0.3h = ${f(r, 0)} mm`, value: f(klu_r, 1) });
  if (sl.secondOrder) {
    steps.push({ label: "ผลอันดับสอง", expr: "วิเคราะห์ P-Delta (P-Δ + P-δ ตามความยาว) — ACI §6.7", value: "ไม่ต้องขยายโมเมนต์ซ้ำ" });
  } else steps.push({ label: "ขีดจำกัด (ค้ำยัน)", expr: "34 + 12(M1/M2) ≤ 40", value: `${f(limit, 1)} → ${slender ? "เสาชะลูด ต้องขยายโมเมนต์" : "เสาสั้น"}`, ok: !slender || undefined });
  if (slender && !sl.secondOrder) steps.push({ label: "EI ประสิทธิผล", expr: `0.4EcIg/(1+βdns), βdns = ${sl.betaDns}`, value: "δ = Cm/(1 − Pu/0.75Pc) ≥ 1" });
  if (crit) {
    steps.push({ label: "กรณีวิกฤต", expr: crit.combo, value: `Pu = ${f(crit.Pu)} kN, Mc = ${f(crit.Mc)} kN·m` });
    steps.push({ label: "φMn ที่ระดับ Pu", expr: "จากแผนภาพ P–M (ความเข้ากันได้ของความเครียด)", value: `${f(crit.phiMnAtPu)} kN·m` });
    steps.push({ label: "อัตราส่วนกำลัง", expr: "Mc/φMn (หรือ Pu/φPn,max)", value: f(crit.ratio, 3), ok: crit.ratio <= 1 });
  }
  steps.push({ label: "ระยะปลอก (รายละเอียด)", expr: `min(16db, 48dtie, ด้านแคบ) = min(${16 * lay.dia}, ${48 * sec.tieDia}, ${Math.min(sec.b, sec.h)})`, value: `${f(sDetail, 0)} mm` });
  if (Number.isFinite(sShear)) steps.push({ label: "ระยะปลอก (แรงเฉือน)", expr: "Av·fyt·d / Vs", value: `${f(sShear, 0)} mm` });
  steps.push({ label: "ใช้ปลอก", expr: "ปัดลงทีละ 25 mm", value: `${tieName} @ ${sTie} mm`, ok: shearOk });

  const maxDeltaS = Math.max(1, ...demands.map((x) => x.deltaS ?? 1));
  // ACI 318-19 §6.2.5.3: โมเมนต์รวมผลอันดับสอง ≤ 1.4 เท่าของโมเมนต์อันดับหนึ่ง
  const swayOk = maxDeltaS <= 1.4;
  if (maxDeltaS > 1.0001) {
    steps.push({ label: "δs สูงสุด (โครงเซ)", expr: "ACI §6.6.4.6 — ต้องไม่เกิน 1.4 (§6.2.5.3)", value: Number.isFinite(maxDeltaS) ? f(maxDeltaS, 3) : "∞", ok: swayOk });
  }
  const ok = maxRatio <= 1 && shearOk && swayOk;
  const message = ok
    ? `ใช้ ${totalBars(lay)}DB${lay.dia}, ปลอก ${tieName}@${(sTie / 1000).toFixed(2)}`
    : !swayOk ? (Number.isFinite(maxDeltaS) ? `δs = ${f(maxDeltaS, 2)} เกิน 1.4 — โครงอ่อนเกินไป เพิ่มความแข็งด้านข้าง` : "ชั้นไม่มีเสถียรภาพ (ΣPu ≥ 0.75ΣPc) — เพิ่มขนาดเสา/คาน")
    : !shearOk ? (sShear < 75 ? `ปลอกต้องการระยะ ${f(sShear, 0)} mm < 75 mm — เพิ่มขนาดเหล็กปลอกหรือขยายหน้าตัด` : "หน้าตัดเล็กเกินไปสำหรับแรงเฉือน")
      : `กำลังไม่พอ (อัตราส่วน ${f(maxRatio, 2)}) — เพิ่มขนาดเสา`;
  return {
    section: sec, layout: lay, Ast, rho, diagram: dg.points, phiPnMax: dg.phiPnMax, checks, maxRatio,
    slender: { klu_r, limit, slender, k: sl.k, Lu: sl.Lu },
    ties: { dia: sec.tieDia, spacing: sTie, note: `${tieName} @ ${(sTie / 1000).toFixed(3)} m` },
    ok, message, steps,
  };
}
