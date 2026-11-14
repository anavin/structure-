// คลื่นแผ่นดินไหวสังเคราะห์ให้สอดคล้องกับสเปกตรัมออกแบบ + วิเคราะห์ระบบขั้นความเสรีเดียว (Newmark)
//   คลื่น: ผลรวมคลื่นไซน์ 0.1–25 Hz เฟสสุ่ม (seed คงที่ ผลซ้ำได้) × ฟังก์ชันซองแบบสี่เหลี่ยมคางหมู (ขึ้น–คงที่–ลดแบบเอกซ์โพเนนเชียล)
//   ปรับแอมพลิจูดทีละความถี่ให้สเปกตรัมการตอบสนอง (ζ 5%) ใกล้สเปกตรัมเป้าหมาย (วนซ้ำ) แล้วแก้เส้นฐานความเร็ว
//   Newmark ค่าเฉลี่ยความเร่ง (γ = ½, β = ¼): เสถียรไม่มีเงื่อนไข

export interface GroundMotion { dt: number; ag: number[]; /** หน่วย g */ pga: number; duration: number }

/** ตัวสุ่มแบบกำหนด seed (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** การตอบสนองสูงสุดของ SDOF: คืน { u สูงสุด (หน่วยเดียวกับ ag/ω²), Sa = ω²·u } — ag หน่วยใดก็ได้ */
export function sdofPeak(ag: number[], dt: number, T: number, zeta = 0.05): { umax: number; Sa: number } {
  const w = (2 * Math.PI) / T, c = 2 * zeta * w, k = w * w;
  // Newmark average acceleration (m = 1)
  const a0 = 4 / (dt * dt), a1 = 2 / dt, kh = k + a0 + a1 * c;
  let u = 0, v = 0, a = -ag[0], umax = 0;
  for (let i = 1; i < ag.length; i++) {
    const p = -ag[i] + (a0 * u + (4 / dt) * v + a) + c * (a1 * u + v);
    const un = p / kh;
    const vn = (2 / dt) * (un - u) - v;
    const an = a0 * (un - u) - (4 / dt) * v - a;
    u = un; v = vn; a = an;
    if (Math.abs(u) > umax) umax = Math.abs(u);
  }
  return { umax, Sa: umax * k };
}

export function responseSpectrum(ag: number[], dt: number, periods: number[], zeta = 0.05): number[] {
  return periods.map((T) => sdofPeak(ag, dt, T, zeta).Sa);
}

/** ฟังก์ชันซอง: ขึ้นแบบกำลังสองถึง t1, คงที่ถึง t2, ลด exp หลังจากนั้น */
const envelope = (t: number, t1: number, t2: number, dur: number) => (t < t1 ? (t / t1) ** 2 : t <= t2 ? 1 : Math.exp((-3 * (t - t2)) / (dur - t2)));

/**
 * สร้างคลื่นสอดคล้องสเปกตรัม
 * @param target Sa(T) เป้าหมาย (g)
 */
export function syntheticMotion(target: (T: number) => number, opts: { duration?: number; dt?: number; seed?: number; iterations?: number } = {}): GroundMotion {
  const dur = opts.duration ?? 20, dt = opts.dt ?? 0.01, n = Math.round(dur / dt) + 1;
  const R = rng(opts.seed ?? 20251114);
  const nf = 140;
  const freqs = Array.from({ length: nf }, (_, k) => 0.1 * Math.pow(25 / 0.1, k / (nf - 1))); // Hz (แบ่งแบบลอการิทึม)
  const phases = freqs.map(() => R() * 2 * Math.PI);
  // แอมพลิจูดเริ่มต้นตามสเปกตรัมเป้าหมาย (ปรับต่อด้วยการวนซ้ำ)
  const amps = freqs.map((f) => 0.06 * target(1 / f));
  const t1 = 0.12 * dur, t2 = 0.5 * dur;
  const env = Array.from({ length: n }, (_, i) => envelope(i * dt, t1, t2, dur));
  const envInt = env.reduce((a, e) => a + e, 0) * dt;
  const build = () => {
    const ag = new Array<number>(n).fill(0);
    for (let k = 0; k < nf; k++) {
      const w = 2 * Math.PI * freqs[k], A = amps[k], ph = phases[k];
      for (let i = 0; i < n; i++) ag[i] += A * Math.sin(w * i * dt + ph);
    }
    for (let i = 0; i < n; i++) ag[i] *= env[i];
    // แก้เส้นฐาน: ลบเส้นตรงของความเร็วสะสม (ให้ความเร็วปลายเป็นศูนย์)
    let v = 0; for (let i = 0; i < n; i++) v += ag[i] * dt;
    for (let i = 0; i < n; i++) ag[i] -= (v / envInt) * env[i];
    return ag;
  };
  // คาบที่ใช้จับคู่ = 1/ความถี่ของแต่ละองค์ประกอบ (ช่วงสำคัญ 0.04–4 s)
  const iters = opts.iterations ?? 12;
  let ag = build();
  for (let it = 0; it < iters; it++) {
    const Ts = freqs.map((f) => 1 / f);
    const sa = responseSpectrum(ag, dt, Ts);
    for (let k = 0; k < nf; k++) {
      const r = target(Ts[k]) / Math.max(sa[k], 1e-9);
      amps[k] *= Math.min(3, Math.max(0.33, r));
    }
    ag = build();
  }
  const pga = Math.max(...ag.map((x) => Math.abs(x)));
  return { dt, ag, pga, duration: dur };
}
