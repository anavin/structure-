// ออกแบบผนังรับแรงเฉือน ค.ส.ล. (ACI 318-19 บทที่ 11 — ผนังธรรมดา, ดัดในระนาบ)
//   P–M ในระนาบ: ความเข้ากันได้ของความเครียด แบ่งความยาวผนัง 40 แถบ เหล็กแนวดิ่งกระจายสม่ำเสมอ
//     φ = 0.65 (ควบคุมแรงอัด) → 0.90 (ควบคุมแรงดึง) ตาม εt · φPn,max = 0.80φP0
//   แรงเฉือน (§11.5.4.3): Vn = Acv(αc·λ√fc' + ρt·fy) ≤ 0.66Acv√fc', Acv = t·Lw
//     αc = 0.25 (hw/lw ≤ 1.5) → 0.17 (hw/lw ≥ 2.0)
//   เหล็กขั้นต่ำ (ตาราง 11.6.1): Vu ≤ 0.5φαc√fc'Acv → ρl ≥ 0.0012, ρt ≥ 0.0020 (DB ≤ 16) · มากกว่านั้น ρl = ρt ≥ 0.0025
//   สองชั้นเมื่อ t ≥ 250 mm (§11.7.2.3) · ระยะเหล็ก ≤ min(3t, 450) (§11.7.2.1, 11.7.3.1)
//   ยังไม่ตรวจ boundary element (ผนังพิเศษ §18.10) และการดัดนอกระนาบ

import type { DesignCode, Step } from "./rcBeam.ts";
import { beta1 } from "./rcBeam.ts";

export interface WallDemand { combo: string; Pu: number; Mu: number; Vu: number } // kN, kN·m (Pu อัด = บวก)
export interface WallInput { code: DesignCode; t: number; Lw: number; hw: number; cover: number; fc: number; fy: number; demands: WallDemand[] } // mm, MPa
export interface WallBars { dia: number; s: number; curtains: number; rho: number }
export interface WallResult {
  vertical: WallBars | null; horizontal: WallBars | null;
  ratioPM: number; ratioV: number; ratio: number; crit: string;
  phiVn: number; ok: boolean; message: string; steps: Step[];
}

const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");
const area = (d: number) => (Math.PI * d * d) / 4;

/** จุดบนเส้นโค้ง φPn–φMn (kN, kN·m) ของผนังที่มีเหล็กแนวดิ่ง As รวม (mm²) กระจายสม่ำเสมอ */
export function wallInteraction(t: number, Lw: number, As: number, fc: number, fy: number): { P: number; M: number }[] {
  const n = 40, Es = 200000, b1 = beta1(fc), dx = Lw / n, ey = fy / Es;
  const pts: { P: number; M: number }[] = [];
  const P0 = 0.85 * fc * (t * Lw - As) + fy * As;
  const phiPmax = 0.8 * 0.65 * P0;
  const cs = [...Array.from({ length: 60 }, (_, k) => Lw * (0.02 + (k * 1.5) / 60)), 2 * Lw, 4 * Lw];
  for (const c of cs) {
    const a = Math.min(b1 * c, Lw);
    let P = 0.85 * fc * a * t, M = 0.85 * fc * a * t * (Lw / 2 - a / 2);
    let eps_t = 0;
    for (let k = 0; k < n; k++) {
      const x = (k + 0.5) * dx;
      const eps = (0.003 * (c - x)) / c;
      const fs = Math.max(-fy, Math.min(fy, Es * eps)) - (x < a ? 0.85 * fc : 0);
      const F = fs * (As / n);
      P += F; M += F * (Lw / 2 - x);
      if (k === n - 1) eps_t = -eps;
    }
    const phi = eps_t <= ey ? 0.65 : eps_t >= ey + 0.003 ? 0.9 : 0.65 + (0.25 * (eps_t - ey)) / 0.003;
    pts.push({ P: Math.min(phi * P, phiPmax) / 1e3, M: (phi * M) / 1e6 });
  }
  pts.push({ P: (-0.9 * fy * As) / 1e3, M: 0 }); // แรงดึงล้วน
  return pts.sort((p, q) => p.P - q.P);
}

/** อัตราส่วนแรง/กำลังตามแนวรัศมี (P, |M|) เทียบเส้นโค้ง */
export function pmRatio(curve: { P: number; M: number }[], P: number, M: number): number {
  const m = Math.abs(M);
  if (Math.hypot(P, m) < 1e-9) return 0;
  // หาจุดตัดของรังสีจากจุดกำเนิดกับรูปหลายเหลี่ยม (เส้นโค้ง + แกน M = 0)
  const poly = [...curve, { P: curve[curve.length - 1].P, M: 0 }];
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = poly[i], B = poly[i + 1];
    const den = P * (B.M - A.M) - m * (B.P - A.P);
    if (Math.abs(den) < 1e-12) continue;
    const s = (A.P * (B.M - A.M) - A.M * (B.P - A.P)) / den; // จุดตัด = s·(P, m)
    const u = Math.abs(B.P - A.P) > Math.abs(B.M - A.M) ? (s * P - A.P) / (B.P - A.P) : (s * m - A.M) / (B.M - A.M);
    if (s > 1e-12 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, 1 / s);
  }
  return best;
}

export function designWall(inp: WallInput): WallResult {
  const { t, Lw, hw, fc, fy } = inp;
  const phiV = inp.code === "ACI" ? 0.75 : 0.85;
  const sq = Math.sqrt(fc);
  const Acv = t * Lw;
  const r = hw / Lw;
  const ac = r <= 1.5 ? 0.25 : r >= 2 ? 0.17 : 0.25 - ((r - 1.5) / 0.5) * 0.08;
  const curtains = t >= 250 ? 2 : 1;
  const smax = Math.min(3 * t, 450);
  const Vu = Math.max(0, ...inp.demands.map((d) => Math.abs(d.Vu)));
  const lowShear = Vu * 1e3 <= 0.5 * phiV * ac * sq * Acv;
  const rlMin = lowShear ? 0.0012 : 0.0025, rtMin = lowShear ? 0.002 : 0.0025;
  const steps: Step[] = [
    { label: "ผนัง", expr: "t × Lw, ความสูงรวม hw", value: `${f(t, 0)} × ${f(Lw, 0)} mm, hw = ${f(hw / 1000)} m (hw/lw = ${f(r)})` },
    { label: "เหล็กขั้นต่ำ", expr: lowShear ? "Vu ≤ 0.5φαc√fc'Acv (แรงเฉือนต่ำ)" : "Vu > 0.5φαc√fc'Acv", value: `ρl ≥ ${rlMin} · ρt ≥ ${rtMin} · ${curtains} ชั้น · ระยะ ≤ ${f(smax, 0)} mm` },
  ];
  // ---- เหล็กแนวดิ่ง: เลือกขนาด/ระยะน้อยสุดที่ผ่าน P–M ----
  let vertical: WallBars | null = null, ratioPM = Infinity, crit = "-";
  const options: { dia: number; s: number }[] = [];
  for (const dia of [10, 12, 16, 20, 25]) for (const s of [300, 250, 200, 150, 125, 100]) if (s <= smax) options.push({ dia, s });
  options.sort((a, b) => area(a.dia) / a.s - area(b.dia) / b.s);
  for (const o of options) {
    const rho = (curtains * area(o.dia)) / (o.s * t);
    if (rho < rlMin - 1e-9) continue;
    const As = rho * t * Lw;
    const curve = wallInteraction(t, Lw, As, fc, fy);
    let worst = 0, wc = "-";
    for (const d of inp.demands) { const q = pmRatio(curve, d.Pu, d.Mu); if (q > worst) { worst = q; wc = d.combo; } }
    if (worst <= 1 || rho > 0.04) { vertical = { ...o, curtains, rho }; ratioPM = worst; crit = wc; if (worst <= 1) break; }
  }
  // ---- เหล็กแนวนอน (แรงเฉือน) ----
  const VnMax = 0.66 * Acv * sq;
  const rtReq = Math.max(rtMin, (Vu * 1e3 / phiV / Acv - ac * sq) / fy);
  let horizontal: WallBars | null = null;
  const hopts = [10, 12, 16].flatMap((dia) => [300, 250, 200, 150, 125, 100].filter((s) => s <= smax).map((s) => ({ dia, s }))).sort((a, b) => area(a.dia) / a.s - area(b.dia) / b.s);
  for (const o of hopts) { const rho = (curtains * area(o.dia)) / (o.s * t); if (rho >= rtReq - 1e-9) { horizontal = { ...o, curtains, rho }; break; } }
  const rt = horizontal?.rho ?? 0;
  const Vn = Math.min(Acv * (ac * sq + rt * fy), VnMax);
  const phiVn = (phiV * Vn) / 1e3;
  const ratioV = phiVn > 0 ? Vu / phiVn : Infinity;
  const nm = (b: WallBars | null) => (b ? `DB${b.dia} @ ${(b.s / 1000).toFixed(3)} m${b.curtains === 2 ? " สองชั้น" : ""} (ρ = ${f(b.rho * 100, 3)}%)` : "ไม่ผ่าน");
  steps.push(
    { label: "เหล็กแนวดิ่ง (P–M ในระนาบ)", expr: `อัตราส่วนสูงสุด (${crit})`, value: `${nm(vertical)} · ${f(ratioPM)}`, ok: ratioPM <= 1 },
    { label: "αc", expr: "0.25 (hw/lw ≤ 1.5) … 0.17 (≥ 2)", value: f(ac, 3) },
    { label: "ρt ที่ต้องการ", expr: "max(ขั้นต่ำ, (Vu/φAcv − αc√fc')/fy)", value: f(rtReq, 5) },
    { label: "เหล็กแนวนอน", expr: "", value: nm(horizontal), ok: !!horizontal },
    { label: "กำลังเฉือน", expr: `φAcv(αc√fc' + ρt·fy) ≤ φ·0.66Acv√fc'`, value: `Vu ${f(Vu)} / φVn ${f(phiVn)} kN`, ok: ratioV <= 1 },
  );
  const ratio = Math.max(ratioPM, ratioV);
  const ok = !!vertical && !!horizontal && ratio <= 1;
  return {
    vertical, horizontal, ratioPM, ratioV, ratio, crit, phiVn, ok,
    message: ok ? `แนวดิ่ง ${nm(vertical)} · แนวนอน ${nm(horizontal)}` : ratioV > 1 ? "แรงเฉือนเกิน — เพิ่มความหนาผนัง" : "P–M ไม่ผ่าน — เพิ่มความหนา/ความยาวผนัง",
    steps,
  };
}
