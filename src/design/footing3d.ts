// ออกแบบฐานรากเดี่ยว ค.ส.ล. รับแรงอัดร่วมกับโมเมนต์สองทิศ (โหมด 3D)
//  - ฐานแผ่: q(x, y) = P/A + My·x/Iy − Mx·y/Ix เมื่ออยู่ใน kern (|ex|/L + |ey|/B ≤ 1/6)
//            นอก kern: หา q = max(0, a + bx + cy) ด้วย Newton บนกริด ให้ ΣqdA = P, ΣqxdA = My, −ΣqydA = Mx
//            กรณีแรงแนวดิ่งต้องสัมผัสดินเต็มพื้นที่, กรณีลมต้องสัมผัส ≥ 50%
//  - ฐานเข็ม: Pi = P/n + My·xi/Σx² − Mx·yi/Σy², ไม่มีเข็มรับแรงถอน, นับแรงเข็มในการตรวจเฉือนตาม ACI 13.4.2.5
// แกน: x ตามแกน X (ด้าน L), y ตามแกน Y (ด้าน B) · Mx = โมเมนต์รอบแกน X, My = รอบแกน Y (กฎมือขวา, Z ขึ้น)
// หน่วยภายใน: kN, m (การตรวจกำลังแปลงเป็น N, mm, MPa)

import { KSC_TO_MPA } from "../core/model.ts";
import type { DesignCode, Step } from "./rcBeam.ts";
import { outside, pileLayout, slabSteel, T_TO_KN, vcOneWay, vcPunch, type FoundationSettings, type PileLayout } from "./footing.ts";

const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "-");

/** แรงที่เสากระทำต่อยอดฐาน: P อัดลงเป็นบวก (kN), Mx/My (kN·m), Hx/Hy (kN) */
export interface FootingLoad3 { name: string; P: number; Mx: number; My: number; Hx: number; Hy: number; wind?: boolean }

export interface FootingInput3 {
  code: DesignCode;
  cx: number; cy: number; // ขนาดเสา (m) ตามแกน X / Y
  fcKsc: number; fyKsc: number;
  settings: FoundationSettings;
  service: FootingLoad3[];
  strength: FootingLoad3[];
}

export interface ServiceCheck3 {
  name: string; Ptot: number; Mbx: number; Mby: number;
  qmax: number; qmin: number; contact: number; allow: number; ok: boolean; note: string;
}

export interface FootingResult3 {
  type: "spread" | "pile";
  L: number; B: number; t: number;
  piles: PileLayout | null;
  service: ServiceCheck3[];
  barsX: string; barsY: string;
  ok: boolean;
  message: string;
  steps: Step[];
  crit: { punch: number; oneWayX: number; oneWayY: number; MuX: number; MuY: number };
}

/** โมเมนต์ที่ท้องฐาน: แรงแนวราบที่ยอดฐานสูง t เหนือท้องฐาน */
export const baseMoments = (l: FootingLoad3, t: number) => ({ Mbx: l.Mx - t * l.Hy, Mby: l.My + t * l.Hx });

// ---------- แรงดันดินสองทิศ ----------
export interface Pressure { q: (x: number, y: number) => number; qmax: number; qmin: number; contact: number; ok: boolean; /** สัมผัสเต็มฐาน: q = a + bx + cy (อินทิเกรตแบบปิดได้) */ lin?: [number, number, number] }

const NG = 60;

/** แรงดันใต้ฐาน L (X) × B (Y) จาก P, Mx, My ที่ท้องฐาน */
export function pressure2(P: number, Mx: number, My: number, L: number, B: number): Pressure {
  const A = L * B, Iy = (B * L ** 3) / 12, Ix = (L * B ** 3) / 12;
  const corners = [[-L / 2, -B / 2], [L / 2, -B / 2], [L / 2, B / 2], [-L / 2, B / 2]];
  if (P <= 0) return { q: () => 0, qmax: 0, qmin: 0, contact: 0, ok: false };
  const ex = My / P, ey = Mx / P;
  if (Math.abs(ex) / L + Math.abs(ey) / B <= 1 / 6 + 1e-12) {
    const q = (x: number, y: number) => P / A + (My * x) / Iy - (Mx * y) / Ix;
    const qs = corners.map(([x, y]) => q(x, y));
    return { q, qmax: Math.max(...qs), qmin: Math.min(...qs), contact: 1, ok: true, lin: [P / A, My / Iy, -Mx / Ix] };
  }
  if (Math.abs(ex) >= L / 2 || Math.abs(ey) >= B / 2) return { q: () => 0, qmax: Infinity, qmin: 0, contact: 0, ok: false };

  // นอก kern: Newton บนกริด NG × NG (จุดกึ่งกลางช่อง)
  const dx = L / NG, dy = B / NG, dA = dx * dy;
  const xs = Array.from({ length: NG }, (_, i) => -L / 2 + (i + 0.5) * dx);
  const ys = Array.from({ length: NG }, (_, j) => -B / 2 + (j + 0.5) * dy);
  let a = P / A, b = My / Iy, c = -Mx / Ix;
  const resid = (a0: number, b0: number, c0: number) => {
    let r1 = -P, r2 = -My, r3 = -Mx;
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let area = 0;
    for (const x of xs) for (const y of ys) {
      const v = a0 + b0 * x + c0 * y;
      if (v <= 0) continue;
      area += dA;
      r1 += v * dA; r2 += v * x * dA; r3 -= v * y * dA;
      J[0][0] += dA; J[0][1] += x * dA; J[0][2] += y * dA;
      J[1][1] += x * x * dA; J[1][2] += x * y * dA; J[2][2] += y * y * dA;
    }
    // แถว 3 (สมการ −Σq·y·dA = Mx) เป็นลบของอนุพันธ์ Σy·(…)
    const Jm = [[J[0][0], J[0][1], J[0][2]], [J[0][1], J[1][1], J[1][2]], [-J[0][2], -J[1][2], -J[2][2]]];
    return { r: [r1, r2, r3], J: Jm, area };
  };
  const norm = (r: number[]) => Math.abs(r[0]) / P + (Math.abs(r[1]) + Math.abs(r[2])) / (P * Math.max(L, B));
  let cur = resid(a, b, c);
  for (let it = 0; it < 100 && norm(cur.r) > 1e-9; it++) {
    const step = solve3(cur.J, cur.r.map((v) => -v));
    if (!step) break;
    let lam = 1;
    let next = resid(a + step[0], b + step[1], c + step[2]);
    while (norm(next.r) > norm(cur.r) && lam > 1e-4) {
      lam /= 2;
      next = resid(a + lam * step[0], b + lam * step[1], c + lam * step[2]);
    }
    a += lam * step[0]; b += lam * step[1]; c += lam * step[2];
    cur = next;
  }
  const ok = norm(cur.r) < 1e-6;
  const q = (x: number, y: number) => Math.max(0, a + b * x + c * y);
  const qs = corners.map(([x, y]) => a + b * x + c * y);
  return { q, qmax: Math.max(...qs), qmin: Math.max(0, Math.min(...qs)), contact: cur.area / A, ok };
}

function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let p = 0; p < 3; p++) {
    let piv = p;
    for (let r = p + 1; r < 3; r++) if (Math.abs(M[r][p]) > Math.abs(M[piv][p])) piv = r;
    [M[p], M[piv]] = [M[piv], M[p]];
    if (Math.abs(M[p][p]) < 1e-300) return null;
    for (let r = 0; r < 3; r++) if (r !== p) {
      const k = M[r][p] / M[p][p];
      for (let cc = p; cc < 4; cc++) M[r][cc] -= k * M[p][cc];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** อินทิเกรต q บนพื้นที่สี่เหลี่ยม (Simpson ทั้งสองแกน) */
function integ2(fn: (x: number, y: number) => number, x0: number, x1: number, y0: number, y1: number, nx = 200, ny = 40) {
  if (x1 <= x0 || y1 <= y0) return 0;
  const hx = (x1 - x0) / nx, hy = (y1 - y0) / ny;
  let s = 0;
  for (let i = 0; i <= nx; i++) {
    const wx = i === 0 || i === nx ? 1 : i % 2 ? 4 : 2;
    const x = x0 + i * hx;
    for (let j = 0; j <= ny; j++) {
      const wy = j === 0 || j === ny ? 1 : j % 2 ? 4 : 2;
      s += wx * wy * fn(x, y0 + j * hy);
    }
  }
  return (s * hx * hy) / 9;
}

/** แรงรวมของแรงดันบนพื้นที่สี่เหลี่ยม: สัมผัสเต็มฐาน (เชิงเส้น) = พื้นที่ × q ที่จุดศูนย์ถ่วง (ตรง) · มิฉะนั้น Simpson */
function integQ(pr: Pressure, x0: number, x1: number, y0: number, y1: number, nx = 200, ny = 40) {
  if (x1 <= x0 || y1 <= y0) return 0;
  if (pr.lin) { const [a, b, c] = pr.lin; return (x1 - x0) * (y1 - y0) * (a + (b * (x0 + x1)) / 2 + (c * (y0 + y1)) / 2); }
  return integ2(pr.q, x0, x1, y0, y1, nx, ny);
}

// ---------- ฐานแผ่ ----------
function serviceSpread3(B: number, L: number, t: number, inp: FootingInput3): ServiceCheck3[] {
  const st = inp.settings;
  const qa = st.qaTon * T_TO_KN;
  const W = (24 * t + st.gammaSoil * Math.max(0, st.Df - t)) * B * L;
  return inp.service.map((s) => {
    const Ptot = s.P + W;
    const { Mbx, Mby } = baseMoments(s, t);
    const allow = qa * (s.wind && st.windIncrease ? 1.33 : 1);
    if (Ptot <= 0) return { name: s.name, Ptot, Mbx, Mby, qmax: 0, qmin: 0, contact: 0, allow, ok: false, note: "แรงถอน" };
    const pr = pressure2(Ptot, Mbx, Mby, L, B);
    const contactOk = pr.ok && (s.wind ? pr.contact >= 0.5 - 1e-9 : pr.contact >= 1 - 1e-9);
    const note = !pr.ok ? "ระยะเยื้องศูนย์เกินฐาน" : pr.contact < 1 - 1e-9 ? `สัมผัสดิน ${(pr.contact * 100).toFixed(0)}%` : "";
    return { name: s.name, Ptot, Mbx, Mby, qmax: pr.qmax, qmin: pr.qmin, contact: pr.contact, allow, ok: pr.qmax <= allow && contactOk, note };
  });
}

function designSpread3(inp: FootingInput3): FootingResult3 {
  const st = inp.settings;
  const fc = inp.fcKsc * KSC_TO_MPA, fy = inp.fyKsc * KSC_TO_MPA;
  const phiV = inp.code === "ACI" ? 0.75 : 0.85;
  const cover = 75, db = 16;
  const { cx, cy } = inp;
  const steps: Step[] = [];

  let t = 0.3, B = 0, L = 0;
  let service: ServiceCheck3[] = [];
  let thick = { ok: false, punch: 0, ow: 0, owy: 0 };
  for (let pass = 0; pass < 3; pass++) {
    B = Math.max(cy + 0.3, (cx + 0.3) / st.ratio, 0.6);
    // ขอบล่าง: qmax ≥ P/A ทุกกรณี → ข้ามขนาดที่พื้นที่ไม่พอแน่นอน (ไม่ต้องคำนวณแรงดัน — ผลเท่าเดิม)
    const need = Math.max(0, ...inp.service.map((s) => s.P / (st.qaTon * T_TO_KN * (s.wind && st.windIncrease ? 1.33 : 1))));
    while (B * Math.max(st.ratio * B, cx + 0.3) < need && B < 50) B = Math.round((B + 0.05) * 100) / 100;
    for (let k = 0; k < 300; k++) {
      L = Math.max(st.ratio * B, cx + 0.3);
      service = serviceSpread3(B, L, t, inp);
      if (service.every((s) => s.ok)) break;
      B = Math.round((B + 0.05) * 100) / 100;
    }
    for (let tt = 0.25; tt <= 2.5 + 1e-9; tt = Math.round((tt + 0.05) * 100) / 100) {
      const d = tt * 1000 - cover - db;
      if (d < 150) continue;
      const dm = d / 1000;
      let wp = 0, wx = 0, wy = 0;
      for (const s of inp.strength) {
        const { Mbx, Mby } = baseMoments(s, tt);
        const pr = pressure2(s.P, Mbx, Mby, L, B);
        if (!pr.ok) continue; // แรงยก/แรงลัพธ์นอกฐาน — รายงานแยก
        const qavg = s.P / (B * L);
        const Vp = s.P - qavg * (cx + dm) * (cy + dm);
        const bo = 2 * (cx + dm + cy + dm) * 1000;
        const beta = Math.max(cx, cy) / Math.min(cx, cy);
        wp = Math.max(wp, (Vp * 1e3) / (phiV * vcPunch(fc, bo, d, beta, 40)));
        const xr = cx / 2 + dm, yr = cy / 2 + dm;
        const Vx = Math.max(integQ(pr, xr, L / 2, -B / 2, B / 2), integQ(pr, -L / 2, -xr, -B / 2, B / 2));
        const Vy = Math.max(integQ(pr, -L / 2, L / 2, yr, B / 2, 40, 200), integQ(pr, -L / 2, L / 2, -B / 2, -yr, 40, 200));
        wx = Math.max(wx, (Vx * 1e3) / (phiV * vcOneWay(fc, B * 1000, d)));
        wy = Math.max(wy, (Vy * 1e3) / (phiV * vcOneWay(fc, L * 1000, d)));
      }
      thick = { ok: wp <= 1 && wx <= 1 && wy <= 1, punch: wp, ow: wx, owy: wy };
      if (thick.ok) { t = tt; break; }
    }
    const svc = serviceSpread3(B, L, t, inp);
    if (svc.every((s) => s.ok)) { service = svc; break; }
  }

  const d = t * 1000 - cover - db;
  let MuX = 0, MuY = 0;
  const outside: string[] = [];
  for (const s of inp.strength) {
    const { Mbx, Mby } = baseMoments(s, t);
    const pr = pressure2(s.P, Mbx, Mby, L, B);
    if (!pr.ok) { outside.push(s.P <= 0 ? `${s.name} (แรงถอน P = ${f(s.P)} kN)` : s.name); continue; }
    const ax = cx / 2, ay = cy / 2;
    MuX = Math.max(MuX, integ2((x, y) => pr.q(x, y) * (x - ax), ax, L / 2, -B / 2, B / 2), integ2((x, y) => pr.q(x, y) * (-ax - x), -L / 2, -ax, -B / 2, B / 2));
    MuY = Math.max(MuY, integ2((x, y) => pr.q(x, y) * (y - ay), -L / 2, L / 2, ay, B / 2, 40, 200), integ2((x, y) => pr.q(x, y) * (-ay - y), -L / 2, L / 2, -B / 2, -ay, 40, 200));
  }
  const sx = slabSteel(MuX, B, t, d, fc, fy, 0.9, cover);
  const sy = slabSteel(MuY, L, t, d, fc, fy, 0.9, cover);
  const name = (p: ReturnType<typeof slabSteel>["pick"]) => (p ? `${p.n}DB${p.dia} @ ${(p.s / 1000).toFixed(3)} m` : "—");

  const qa = st.qaTon * T_TO_KN;
  const worst = service.reduce((a, s) => (s.qmax / s.allow > a.qmax / a.allow ? s : a), service[0]);
  steps.push({ label: "หน่วยแรงแบกทานยอมให้", expr: `qa = ${st.qaTon} t/m² (gross)${st.windIncrease ? ", กรณีลม ×1.33" : ""}`, value: `${f(qa)} kN/m²` });
  steps.push({ label: "ขนาดเสา", expr: "cx × cy", value: `${f(cx * 1000, 0)} × ${f(cy * 1000, 0)} mm` });
  steps.push({ label: "ขนาดฐาน", expr: `L (X) × B (Y) × t, Df = ${st.Df} m`, value: `${f(L)} × ${f(B)} × ${f(t)} m` });
  if (worst) {
    steps.push({ label: "กรณีแรงใช้งานวิกฤต", expr: worst.name, value: `P = ${f(worst.Ptot)} kN, Mx = ${f(worst.Mbx)}, My = ${f(worst.Mby)} kN·m` });
    steps.push({ label: "ระยะเยื้องศูนย์", expr: "|ex|/L + |ey|/B (kern ≤ 1/6)", value: f(Math.abs(worst.Mby / worst.Ptot) / L + Math.abs(worst.Mbx / worst.Ptot) / B, 3) });
    steps.push({ label: "qmax / qmin", expr: worst.contact < 1 ? `สัมผัสดินบางส่วน ${(worst.contact * 100).toFixed(0)}%` : "P/A ± My·x/Iy ∓ Mx·y/Ix", value: `${f(worst.qmax)} / ${f(worst.qmin)} kN/m² ${worst.ok ? "≤" : ">"} ${f(worst.allow)}`, ok: worst.ok });
  }
  steps.push({ label: "ความลึกประสิทธิผล d", expr: `t − ${cover} − db`, value: `${f(d, 0)} mm` });
  steps.push({ label: "แรงเฉือนทะลุ", expr: "Vu / φVc (ที่ d/2, แรงดันเฉลี่ย)", value: f(thick.punch, 3), ok: thick.punch <= 1 });
  steps.push({ label: "แรงเฉือนทางเดียว X / Y", expr: "∫∫q dA นอกหน้าตัดที่ d / φ(0.17√fc' b d)", value: `${f(thick.ow, 3)} / ${f(thick.owy, 3)}`, ok: thick.ow <= 1 && thick.owy <= 1 });
  steps.push({ label: "Mu ที่ผิวเสา X / Y", expr: "∫∫q·(x − cx/2) dA / ∫∫q·(y − cy/2) dA", value: `${f(MuX)} / ${f(MuY)} kN·m` });
  steps.push({ label: "เหล็กแนว X", expr: `As = ${f(sx.As, 0)} mm²`, value: name(sx.pick), ok: sx.ok });
  steps.push({ label: "เหล็กแนว Y", expr: `As = ${f(sy.As, 0)} mm²`, value: name(sy.pick), ok: sy.ok });
  if (outside.length) steps.push({ label: "แรงประลัยที่ฐานแผ่รับไม่ได้", expr: "แรงยก หรือแรงลัพธ์อยู่นอกฐาน (ดินรับแรงดึงไม่ได้)", value: outside.join(", "), ok: false });

  const svcOk = service.every((s) => s.ok);
  const ok = svcOk && thick.ok && sx.ok && sy.ok && !outside.length;
  return {
    type: "spread", L, B, t, piles: null, service, barsX: name(sx.pick), barsY: name(sy.pick), ok,
    message: ok ? `${f(L)}×${f(B)}×${f(t)} m` : !svcOk ? "แรงแบกทานเกิน/ฐานยก — ตรวจ qa หรือเพิ่มขนาด"
      : outside.length ? (outside.every((o) => o.includes("แรงถอน"))
        ? `แรงถอน (เสารับแรงดึง) ในชุด ${outside[0].replace(/ \(แรงถอน.*$/, "")} — ใช้เสาเข็มรับแรงถอน หรือเพิ่มน้ำหนักถ่วง/รวมฐาน`
        : `แรงลัพธ์นอกฐานในชุด ${outside[0].replace(/ \(แรงถอน.*$/, "")}${outside.length > 1 ? ` (+${outside.length - 1})` : ""} — ใช้คานคอดินรับโมเมนต์ หรือฐานเข็ม`)
      : !thick.ok ? "ความหนาไม่พอสำหรับแรงเฉือน" : "เหล็กเสริมไม่พอ",
    steps, crit: { punch: thick.punch, oneWayX: thick.ow, oneWayY: thick.owy, MuX, MuY },
  };
}

// ---------- ฐานเข็ม ----------
const LAYOUTS3: [number, number][] = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [3, 3], [4, 3], [3, 4], [4, 4], [5, 4], [4, 5], [5, 5]];

/** แรงในเข็ม Pi = P/n + My·xi/Σx² − Mx·yi/Σy² (null ถ้าการวางเข็มรับโมเมนต์ทิศนั้นไม่ได้) */
export function pileForces3(P: number, Mx: number, My: number, lay: PileLayout): number[] | null {
  const n = lay.coords.length;
  const sx2 = lay.coords.reduce((a, c) => a + c.x * c.x, 0), sy2 = lay.coords.reduce((a, c) => a + c.y * c.y, 0);
  const tol = 0.05 * Math.max(Math.abs(P), 1);
  if ((sx2 === 0 && Math.abs(My) > tol) || (sy2 === 0 && Math.abs(Mx) > tol)) return null;
  return lay.coords.map((c) => P / n + (sx2 > 0 ? (My * c.x) / sx2 : 0) - (sy2 > 0 ? (Mx * c.y) / sy2 : 0));
}

function designPile3(inp: FootingInput3): FootingResult3 {
  const st = inp.settings;
  const fc = inp.fcKsc * KSC_TO_MPA, fy = inp.fyKsc * KSC_TO_MPA;
  const phiV = inp.code === "ACI" ? 0.75 : 0.85;
  const Ra = st.pileTon * T_TO_KN;
  const D = st.pileSize;
  const s = Math.max(st.pileSpacingFactor * D, 0.6);
  const edge = Math.max(D, 0.25);
  const { cx, cy } = inp;
  const db = 16;
  const steps: Step[] = [];
  const none = { punch: 0, oneWayX: 0, oneWayY: 0, MuX: 0, MuY: 0 };

  const svcFor = (lay: PileLayout, L: number, B: number, t: number): ServiceCheck3[] | null => {
    const W = (24 * t + st.gammaSoil * Math.max(0, st.Df - t)) * B * L;
    const out: ServiceCheck3[] = [];
    for (const sv of inp.service) {
      const Ptot = sv.P + W;
      const { Mbx, Mby } = baseMoments(sv, t);
      const pf = pileForces3(Ptot, Mbx, Mby, lay);
      if (!pf) return null;
      const allow = Ra * (sv.wind && st.windIncrease ? 1.33 : 1);
      const qmax = Math.max(...pf), qmin = Math.min(...pf);
      out.push({ name: sv.name, Ptot, Mbx, Mby, qmax, qmin, contact: 1, allow, ok: qmax <= allow && qmin >= 0, note: qmin < 0 ? "เข็มรับแรงถอน" : "" });
    }
    return out;
  };

  let chosen: { lay: PileLayout; L: number; B: number; t: number } | null = null;
  for (const [nx, ny] of LAYOUTS3) {
    const lay = pileLayout(nx, ny, s, edge);
    const L = Math.max((nx - 1) * s + 2 * edge, cx + 0.2);
    const B = Math.max((ny - 1) * s + 2 * edge, cy + 0.2);
    const tGuess = nx * ny === 1 ? 0.6 : 0.8;
    const svc = svcFor(lay, L, B, tGuess);
    if (svc && svc.every((x) => x.ok)) { chosen = { lay, L, B, t: tGuess }; break; }
  }
  if (!chosen) {
    return { type: "pile", L: 0, B: 0, t: 0, piles: null, service: [], barsX: "—", barsY: "—", ok: false, message: "ต้องใช้เข็มมากกว่า 25 ต้น — เพิ่มกำลังเข็ม", steps, crit: none };
  }
  const { lay, L, B } = chosen;
  const n = lay.coords.length;

  let t = chosen.t, best = { punch: Infinity, ow: Infinity, owy: Infinity, corner: 0 };
  for (let tt = 0.5; tt <= 3 + 1e-9; tt = Math.round((tt + 0.05) * 100) / 100) {
    const d = tt * 1000 - 150 - db;
    if (d < 300) continue;
    const dm = d / 1000;
    let wp = 0, wx = 0, wy = 0, wc = 0;
    for (const sg of inp.strength) {
      const { Mbx, Mby } = baseMoments(sg, tt);
      const pf = pileForces3(sg.P, Mbx, Mby, lay) ?? lay.coords.map(() => sg.P / n);
      const hx = (cx + dm) / 2, hy = (cy + dm) / 2;
      let Vp = 0;
      lay.coords.forEach((c, k) => { Vp += pf[k] * outside(Math.max(Math.abs(c.x) - hx, Math.abs(c.y) - hy), D); });
      const bo = 2 * (cx + cy + 2 * dm) * 1000;
      const beta = Math.max(cx, cy) / Math.min(cx, cy);
      if (n > 1) wp = Math.max(wp, (Vp * 1e3) / (phiV * vcPunch(fc, bo, d, beta, 40)));
      for (const sgn of [1, -1]) {
        let vx = 0, vy = 0;
        lay.coords.forEach((c, k) => {
          vx += Math.max(0, pf[k]) * outside(sgn * c.x - (cx / 2 + dm), D);
          vy += Math.max(0, pf[k]) * outside(sgn * c.y - (cy / 2 + dm), D);
        });
        wx = Math.max(wx, (vx * 1e3) / (phiV * vcOneWay(fc, B * 1000, d)));
        wy = Math.max(wy, (vy * 1e3) / (phiV * vcOneWay(fc, L * 1000, d)));
      }
      if (n > 1) {
        const boC = 2 * (edge + (D + dm) / 2) * 1000;
        wc = Math.max(wc, (Math.max(...pf) * 1e3) / (phiV * vcPunch(fc, boC, d, 1, 20)));
      }
    }
    best = { punch: wp, ow: wx, owy: wy, corner: wc };
    if (wp <= 1 && wx <= 1 && wy <= 1 && wc <= 1) { t = tt; break; }
  }
  const service = svcFor(lay, L, B, t) ?? [];
  const d = t * 1000 - 150 - db;
  let MuX = 0, MuY = 0;
  for (const sg of inp.strength) {
    const { Mbx, Mby } = baseMoments(sg, t);
    const pf = pileForces3(sg.P, Mbx, Mby, lay) ?? lay.coords.map(() => sg.P / n);
    for (const sgn of [1, -1]) {
      let mx = 0, my = 0;
      lay.coords.forEach((c, k) => {
        const ax = sgn * c.x - cx / 2, ay = sgn * c.y - cy / 2;
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
  steps.push({ label: "การวางเข็ม", expr: `${lay.nx} (X) × ${lay.ny} (Y), ระยะห่าง ${f(s)} m, ระยะขอบ ${f(edge)} m`, value: `${n} ต้น` });
  steps.push({ label: "ขนาดฐาน", expr: "L (X) × B (Y) × t", value: `${f(L)} × ${f(B)} × ${f(t)} m` });
  if (worst) {
    steps.push({ label: "กรณีแรงใช้งานวิกฤต", expr: worst.name, value: `P = ${f(worst.Ptot)} kN, Mx = ${f(worst.Mbx)}, My = ${f(worst.Mby)} kN·m` });
    steps.push({ label: "แรงในเข็ม max / min", expr: "P/n + My·x/Σx² − Mx·y/Σy²", value: `${f(worst.qmax)} / ${f(worst.qmin)} kN ${worst.ok ? "≤" : ">"} ${f(worst.allow)}`, ok: worst.ok });
  }
  steps.push({ label: "ความลึกประสิทธิผล d", expr: "t − 150 (ฝังหัวเข็ม + หุ้ม) − db", value: `${f(d, 0)} mm` });
  if (n > 1) steps.push({ label: "แรงเฉือนทะลุรอบเสา", expr: "ΣPu เข็มนอกแนว d/2 (ACI 13.4.2.5) / φVc", value: f(best.punch, 3), ok: best.punch <= 1 });
  steps.push({ label: "แรงเฉือนทางเดียว X / Y", expr: "ΣPu เข็มนอกแนว d / φ(0.17√fc' b d)", value: `${f(best.ow, 3)} / ${f(best.owy, 3)}`, ok: best.ow <= 1 && best.owy <= 1 });
  if (n > 1) steps.push({ label: "แรงเฉือนทะลุรอบเข็มมุม", expr: "αs = 20, bo ถึงขอบฐาน", value: f(best.corner, 3), ok: best.corner <= 1 });
  steps.push({ label: "Mu ที่ผิวเสา X / Y", expr: "ΣPu,i·(xi − c/2)", value: `${f(MuX)} / ${f(MuY)} kN·m` });
  steps.push({ label: "เหล็กแนว X", expr: `As = ${f(sx.As, 0)} mm²`, value: name(sx.pick), ok: sx.ok });
  steps.push({ label: "เหล็กแนว Y", expr: `As = ${f(sy.As, 0)} mm²`, value: name(sy.pick), ok: sy.ok });

  const svcOk = service.length > 0 && service.every((x) => x.ok);
  const shearOk = best.punch <= 1 && best.ow <= 1 && best.owy <= 1 && best.corner <= 1;
  const ok = svcOk && shearOk && sx.ok && sy.ok;
  return {
    type: "pile", L, B, t, piles: lay, service, barsX: name(sx.pick), barsY: name(sy.pick), ok,
    message: ok ? `เข็ม ${n} ต้น, ${f(L)}×${f(B)}×${f(t)} m` : !svcOk ? "แรงในเข็มเกินกำลัง/เข็มรับแรงถอน" : !shearOk ? "ความหนาไม่พอสำหรับแรงเฉือน" : "เหล็กเสริมไม่พอ",
    steps, crit: { punch: best.punch, oneWayX: best.ow, oneWayY: best.owy, MuX, MuY },
  };
}

export function designFooting3(inp: FootingInput3): FootingResult3 {
  return inp.settings.type === "pile" ? designPile3(inp) : designSpread3(inp);
}
