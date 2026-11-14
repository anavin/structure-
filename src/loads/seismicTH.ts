// แรงแผ่นดินไหว — วิธีแรงสถิตเทียบเท่า (Equivalent Static) แนวทาง มยผ. 1301/1302-61
//   SMS = Fa·Ss, SM1 = Fv·S1, SDS = ⅔SMS, SD1 = ⅔SM1
//   สเปกตรัมออกแบบ: T0 = 0.2·SD1/SDS, Ts = SD1/SDS
//     Sa = SDS(0.4 + 0.6T/T0) (T < T0) · SDS (T0 ≤ T ≤ Ts) · SD1/T (T > Ts)
//   Cs = Sa·Ie / R ≥ 0.01,  V = Cs·W
//   คาบโดยประมาณ T = 0.02H (อาคาร ค.ส.ล.) แก้ได้
//   กระจายตามความสูง Fx = Cvx·V, Cvx = wx·hx^k / Σ wi·hi^k, k = 1 (T ≤ 0.5 s) … 2 (T ≥ 2.5 s)
//   การเยื้องศูนย์โดยบังเอิญ 5% ของความกว้างอาคารตั้งฉากกับทิศแรง → แรงบิดที่จุดอ้างอิงพื้น
// ค่าตั้งต้นทั้งหมดแก้ได้ — ผู้ออกแบบต้องตรวจกับแผนที่/ตารางในมาตรฐานฉบับจริง (กรุงเทพฯ และปริมณฑลใช้สเปกตรัมเฉพาะ ยังไม่รองรับ)

export type SiteClass = "A" | "B" | "C" | "D" | "E";

export interface SeismicSettings {
  enabled: boolean;
  Ss: number; S1: number; // g
  site: SiteClass;
  Ie: number;
  R: number;
  /** คาบที่กำหนดเอง (s) — 0 = ใช้ 0.02H */
  Tuser: number;
  /** สัดส่วนน้ำหนักบรรทุกจรที่รวมในน้ำหนักอาคาร */
  llFraction: number;
  /** การเยื้องศูนย์โดยบังเอิญ (สัดส่วนของความกว้างอาคาร) */
  eccentricity: number;
  /** ตัวประกอบขยายการเคลื่อนตัว Cd (ใช้ตรวจ drift) */
  Cd?: number;
}

export const defaultSeismic: SeismicSettings = {
  enabled: false, Ss: 0.6, S1: 0.2, site: "D", Ie: 1.0, R: 3, Tuser: 0, llFraction: 0.25, eccentricity: 0.05, Cd: 2.5,
};

// สัมประสิทธิ์สภาพดิน (ตารางแบบเดียวกับ ASCE 7 ซึ่ง มยผ. 1301/1302 อ้างอิงแนวทาง)
const FA: Record<SiteClass, number[]> = {
  A: [0.8, 0.8, 0.8, 0.8, 0.8], B: [1, 1, 1, 1, 1], C: [1.2, 1.2, 1.1, 1.0, 1.0],
  D: [1.6, 1.4, 1.2, 1.1, 1.0], E: [2.5, 1.7, 1.2, 0.9, 0.9],
};
const FV: Record<SiteClass, number[]> = {
  A: [0.8, 0.8, 0.8, 0.8, 0.8], B: [1, 1, 1, 1, 1], C: [1.7, 1.6, 1.5, 1.4, 1.3],
  D: [2.4, 2.0, 1.8, 1.6, 1.5], E: [3.5, 3.2, 2.8, 2.4, 2.4],
};
const SS_PTS = [0.25, 0.5, 0.75, 1.0, 1.25];
const S1_PTS = [0.1, 0.2, 0.3, 0.4, 0.5];

function interp(x: number, xs: number[], ys: number[]) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x <= xs[i + 1]) return ys[i] + ((ys[i + 1] - ys[i]) * (x - xs[i])) / (xs[i + 1] - xs[i]);
  }
  return ys[ys.length - 1];
}
export const siteFa = (site: SiteClass, Ss: number) => interp(Ss, SS_PTS, FA[site]);
export const siteFv = (site: SiteClass, S1: number) => interp(S1, S1_PTS, FV[site]);

export interface SpectrumParams { Fa: number; Fv: number; SDS: number; SD1: number; T0: number; Ts: number }

export function spectrum(s: SeismicSettings): SpectrumParams {
  const Fa = siteFa(s.site, s.Ss), Fv = siteFv(s.site, s.S1);
  const SDS = (2 / 3) * Fa * s.Ss, SD1 = (2 / 3) * Fv * s.S1;
  const Ts = SDS > 0 ? SD1 / SDS : 0;
  return { Fa, Fv, SDS, SD1, T0: 0.2 * Ts, Ts };
}

export function Sa(p: SpectrumParams, T: number): number {
  if (T < p.T0) return p.SDS * (0.4 + (0.6 * T) / Math.max(p.T0, 1e-9));
  if (T <= p.Ts) return p.SDS;
  return p.SD1 / T;
}

export const kExponent = (T: number) => (T <= 0.5 ? 1 : T >= 2.5 ? 2 : 1 + (T - 0.5) / 2);

export interface SeismicLevel { z: number; W: number; Cvx: number; F: number }
export interface SeismicResult {
  T: number; spec: SpectrumParams; Sa: number; Cs: number; W: number; V: number; k: number;
  levels: SeismicLevel[];
}

/** คำนวณแรงแผ่นดินไหวจากน้ำหนักรายชั้น (kN) ที่ความสูง z (m จากฐาน) */
export function seismicForces(s: SeismicSettings, levels: { z: number; W: number }[]): SeismicResult {
  const H = Math.max(...levels.map((l) => l.z), 0);
  const T = s.Tuser > 0 ? s.Tuser : 0.02 * H;
  const spec = spectrum(s);
  const sa = Sa(spec, T);
  const Cs = Math.max((sa * s.Ie) / s.R, 0.01);
  const W = levels.reduce((a, l) => a + l.W, 0);
  const V = Cs * W;
  const k = kExponent(T);
  const denom = levels.reduce((a, l) => a + l.W * l.z ** k, 0);
  return {
    T, spec, Sa: sa, Cs, W, V, k,
    levels: levels.map((l) => { const Cvx = denom > 0 ? (l.W * l.z ** k) / denom : 0; return { z: l.z, W: l.W, Cvx, F: Cvx * V }; }),
  };
}
