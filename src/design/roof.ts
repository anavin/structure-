// หลังคาโครงเหล็ก: ทรงจั่ว / ปั้นหยา / เพิงหมาแหงน บนคานชั้นบนสุด
//   เหล็กหนาอย่างน้อย 2.3 mm (งานเชื่อม) · คุณสมบัติหน้าตัดคิดแบบผนังบาง ลด 5% แทนผลมุมโค้ง
//   โครงถัก (truss) วางบนเสาริมทุกแนวกริดที่ตั้งฉากกับสันหลังคา · แปวางที่จุดต่อคอร่า (ช่วงแป = ระยะโครงถัก)
//   หน่วยแรงที่ยอมให้ (ASD, AISC 1989 / AISI):
//     โครงถัก: ท่อเหลี่ยม · แรงดึง Ft = 0.6Fy · แรงอัด Fa (AISC E2-1/E2-2) · KL/r ≤ 200 (อัด) / 300 (ดึง)
//     แป: เหล็กรูปพรรณขึ้นรูปเย็นตัว C ดัดสองแกน fbx/Fb + fby/Fb ≤ 1, Fb = 0.6Fy (แผ่นมุงยึดปีกบน)
//          แรงลมยก: ปีกล่างรับแรงอัดไม่มีค้ำ → Fb × R, R = 0.40 (AISI D6.1.1 ช่วงเดี่ยว ยึดแผ่นมุงด้วยสกรู)
//          ระยะแอ่นตัว ≤ L/180 · เหล็กยึดแป (sag rod) ลดช่วงแกนอ่อน
//   ชุดน้ำหนัก: D + Lr · D + W (แรงลมกดลง) · 0.6D + W (แรงลมยก) — แรงลม มยผ. 1311-50 ระดับใช้งาน
//   แรงลมบนหลังคา: p = Iw·q·Ce(h)·(CpCg − CpiCgi), h = ความสูงเฉลี่ยหลังคา
//     CpCg ภายนอก (อาคารเตี้ย ลมตั้งฉากสันหลังคา): ด้านต้นลม/ท้ายลมตามความชัน (ประมาณค่าเชิงเส้นระหว่างจุด)
//       0–5°: −1.3 / −0.7 · 20°: −1.3 / −0.9 · 30–45°: +0.4 / −0.8 · 90°: +1.05 / −0.7
//     CpiCgi ภายใน: ปิดมิด −0.3…0 · มีช่องเปิดมาก −0.9…+0.6 (ใช้ค่าที่วิกฤต)
//   ส่งเข้าโครงสร้างหลัก: น้ำหนักคงที่/จรของหลังคาเป็นแรงที่หัวเสา · แรงลมด้านข้างบนพื้นที่ฉาย (หน้าจั่ว/ลาด) เข้าพื้นชั้นบนสุด
//     แรงลมยกไม่รวมในโครงสร้างหลัก (ลดแรงในเสา/คาน — อนุรักษ์นิยม) ตรวจที่จุดยึดหลังคาแทน
// หน่วยภายใน: กก., ซม. (หน่วยแรง ksc) · ส่งออก kN, m

import { exposureFactor, refPressure, type WindSettings } from "../loads/windTH.ts";
import type { Step } from "./rcBeam.ts";

export type RoofType = "gable" | "hip" | "shed";
export interface RoofSettings {
  enabled: boolean;
  type: RoofType;
  /** แนวสันหลังคา (จั่ว/ปั้นหยา) หรือแนวขอบสูง (เพิง) — โครงถักวางตั้งฉากกับแนวนี้ */
  ridge: "X" | "Y";
  pitch: number; // องศา
  overhang: number; // m (ชายคายื่นจากแนวเสา)
  covering: "tile" | "metal";
  coverKg: number; // kg/m² ของผิวลาด (วัสดุมุง + ระแนง/ยึด)
  llKg: number; // kg/m² แนวราบ (น้ำหนักจรหลังคา)
  purlinMax: number; // m ระยะแปสูงสุด
  sagRods: number; // จำนวนเหล็กยึดแปต่อช่วง (0–2)
  openings: "closed" | "open";
  fyKsc: number;
}

export const defaultRoof: RoofSettings = {
  enabled: false, type: "gable", ridge: "X", pitch: 20, overhang: 1.0,
  covering: "metal", coverKg: 7, llKg: 30, purlinMax: 1.2, sagRods: 1, openings: "closed", fyKsc: 2450,
};
export const COVERINGS = { metal: { kg: 7, label: "เมทัลชีท" }, tile: { kg: 55, label: "กระเบื้องคอนกรีต" } } as const;

const KG = 9.80665 / 1000; // kg → kN
const E = 2.04e6; // ksc
const rad = (d: number) => (d * Math.PI) / 180;
const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");

// ---------- หน้าตัดเหล็ก ----------
export interface SteelSec { name: string; A: number; w: number; Ix: number; Iy: number; Sx: number; Sy: number; r: number } // cm², kg/m, cm⁴, cm³, cm

/** มุมเหลี่ยมคม (ไม่คิดรัศมีพับ) ให้ค่ามากกว่าตาราง JIS ราว 4–5% → ลดลง 5% */
const K_CORNER = 0.95;
/** ท่อเหลี่ยมจัตุรัส b × b × t (mm) */
export function boxSection(b: number, t: number): SteelSec {
  const B = b / 10, T = t / 10, Bi = B - 2 * T;
  const A = K_CORNER * (B * B - Bi * Bi), I = K_CORNER * (B ** 4 - Bi ** 4) / 12;
  return { name: `□${b}×${b}×${t}`, A, w: A * 0.785, Ix: I, Iy: I, Sx: I / (B / 2), Sy: I / (B / 2), r: Math.sqrt(I / A) };
}
/** เหล็กรางน้ำขอบพับ C h × b × c × t (mm) — คำนวณแบบเส้นกลางผนังบาง */
export function lipChannel(h: number, b: number, c: number, t: number): SteelSec {
  const T = t / 10, H = (h - t) / 10, Bf = (b - t) / 10, C = (c - t / 2) / 10;
  // ชิ้นส่วนเส้นตรง: [x1, y1, x2, y2]
  const els = [[0, -H / 2, 0, H / 2], [0, H / 2, Bf, H / 2], [0, -H / 2, Bf, -H / 2], [Bf, H / 2, Bf, H / 2 - C], [Bf, -H / 2, Bf, -H / 2 + C]];
  let A = 0, Ax = 0, Ix = 0, Iy0 = 0;
  for (const [x1, y1, x2, y2] of els) {
    const L = Math.hypot(x2 - x1, y2 - y1), a = L * T;
    A += a; Ax += (a * (x1 + x2)) / 2;
    if (x1 === x2) { Ix += (T * Math.abs(y2 ** 3 - y1 ** 3)) / 3; Iy0 += a * x1 * x1; }
    else { Ix += a * y1 * y1; Iy0 += (T * Math.abs(x2 ** 3 - x1 ** 3)) / 3; }
  }
  const xc = Ax / A, Iy = K_CORNER * (Iy0 - A * xc * xc);
  A *= K_CORNER; Ix *= K_CORNER;
  return { name: `C${h}×${b}×${c}×${t}`, A, w: A * 0.785, Ix, Iy, Sx: Ix / (h / 20), Sy: Iy / Math.max(xc + T / 2, Bf + T / 2 - xc), r: Math.sqrt(Math.min(Ix, Iy) / A) };
}

export const BOXES: SteelSec[] = ([[38, 2.3], [50, 2.3], [50, 3.2], [75, 2.3], [75, 3.2], [100, 2.3], [100, 3.2], [100, 4.5], [125, 3.2], [125, 4.5], [150, 4.5], [150, 6]] as const)
  .map(([b, t]) => boxSection(b, t)).sort((a, b) => a.w - b.w);
export const PURLINS: SteelSec[] = ([[75, 45, 15, 2.3], [100, 50, 20, 2.3], [100, 50, 20, 3.2], [125, 50, 20, 2.3], [125, 50, 20, 3.2], [150, 50, 20, 2.3], [150, 50, 20, 3.2], [150, 65, 20, 3.2], [200, 75, 20, 3.2]] as const)
  .map(([h, b, c, t]) => lipChannel(h, b, c, t)).sort((a, b) => a.w - b.w);

/** หน่วยแรงอัดที่ยอมให้ AISC 1989 (ksc) */
export function allowFa(KLr: number, Fy: number): number {
  const Cc = Math.sqrt((2 * Math.PI ** 2 * E) / Fy);
  if (KLr <= Cc) {
    const q = KLr / Cc;
    return ((1 - q * q / 2) * Fy) / (5 / 3 + (3 * q) / 8 - q ** 3 / 8);
  }
  return (12 * Math.PI ** 2 * E) / (23 * KLr * KLr);
}

// ---------- แรงลม ----------
const interp = (pts: [number, number][], x: number) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return pts[pts.length - 1][1];
};
/** CpCg ภายนอกของหลังคา: [ด้านต้นลม, ด้านท้ายลม] */
export function roofCpCg(theta: number): [number, number] {
  return [
    interp([[5, -1.3], [20, -1.3], [30, 0.4], [45, 0.4], [90, 1.05]], theta),
    interp([[5, -0.7], [20, -0.9], [30, -0.8], [45, -0.8], [90, -0.7]], theta),
  ];
}

// ---------- รูปทรง ----------
export interface RoofGeom {
  W: number; // ช่วงโครงถัก (ตั้งฉากกับสัน) m
  Lr: number; // ความยาวตามแนวสัน (ระหว่างเสาริม) m
  rise: number; zTop: number; theta: number;
  trusses: { pos: number; trib: number; line: number }[]; // pos ตามแนวสัน, line = ดัชนีแนวกริด
  span: number; // ช่วงแป (ระยะโครงถักมากสุด) m
  across: "X" | "Y"; // ทิศช่วงโครงถัก
}
const cumsum = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);

export function roofGeom(dx: number[], dy: number[], zTop: number, s: RoofSettings): RoofGeom {
  const along = s.ridge === "X" ? dx : dy, acrossS = s.ridge === "X" ? dy : dx;
  const W = acrossS.reduce((a, v) => a + v, 0), Lr = along.reduce((a, v) => a + v, 0);
  const theta = s.pitch;
  const rise = (s.type === "shed" ? W : W / 2) * Math.tan(rad(theta));
  const ps = cumsum(along);
  const trusses = ps.map((pos, i) => ({ pos, line: i, trib: ((i > 0 ? along[i - 1] : 2 * s.overhang) + (i < along.length ? along[i] : 2 * s.overhang)) / 2 }));
  return { W, Lr, rise, zTop, theta, trusses, span: Math.max(...along), across: s.ridge === "X" ? "Y" : "X" };
}

// ---------- โครงถัก 2 มิติ (แรงในแนวแกนเท่านั้น) ----------
export interface TrussModel {
  nodes: { x: number; y: number }[];
  members: { i: number; j: number; group: "top" | "bottom" | "web" }[];
  top: number[]; // จุดต่อคอร่า (ซ้าย → ขวา) รวมจุดรองรับ
  supports: [number, number]; // ซ้าย (หมุด), ขวา (ล้อ)
  panel: number; // ระยะช่องแนวราบ m
}

export function buildTruss(W: number, theta: number, type: RoofType, purlinMax: number): TrussModel {
  const t = Math.tan(rad(theta)), c = Math.cos(rad(theta));
  const shed = type === "shed";
  const Lh = shed ? W : W / 2;
  const nHalf = Math.max(2, Math.ceil(Lh / c / purlinMax - 1e-9));
  const n = shed ? nHalf : 2 * nHalf;
  const dxp = W / n;
  const yTop = (x: number) => (shed ? x * t : Math.min(x, W - x) * t);
  const nodes: TrussModel["nodes"] = [];
  const bot: number[] = [], top: number[] = [];
  for (let i = 0; i <= n; i++) { bot.push(nodes.length); nodes.push({ x: i * dxp, y: 0 }); }
  for (let i = 0; i <= n; i++) {
    const y = yTop(i * dxp);
    if (y < 1e-9) top.push(bot[i]);
    else { top.push(nodes.length); nodes.push({ x: i * dxp, y }); }
  }
  const members: TrussModel["members"] = [];
  for (let i = 0; i < n; i++) {
    members.push({ i: bot[i], j: bot[i + 1], group: "bottom" });
    members.push({ i: top[i], j: top[i + 1], group: "top" });
  }
  for (let i = 0; i <= n; i++) if (top[i] !== bot[i]) members.push({ i: bot[i], j: top[i], group: "web" });
  // ทแยงแบบแพรตต์: จากท้องขึ้นเข้าหากลางช่วง (จั่ว) / เข้าหาด้านสูง (เพิง) — ทแยงยาวรับแรงดึง ตั้งสั้นรับแรงอัด ภายใต้น้ำหนักกดลง
  for (let i = 1; i < n - (shed ? 0 : 1); i++) {
    if (shed || i < n / 2) members.push({ i: bot[i], j: top[i + 1], group: "web" });
    else members.push({ i: top[i], j: bot[i + 1], group: "web" });
  }
  return { nodes, members, top, supports: [bot[0], bot[n]], panel: dxp };
}

/** วิเคราะห์โครงถัก: แรงที่จุดต่อ (kN) → แรงในชิ้นส่วน (+ ดึง) และแรงปฏิกิริยาแนวดิ่ง [ซ้าย, ขวา] */
export function solveTruss(tm: TrussModel, loads: { node: number; fx: number; fy: number }[]): { N: number[]; R: [number, number]; H: number } {
  const nn = tm.nodes.length, nd = 2 * nn;
  const K = Array.from({ length: nd }, () => new Float64Array(nd));
  const F = new Float64Array(nd);
  for (const m of tm.members) {
    const a = tm.nodes[m.i], b = tm.nodes[m.j];
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, s = (b.y - a.y) / L, k = 1 / L;
    const d = [2 * m.i, 2 * m.i + 1, 2 * m.j, 2 * m.j + 1], v = [-c, -s, c, s];
    for (let p = 0; p < 4; p++) for (let q = 0; q < 4; q++) K[d[p]][d[q]] += k * v[p] * v[q];
  }
  for (const l of loads) { F[2 * l.node] += l.fx; F[2 * l.node + 1] += l.fy; }
  const fixed = new Set([2 * tm.supports[0], 2 * tm.supports[0] + 1, 2 * tm.supports[1] + 1]);
  const free = [...Array(nd).keys()].filter((i) => !fixed.has(i));
  const n = free.length;
  const A = free.map((i) => [...free.map((j) => K[i][j]), F[i]]);
  for (let p = 0; p < n; p++) {
    let piv = p;
    for (let r = p + 1; r < n; r++) if (Math.abs(A[r][p]) > Math.abs(A[piv][p])) piv = r;
    [A[p], A[piv]] = [A[piv], A[p]];
    if (Math.abs(A[p][p]) < 1e-12) throw new Error("โครงถักไม่มีเสถียรภาพ");
    for (let r = p + 1; r < n; r++) { const k = A[r][p] / A[p][p]; if (k) for (let c = p; c <= n; c++) A[r][c] -= k * A[p][c]; }
  }
  const x = new Float64Array(n);
  for (let p = n - 1; p >= 0; p--) { let s = A[p][n]; for (let c = p + 1; c < n; c++) s -= A[p][c] * x[c]; x[p] = s / A[p][p]; }
  const u = new Float64Array(nd);
  free.forEach((g, k) => (u[g] = x[k]));
  const N = tm.members.map((m) => {
    const a = tm.nodes[m.i], b = tm.nodes[m.j];
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, s = (b.y - a.y) / L;
    return (c * (u[2 * m.j] - u[2 * m.i]) + s * (u[2 * m.j + 1] - u[2 * m.i + 1])) / L;
  });
  // แรงปฏิกิริยา = Ku − F ที่ DOF ที่ยึด
  const react = (g: number) => { let r = -F[g]; for (let j = 0; j < nd; j++) r += K[g][j] * u[j]; return r; };
  return { N, R: [react(2 * tm.supports[0] + 1), react(2 * tm.supports[1] + 1)], H: react(2 * tm.supports[0]) };
}

// ---------- น้ำหนักบรรทุก ----------
export interface RoofLoadsOut {
  /** แรงที่หัวเสาริมต่อโครงถัก (kN, ลง = บวก) ด้านละครึ่ง */
  perTruss: { line: number; trib: number; D: number; L: number }[];
  /** แรงลมด้านข้างรวม (kN) เข้าพื้นชั้นบนสุด */
  FX: number; FY: number;
  weight: number; // kN น้ำหนักหลังคาทั้งหมด (สำหรับแผ่นดินไหว)
  pWall: number; // kN/m² แรงลมบนพื้นที่ฉาย
  areaX: number; areaY: number; // m² พื้นที่ฉายที่รับลมทิศ X / Y
}

/** น้ำหนักเหล็กโครงหลังคาเริ่มต้น (kg/m² แนวราบ) ใช้ก่อนออกแบบจริง */
export const STEEL_EST = 15;

export function roofLoads(g: RoofGeom, s: RoofSettings, wind: WindSettings, steelKg = STEEL_EST): RoofLoadsOut {
  const c = Math.cos(rad(g.theta));
  const wD = (s.coverKg / c + steelKg) * KG; // kN/m² แนวราบ
  const wL = s.llKg * KG;
  const Wtot = g.W + 2 * s.overhang;
  const perTruss = g.trusses.map((t) => ({ line: t.line, trib: t.trib, D: (wD * Wtot * t.trib) / 2, L: (wL * Wtot * t.trib) / 2 }));
  const Lall = g.Lr + 2 * s.overhang;
  const h = g.zTop + g.rise / 2;
  const pWall = wind.Iw * refPressure(wind.V50, wind.TF) * exposureFactor(h, wind.exposure) * wind.Cg * (wind.CpW + Math.abs(wind.CpL));
  const triangle = (Wtot * g.rise) / 2;
  const slope = s.type === "hip" ? (g.rise * (2 * Lall - Wtot)) / 2 : Lall * g.rise;
  // ลมตั้งฉากสัน (ทิศช่วงโครงถัก) เห็นพื้นที่ฉายของลาด · ลมขนานสันเห็นหน้าจั่ว (สามเหลี่ยม)
  const aAcross = Math.max(0, slope), aAlong = triangle;
  const areaX = g.across === "X" ? aAcross : aAlong, areaY = g.across === "Y" ? aAcross : aAlong;
  return { perTruss, FX: pWall * areaX, FY: pWall * areaY, weight: wD * Wtot * Lall, pWall, areaX, areaY };
}

// ---------- ออกแบบ ----------
export interface MemberCheck { group: "top" | "bottom" | "web"; label: string; sec: SteelSec; Nt: number; Nc: number; KL: number; ratio: number; crit: string; ok: boolean }
export interface PurlinCheck { sec: SteelSec; span: number; spacing: number; ratioG: number; ratioU: number; defl: number; deflAllow: number; ratio: number; ok: boolean }
export interface RoofDesign {
  geom: RoofGeom;
  truss: TrussModel;
  wind: { h: number; base: number; cp: [number, number]; cpi: [number, number]; up: [number, number]; down: [number, number] }; // kN/m²
  purlin: PurlinCheck;
  members: MemberCheck[];
  anchor: { uplift: number; bolts: number; dia: number; gravity: number; H: number };
  steelKgM2: number; steelTotal: number; // kg/m² แนวราบ, kg ทั้งหลังคา
  loads: RoofLoadsOut;
  ok: boolean; message: string; steps: Step[];
}

const ALL_SEC = 1e9;

export function designRoof(dx: number[], dy: number[], zTop: number, sIn: RoofSettings, wind: WindSettings): RoofDesign {
  const s = { ...defaultRoof, ...sIn };
  const g = roofGeom(dx, dy, zTop, s);
  const th = rad(g.theta), c = Math.cos(th), sn = Math.sin(th);
  const Fy = s.fyKsc, Fb = 0.6 * Fy;
  const tm = buildTruss(g.W, g.theta, s.type, s.purlinMax);
  const spacing = tm.panel / c; // ระยะแปตามลาด (m)
  const spacingMax = Math.max(...g.trusses.map((t) => t.trib));

  // แรงลม
  const h = zTop + g.rise / 2;
  const base = wind.Iw * refPressure(wind.V50, wind.TF) * exposureFactor(h, wind.exposure);
  const cp = roofCpCg(g.theta);
  const cpi: [number, number] = s.openings === "open" ? [-0.9, 0.6] : [-0.3, 0];
  const up: [number, number] = [base * (cp[0] - cpi[1]), base * (cp[1] - cpi[1])]; // + = กดลง, − = ยก
  const down: [number, number] = [base * (cp[0] - cpi[0]), base * (cp[1] - cpi[0])];

  // ---- แป ----
  const pKg = (kN: number) => kN / KG; // kN/m² → kg/m²
  const L = g.span * 100; // cm
  const nSag = Math.max(0, Math.min(2, Math.round(s.sagRods)));
  const upliftKgM2 = Math.max(0, -pKg(Math.min(up[0], up[1])));
  const downKgM2 = Math.max(0, pKg(Math.max(down[0], down[1])));
  let purlin: PurlinCheck | null = null;
  for (const sec of PURLINS) {
    const dKgM = s.coverKg * spacing + sec.w; // kg/m ตามแนวแป (ผิวลาด)
    const lKgM = s.llKg * spacing * c; // น้ำหนักจรแนวราบ × ความกว้างฉาย
    // กรณี D + Lr และ D + W(กด): [ตั้งฉากผิว, ขนานผิว] kg/m
    const cases: [number, number][] = [[(dKgM + lKgM) * c, (dKgM + lKgM) * sn], [dKgM * c + downKgM2 * spacing, dKgM * sn]];
    let ratioG = 0, wnMax = 0;
    for (const [wn, wt] of cases) {
      const Mx = ((wn / 100) * L * L) / 8, My = ((wt / 100) * (L / (nSag + 1)) ** 2) / 8;
      ratioG = Math.max(ratioG, Mx / (sec.Sx * Fb) + My / (sec.Sy * Fb));
      wnMax = Math.max(wnMax, wn);
    }
    const wu = upliftKgM2 * spacing - 0.6 * dKgM * c;
    const ratioU = wu > 0 ? ((wu / 100) * L * L) / 8 / (0.4 * Fb * sec.Sx) : 0;
    const defl = (5 * (wnMax / 100) * L ** 4) / (384 * E * sec.Ix);
    const deflAllow = L / 180;
    const ratio = Math.max(ratioG, ratioU, defl / deflAllow);
    purlin = { sec, span: g.span, spacing, ratioG, ratioU, defl, deflAllow, ratio, ok: ratio <= 1 };
    if (purlin.ok) break;
  }
  purlin = purlin!;

  // ---- โครงถัก: น้ำหนักที่จุดต่อคอร่า ----
  const nodeLoads = (wH: number, pSlope: [number, number] | null, mirror = false) => {
    // wH: kN/m² แนวราบ (แนวดิ่ง) · pSlope: แรงดันตั้งฉากผิว [ต้นลม, ท้ายลม] kN/m² (+ = กด) · mirror = ลมพัดจากขวา
    const pAt = (x: number) => (!pSlope ? 0 : s.type === "shed" ? pSlope[mirror ? 1 : 0] : (x < g.W / 2) !== mirror ? pSlope[0] : pSlope[1]);
    const out: { node: number; fx: number; fy: number }[] = [];
    const tops = tm.top;
    for (let k = 0; k < tops.length; k++) {
      const n = tm.nodes[tops[k]];
      let fx = 0, fy = 0;
      for (const nb of [k - 1, k + 1]) {
        if (nb < 0 || nb >= tops.length) continue;
        const o = tm.nodes[tops[nb]];
        const half = Math.abs(o.x - n.x) / 2;
        fy -= wH * half * spacingMax;
        const p = pAt((o.x + n.x) / 2);
        if (p) {
          const F = p * (half / c) * spacingMax; // แรงตั้งฉากผิว (ความยาวตามลาด)
          // ทิศเข้าหาผิว: ลาดขึ้นไปทางขวา → (sinθ, −cosθ) · ลาดลงไปทางขวา → (−sinθ, −cosθ)
          const rising = (o.y - n.y) * (o.x - n.x) > 0;
          fx += F * (rising ? sn : -sn);
          fy -= F * c;
        }
      }
      out.push({ node: tops[k], fx, fy });
    }
    // ชายคา (ฉายแนวราบ ov): แรงดิ่งที่จุดรองรับ
    const ov = s.overhang;
    if (ov > 0) for (const [node, x] of [[tm.supports[0], 0], [tm.supports[1], g.W]] as const) {
      out.push({ node, fx: 0, fy: -(wH + pAt(x === 0 ? 0 : g.W - 1e-6)) * ov * spacingMax });
    }
    return out;
  };

  let steelKg = STEEL_EST;
  let members: MemberCheck[] = [];
  let anchor = { uplift: 0, bolts: 2, dia: 16, gravity: 0, H: 0 };
  let steelKgM2 = steelKg;
  for (let iter = 0; iter < 3; iter++) {
    const dH = (s.coverKg / c + steelKg) * KG; // kN/m² แนวราบ
    const lH = s.llKg * KG;
    const cases: { name: string; wind: boolean; loads: { node: number; fx: number; fy: number }[] }[] = [
      { name: "D + Lr", wind: false, loads: nodeLoads(dH + lH, null) },
      { name: "0.6D + W (ยก, ลมซ้าย)", wind: true, loads: nodeLoads(0.6 * dH, up) },
      { name: "0.6D + W (ยก, ลมขวา)", wind: true, loads: nodeLoads(0.6 * dH, up, true) },
    ];
    if (Math.max(down[0], down[1]) > 0) {
      cases.push({ name: "D + W (กด, ลมซ้าย)", wind: true, loads: nodeLoads(dH, [Math.max(0, down[0]), Math.max(0, down[1])]) });
      cases.push({ name: "D + W (กด, ลมขวา)", wind: true, loads: nodeLoads(dH, [Math.max(0, down[0]), Math.max(0, down[1])], true) });
    }
    const res = cases.map((cs) => ({ ...cs, r: solveTruss(tm, cs.loads) }));
    const groups = ["top", "bottom", "web"] as const;
    members = groups.map((grp) => {
      const idx = tm.members.map((m, k) => (m.group === grp ? k : -1)).filter((k) => k >= 0);
      const len = (k: number) => { const m = tm.members[k], a = tm.nodes[m.i], b = tm.nodes[m.j]; return Math.hypot(b.x - a.x, b.y - a.y); };
      let Nt = 0, Nc = 0, ct = "-", cc = "-", KLc = 0, KLt = 0;
      for (const r of res) for (const k of idx) {
        const N = r.r.N[k];
        // ท้องโครงถัก: ค้ำยันด้านข้างทุก 2 ช่อง (แรงอัดจากลมยก)
        const KL = grp === "bottom" ? 2 * len(k) : len(k);
        if (N > Nt) { Nt = N; ct = r.name; KLt = KL; }
        if (-N > Nc) { Nc = -N; cc = r.name; KLc = KL; }
      }
      const KLmax = Math.max(...idx.map((k) => (grp === "bottom" ? 2 : 1) * len(k)));
      let pick: MemberCheck | null = null;
      for (const sec of BOXES) {
        const lamC = (KLc * 100) / sec.r, lamT = (KLmax * 100) / sec.r;
        if (lamT > 300 || (Nc > 0 && lamC > 200)) continue;
        const rt = (Nt / KG) / (0.6 * Fy * sec.A);
        const rc = Nc > 0 ? (Nc / KG) / (allowFa(lamC, Fy) * sec.A) : 0;
        const ratio = Math.max(rt, rc);
        pick = { group: grp, label: grp === "top" ? "จันทัน/คอร่าบน" : grp === "bottom" ? "คอร่าล่าง (ขื่อ)" : "ชิ้นส่วนแนวตั้ง/ทแยง", sec, Nt, Nc, KL: rc >= rt ? KLc : KLt, ratio, crit: rc >= rt ? cc : ct, ok: ratio <= 1 };
        if (pick.ok) break;
      }
      return pick ?? { group: grp, label: grp, sec: BOXES[BOXES.length - 1], Nt, Nc, KL: KLc, ratio: ALL_SEC, crit: cc, ok: false };
    });
    // น้ำหนักเหล็กจริง
    const trussKg = tm.members.reduce((a, m) => {
      const A = tm.nodes[m.i], B = tm.nodes[m.j];
      return a + Math.hypot(B.x - A.x, B.y - A.y) * members.find((x) => x.group === m.group)!.sec.w;
    }, 0);
    const Wtot = g.W + 2 * s.overhang;
    steelKgM2 = trussKg / (Wtot * spacingMax) + ((tm.top.length + 2) * purlin.sec.w) / Wtot; // + แปชายคา 2 แถว
    // จุดยึด: แรงยกสูงสุด (0.6D + W) และแรงกดสูงสุด
    const Rup = Math.max(0, ...res.filter((r) => r.name.startsWith("0.6D")).flatMap((r) => [-r.r.R[0], -r.r.R[1]]));
    const Rdn = Math.max(...res.flatMap((r) => [r.r.R[0], r.r.R[1]]));
    const H = Math.max(...res.map((r) => Math.abs(r.r.H)));
    const Ta = 1400 * 1.57 * KG; // M16 A307: Ft = 1400 ksc × As 1.57 cm² (kN)
    anchor = { uplift: Rup, bolts: Math.max(2, Math.ceil(Rup / Ta - 1e-9)), dia: 16, gravity: Rdn, H };
    if (Math.abs(steelKgM2 - steelKg) < 0.5) break;
    steelKg = steelKgM2;
  }
  const trussKgOne = tm.members.reduce((a, m) => { const A = tm.nodes[m.i], B = tm.nodes[m.j]; return a + Math.hypot(B.x - A.x, B.y - A.y) * members.find((x) => x.group === m.group)!.sec.w; }, 0);
  const purlinLen = (tm.top.length + 2) * (g.Lr + 2 * s.overhang);
  const steelTotal = trussKgOne * g.trusses.length + purlinLen * purlin.sec.w;
  const loads = roofLoads(g, s, wind, steelKgM2);

  const ok = purlin.ok && members.every((m) => m.ok);
  const typeName = s.type === "gable" ? "จั่ว" : s.type === "hip" ? "ปั้นหยา" : "เพิงหมาแหงน";
  const steps: Step[] = [
    { label: "รูปทรง", expr: `หลังคา${typeName} ชัน ${f(g.theta, 1)}° · สัน${s.type === "shed" ? "สูง" : ""}แนว ${s.ridge}`, value: `ช่วงโครงถัก W = ${f(g.W)} m · สูง ${f(g.rise)} m · ${g.trusses.length} โครง @ ≤ ${f(g.span)} m · ชายคา ${f(s.overhang)} m` },
    { label: "น้ำหนักบรรทุก", expr: "วัสดุมุง (ผิวลาด) + เหล็กโครงหลังคา · น้ำหนักจร (แนวราบ)", value: `${s.coverKg} kg/m² + ${f(steelKgM2, 1)} kg/m² · Lr ${s.llKg} kg/m²` },
    { label: "แรงลมบนหลังคา", expr: `Iw·q·Ce(h = ${f(h)} m) · CpCg ${f(cp[0])}/${f(cp[1])} · CpiCgi ${f(cpi[0])}…${f(cpi[1])}`, value: `ฐาน ${f(base, 3)} kN/m² · ยก ${f(up[0], 3)}/${f(up[1], 3)} · กด ${f(down[0], 3)}/${f(down[1], 3)} kN/m²` },
    { label: "แป", expr: `ช่วง ${f(g.span)} m · ระยะ ${f(spacing)} m · เหล็กยึดแป ${nSag} จุด/ช่วง`, value: `${purlin.sec.name} (${f(purlin.sec.w)} kg/m)`, ok: purlin.ok },
    { label: "แป: ดัดสองแกน", expr: "Mx/(Sx·0.6Fy) + My/(Sy·0.6Fy)", value: f(purlin.ratioG), ok: purlin.ratioG <= 1 },
    { label: "แป: แรงลมยก", expr: "(wยก − 0.6D)L²/8 / (0.40 × 0.6Fy·Sx)", value: f(purlin.ratioU), ok: purlin.ratioU <= 1 },
    { label: "แป: ระยะแอ่นตัว", expr: "5wL⁴/384EI ≤ L/180", value: `${f(purlin.defl * 10, 1)} / ${f(purlin.deflAllow * 10, 1)} mm`, ok: purlin.defl <= purlin.deflAllow },
    { label: "โครงถัก", expr: `แบบแพรตต์ ${tm.members.filter((m) => m.group === "bottom").length} ช่อง @ ${f(tm.panel)} m · ระยะโครงถัก ${f(spacingMax)} m`, value: `น้ำหนักโครงละ ${f(trussKgOne, 0)} kg` },
    ...members.map((m) => ({ label: m.label, expr: `ดึง ${f(m.Nt)} / อัด ${f(m.Nc)} kN · KL ${f(m.KL)} m (${m.crit})`, value: `${m.sec.name} · ${f(m.ratio)}`, ok: m.ok })),
    { label: "จุดยึดหัวเสา", expr: "แรงยกสูงสุด (0.6D + W) · สลัก M16 A307 Ft = 1,400 ksc", value: `${f(anchor.uplift)} kN → ${anchor.bolts}-M${anchor.dia} · แรงกด ${f(anchor.gravity)} kN` },
    { label: "ส่งเข้าโครงสร้างหลัก", expr: "แรงที่หัวเสาริม (D, Lr) + ลมด้านข้างบนพื้นที่ฉาย", value: `ลม X ${f(loads.FX)} kN · ลม Y ${f(loads.FY)} kN · น้ำหนักหลังคา ${f(loads.weight)} kN` },
  ];
  const bad = [!purlin.ok ? "แป" : "", ...members.filter((m) => !m.ok).map((m) => m.label)].filter(Boolean);
  return {
    geom: g, truss: tm, wind: { h, base, cp, cpi, up, down }, purlin, members, anchor, steelKgM2, steelTotal, loads, ok,
    message: ok ? `แป ${purlin.sec.name} · คอร่าบน ${members[0].sec.name} · คอร่าล่าง ${members[1].sec.name} · ค้ำ ${members[2].sec.name} · ยึด ${anchor.bolts}-M${anchor.dia}` : `ไม่ผ่าน: ${bad.join(", ")} — ลดระยะโครงถัก/ระยะแป หรือเพิ่มความชัน`,
    steps,
  };
}

// ---------- ปริมาณวัสดุหลังคา ----------
export interface RoofQty {
  trussKg: number; purlinKg: number; steelKg: number;
  trusses: number; purlinM: number; bolts: number;
  coverArea: number; // m² ผิวลาด (รวมชายคา)
  covering: RoofSettings["covering"];
}
export function roofQty(r: RoofDesign, sIn: RoofSettings): RoofQty {
  const s = { ...defaultRoof, ...sIn };
  const g = r.geom, tm = r.truss;
  const len = (m: TrussModel["members"][number]) => { const a = tm.nodes[m.i], b = tm.nodes[m.j]; return Math.hypot(b.x - a.x, b.y - a.y); };
  const oneTruss = tm.members.reduce((a, m) => a + len(m) * r.members.find((x) => x.group === m.group)!.sec.w, 0);
  const purlinM = (tm.top.length + 2) * (g.Lr + 2 * s.overhang);
  const trussKg = oneTruss * g.trusses.length, purlinKg = purlinM * r.purlin.sec.w;
  const coverArea = ((g.Lr + 2 * s.overhang) * (g.W + 2 * s.overhang)) / Math.cos(rad(g.theta)); // ทุกระนาบชันเท่ากัน → พื้นที่ฉาย / cosθ
  return { trussKg, purlinKg, steelKg: trussKg + purlinKg, trusses: g.trusses.length, purlinM, bolts: 2 * r.anchor.bolts * g.trusses.length, coverArea, covering: s.covering };
}
