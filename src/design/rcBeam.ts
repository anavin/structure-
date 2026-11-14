// ออกแบบคาน ค.ส.ล. หน้าตัดสี่เหลี่ยม เสริมเหล็กรับแรงดึงอย่างเดียว (วิธีกำลัง)
// รองรับ: วสท. 1008-38 (SDM) และ ACI 318-19
// หน่วยภายในการคำนวณ: N, mm, MPa — ผลลัพธ์แสดงทั้ง SI และ ksc

import { KSC_TO_MPA } from "../core/model.ts";

export type DesignCode = "EIT" | "ACI";

export interface BeamDesignInput {
  code: DesignCode;
  b: number; // mm
  h: number; // mm
  cover: number; // mm ระยะหุ้มถึงผิวเหล็กปลอก
  fcKsc: number;
  fyKsc: number;
  fytKsc: number;
  stirrupDia: number; // mm
  stirrupLegs: number;
  MuPos: number; // kN·m (โมเมนต์บวก ≥ 0)
  MuNeg: number; // kN·m (ขนาดของโมเมนต์ลบ ≥ 0)
  Vu: number; // kN
}

export interface Step { label: string; expr: string; value: string; ok?: boolean }

export interface FlexureResult {
  Mu: number;
  bars: { n: number; dia: number } | null;
  AsReq: number; AsProv: number;
  phiMn: number; // kN·m
  d: number;
  ok: boolean;
  message: string;
  steps: Step[];
}

export interface ShearResult {
  Vu: number;
  phiVc: number; // kN
  spacing: number | null; // mm
  ok: boolean;
  message: string;
  steps: Step[];
}

export interface BeamDesignResult {
  input: BeamDesignInput;
  bottom: FlexureResult;
  top: FlexureResult;
  shear: ShearResult;
  ok: boolean;
}

const BAR_SIZES = [12, 16, 20, 25, 28];
const barArea = (d: number) => (Math.PI * d * d) / 4;
const f = (v: number, dp = 2) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function beta1(fc: number): number {
  if (fc <= 28) return 0.85;
  return Math.max(0.65, 0.85 - (0.05 * (fc - 28)) / 7);
}

function phiFlexure(code: DesignCode) { return code === "EIT" ? 0.9 : 0.9; }
function phiShear(code: DesignCode) { return code === "EIT" ? 0.85 : 0.75; }

function designFlexure(inp: BeamDesignInput, MuKnm: number, where: string): FlexureResult {
  const fc = inp.fcKsc * KSC_TO_MPA;
  const fy = inp.fyKsc * KSC_TO_MPA;
  const { b, h, cover, stirrupDia } = inp;
  const phi = phiFlexure(inp.code);
  const b1 = beta1(fc);
  const steps: Step[] = [];
  const Mu = MuKnm * 1e6; // N·mm

  const rhoMin = inp.code === "EIT" ? 1.4 / fy : Math.max(1.4 / fy, (0.25 * Math.sqrt(fc)) / fy);
  const rhoB = ((0.85 * b1 * fc) / fy) * (600 / (600 + fy));
  const rhoMax = inp.code === "EIT"
    ? 0.75 * rhoB
    : ((0.85 * b1 * fc) / fy) * (0.003 / (0.003 + 0.005)); // tension-controlled εt ≥ 0.005

  const clearMin = (db: number) => Math.max(25, db);
  const fits = (n: number, db: number) =>
    n <= 1 || (b - 2 * cover - 2 * stirrupDia - n * db) / (n - 1) >= clearMin(db);

  if (MuKnm <= 1e-6) {
    const bars = { n: 2, dia: 12 };
    const d = h - cover - stirrupDia - 6;
    return {
      Mu: 0, bars, AsReq: 0, AsProv: 2 * barArea(12), phiMn: 0, d, ok: true,
      message: `ไม่มีโมเมนต์${where} — ใส่ 2DB12 เป็นเหล็กยึดปลอก`, steps: [
        { label: `Mu (${where})`, expr: "", value: "0 kN·m" },
      ],
    };
  }

  let dbGuess = 16;
  let result: FlexureResult | null = null;
  for (let iter = 0; iter < 3; iter++) {
    const d = h - cover - stirrupDia - dbGuess / 2;
    steps.length = 0;
    steps.push({ label: `Mu (${where})`, expr: "จากผลวิเคราะห์ (ค่าสุดขีดของชุดผสม)", value: `${f(MuKnm)} kN·m` });
    steps.push({ label: "ความลึกประสิทธิผล d", expr: `h − cover − d_s − d_b/2 = ${h} − ${cover} − ${stirrupDia} − ${dbGuess}/2`, value: `${f(d, 1)} mm` });
    const Rn = Mu / (phi * b * d * d);
    steps.push({ label: "Rn", expr: `Mu/(φ b d²), φ = ${phi}`, value: `${f(Rn, 3)} MPa` });
    const k = (2 * Rn) / (0.85 * fc);
    if (k >= 1) {
      return {
        Mu: MuKnm, bars: null, AsReq: NaN, AsProv: 0, phiMn: 0, d, ok: false,
        message: "หน้าตัดเล็กเกินไป (Rn เกินกำลังคอนกรีต) — เพิ่ม b หรือ h", steps,
      };
    }
    const rho = ((0.85 * fc) / fy) * (1 - Math.sqrt(1 - k));
    steps.push({ label: "ρ ที่ต้องการ", expr: "(0.85fc'/fy)·[1 − √(1 − 2Rn/(0.85fc'))]", value: f(rho, 5) });
    steps.push({ label: "ρ_min", expr: inp.code === "EIT" ? "14/fy (ksc) = 1.4/fy (MPa)" : "max(1.4/fy, 0.25√fc'/fy)", value: f(rhoMin, 5) });
    steps.push({
      label: "ρ_max", value: f(rhoMax, 5),
      expr: inp.code === "EIT" ? `0.75ρb, ρb = 0.85β₁(fc'/fy)·600/(600+fy), β₁=${f(b1, 3)}` : `ควบคุมด้วยแรงดึง εt ≥ 0.005, β₁=${f(b1, 3)}`,
    });
    if (rho > rhoMax) {
      return {
        Mu: MuKnm, bars: null, AsReq: rho * b * d, AsProv: 0, phiMn: 0, d, ok: false,
        message: "ρ เกิน ρ_max — เพิ่มขนาดหน้าตัด (รุ่นนี้ยังไม่รองรับเหล็กรับแรงอัด)", steps,
      };
    }
    const AsReq = Math.max(rho, rhoMin) * b * d;
    steps.push({ label: "As ที่ต้องการ", expr: "max(ρ, ρ_min)·b·d", value: `${f(AsReq, 0)} mm²` });

    // เลือกเหล็ก: พื้นที่ส่วนเกินน้อยที่สุดที่วางได้ชั้นเดียว
    let best: { n: number; dia: number; As: number } | null = null;
    for (const dia of BAR_SIZES) {
      const n = Math.max(2, Math.ceil(AsReq / barArea(dia)));
      if (!fits(n, dia)) continue;
      const As = n * barArea(dia);
      if (!best || As < best.As - 1e-6 || (Math.abs(As - best.As) < 1e-6 && n < best.n)) best = { n, dia, As };
    }
    if (!best) {
      return {
        Mu: MuKnm, bars: null, AsReq, AsProv: 0, phiMn: 0, d, ok: false,
        message: "วางเหล็กชั้นเดียวไม่พอ — เพิ่มความกว้างคาน (รุ่นนี้ยังไม่รองรับเหล็ก 2 ชั้น)", steps,
      };
    }
    if (best.dia !== dbGuess) { dbGuess = best.dia; continue; }

    const a = (best.As * fy) / (0.85 * fc * b);
    const c = a / b1;
    const et = (0.003 * (d - c)) / c;
    const phiMn = (phi * best.As * fy * (d - a / 2)) / 1e6;
    steps.push({ label: "เลือกเหล็ก", expr: `${best.n}DB${best.dia}`, value: `As = ${f(best.As, 0)} mm²` });
    steps.push({ label: "a", expr: "As·fy/(0.85fc'·b)", value: `${f(a, 1)} mm` });
    if (inp.code === "ACI") steps.push({ label: "εt", expr: "0.003(d − c)/c", value: f(et, 4), ok: et >= 0.005 });
    const ok = phiMn >= MuKnm - 1e-9;
    steps.push({ label: "φMn", expr: "φ·As·fy·(d − a/2)", value: `${f(phiMn)} kN·m ${ok ? "≥" : "<"} Mu`, ok });
    result = {
      Mu: MuKnm, bars: { n: best.n, dia: best.dia }, AsReq, AsProv: best.As, phiMn, d, ok,
      message: ok ? `ใช้ ${best.n}DB${best.dia}` : "กำลังไม่พอ", steps: [...steps],
    };
    break;
  }
  return result ?? {
    Mu: MuKnm, bars: null, AsReq: NaN, AsProv: 0, phiMn: 0, d: NaN, ok: false,
    message: "เลือกเหล็กไม่ลู่เข้า — ตรวจขนาดหน้าตัด", steps,
  };
}

function designShear(inp: BeamDesignInput, d: number): ShearResult {
  const fc = inp.fcKsc * KSC_TO_MPA;
  const fyt = inp.fytKsc * KSC_TO_MPA;
  const { b } = inp;
  const phi = phiShear(inp.code);
  const Vu = inp.Vu * 1e3;
  const steps: Step[] = [];
  const sq = Math.sqrt(fc);
  const Vc = 0.17 * sq * b * d;
  const Av = inp.stirrupLegs * barArea(inp.stirrupDia);
  steps.push({ label: "Vu", expr: "ค่าสูงสุดตามความยาวชิ้นส่วน (เผื่อปลอดภัย ไม่ลดที่ระยะ d)", value: `${f(inp.Vu)} kN` });
  steps.push({ label: "Vc", expr: inp.code === "EIT" ? "0.53√fc' b d (ksc) ≈ 0.17√fc' b d (MPa)" : "0.17λ√fc' b d", value: `${f(Vc / 1e3)} kN` });
  steps.push({ label: "φVc", expr: `φ = ${phi}`, value: `${f((phi * Vc) / 1e3)} kN` });

  const Vs = Math.max(0, Vu / phi - Vc);
  const VsMax = 0.66 * sq * b * d;
  steps.push({ label: "Vs ที่ต้องการ", expr: "Vu/φ − Vc", value: `${f(Vs / 1e3)} kN` });
  if (Vs > VsMax) {
    steps.push({ label: "Vs,max", expr: "0.66√fc' b d", value: `${f(VsMax / 1e3)} kN`, ok: false });
    return { Vu: inp.Vu, phiVc: (phi * Vc) / 1e3, spacing: null, ok: false, message: "หน้าตัดเล็กเกินไปสำหรับแรงเฉือน — เพิ่ม b หรือ h", steps };
  }
  const sStrength = Vs > 0 ? (Av * fyt * d) / Vs : Infinity;
  const tight = Vs > 0.33 * sq * b * d;
  const sMaxGeom = tight ? Math.min(d / 4, 300) : Math.min(d / 2, 600);
  const avMinCoef = inp.code === "ACI" ? Math.max(0.062 * sq, 0.35) : 0.35;
  const sMinSteel = (Av * fyt) / (avMinCoef * b);
  const s = Math.min(sStrength, sMaxGeom, sMinSteel);
  const sUse = Math.max(75, Math.floor(s / 25) * 25);
  steps.push({ label: "Av", expr: `${inp.stirrupLegs} ขา × Ø${inp.stirrupDia}`, value: `${f(Av, 1)} mm²` });
  steps.push({ label: "s ตามกำลัง", expr: "Av·fyt·d / Vs", value: Number.isFinite(sStrength) ? `${f(sStrength, 0)} mm` : "ไม่ต้องการ" });
  steps.push({ label: "s สูงสุด", expr: tight ? "min(d/4, 300) เพราะ Vs > 0.33√fc' b d" : "min(d/2, 600)", value: `${f(sMaxGeom, 0)} mm` });
  steps.push({ label: "s ตามเหล็กปลอกขั้นต่ำ", expr: inp.code === "ACI" ? "Av·fyt / (max(0.062√fc', 0.35)·b)" : "Av·fyt / (0.35·b)", value: `${f(sMinSteel, 0)} mm` });
  const name = inp.stirrupDia <= 9 ? `RB${inp.stirrupDia}` : `DB${inp.stirrupDia}`;
  // ระยะเรียงต่ำสุดที่ทำงานได้จริง 75 mm — ถ้ากำลังต้องการถี่กว่านั้น ห้ามปัดขึ้นแล้วบอกว่าผ่าน
  if (s < 75 - 1e-9) {
    steps.push({ label: "ใช้ระยะเรียง", expr: "ต้องการถี่กว่า 75 mm (ต่ำสุดที่ทำงานได้)", value: `${f(s, 0)} mm`, ok: false });
    return { Vu: inp.Vu, phiVc: (phi * Vc) / 1e3, spacing: 75, ok: false, message: `เหล็กปลอก ${name} ต้องการระยะ ${f(s, 0)} mm < 75 mm — เพิ่มขนาด/จำนวนขาเหล็กปลอก หรือขยายหน้าตัด`, steps };
  }
  steps.push({ label: "ใช้ระยะเรียง", expr: "ปัดลงทีละ 25 mm", value: `${sUse} mm`, ok: true });
  return { Vu: inp.Vu, phiVc: (phi * Vc) / 1e3, spacing: sUse, ok: true, message: `เหล็กปลอก ${name} @ ${(sUse / 1000).toFixed(3)} m`, steps };
}

export function designRcBeam(inp: BeamDesignInput): BeamDesignResult {
  const bottom = designFlexure(inp, inp.MuPos, "บวก/ล่าง");
  const top = designFlexure(inp, inp.MuNeg, "ลบ/บน");
  const d = Math.min(bottom.d, top.d);
  const shear = designShear(inp, Number.isFinite(d) ? d : inp.h - inp.cover - inp.stirrupDia - 8);
  return { input: inp, bottom, top, shear, ok: bottom.ok && top.ok && shear.ok };
}
