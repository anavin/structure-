// ออกแบบฐานรากเดี่ยว ค.ส.ล. ใต้เสา
//  - ฐานรากแผ่ (บนดิน): ขนาดจากแรงใช้งานเทียบหน่วยแรงแบกทานยอมให้ (gross), ความหนาจากแรงเฉือนทะลุ/แรงเฉือนทางเดียว,
//    เหล็กเสริมจากโมเมนต์ที่ผิวเสา (แรงประลัย) — ACI 318-19 บทที่ 13 / วสท. 1008-38
//  - ฐานรากเสาเข็ม: จำนวนเข็มจากแรงใช้งาน P/n ± M·x/Σx², ความหนาจากแรงเฉือน (นับแรงเข็มตาม ACI 13.4.2.5),
//    เหล็กเสริมจากโมเมนต์ของแรงเข็มรอบผิวเสา
// โมเมนต์มีเฉพาะในระนาบโครง (แกน x) เพราะเป็นโครง 2 มิติ
// หน่วยภายใน: kN, m (การตรวจกำลังแปลงเป็น N, mm, MPa)

import { KSC_TO_MPA } from "../core/model.ts";
import type { DesignCode, Step } from "./rcBeam.ts";

export const T_TO_KN = 9.80665;
const barArea = (d: number) => (Math.PI * d * d) / 4;
const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "-");

export interface FootingLoadService { name: string; P: number; M: number; H: number; wind: boolean } // P อัดลง (kN), M ที่ยอดฐาน (kN·m), H แนวราบ (kN)
export interface FootingLoadStrength { name: string; Pu: number; Mu: number; Hu: number }

export interface FoundationSettings {
  type: "spread" | "pile";
  /** ระดับท้องฐานรากจากผิวดิน (m) */
  Df: number;
  gammaSoil: number; // kN/m³
  /** หน่วยแรงแบกทานยอมให้ของดิน (t/m²) — ฐานแผ่ */
  qaTon: number;
  /** อัตราส่วน L/B (L ตามระนาบโครง) — ฐานแผ่ */
  ratio: number;
  /** น้ำหนักบรรทุกปลอดภัยต่อต้นของเสาเข็ม (ตัน) */
  pileTon: number;
  /** ขนาดเสาเข็ม (m) */
  pileSize: number;
  /** ระยะห่างเข็ม = k × ขนาดเข็ม */
  pileSpacingFactor: number;
  /** เพิ่มค่ายอมให้ 33% สำหรับกรณีแรงลม */
  windIncrease: boolean;
}

export const defaultFoundation: FoundationSettings = {
  type: "spread", Df: 1.5, gammaSoil: 18, qaTon: 15, ratio: 1,
  pileTon: 30, pileSize: 0.22, pileSpacingFactor: 3, windIncrease: true,
};

export interface FootingInput {
  code: DesignCode;
  c1: number; c2: number; // ขนาดเสา (m): c1 ตามระนาบโครง (x), c2 ตั้งฉาก (y)
  fcKsc: number; fyKsc: number;
  settings: FoundationSettings;
  service: FootingLoadService[];
  strength: FootingLoadStrength[];
}

export interface ServiceCheck { name: string; Ptot: number; Mb: number; e: number; qmax: number; qmin: number; allow: number; ok: boolean; note: string }
export interface PileLayout { nx: number; ny: number; s: number; edge: number; coords: { x: number; y: number }[] }

export interface FootingResult {
  type: "spread" | "pile";
  L: number; B: number; t: number; // m
  piles: PileLayout | null;
  service: ServiceCheck[];
  barsX: string; barsY: string; // เหล็กตามแนว x (ต้านโมเมนต์รอบแกน y) / ตามแนว y
  ok: boolean;
  message: string;
  steps: Step[];
  /** ผลแรงประลัยวิกฤต */
  crit: { punch: number; oneWayX: number; oneWayY: number; MuX: number; MuY: number };
}

// ---------- เหล็กเสริม ----------
export function slabSteel(MuKnm: number, widthM: number, tM: number, dMm: number, fc: number, fy: number, phi: number, cover: number) {
  const b = widthM * 1000;
  const Mu = MuKnm * 1e6;
  const Rn = Mu / (phi * b * dMm * dMm);
  const k = (2 * Rn) / (0.85 * fc);
  const rho = k >= 1 ? NaN : ((0.85 * fc) / fy) * (1 - Math.sqrt(1 - k));
  const AsMin = 0.0018 * b * tM * 1000;
  const As = Math.max(Number.isFinite(rho) ? rho * b * dMm : Infinity, AsMin);
  const sMax = Math.min(3 * tM * 1000, 450);
  let pick: { dia: number; n: number; s: number } | null = null;
  // เลือกเหล็กเส้นเล็กสุดที่ได้ระยะเรียง ≥ 150 mm (สะดวกต่อการเทคอนกรีต) ถ้าไม่ได้จึงยอมถึง 100 mm
  for (const sMin of [150, 100]) {
    for (const dia of [12, 16, 20, 25]) {
      let n = Math.max(2, Math.ceil(As / barArea(dia)));
      let s = (b - 2 * cover) / (n - 1);
      while (s > sMax) { n++; s = (b - 2 * cover) / (n - 1); }
      if (s >= sMin) { pick = { dia, n, s: Math.floor(s / 25) * 25 }; break; }
    }
    if (pick) break;
  }
  return { As, AsMin, rho, pick, ok: Number.isFinite(As) && !!pick };
}

export const vcOneWay = (fc: number, b: number, d: number) => 0.17 * Math.sqrt(fc) * b * d; // N
export function vcPunch(fc: number, bo: number, d: number, beta: number, alphaS: number) {
  const sq = Math.sqrt(fc);
  return Math.min(0.33 * sq, 0.17 * (1 + 2 / beta) * sq, 0.083 * ((alphaS * d) / bo + 2) * sq) * bo * d;
}

// ---------- ฐานรากแผ่ ----------
/** แรงดันดินที่ตำแหน่ง x (m) จากศูนย์กลาง — เชิงเส้น หรือสามเหลี่ยมเมื่อ e > L/6 */
export function pressureAt(P: number, M: number, B: number, L: number, x: number): number {
  if (P <= 0) return 0;
  const e = M / P; // M บวก (ทวนเข็ม) กดด้าน −x
  if (Math.abs(e) <= L / 6) return P / (B * L) - (M * x) / ((B * L ** 3) / 12);
  const a = 3 * (L / 2 - Math.abs(e)); // ความยาวที่สัมผัส
  const qmax = (2 * P) / (3 * B * (L / 2 - Math.abs(e)));
  const xs = e > 0 ? x + L / 2 : L / 2 - x; // ระยะจากขอบที่แรงดันสูง
  return xs <= a ? qmax * (1 - xs / a) : 0;
}

function integrate(fn: (x: number) => number, a: number, b: number, n = 200) {
  if (b <= a) return 0;
  const h = (b - a) / n;
  let s = fn(a) + fn(b);
  for (let k = 1; k < n; k++) s += fn(a + k * h) * (k % 2 ? 4 : 2);
  return (s * h) / 3;
}

function serviceSpread(B: number, L: number, t: number, inp: FootingInput): ServiceCheck[] {
  const st = inp.settings;
  const qa = st.qaTon * T_TO_KN;
  const W = (24 * t + st.gammaSoil * Math.max(0, st.Df - t)) * B * L;
  return inp.service.map((s) => {
    const Ptot = s.P + W;
    const Mb = s.M - s.H * t; // โมเมนต์ที่ท้องฐาน
    const e = Ptot > 0 ? Mb / Ptot : Infinity;
    const allow = qa * (s.wind && st.windIncrease ? 1.33 : 1);
    if (Ptot <= 0) return { name: s.name, Ptot, Mb, e, qmax: 0, qmin: 0, allow, ok: false, note: "แรงถอน" };
    let qmax: number, qmin: number, note = "";
    if (Math.abs(e) <= L / 6) {
      qmax = (Ptot / (B * L)) * (1 + (6 * Math.abs(e)) / L);
      qmin = (Ptot / (B * L)) * (1 - (6 * Math.abs(e)) / L);
    } else {
      qmax = Math.abs(e) < L / 2 ? (2 * Ptot) / (3 * B * (L / 2 - Math.abs(e))) : Infinity;
      qmin = 0;
      note = "สัมผัสดินบางส่วน (e > L/6)";
    }
    // กรณีแรงในแนวดิ่งอย่างเดียวต้องไม่มีส่วนยก; กรณีลมยอมให้ยกได้ถ้า e < L/3
    const contactOk = Math.abs(e) <= L / 6 || (s.wind && Math.abs(e) < L / 3);
    return { name: s.name, Ptot, Mb, e, qmax, qmin, allow, ok: qmax <= allow && contactOk, note };
  });
}

function designSpread(inp: FootingInput): FootingResult {
  const st = inp.settings;
  const fc = inp.fcKsc * KSC_TO_MPA, fy = inp.fyKsc * KSC_TO_MPA;
  const phiV = inp.code === "ACI" ? 0.75 : 0.85;
  const phiM = 0.9;
  const cover = 75; // mm หล่อติดดิน
  const db = 16;
  const { c1, c2 } = inp;
  const steps: Step[] = [];

  // 1) ขนาดฐานจากแรงใช้งาน (วนกับความหนา 2 รอบ)
  let t = 0.3, B = 0, L = 0;
  let service: ServiceCheck[] = [];
  let thick = { ok: false, punch: 0, ow: 0, owy: 0, d: 0 };
  for (let pass = 0; pass < 3; pass++) {
    B = Math.max(c2 + 0.3, (c1 + 0.3) / st.ratio, 0.6);
    for (let k = 0; k < 200; k++) {
      L = Math.max(st.ratio * B, c1 + 0.3);
      service = serviceSpread(B, L, t, inp);
      if (service.every((s) => s.ok)) break;
      B = Math.round((B + 0.05) * 100) / 100;
    }
    // 2) ความหนาจากแรงเฉือน
    for (let tt = 0.25; tt <= 2.5 + 1e-9; tt = Math.round((tt + 0.05) * 100) / 100) {
      const d = tt * 1000 - cover - db; // mm (เฉลี่ยสองชั้น)
      if (d < 150) continue;
      const dm = d / 1000;
      let worstP = 0, worstX = 0, worstY = 0;
      for (const s of inp.strength) {
        const q = (x: number) => pressureAt(s.Pu, s.Mu - s.Hu * tt, B, L, x);
        const qavg = s.Pu / (B * L);
        const Vp = s.Pu - qavg * (c1 + dm) * (c2 + dm);
        const bo = 2 * (c1 + dm + c2 + dm) * 1000;
        const beta = Math.max(c1, c2) / Math.min(c1, c2);
        worstP = Math.max(worstP, (Vp * 1e3) / (phiV * vcPunch(fc, bo, d, beta, 40)));
        const xr = c1 / 2 + dm;
        const Vx = Math.max(B * integrate(q, xr, L / 2), B * integrate(q, -L / 2, -xr));
        worstX = Math.max(worstX, (Vx * 1e3) / (phiV * vcOneWay(fc, B * 1000, d)));
        const Vy = (s.Pu / B) * Math.max(0, B / 2 - c2 / 2 - dm);
        worstY = Math.max(worstY, (Vy * 1e3) / (phiV * vcOneWay(fc, L * 1000, d)));
      }
      thick = { ok: worstP <= 1 && worstX <= 1 && worstY <= 1, punch: worstP, ow: worstX, owy: worstY, d };
      if (thick.ok) { t = tt; break; }
    }
    const svc = serviceSpread(B, L, t, inp);
    if (svc.every((s) => s.ok)) { service = svc; break; }
  }

  // 3) โมเมนต์ที่ผิวเสาและเหล็กเสริม
  const d = t * 1000 - cover - db;
  let MuX = 0, MuY = 0;
  for (const s of inp.strength) {
    const q = (x: number) => pressureAt(s.Pu, s.Mu - s.Hu * t, B, L, x);
    const a = c1 / 2;
    MuX = Math.max(MuX, B * integrate((x) => q(x) * (x - a), a, L / 2), B * integrate((x) => q(x) * (-a - x), -L / 2, -a));
    MuY = Math.max(MuY, ((s.Pu / B) * (B / 2 - c2 / 2) ** 2) / 2);
  }
  const sx = slabSteel(MuX, B, t, d, fc, fy, phiM, cover);
  const sy = slabSteel(MuY, L, t, d, fc, fy, phiM, cover);
  const name = (p: ReturnType<typeof slabSteel>["pick"]) => (p ? `${p.n}DB${p.dia} @ ${(p.s / 1000).toFixed(3)} m` : "—");

  const qa = st.qaTon * T_TO_KN;
  const worst = service.reduce((a, s) => (s.qmax / s.allow > a.qmax / a.allow ? s : a), service[0]);
  steps.push({ label: "หน่วยแรงแบกทานยอมให้", expr: `qa = ${st.qaTon} t/m² (gross)${st.windIncrease ? ", กรณีลม ×1.33" : ""}`, value: `${f(qa)} kN/m²` });
  steps.push({ label: "ขนาดเสา", expr: "c1 (ระนาบโครง) × c2", value: `${f(c1 * 1000, 0)} × ${f(c2 * 1000, 0)} mm` });
  steps.push({ label: "ขนาดฐาน", expr: `L × B × t, Df = ${st.Df} m`, value: `${f(L)} × ${f(B)} × ${f(t)} m` });
  steps.push({ label: "น้ำหนักฐาน + ดินถม", expr: `(24t + γs(Df − t))·B·L, γs = ${st.gammaSoil}`, value: `${f((24 * t + st.gammaSoil * Math.max(0, st.Df - t)) * B * L)} kN` });
  if (worst) {
    steps.push({ label: "กรณีแรงใช้งานวิกฤต", expr: worst.name, value: `P = ${f(worst.Ptot)} kN, M = ${f(worst.Mb)} kN·m` });
    steps.push({ label: "ระยะเยื้องศูนย์ e", expr: `M/P (L/6 = ${f(L / 6, 3)} m)`, value: `${f(worst.e, 3)} m` });
    steps.push({ label: "qmax / qmin", expr: Math.abs(worst.e) <= L / 6 ? "(P/A)(1 ± 6e/L)" : "2P / [3B(L/2 − e)]", value: `${f(worst.qmax)} / ${f(worst.qmin)} kN/m² ${worst.ok ? "≤" : ">"} ${f(worst.allow)}`, ok: worst.ok });
  }
  steps.push({ label: "ความลึกประสิทธิผล d", expr: `t − ${cover} − db (เฉลี่ยสองชั้น)`, value: `${f(d, 0)} mm` });
  steps.push({ label: "แรงเฉือนทะลุ (ที่ d/2)", expr: "Vu / φVc, Vc = min(0.33, 0.17(1+2/β), 0.083(αs·d/bo+2))√fc'·bo·d", value: f(thick.punch, 3), ok: thick.punch <= 1 });
  steps.push({ label: "แรงเฉือนทางเดียว x (ที่ d)", expr: "Vu / φ(0.17√fc' B d) — แรงดันดินตามจริง", value: f(thick.ow, 3), ok: thick.ow <= 1 });
  steps.push({ label: "แรงเฉือนทางเดียว y (ที่ d)", expr: "Vu / φ(0.17√fc' L d)", value: f(thick.owy, 3), ok: thick.owy <= 1 });
  steps.push({ label: "Mu ที่ผิวเสา (แนว x)", expr: "B∫q(x)(x − c1/2)dx", value: `${f(MuX)} kN·m` });
  steps.push({ label: "เหล็กแนว x", expr: `As = max(ρbd, 0.0018bt) = ${f(sx.As, 0)} mm²`, value: name(sx.pick), ok: sx.ok });
  steps.push({ label: "Mu ที่ผิวเสา (แนว y)", expr: "(Pu/B)(B/2 − c2/2)²/2", value: `${f(MuY)} kN·m` });
  steps.push({ label: "เหล็กแนว y", expr: `As = max(ρbd, 0.0018bt) = ${f(sy.As, 0)} mm²`, value: name(sy.pick), ok: sy.ok });

  const svcOk = service.every((s) => s.ok);
  const ok = svcOk && thick.ok && sx.ok && sy.ok;
  const message = ok ? `${f(L)}×${f(B)}×${f(t)} m` : !svcOk ? "แรงแบกทานเกิน/ฐานยก — ตรวจ qa หรือเพิ่มขนาด" : !thick.ok ? "ความหนาไม่พอสำหรับแรงเฉือน" : "เหล็กเสริมไม่พอ";
  return {
    type: "spread", L, B, t, piles: null, service, barsX: name(sx.pick), barsY: name(sy.pick), ok, message, steps,
    crit: { punch: thick.punch, oneWayX: thick.ow, oneWayY: thick.owy, MuX, MuY },
  };
}

// ---------- ฐานรากเสาเข็ม ----------
const LAYOUTS: [number, number][] = [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 4], [5, 5]];

export function pileLayout(nx: number, ny: number, s: number, edge: number): PileLayout {
  const coords: { x: number; y: number }[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    coords.push({ x: (i - (nx - 1) / 2) * s, y: (j - (ny - 1) / 2) * s });
  }
  return { nx, ny, s, edge, coords };
}

/** แรงในเข็มแต่ละต้น P/n ± M·x/Σx² */
export function pileForces(P: number, M: number, lay: PileLayout): number[] {
  const n = lay.coords.length;
  const sx2 = lay.coords.reduce((a, c) => a + c.x * c.x, 0);
  // M ทวนเข็ม (บวก) กดเข็มด้าน −x
  return lay.coords.map((c) => P / n - (sx2 > 0 ? (M * c.x) / sx2 : 0));
}

/** สัดส่วนแรงเข็มที่นับว่าอยู่นอกหน้าตัดวิกฤต (ACI 13.4.2.5) */
export const outside = (dist: number, D: number) => Math.min(1, Math.max(0, (dist + D / 2) / D));

function designPile(inp: FootingInput): FootingResult {
  const st = inp.settings;
  const fc = inp.fcKsc * KSC_TO_MPA, fy = inp.fyKsc * KSC_TO_MPA;
  const phiV = inp.code === "ACI" ? 0.75 : 0.85;
  const Ra = st.pileTon * T_TO_KN;
  const D = st.pileSize;
  const s = Math.max(st.pileSpacingFactor * D, 0.6);
  const edge = Math.max(D, 0.25);
  const { c1, c2 } = inp;
  const db = 16;
  const steps: Step[] = [];

  const svcFor = (lay: PileLayout, L: number, B: number, t: number): ServiceCheck[] => {
    const W = (24 * t + st.gammaSoil * Math.max(0, st.Df - t)) * B * L;
    return inp.service.map((sv) => {
      const Ptot = sv.P + W;
      const Mb = sv.M - sv.H * t;
      const pf = pileForces(Ptot, Mb, lay);
      const allow = Ra * (sv.wind && st.windIncrease ? 1.33 : 1);
      const qmax = Math.max(...pf), qmin = Math.min(...pf);
      const ok = qmax <= allow && qmin >= 0;
      return { name: sv.name, Ptot, Mb, e: Ptot > 0 ? Mb / Ptot : Infinity, qmax, qmin, allow, ok, note: qmin < 0 ? "เข็มรับแรงถอน" : "" };
    });
  };

  let chosen: { lay: PileLayout; L: number; B: number; t: number; service: ServiceCheck[] } | null = null;
  for (const [nx, ny] of LAYOUTS) {
    const lay = pileLayout(nx, ny, s, edge);
    const L = Math.max((nx - 1) * s + 2 * edge, c1 + 0.2);
    const B = Math.max((ny - 1) * s + 2 * edge, c2 + 0.2);
    const tGuess = nx * ny === 1 ? 0.6 : 0.8;
    // เข็มต้นเดียวรับโมเมนต์ไม่ได้ (ต้องมีคานยึด) — ใช้เมื่อ e เล็กมากเท่านั้น
    if (nx * ny === 1 && inp.service.some((sv) => Math.abs(sv.M - sv.H * tGuess) > 0.05 * Math.max(sv.P, 1))) continue;
    const service = svcFor(lay, L, B, tGuess);
    if (service.every((x) => x.ok)) { chosen = { lay, L, B, t: tGuess, service }; break; }
  }
  if (!chosen) {
    return {
      type: "pile", L: 0, B: 0, t: 0, piles: null, service: [], barsX: "—", barsY: "—", ok: false,
      message: `ต้องใช้เข็มมากกว่า ${LAYOUTS[LAYOUTS.length - 1][0] * LAYOUTS[LAYOUTS.length - 1][1]} ต้น — เพิ่มกำลังเข็ม`, steps,
      crit: { punch: 0, oneWayX: 0, oneWayY: 0, MuX: 0, MuY: 0 },
    };
  }
  const { lay, L, B } = chosen;
  const n = lay.coords.length;

  // ความหนาจากแรงเฉือน
  let t = chosen.t, best = { punch: Infinity, ow: Infinity, owy: Infinity, corner: 0, d: 0 };
  for (let tt = 0.5; tt <= 3 + 1e-9; tt = Math.round((tt + 0.05) * 100) / 100) {
    const d = tt * 1000 - 150 - db; // ฝังหัวเข็ม ~100 mm + ระยะหุ้ม
    if (d < 300) continue;
    const dm = d / 1000;
    let wp = 0, wx = 0, wy = 0, wc = 0;
    for (const sg of inp.strength) {
      const pf = pileForces(sg.Pu, sg.Mu - sg.Hu * tt, lay);
      // ทะลุรอบเสา
      const hx = (c1 + dm) / 2, hy = (c2 + dm) / 2;
      let Vp = 0;
      lay.coords.forEach((c, k) => {
        const dist = Math.max(Math.abs(c.x) - hx, Math.abs(c.y) - hy);
        Vp += pf[k] * outside(dist, D);
      });
      const bo = 2 * (c1 + c2 + 2 * dm) * 1000;
      const beta = Math.max(c1, c2) / Math.min(c1, c2);
      if (n > 1) wp = Math.max(wp, (Vp * 1e3) / (phiV * vcPunch(fc, bo, d, beta, 40)));
      // ทางเดียว x และ y (ที่ระยะ d จากผิวเสา) ทั้งสองข้าง
      for (const sgn of [1, -1]) {
        let vx = 0, vy = 0;
        lay.coords.forEach((c, k) => {
          vx += Math.max(0, pf[k]) * outside(sgn * c.x - (c1 / 2 + dm), D);
          vy += Math.max(0, pf[k]) * outside(sgn * c.y - (c2 / 2 + dm), D);
        });
        wx = Math.max(wx, (vx * 1e3) / (phiV * vcOneWay(fc, B * 1000, d)));
        wy = Math.max(wy, (vy * 1e3) / (phiV * vcOneWay(fc, L * 1000, d)));
      }
      // ทะลุรอบเข็มมุม (ขอบเขตสองด้านถึงขอบฐาน)
      if (n > 1) {
        const boC = 2 * (edge + (D + dm) / 2) * 1000;
        wc = Math.max(wc, (Math.max(...pf) * 1e3) / (phiV * vcPunch(fc, boC, d, 1, 20)));
      }
    }
    best = { punch: wp, ow: wx, owy: wy, corner: wc, d };
    if (wp <= 1 && wx <= 1 && wy <= 1 && wc <= 1) { t = tt; break; }
  }
  const service = svcFor(lay, L, B, t);
  const d = t * 1000 - 150 - db;

  // โมเมนต์ที่ผิวเสา
  let MuX = 0, MuY = 0;
  for (const sg of inp.strength) {
    const pf = pileForces(sg.Pu, sg.Mu - sg.Hu * t, lay);
    for (const sgn of [1, -1]) {
      let mx = 0, my = 0;
      lay.coords.forEach((c, k) => {
        const ax = sgn * c.x - c1 / 2, ay = sgn * c.y - c2 / 2;
        if (ax > 0) mx += Math.max(0, pf[k]) * ax;
        if (ay > 0) my += Math.max(0, pf[k]) * ay;
      });
      MuX = Math.max(MuX, mx); MuY = Math.max(MuY, my);
    }
  }
  const sx = slabSteel(MuX, B, t, d, fc, fy, 0.9, 75);
  const sy = slabSteel(MuY, L, t, d, fc, fy, 0.9, 75);
  const name = (p: ReturnType<typeof slabSteel>["pick"]) => (p ? `${p.n}DB${p.dia} @ ${(p.s / 1000).toFixed(3)} m` : "—");

  const worst = service.reduce((a, x) => (x.qmax / x.allow > a.qmax / a.allow ? x : a), service[0]);
  steps.push({ label: "เสาเข็ม", expr: `ขนาด ${f(D * 1000, 0)} mm, Ra = ${st.pileTon} ตัน/ต้น${st.windIncrease ? " (ลม ×1.33)" : ""}`, value: `${f(Ra)} kN` });
  steps.push({ label: "การวางเข็ม", expr: `${lay.nx} × ${lay.ny}, ระยะห่าง ${f(s)} m (${st.pileSpacingFactor}D), ระยะขอบ ${f(edge)} m`, value: `${n} ต้น` });
  steps.push({ label: "ขนาดฐาน", expr: "L × B × t", value: `${f(L)} × ${f(B)} × ${f(t)} m` });
  if (worst) {
    steps.push({ label: "กรณีแรงใช้งานวิกฤต", expr: worst.name, value: `P = ${f(worst.Ptot)} kN, M = ${f(worst.Mb)} kN·m` });
    steps.push({ label: "แรงในเข็ม max / min", expr: "P/n ± M·x/Σx²", value: `${f(worst.qmax)} / ${f(worst.qmin)} kN ${worst.ok ? "≤" : ">"} ${f(worst.allow)}`, ok: worst.ok });
  }
  steps.push({ label: "ความลึกประสิทธิผล d", expr: "t − 150 (ฝังหัวเข็ม + หุ้ม) − db", value: `${f(d, 0)} mm` });
  if (n > 1) steps.push({ label: "แรงเฉือนทะลุรอบเสา", expr: "ΣPu เข็มนอกแนว d/2 (ACI 13.4.2.5) / φVc", value: f(best.punch, 3), ok: best.punch <= 1 });
  steps.push({ label: "แรงเฉือนทางเดียว x / y", expr: "ΣPu เข็มนอกแนว d / φ(0.17√fc' b d)", value: `${f(best.ow, 3)} / ${f(best.owy, 3)}`, ok: best.ow <= 1 && best.owy <= 1 });
  if (n > 1) steps.push({ label: "แรงเฉือนทะลุรอบเข็มมุม", expr: "αs = 20, bo ถึงขอบฐาน", value: f(best.corner, 3), ok: best.corner <= 1 });
  steps.push({ label: "Mu ที่ผิวเสา x / y", expr: "ΣPu,i·(xi − c/2)", value: `${f(MuX)} / ${f(MuY)} kN·m` });
  steps.push({ label: "เหล็กแนว x", expr: `As = ${f(sx.As, 0)} mm²`, value: name(sx.pick), ok: sx.ok });
  steps.push({ label: "เหล็กแนว y", expr: `As = ${f(sy.As, 0)} mm²`, value: name(sy.pick), ok: sy.ok });

  const svcOk = service.every((x) => x.ok);
  const shearOk = best.punch <= 1 && best.ow <= 1 && best.owy <= 1 && best.corner <= 1;
  const ok = svcOk && shearOk && sx.ok && sy.ok;
  return {
    type: "pile", L, B, t, piles: lay, service, barsX: name(sx.pick), barsY: name(sy.pick), ok,
    message: ok ? `เข็ม ${n} ต้น, ${f(L)}×${f(B)}×${f(t)} m` : !svcOk ? "แรงในเข็มเกินกำลัง/เข็มรับแรงถอน" : !shearOk ? "ความหนาไม่พอสำหรับแรงเฉือน" : "เหล็กเสริมไม่พอ",
    steps, crit: { punch: best.punch, oneWayX: best.ow, oneWayY: best.owy, MuX, MuY },
  };
}

export function designFooting(inp: FootingInput): FootingResult {
  return inp.settings.type === "pile" ? designPile(inp) : designSpread(inp);
}
