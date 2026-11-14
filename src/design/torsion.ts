// ออกแบบเหล็กรับแรงบิดในคาน ค.ส.ล. (ACI 318-19 §22.7, หน้าตัดตัน, θ = 45°)
//   Tth = φ·0.083λ√fc'·Acp²/pcp — ไม่เกินนี้ไม่ต้องคิดแรงบิด
//   ขนาดหน้าตัด: √[(Vu/bd)² + (Tu·ph/1.7Aoh²)²] ≤ φ(Vc/bd + 0.66√fc')
//   At/s = Tu / (φ·2·Ao·fyt·cotθ), Ao = 0.85·Aoh
//   เหล็กปลอกรวม: ขาริมรับ At/s + ส่วนแบ่งแรงเฉือน (Av/s)/ขา → s ≤ A1 / (At/s + (Av/s)/n)
//   (Av + 2At)/s ≥ max(0.062√fc', 0.35)·b/fyt · s ≤ min(ph/8, 300 mm)
//   Al = (At/s)·ph·(fyt/fy) ≥ Al,min = 0.42√fc'·Acp/fy − (At/s ≥ 0.175b/fyt)·ph·fyt/fy
//   กระจาย Al: บน ¼, ล่าง ¼, ข้างละ ¼ (เหล็กข้าง ระยะ ≤ 300 mm, Ø ≥ max(0.042s, 10))

import type { DesignCode, Step } from "./rcBeam.ts";

export interface TorsionInput {
  code: DesignCode; b: number; h: number; cover: number; stirrupDia: number; legs: number; // mm
  fc: number; fy: number; fyt: number; // MPa
  Tu: number; Vu: number; // kN·m, kN
  d: number; // mm
}
export interface TorsionResult {
  required: boolean; ok: boolean;
  Tth: number; sectionRatio: number;
  AtS: number; AvS: number; s: number | null; Al: number;
  /** เหล็กตามยาวเพิ่ม: บน/ล่าง (mm² เพิ่มจากที่ต้องการรับดัด), เหล็กข้างต่อด้าน */
  AlTop: number; AlBottom: number; side: { n: number; dia: number } | null;
  message: string; steps: Step[];
}

const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");

export function designTorsion(inp: TorsionInput): TorsionResult {
  const { b, h, cover, stirrupDia: ds, legs, fc, fy, fyt, d } = inp;
  const phi = inp.code === "ACI" ? 0.75 : 0.85;
  const sq = Math.sqrt(fc);
  const Acp = b * h, pcp = 2 * (b + h);
  const x1 = b - 2 * (cover + ds / 2), y1 = h - 2 * (cover + ds / 2);
  const Aoh = x1 * y1, ph = 2 * (x1 + y1), Ao = 0.85 * Aoh;
  const Tu = inp.Tu * 1e6, Vu = inp.Vu * 1e3;
  const Tth = (phi * 0.083 * sq * Acp * Acp) / pcp;
  const steps: Step[] = [
    { label: "Acp / pcp", expr: "b·h / 2(b + h)", value: `${f(Acp, 0)} mm² / ${f(pcp, 0)} mm` },
    { label: "Tth", expr: `φ·0.083√fc'·Acp²/pcp (φ = ${phi})`, value: `${f(Tth / 1e6)} kN·m` },
  ];
  if (Tu <= Tth) {
    steps.push({ label: "Tu", expr: "≤ Tth — ไม่ต้องคิดแรงบิด", value: `${f(inp.Tu)} kN·m`, ok: true });
    return { required: false, ok: true, Tth: Tth / 1e6, sectionRatio: 0, AtS: 0, AvS: 0, s: null, Al: 0, AlTop: 0, AlBottom: 0, side: null, message: "ไม่ต้องคิดแรงบิด", steps };
  }
  steps.push({ label: "Tu", expr: "> Tth — ต้องออกแบบเหล็กรับแรงบิด", value: `${f(inp.Tu)} kN·m` });
  steps.push({ label: "Aoh / ph / Ao", expr: "x₁·y₁ / 2(x₁ + y₁) / 0.85Aoh (ศูนย์กลางเหล็กปลอก)", value: `${f(Aoh, 0)} mm² / ${f(ph, 0)} mm / ${f(Ao, 0)} mm²` });
  const Vc = 0.17 * sq * b * d;
  const lhs = Math.hypot(Vu / (b * d), (Tu * ph) / (1.7 * Aoh * Aoh));
  const rhs = phi * (Vc / (b * d) + 0.66 * sq);
  const sectionRatio = lhs / rhs;
  steps.push({ label: "ขนาดหน้าตัด", expr: "√[(Vu/bd)² + (Tu·ph/1.7Aoh²)²] ≤ φ(Vc/bd + 0.66√fc')", value: `${f(lhs)} ≤ ${f(rhs)} MPa`, ok: sectionRatio <= 1 });
  if (sectionRatio > 1) {
    return { required: true, ok: false, Tth: Tth / 1e6, sectionRatio, AtS: 0, AvS: 0, s: null, Al: 0, AlTop: 0, AlBottom: 0, side: null, message: "หน้าตัดเล็กเกินไปสำหรับแรงบิด + แรงเฉือน — เพิ่มขนาดคาน", steps };
  }
  const AtS = Tu / (phi * 2 * Ao * fyt); // mm²/mm ต่อขา
  const AvS = Math.max(0, Vu / phi - Vc) / (fyt * d); // mm²/mm ทุกขา
  const A1 = (Math.PI * ds * ds) / 4;
  const minTot = (Math.max(0.062 * sq, 0.35) * b) / fyt;
  const sStr = A1 / (AtS + AvS / legs);
  const sMin = (legs * A1) / Math.max(minTot, 1e-12); // (Av + 2At)/s ≥ ค่าขั้นต่ำ
  const sMax = Math.min(ph / 8, 300);
  const sNeed = Math.min(sStr, sMin, sMax);
  const s = Math.max(75, Math.floor(sNeed / 25) * 25);
  const sOk = sNeed >= 75 - 1e-9; // ต้องการถี่กว่า 75 mm → ไม่ผ่าน
  steps.push({ label: "At/s", expr: "Tu / (φ·2·Ao·fyt·cot45°)", value: `${f(AtS, 4)} mm²/mm ต่อขา` });
  steps.push({ label: "Av/s (แรงเฉือน)", expr: "(Vu/φ − Vc) / (fyt·d)", value: `${f(AvS, 4)} mm²/mm` });
  steps.push({ label: "ระยะเหล็กปลอก", expr: `min(A₁/(At/s + (Av/s)/${legs}), เหล็กขั้นต่ำ, ph/8 ≤ 300)`, value: sOk ? `${s} mm` : `ต้องการ ${f(sNeed, 0)} mm < 75 mm`, ok: sOk });
  const AtSdesign = Math.max(AtS, (0.175 * b) / fyt);
  const Al = AtS * ph * (fyt / fy);
  const AlMin = Math.max(0, (0.42 * sq * Acp) / fy - AtSdesign * ph * (fyt / fy));
  const AlUse = Math.max(Al, AlMin);
  steps.push({ label: "Al", expr: "(At/s)·ph·fyt/fy ≥ Al,min", value: `${f(AlUse, 0)} mm² (Al,min ${f(AlMin, 0)})` });
  // เหล็กข้าง: ¼Al ต่อด้าน ระยะห่าง ≤ 300 mm
  const sideH = h - 2 * (cover + ds);
  const nSide = Math.max(0, Math.ceil(sideH / 300) - 1);
  const diaMin = Math.max(0.042 * s, 10);
  let side: TorsionResult["side"] = null;
  if (nSide > 0) {
    const need = AlUse / 4;
    const dia = [10, 12, 16, 20, 25].find((dd) => dd >= diaMin && nSide * Math.PI * dd * dd / 4 >= need) ?? 25;
    side = { n: nSide, dia };
    steps.push({ label: "เหล็กข้าง", expr: `¼Al ต่อด้าน, ระยะ ≤ 300 mm, Ø ≥ ${f(diaMin, 0)} mm`, value: `ข้างละ ${nSide}-DB${dia}` });
  }
  // มีเหล็กข้าง → บน/ล่างรับด้านละ ¼Al · คานตื้นไม่มีเหล็กข้าง → บน/ล่างรับด้านละ ½Al
  const AlTop = AlUse * (side ? 0.25 : 0.5), AlBottom = AlTop;
  steps.push({ label: "เหล็กตามยาวเพิ่ม บน / ล่าง", expr: side ? "¼Al แต่ละด้าน" : "½Al แต่ละด้าน (คานตื้น ไม่มีเหล็กข้าง)", value: `${f(AlTop, 0)} / ${f(AlBottom, 0)} mm²` });
  const name = ds <= 9 ? `RB${ds}` : `DB${ds}`;
  return { required: true, ok: sOk, Tth: Tth / 1e6, sectionRatio, AtS, AvS, s, Al: AlUse, AlTop, AlBottom, side, message: sOk ? `ปลอกปิด ${name} @ ${(s / 1000).toFixed(3)} m${side ? ` + เหล็กข้าง ${side.n}-DB${side.dia}` : ""}` : `ปลอกปิด ${name} ต้องการระยะ ${f(sNeed, 0)} mm < 75 mm — เพิ่มขนาดเหล็กปลอกหรือขยายคาน`, steps };
}
