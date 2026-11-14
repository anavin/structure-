// เสา ค.ส.ล. สี่เหลี่ยมรับแรงอัดร่วมกับโมเมนต์สองแกน (P–M33–M22)
// ความเข้ากันได้ของความเครียดที่มุมแกนสะเทินใดๆ: ตัดพื้นที่คอนกรีตรับแรงอัด (Whitney block) ด้วยระนาบ
// แล้วค้นหามุม θ และความลึก c ให้ φPn = Pu และทิศโมเมนต์ตรงกับแรงที่กระทำ → อัตราส่วน = |Mu| / φMn
// พิกัดหน้าตัด: u ตามแกน 2 (ด้าน h), w ตามแกน 3 (ด้าน b) · M33 ใช้แขน u, M22 ใช้แขน w
// หน่วยภายใน: N, mm, MPa

import { KSC_TO_MPA } from "../core/model.ts";
import { beta1, type DesignCode } from "./rcBeam.ts";

const ES = 200000, ECU = 0.003;
const barArea = (d: number) => (Math.PI * d * d) / 4;

export interface BiaxSection {
  code: DesignCode;
  b: number; h: number; cover: number; tieDia: number; // mm
  fcKsc: number; fyKsc: number;
}

/** การวางเหล็ก: n2 = จำนวนเหล็กต่อด้านตามแนว h (รวมมุม), n3 = ต่อด้านตามแนว b (รวมมุม) */
export interface BiaxLayout { dia: number; n2: number; n3: number }

export const totalBarsBiax = (l: BiaxLayout) => 2 * (l.n2 + l.n3) - 4;

export function barPositions(s: BiaxSection, l: BiaxLayout): { u: number; w: number }[] {
  const e = s.cover + s.tieDia + l.dia / 2;
  const U = s.h / 2 - e, W = s.b / 2 - e;
  const pts: { u: number; w: number }[] = [];
  const key = new Set<string>();
  const add = (u: number, w: number) => { const k = `${u.toFixed(3)},${w.toFixed(3)}`; if (!key.has(k)) { key.add(k); pts.push({ u, w }); } };
  for (let i = 0; i < l.n2; i++) { const u = -U + (2 * U * i) / (l.n2 - 1); add(u, -W); add(u, W); }
  for (let j = 0; j < l.n3; j++) { const w = -W + (2 * W * j) / (l.n3 - 1); add(-U, w); add(U, w); }
  return pts;
}

type P2 = [number, number];
function clipHalfPlane(poly: P2[], nx: number, ny: number, s: number): P2[] {
  const out: P2[] = [];
  const inside = (p: P2) => p[0] * nx + p[1] * ny >= s;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const da = a[0] * nx + a[1] * ny - s, db = b[0] * nx + b[1] * ny - s;
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}
function areaCentroid(poly: P2[]) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const cr = x0 * y1 - x1 * y0;
    A += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
  }
  A /= 2;
  return Math.abs(A) < 1e-12 ? { A: 0, cx: 0, cy: 0 } : { A: Math.abs(A), cx: cx / (6 * A), cy: cy / (6 * A) };
}

export interface BiaxPoint { Pn: number; M2: number; M3: number; phi: number }

/** กำลังระบุที่มุม θ (ทิศรับแรงอัดในระนาบ u–w) และความลึก c (mm) — คืน kN, kN·m */
export function sectionAt(s: BiaxSection, bars: { u: number; w: number }[], As1: number, theta: number, c: number): BiaxPoint {
  const fc = s.fcKsc * KSC_TO_MPA, fy = s.fyKsc * KSC_TO_MPA;
  const b1 = beta1(fc);
  const nu = Math.cos(theta), nw = Math.sin(theta);
  const corners: P2[] = [[-s.h / 2, -s.b / 2], [s.h / 2, -s.b / 2], [s.h / 2, s.b / 2], [-s.h / 2, s.b / 2]];
  const dmax = Math.max(...corners.map(([u, w]) => u * nu + w * nw));
  const a = Math.min(b1 * c, 2 * dmax + 1);
  const block = areaCentroid(clipHalfPlane(corners, nu, nw, dmax - a));
  let Pn = 0.85 * fc * block.A;
  let M3 = Pn * block.cx, M2 = Pn * block.cy;
  let dt = 0;
  for (const p of bars) {
    const t = dmax - (p.u * nu + p.w * nw); // ระยะจากผิวรับแรงอัดสุด
    dt = Math.max(dt, t);
    const es = (ECU * (c - t)) / c;
    let fs = Math.max(-fy, Math.min(fy, ES * es));
    if (t < a) fs -= 0.85 * fc;
    const F = fs * As1;
    Pn += F; M3 += F * p.u; M2 += F * p.w;
  }
  const et = (ECU * (dt - c)) / c;
  let phi: number;
  if (s.code === "ACI") {
    const ety = fy / ES;
    phi = et <= ety ? 0.65 : et >= ety + 0.003 ? 0.9 : 0.65 + (0.25 * (et - ety)) / 0.003;
  } else {
    // วสท.: 0.70 → 0.90 เมื่อแรงอัดต่ำ (ใช้ 0.1fc'Ag เป็นเกณฑ์ — อนุรักษ์นิยมกว่า φPb ในกรณีส่วนใหญ่)
    const Pt = 0.1 * fc * s.b * s.h;
    phi = Pn <= 0 ? 0.9 : 0.7 * Pn >= Pt ? 0.7 : 0.9 - (0.2 * 0.7 * Pn) / Pt;
  }
  return { Pn: Pn / 1e3, M2: M2 / 1e6, M3: M3 / 1e6, phi };
}

export interface BiaxCheck { ratio: number; phiMn: number; phiM3: number; phiM2: number; theta: number; note: string }

export function phiPnMaxBiax(s: BiaxSection, l: BiaxLayout): number {
  const fc = s.fcKsc * KSC_TO_MPA, fy = s.fyKsc * KSC_TO_MPA;
  const Ast = totalBarsBiax(l) * barArea(l.dia);
  const P0 = 0.85 * fc * (s.b * s.h - Ast) + fy * Ast;
  return (0.8 * (s.code === "ACI" ? 0.65 : 0.7) * P0) / 1e3;
}

/** ตรวจ (Pu, Mu3, Mu2): kN, kN·m (ใช้ขนาด) */
export function checkBiaxial(s: BiaxSection, l: BiaxLayout, Pu: number, Mu3: number, Mu2: number): BiaxCheck {
  const bars = barPositions(s, l);
  const As1 = barArea(l.dia);
  const pMax = phiPnMaxBiax(s, l);
  const fy = s.fyKsc * KSC_TO_MPA;
  const pTen = (-0.9 * fy * As1 * bars.length) / 1e3;
  if (Pu > pMax) return { ratio: Pu / pMax, phiMn: 0, phiM3: 0, phiM2: 0, theta: 0, note: "Pu เกิน φPn,max" };
  if (Pu < pTen) return { ratio: Pu / pTen, phiMn: 0, phiM3: 0, phiM2: 0, theta: 0, note: "แรงดึงเกินกำลัง" };
  const m3 = Math.abs(Mu3), m2 = Math.abs(Mu2);
  const Mu = Math.hypot(m3, m2);
  if (Mu < 1e-9) return { ratio: Pu > 0 ? Pu / pMax : Pu / pTen, phiMn: 0, phiM3: 0, phiM2: 0, theta: 0, note: "" };

  // หา c ที่ φPn = Pu สำหรับมุม θ (bisection บน log c)
  const atTheta = (theta: number) => {
    let lo = Math.log(1), hi = Math.log(Math.max(s.b, s.h) * 50);
    let pt = sectionAt(s, bars, As1, theta, Math.exp(hi));
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      pt = sectionAt(s, bars, As1, theta, Math.exp(mid));
      if (pt.phi * pt.Pn > Pu) hi = mid; else lo = mid;
    }
    return { phiM3: pt.phi * pt.M3, phiM2: pt.phi * pt.M2 };
  };
  // หา θ ที่ทิศโมเมนต์ตรงกับแรงกระทำ (ควอดแรนต์แรก — หน้าตัดสมมาตร)
  const target = Math.atan2(m2, m3);
  let lo = 0, hi = Math.PI / 2;
  let best = atTheta(target);
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    best = atTheta(mid);
    const lam = Math.atan2(best.phiM2, best.phiM3);
    if (lam < target) lo = mid; else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  const phiMn = Math.hypot(best.phiM3, best.phiM2);
  return { ratio: Mu / Math.max(phiMn, 1e-9), phiMn, phiM3: best.phiM3, phiM2: best.phiM2, theta: (lo + hi) / 2, note: "" };
}

export interface BiaxDemand { combo: string; end: "i" | "j" | "กลาง"; Pu: number; M3: number; M2: number }

export interface BiaxDesign {
  layout: BiaxLayout | null;
  Ast: number; rho: number;
  ratio: number;
  crit: (BiaxDemand & BiaxCheck) | null;
  ok: boolean;
  message: string;
}

/** เลือกเหล็กยืนน้อยที่สุดที่ผ่านทุกกรณี (ρ 1%–4%) */
export function designBiaxial(s: BiaxSection, demands: BiaxDemand[]): BiaxDesign {
  const Ag = s.b * s.h;
  const clear = (db: number) => Math.max(1.5 * db, 40);
  const fits = (n: number, len: number, db: number) => n >= 2 && (len - 2 * s.cover - 2 * s.tieDia - n * db) / (n - 1) >= clear(db);
  const cands: BiaxLayout[] = [];
  for (const dia of [12, 16, 20, 25, 28]) for (let n2 = 2; n2 <= 8; n2++) for (let n3 = 2; n3 <= 8; n3++) {
    if (!fits(n2, s.h, dia) || !fits(n3, s.b, dia)) continue;
    const l = { dia, n2, n3 };
    const rho = (totalBarsBiax(l) * barArea(dia)) / Ag;
    if (rho >= 0.01 && rho <= 0.04) cands.push(l);
  }
  cands.sort((a, b) => totalBarsBiax(a) * barArea(a.dia) - totalBarsBiax(b) * barArea(b.dia) || totalBarsBiax(a) - totalBarsBiax(b));
  let fallback: BiaxDesign | null = null;
  for (const l of cands) {
    let crit: (BiaxDemand & BiaxCheck) | null = null;
    for (const d of demands) {
      const c = checkBiaxial(s, l, d.Pu, d.M3, d.M2);
      if (!crit || c.ratio > crit.ratio) crit = { ...d, ...c };
      if (c.ratio > 1) break; // ตัดทิ้งเร็ว
    }
    const Ast = totalBarsBiax(l) * barArea(l.dia);
    const r = crit?.ratio ?? 0;
    const res: BiaxDesign = { layout: l, Ast, rho: Ast / Ag, ratio: r, crit, ok: r <= 1, message: "" };
    if (r <= 1) {
      // คำนวณกรณีวิกฤตจริงครบทุกกรณีสำหรับแบบที่เลือก
      for (const d of demands) { const c = checkBiaxial(s, l, d.Pu, d.M3, d.M2); if (c.ratio > res.ratio) { res.ratio = c.ratio; res.crit = { ...d, ...c }; } }
      res.message = `${totalBarsBiax(l)}DB${l.dia}`;
      return res;
    }
    if (!fallback || r < fallback.ratio) fallback = res;
  }
  if (!fallback) return { layout: null, Ast: 0, rho: 0, ratio: Infinity, crit: null, ok: false, message: "วางเหล็ก 1%–4% ไม่ได้ — ตรวจขนาดเสา" };
  return { ...fallback, ok: false, message: `กำลังไม่พอแม้ใช้เหล็ก 4% (อัตราส่วน ${fallback.ratio.toFixed(2)}) — เพิ่มขนาดเสา` };
}
