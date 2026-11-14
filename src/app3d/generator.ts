// สร้างโมเดลอาคาร 3D จากกริด: เสา คาน diaphragm น้ำหนักบรรทุก แรงลม 2 ทิศ และชุดผสม
// แรงลมใช้ มยผ. 1311-50 วิธีอย่างง่าย (เดียวกับโหมด 2D) กระทำที่จุดอ้างอิง diaphragm ของแต่ละชั้น

import { concreteE } from "../core/model.ts";
import { autoDiaphragms, type Combo3, type LoadCase3, type Model3 } from "../core3d/model3d.ts";
import { defaultWind, exposureFactor, refPressure, type WindSettings } from "../loads/windTH.ts";
import { defaultSeismic, seismicForces, type SeismicResult, type SeismicSettings } from "../loads/seismicTH.ts";

import { emptyInfo, type ProjectInfo } from "../shared/shared.ts";
export { emptyInfo, type ProjectInfo };

export interface GridParams {
  name: string;
  /** ข้อมูลโครงการสำหรับหน้าปก/หัวกระดาษรายการคำนวณ */
  info?: ProjectInfo;
  xSpacing: string; // เช่น "3@5" หรือ "5,4,5"
  ySpacing: string;
  storeys: string; // เช่น "4,3@3.5" (ชั้นล่างสุดก่อน)
  col: { b: number; h: number };
  beam: { b: number; h: number };
  fcKsc: number; fyKsc: number;
  /** กำลังครากเหล็กปลอก (ksc) */
  fytKsc?: number;
  /** น้ำหนักบรรทุกคงที่เพิ่มเติมบนคาน (kN/m) และน้ำหนักจร (kN/m) */
  sdl: number; ll: number;
  /** หลังคา (ชั้นบนสุด) */
  sdlRoof: number; llRoof: number;
  wind: WindSettings;
  /** แรงแผ่นดินไหว มยผ. 1301/1302-61 (สถิตเทียบเท่า) */
  seismic?: SeismicSettings;
  diaphragm: boolean;
  /** คานคอดิน: คานที่ระดับฐาน (ระดับ 0) เชื่อมโคนเสาทุกแนว ฐานเสาเป็นแบบหมุนได้ — คานคอดินรับโมเมนต์ที่ฐาน
   *  sdl = น้ำหนักผนังชั้นล่าง/อื่น ๆ บนคานคอดิน (kN/m) */
  tieBeam?: { enabled: boolean; b: number; h: number; sdl: number };
  /** พื้นสองทาง: น้ำหนักต่อพื้นที่ (kg/m²) กระจายลงคานรอบแผ่น (เส้น 45°) เป็นน้ำหนักแผ่สม่ำเสมอเทียบเท่า
   *  เมื่อเปิด sdl/ll บนคาน (kN/m) = น้ำหนักเพิ่มเติม เช่น ผนัง */
  slab?: SlabSettings;
  /** บันได (ออกแบบแยก ไม่อยู่ในโมเดลวิเคราะห์) */
  stair?: import("../design/stair.ts").StairInput;
  /** ชุดผสมที่ผู้ใช้แก้เอง (ว่าง = ตามมาตรฐานที่เลือก) */
  combos?: Combo3[];
  /** รูปทรงไม่เต็มกริด: ชิ้นที่ลบ, ช่องเปิดพื้น, คานยื่น */
  layout?: LayoutEdits;
  /** ค่าปรับรายชิ้น (มาจากการแก้ไขโครงในหน้า 2D) — ทับค่าทั้งอาคารเฉพาะชิ้นนั้น */
  overrides?: MemberOverrides;
  /** วิเคราะห์อันดับสอง P-Delta + หน้าตัดแตกร้าว */
  pDelta: boolean;
  cracked: boolean;
}

export interface MemberOverrides {
  /** ขนาดหน้าตัด (m) ตามแกนของ 3D: เสา h ตามแกน X */
  size?: Record<string, { b: number; h: number }>;
  /** น้ำหนักบนคาน (kN/m) */
  load?: Record<string, { sdl: number; ll: number }>;
}
export const overrideCount = (o?: MemberOverrides) => new Set([...Object.keys(o?.size ?? {}), ...Object.keys(o?.load ?? {})]).size;
/** รหัส/ชื่อหน้าตัดตามขนาด (ใช้ทั้ง 3D และโครง 2D) */
export const cm = (v: number) => Math.round(v * 1000) / 10;
export const sizeSecId = (kind: "column" | "beam", b: number, h: number) => `${kind === "column" ? "C" : "B"}${cm(b)}x${cm(h)}`;
export const sizeSecName = (kind: "column" | "beam", b: number, h: number) => `${kind === "column" ? "เสา" : "คาน"} ${cm(b)}×${cm(h)}`;

export const defaultTie = { enabled: false, b: 0.2, h: 0.4, sdl: 0 };

export type Side = "x0" | "x1" | "y0" | "y1";
export interface Cantilever { side: Side; length: number; fromLevel: number }
export interface LayoutEdits {
  /** รหัสชิ้นที่ลบ (เสา/คาน/คานยื่น) */
  removed?: string[];
  /** ช่องเปิดพื้น "ชั้น:ช่อง" เช่น "2:B1" หรือ "*:B1" = ทุกชั้น */
  openings?: string[];
  /** คานยื่นจากขอบอาคาร (ทุกแนวกริดของด้านนั้น ตั้งแต่ชั้น fromLevel) */
  cantilevers?: Cantilever[];
}
/** ชื่อช่องพื้น: แถว (A, B, …) + ช่องตามแกน X (1, 2, …) */
export const panelCode = (i: number, j: number) => `${String.fromCharCode(65 + j)}${i + 1}`;
const removedSet = (p: GridParams) => new Set(p.layout?.removed ?? []);
/** ช่องพื้น (ชั้น k, ช่อง i, j) มีแผ่นพื้นหรือไม่: ไม่อยู่ในช่องเปิด และคานขอบครบ 4 ด้าน */
export function panelExists(p: GridParams, k: number, i: number, j: number, removed = removedSet(p)): boolean {
  const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing);
  if (i < 0 || j < 0 || i >= dx.length || j >= dy.length || k < 1) return false;
  const code = panelCode(i, j);
  if ((p.layout?.openings ?? []).some((o) => o === `${k}:${code}` || o === `*:${code}`)) return false;
  const n = (ii: number, jj: number) => `${String.fromCharCode(65 + jj)}${ii + 1}-${k}`;
  return ![`BX-${n(i, j)}`, `BX-${n(i, j + 1)}`, `BY-${n(i, j)}`, `BY-${n(i + 1, j)}`].some((b) => removed.has(b));
}
/** แปลงข้อความช่องเปิด "2:B1, *:C2" → รายการ */
export function parseOpenings(txt: string): string[] {
  return txt.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter((t) => /^(\d+|\*):[A-Z]\d+$/.test(t));
}

export interface SlabSettings { enabled: boolean; t: number; sdl: number; ll: number; sdlRoof: number; llRoof: number }
/** t (m), น้ำหนักวัสดุปู/ฝ้า/งานระบบ SDL และน้ำหนักจร LL (kg/m²) */
export const defaultSlab: SlabSettings = { enabled: false, t: 0.12, sdl: 100, ll: 200, sdlRoof: 50, llRoof: 100 };
export const KG_M2 = 0.00980665; // kg/m² → kN/m²

/** สัมประสิทธิ์น้ำหนักแผ่เทียบเท่าบนคานขอบแผ่น (× w·S): ด้านสั้น (สามเหลี่ยม) S/3, ด้านยาว (คางหมู) S/3·(3 − m²)/2, m = S/L */
export function edgeFactor(edge: number, other: number): number {
  const S = Math.min(edge, other), L = Math.max(edge, other);
  if (edge <= other + 1e-9) return S / 3;
  const m = S / L;
  return (S / 3) * (3 - m * m) / 2;
}

/** น้ำหนักจากแผ่นพื้นลงคาน (kN/m): sdl รวมน้ำหนักแผ่นพื้นเอง (24·t) */
export function slabLineLoad(p: GridParams, id: string): { sdl: number; ll: number } {
  const s = { ...defaultSlab, ...(p.slab ?? {}) };
  const m = id.match(/^(BX|BY|KX|KY)-([A-Z])(\d+)-(\d+)$/);
  if (!s.enabled || !m || +m[4] === 0) return { sdl: 0, ll: 0 };
  const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing);
  const lvl = +m[4];
  const roof = lvl === parseSpacing(p.storeys).length;
  const j = m[2].charCodeAt(0) - 65, i = +m[3] - 1;
  const wD = 24 * s.t + (roof ? s.sdlRoof : s.sdl) * KG_M2, wL = (roof ? s.llRoof : s.ll) * KG_M2;
  if (m[1] === "KX" || m[1] === "KY") {
    // คานยื่น: รับพื้นยื่นแบบทางเดียว กว้างครึ่งช่วงสองข้างของแนวกริด
    const perp = m[1] === "KX" ? dy : dx, idx = m[1] === "KX" ? j : i;
    const trib = ((perp[idx - 1] ?? 0) + (perp[idx] ?? 0)) / 2;
    return { sdl: wD * trib, ll: wL * trib };
  }
  // ด้านคาน และความยาวด้านตั้งฉากของแผ่นที่อยู่สองข้าง (เฉพาะแผ่นที่มีอยู่จริง)
  const removed = removedSet(p);
  const [edge, sides] = m[1] === "BX"
    ? [dx[i], [[dy[j - 1], panelExists(p, lvl, i, j - 1, removed)], [dy[j], panelExists(p, lvl, i, j, removed)]] as [number | undefined, boolean][]]
    : [dy[j], [[dx[i - 1], panelExists(p, lvl, i - 1, j, removed)], [dx[i], panelExists(p, lvl, i, j, removed)]] as [number | undefined, boolean][]];
  const k = sides.filter(([v, ok]) => v !== undefined && ok).reduce((a, [o]) => a + edgeFactor(edge, o!), 0);
  return { sdl: wD * k, ll: wL * k };
}
/** คานคอดิน = คานระดับ 0 (BX-A1-0, BY-B2-0) */
export const isTieBeam = (id: string) => /^B[XY]-[A-Z]\d+-0$/.test(id);
/** ขนาดหน้าตัดตามทั้งอาคารของชิ้นนั้น (ก่อนค่าปรับรายชิ้น) */
export function defaultSize(p: GridParams, id: string) {
  if (id.startsWith("C-")) return p.col;
  if (isTieBeam(id)) { const t = { ...defaultTie, ...(p.tieBeam ?? {}) }; return { b: t.b, h: t.h }; }
  return p.beam;
}

export const defaultGrid: GridParams = {
  name: "อาคาร ค.ส.ล. 3D (ตัวอย่าง)",
  xSpacing: "3@5", ySpacing: "2@4.5", storeys: "4,3@3.5",
  col: { b: 0.4, h: 0.4 }, beam: { b: 0.25, h: 0.5 },
  fcKsc: 280, fyKsc: 4000,
  sdl: 15, ll: 8, sdlRoof: 8, llRoof: 2,
  wind: { ...defaultWind },
  seismic: { ...defaultSeismic },
  tieBeam: { ...defaultTie },
  slab: { ...defaultSlab },
  diaphragm: true,
  pDelta: true,
  cracked: true,
};

/** แปลงสตริงระยะ "3@5, 4" → [5, 5, 5, 4] */
export function parseSpacing(s: string): number[] {
  const out: number[] = [];
  for (const tok of s.split(/[,\s]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)\s*@\s*([\d.]+)$/);
    if (m) { for (let k = 0; k < +m[1]; k++) out.push(+m[2]); }
    else {
      const v = parseFloat(tok);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`ระยะ "${tok}" ไม่ถูกต้อง`);
      out.push(v);
    }
  }
  if (!out.length) throw new Error("ต้องมีอย่างน้อย 1 ช่วง");
  return out;
}

const cumsum = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);

export interface WindLevel3 { id: string; z: number; band: number; FX: number; FY: number }

/** แรงลมรายชั้นของทั้งอาคาร (ลม X ใช้ความกว้างด้าน Y และกลับกัน) */
export function windStoreys(zs: number[], Bx: number, By: number, w: WindSettings, ids: string[]): WindLevel3[] {
  const H = zs[zs.length - 1] + w.parapet;
  const q = refPressure(w.V50, w.TF);
  const pL = w.Iw * q * exposureFactor(0.5 * H, w.exposure) * w.Cg * Math.abs(w.CpL);
  const pW = (z: number) => w.Iw * q * exposureFactor(z, w.exposure) * w.Cg * w.CpW;
  return zs.map((z, k) => {
    const zBot = k === 0 ? z / 2 : (zs[k - 1] + z) / 2;
    const zTop = k === zs.length - 1 ? z + w.parapet : (z + zs[k + 1]) / 2;
    const n = 40, h = (zTop - zBot) / n;
    let s = pW(zBot) + pW(zTop);
    for (let i = 1; i < n; i++) s += pW(zBot + i * h) * (i % 2 ? 4 : 2);
    const per = (zTop > zBot ? (s * h) / 3 : 0) + pL * (zTop - zBot); // kN/m ของความกว้าง
    return { id: ids[k], z, band: zTop - zBot, FX: per * By, FY: per * Bx };
  });
}

export interface SeismicLevel3 { id: string; z: number; W: number; Cvx: number; F: number; MzX: number; MzY: number }
export interface Seismic3 { result: SeismicResult; levels: SeismicLevel3[]; Bx: number; By: number }

/** น้ำหนักอาคารรายชั้น (kN): คาน (น้ำหนักตัวเอง + SDL + ψ·LL) + เสาครึ่งบน/ครึ่งล่างของชั้น */
export function storeyWeights(p: GridParams, dx: number[], dy: number[], dz: number[], llFraction: number): number[] {
  const g = 24;
  const nx = dx.length + 1, ny = dy.length + 1;
  const Lbeam = ny * dx.reduce((a, v) => a + v, 0) + nx * dy.reduce((a, v) => a + v, 0);
  const wBeam = g * p.beam.b * p.beam.h;
  const wCol = g * p.col.b * p.col.h * nx * ny; // ต่อความสูง 1 m ของทั้งชั้น
  // พื้น: ใช้พื้นที่จริง (น้ำหนักแผ่เทียบเท่าบนคานใช้สำหรับออกแบบคานเท่านั้น)
  const s = { ...defaultSlab, ...(p.slab ?? {}) };
  const removed = removedSet(p);
  const areaAt = (lvl: number) => {
    if (!s.enabled) return 0;
    let A = 0;
    for (let j = 0; j < dy.length; j++) for (let i = 0; i < dx.length; i++) if (panelExists(p, lvl, i, j, removed)) A += dx[i] * dy[j];
    return A;
  };
  return dz.map((_, k) => {
    const area = areaAt(k + 1);
    const roof = k === dz.length - 1;
    const sdl = roof ? p.sdlRoof : p.sdl, ll = roof ? p.llRoof : p.ll;
    const cols = wCol * (dz[k] / 2 + (roof ? 0 : dz[k + 1] / 2));
    const slab = area * (24 * s.t + ((roof ? s.sdlRoof : s.sdl) + llFraction * (roof ? s.llRoof : s.ll)) * KG_M2);
    return (wBeam + sdl + llFraction * ll) * Lbeam + cols + slab;
  });
}

/**
 * ชุดผสมน้ำหนักมาตรฐาน (load case DL, LL, WX, WY และ EX, EY ถ้ามี)
 *  วสท. 1008-38: 1.4D + 1.7L · 0.75(1.4D + 1.7L ± 1.7W) · 0.9D ± 1.3W · 0.75(1.4D + 1.7L ± 1.87E) · 0.9D ± 1.43E
 *  ACI 318-19: 1.4D · 1.2D + 1.6L · 1.2D + 1.0L ± 1.6W · 0.9D ± 1.6W · 1.2D + 1.0L ± 1.0E · 0.9D ± 1.0E
 *   (แรงลม มยผ. 1311-50 เป็นระดับใช้งาน จึงใช้ 1.6W แทน 1.0W ของ ASCE 7 ระดับกำลัง · แรงแผ่นดินไหวเป็นระดับกำลัง ใช้ 1.0E)
 */
export function standardCombos3(code: "EIT" | "ACI", seismic: boolean): Combo3[] {
  const out: Combo3[] = [];
  const add = (name: string, f: Record<string, number>) => out.push({ id: `U${out.length + 1}`, name, factors: f });
  const pm = (sg: number) => (sg > 0 ? "+" : "−");
  if (code === "EIT") {
    add("1.4D + 1.7L", { DL: 1.4, LL: 1.7 });
    for (const d of ["X", "Y"]) for (const sg of [1, -1]) add(`0.75(1.4D + 1.7L ${pm(sg)} 1.7W${d})`, { DL: 1.05, LL: 1.275, [`W${d}`]: sg * 1.275 });
    for (const d of ["X", "Y"]) for (const sg of [1, -1]) add(`0.9D ${pm(sg)} 1.3W${d}`, { DL: 0.9, [`W${d}`]: sg * 1.3 });
    if (seismic) {
      for (const d of ["X", "Y"]) for (const sg of [1, -1]) add(`0.75(1.4D + 1.7L ${pm(sg)} 1.87E${d})`, { DL: 1.05, LL: 1.275, [`E${d}`]: sg * 1.4025 });
      for (const d of ["X", "Y"]) for (const sg of [1, -1]) add(`0.9D ${pm(sg)} 1.43E${d}`, { DL: 0.9, [`E${d}`]: sg * 1.43 });
    }
  } else {
    add("1.4D", { DL: 1.4 });
    add("1.2D + 1.6L", { DL: 1.2, LL: 1.6 });
    for (const d of ["X", "Y"]) for (const sg of [1, -1]) add(`1.2D + 1.0L ${pm(sg)} 1.6W${d}`, { DL: 1.2, LL: 1.0, [`W${d}`]: sg * 1.6 });
    for (const d of ["X", "Y"]) for (const sg of [1, -1]) add(`0.9D ${pm(sg)} 1.6W${d}`, { DL: 0.9, [`W${d}`]: sg * 1.6 });
    if (seismic) {
      for (const d of ["X", "Y"]) for (const sg of [1, -1]) add(`1.2D + 1.0L ${pm(sg)} 1.0E${d}`, { DL: 1.2, LL: 1.0, [`E${d}`]: sg });
      for (const d of ["X", "Y"]) for (const sg of [1, -1]) add(`0.9D ${pm(sg)} 1.0E${d}`, { DL: 0.9, [`E${d}`]: sg });
    }
  }
  return out;
}

export function generateBuilding(p: GridParams, code: "EIT" | "ACI" = "EIT"): { model: Model3; wind: WindLevel3[]; seismic: Seismic3 | null } {
  const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing), dz = parseSpacing(p.storeys);
  const xs = cumsum(dx), ys = cumsum(dy), zs = cumsum(dz);
  const nid = (i: number, j: number, k: number) => `${String.fromCharCode(65 + j)}${i + 1}-${k}`; // กริด A1-0 …
  const nodes: Model3["nodes"] = [];
  for (let k = 0; k < zs.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) nodes.push({ id: nid(i, j, k), x: xs[i], y: ys[j], z: zs[k] });
  const members: Model3["members"] = [];
  for (let k = 0; k < dz.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
    members.push({ id: `C-${nid(i, j, k)}`, i: nid(i, j, k), j: nid(i, j, k + 1), section: "COL", kind: "column" });
  }
  const tie = { ...defaultTie, ...(p.tieBeam ?? {}) };
  for (let k = tie.enabled ? 0 : 1; k < zs.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
    const sec = k === 0 ? "TIE" : "BEAM";
    if (i < dx.length) members.push({ id: `BX-${nid(i, j, k)}`, i: nid(i, j, k), j: nid(i + 1, j, k), section: sec, kind: "beam" });
    if (j < dy.length) members.push({ id: `BY-${nid(i, j, k)}`, i: nid(i, j, k), j: nid(i, j + 1, k), section: sec, kind: "beam" });
  }
  // คานยื่นจากขอบอาคาร: ทุกแนวกริดของด้านนั้น ตั้งแต่ชั้น fromLevel
  for (const cv of p.layout?.cantilevers ?? []) {
    if (!(cv.length > 0)) continue;
    for (let k = Math.max(1, cv.fromLevel || 1); k < zs.length; k++) {
      const alongX = cv.side === "x0" || cv.side === "x1";
      const n = alongX ? ys.length : xs.length;
      for (let a = 0; a < n; a++) {
        const [i, j] = alongX ? [cv.side === "x0" ? 0 : xs.length - 1, a] : [a, cv.side === "y0" ? 0 : ys.length - 1];
        const base = nid(i, j, k), tip = `${base}-${cv.side}`;
        const sg = cv.side.endsWith("0") ? -1 : 1;
        nodes.push({ id: tip, x: xs[i] + (alongX ? sg * cv.length : 0), y: ys[j] + (alongX ? 0 : sg * cv.length), z: zs[k] });
        members.push({ id: `${alongX ? "KX" : "KY"}-${base}`, i: base, j: tip, section: "BEAM", kind: "beam" });
      }
    }
  }
  // ชิ้นที่ลบ แล้วตัดจุดต่อที่ไม่มีชิ้นส่วนต่อ
  const removed = removedSet(p);
  if (removed.size) for (let q = members.length - 1; q >= 0; q--) if (removed.has(members[q].id)) members.splice(q, 1);
  const used = new Set(members.flatMap((m) => [m.i, m.j]));
  for (let q = nodes.length - 1; q >= 0; q--) if (!used.has(nodes[q].id)) nodes.splice(q, 1);
  // มีคานคอดิน → ฐานหมุนได้รอบแกนนอน (โมเมนต์ที่ฐานไปที่คานคอดิน) · ไม่มี → ยึดแน่น
  const supports = [];
  for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) if (used.has(nid(i, j, 0))) supports.push({ node: nid(i, j, 0), ux: true, uy: true, uz: true, rx: !tie.enabled, ry: !tie.enabled, rz: true });

  const model: Model3 = {
    name: p.name, nodes, members, supports,
    materials: [{ id: "CONC", name: `คอนกรีต fc' ${p.fcKsc} ksc`, E: concreteE(p.fcKsc), nu: 0.2, gamma: 24, fc: p.fcKsc, fy: p.fyKsc, fyt: p.fytKsc ?? 2400 }],
    sections: [
      { id: "COL", name: `เสา ${p.col.b * 100}×${p.col.h * 100}`, material: "CONC", b: p.col.b, h: p.col.h },
      { id: "BEAM", name: `คาน ${p.beam.b * 100}×${p.beam.h * 100}`, material: "CONC", b: p.beam.b, h: p.beam.h },
      ...(tie.enabled ? [{ id: "TIE", name: `คานคอดิน ${cm(tie.b)}×${cm(tie.h)}`, material: "CONC", b: tie.b, h: tie.h }] : []),
    ],
    loadCases: [], combos: [],
  };
  // ค่าปรับรายชิ้น: หน้าตัดตามขนาด
  for (const mem of members) {
    const o = p.overrides?.size?.[mem.id];
    if (!o) continue;
    const kind = mem.kind === "column" ? "column" : "beam";
    const def = defaultSize(p, mem.id);
    if (Math.abs(o.b - def.b) < 1e-6 && Math.abs(o.h - def.h) < 1e-6) continue;
    const id = sizeSecId(kind, o.b, o.h);
    if (!model.sections.some((s) => s.id === id)) model.sections.push({ id, name: sizeSecName(kind, o.b, o.h), material: "CONC", b: o.b, h: o.h });
    mem.section = id;
  }
  if (p.diaphragm) model.diaphragms = autoDiaphragms(model);
  model.analysis = { pDelta: p.pDelta ?? false, cracked: p.cracked ?? false };

  // น้ำหนักบนคานตามชั้น (หลังคา / พื้น / คานคอดิน: SDL = ผนังที่กำหนด ไม่มีน้ำหนักจร)
  const beamLoads = (key: "sdl" | "ll") => members.filter((m) => m.kind === "beam")
    .map((m) => ({ type: "udl" as const, member: m.id, dir: "GZ" as const, w: -defaultLoad(p, m.id)[key] }));
  const ovLoad = (key: "sdl" | "ll", loads: ReturnType<typeof beamLoads>) => loads.map((l) => {
    const o = p.overrides?.load?.[l.member];
    return o ? { ...l, w: -o[key] } : l;
  }).filter((l) => l.w !== 0);
  const wind = windStoreys(zs.slice(1), xs[xs.length - 1], ys[ys.length - 1], p.wind,
    zs.slice(1).map((z, k) => model.diaphragms?.[k]?.id ?? nodes.find((n) => Math.abs(n.z - z) < 1e-6)!.id));
  // ถ้าไม่มี diaphragm ใส่แรงลมที่มุมกริด A1 ของแต่ละชั้น
  const wl = (dir: "X" | "Y"): LoadCase3 => ({
    id: `W${dir}`, name: `ลม มยผ.1311-50 (+${dir})`, selfWeight: false, lateral: true,
    loads: wind.map((l) => ({ type: "nodal" as const, node: l.id, fx: dir === "X" ? +l.FX.toFixed(3) : 0, fy: dir === "Y" ? +l.FY.toFixed(3) : 0, fz: 0, mx: 0, my: 0, mz: 0 })),
  });
  model.loadCases = [
    { id: "DL", name: "น้ำหนักคงที่ (รวมน้ำหนักตัวเอง)", selfWeight: true, loads: ovLoad("sdl", beamLoads("sdl")) },
    { id: "LL", name: "น้ำหนักจร", selfWeight: false, loads: ovLoad("ll", beamLoads("ll")) },
    wl("X"), wl("Y"),
  ];

  // แรงแผ่นดินไหว: กระทำที่จุดอ้างอิงพื้น + แรงบิดจากการเยื้องศูนย์โดยบังเอิญ (เฉพาะเมื่อมี diaphragm)
  let seismic: Seismic3 | null = null;
  const sp = p.seismic;
  if (sp?.enabled) {
    const Bx = xs[xs.length - 1], By = ys[ys.length - 1];
    const Ws = storeyWeights(p, dx, dy, dz, sp.llFraction);
    const result = seismicForces(sp, Ws.map((W, k) => ({ z: zs[k + 1], W })));
    const levels = result.levels.map((l, k) => ({
      id: wind[k].id, z: l.z, W: l.W, Cvx: l.Cvx, F: l.F,
      MzX: p.diaphragm ? l.F * sp.eccentricity * By : 0,
      MzY: p.diaphragm ? -l.F * sp.eccentricity * Bx : 0,
    }));
    seismic = { result, levels, Bx, By };
    // สเปกตรัมการตอบสนอง: แทนผล EX/EY ด้วย RSA ตอนวิเคราะห์ (ต้องมีพื้นแข็ง)
    if (sp.method === "RSA" && p.diaphragm) {
      const sc = result.spec;
      model.rsa = { weights: Ws, Bx, By, SDS: sc.SDS, SD1: sc.SD1, T0: sc.T0, Ts: sc.Ts, Ie: sp.Ie, R: sp.R, Vstatic: result.V, minScale: sp.rsaMinScale ?? 0.85 };
    }
    const el = (dir: "X" | "Y"): LoadCase3 => ({
      id: `E${dir}`, name: `แผ่นดินไหว มยผ.1301/1302 (+${dir})`, selfWeight: false, lateral: true,
      loads: levels.map((l) => ({ type: "nodal" as const, node: l.id, fx: dir === "X" ? +l.F.toFixed(3) : 0, fy: dir === "Y" ? +l.F.toFixed(3) : 0, fz: 0, mx: 0, my: 0, mz: +(dir === "X" ? l.MzX : l.MzY).toFixed(3) })),
    });
    model.loadCases.push(el("X"), el("Y"));
  }
  model.combos = p.combos?.length
    ? p.combos.map((cb) => ({ ...cb, factors: Object.fromEntries(Object.entries(cb.factors).filter(([k]) => model.loadCases.some((lc) => lc.id === k))) }))
    : standardCombos3(code, !!seismic);
  return { model, wind, seismic };
}

// ---------- ตัวอย่างอาคาร 3 แบบ ----------
import type { FoundationSettings } from "../design/footing.ts";

export interface Example3D { id: string; label: string; desc: string; params: GridParams; foundation: Partial<FoundationSettings> }

export const EXAMPLES_3D: Example3D[] = [
  {
    id: "house", label: "บ้านพักอาศัย 2 ชั้น", desc: "3×2 ช่วง ฐานแผ่บนดิน qa 10 t/m²",
    params: {
      ...defaultGrid, name: "บ้านพักอาศัย 2 ชั้น (ตัวอย่าง)",
      xSpacing: "4,4.5,4", ySpacing: "4,3.5", storeys: "3.2,3.0",
      col: { b: 0.2, h: 0.2 }, beam: { b: 0.2, h: 0.4 }, fcKsc: 240, fyKsc: 4000, fytKsc: 2400,
      sdl: 9, ll: 4, sdlRoof: 4, llRoof: 1,
      wind: { ...defaultWind, exposure: "B" },
    },
    foundation: { type: "spread", qaTon: 10, Df: 1.2, ratio: 1 },
  },
  {
    id: "shophouse", label: "อาคารพาณิชย์ 4 ชั้น 3 คูหา", desc: "คูหาละ 4 m ลึก 16 m ฐานเข็ม 25 ตัน",
    params: {
      ...defaultGrid, name: "อาคารพาณิชย์ 4 ชั้น 3 คูหา (ตัวอย่าง)",
      xSpacing: "3@4", ySpacing: "4@4", storeys: "3.8,3@3.3",
      col: { b: 0.3, h: 0.3 }, beam: { b: 0.25, h: 0.5 }, fcKsc: 280, fyKsc: 4000, fytKsc: 2400,
      sdl: 14, ll: 8, sdlRoof: 6, llRoof: 2,
      wind: { ...defaultWind, exposure: "B" },
    },
    foundation: { type: "pile", pileTon: 25, pileSize: 0.22, pileSpacingFactor: 3, Df: 1.5 },
  },
  {
    id: "office", label: "อาคารสำนักงาน 8 ชั้น", desc: "4×3 ช่วง 8 m ลมกลุ่ม 2 ความสำคัญมาก ฐานเข็ม 80 ตัน",
    params: {
      ...defaultGrid, name: "อาคารสำนักงาน 8 ชั้น (ตัวอย่าง)",
      xSpacing: "4@8", ySpacing: "3@8", storeys: "4.5,7@3.6",
      col: { b: 0.7, h: 0.7 }, beam: { b: 0.35, h: 0.8 }, fcKsc: 320, fyKsc: 4000, fytKsc: 2400,
      sdl: 28, ll: 20, sdlRoof: 12, llRoof: 5,
      wind: { ...defaultWind, zone: "2", V50: 27, TF: 1.0, importance: "high", Iw: 1.15, exposure: "B" },
    },
    foundation: { type: "pile", pileTon: 80, pileSize: 0.4, pileSpacingFactor: 3, Df: 2.0 },
  },
];

// ---------- แก้ไขรายชิ้นในหน้า 3D ----------
export type EditScope = "member" | "floor" | "line";
const MEMBER_RE = /^(C|BX|BY|KX|KY)-([A-Z])(\d+)-(\d+)$/;

/** ชิ้นส่วนที่อยู่ในขอบเขตเดียวกับชิ้นที่เลือก
 *  floor = ชนิดเดียวกันในชั้นเดียวกัน (คาน: ทั้ง BX และ BY), line = คาน: แนวกริดเดียวกันทุกชั้น · เสา: ต้นเดียวกันทุกชั้น */
export function membersInScope(ids: string[], id: string, scope: EditScope): string[] {
  const m = id.match(MEMBER_RE);
  if (!m || scope === "member") return [id];
  const [, t, J, I, K] = m;
  const col = t === "C";
  return ids.filter((x) => {
    const n = x.match(MEMBER_RE);
    if (!n || (n[1] === "C") !== col) return false;
    if (scope === "floor") return n[4] === K;
    if (col) return n[2] === J && n[3] === I;
    return n[1] === t && (t === "BX" || t === "KX" ? n[2] === J : n[3] === I);
  });
}

export const scopeLabel = (id: string, scope: EditScope) => {
  const col = id.startsWith("C-");
  if (scope === "member") return col ? "เสาต้นนี้" : "คานตัวนี้";
  if (scope === "floor") return col ? "เสาทั้งชั้นนี้" : "คานทั้งชั้นนี้";
  return col ? "เสาต้นนี้ทุกชั้น" : "คานทั้งแนวกริดนี้ทุกชั้น";
};

export function effectiveSize(p: GridParams, id: string) {
  return p.overrides?.size?.[id] ?? defaultSize(p, id);
}
export function defaultLoad(p: GridParams, id: string) {
  const top = parseSpacing(p.storeys).length;
  const lvl = +(id.split("-").pop() ?? 0);
  if (lvl === 0) return { sdl: { ...defaultTie, ...(p.tieBeam ?? {}) }.sdl, ll: 0 };
  const roof = lvl === top;
  const sl = slabLineLoad(p, id);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { sdl: r3((roof ? p.sdlRoof : p.sdl) + sl.sdl), ll: r3((roof ? p.llRoof : p.ll) + sl.ll) };
}
export function effectiveLoad(p: GridParams, id: string) {
  return p.overrides?.load?.[id] ?? defaultLoad(p, id);
}

/** ตั้งค่าปรับให้หลายชิ้น — null = คืนค่าตามทั้งอาคาร; ค่าที่เท่าค่าทั้งอาคารจะไม่เก็บ */
export function applyOverride(p: GridParams, ids: string[], patch: { size?: { b: number; h: number } | null; load?: { sdl: number; ll: number } | null }): GridParams {
  const size = { ...(p.overrides?.size ?? {}) };
  const load = { ...(p.overrides?.load ?? {}) };
  for (const id of ids) {
    if (patch.size !== undefined) {
      const def = defaultSize(p, id);
      const s = patch.size;
      if (!s || (Math.abs(s.b - def.b) < 1e-6 && Math.abs(s.h - def.h) < 1e-6)) delete size[id];
      else size[id] = { b: s.b, h: s.h };
    }
    if (patch.load !== undefined && !id.startsWith("C-")) {
      const def = defaultLoad(p, id);
      const l = patch.load;
      if (!l || (Math.abs(l.sdl - def.sdl) < 1e-6 && Math.abs(l.ll - def.ll) < 1e-6)) delete load[id];
      else load[id] = { sdl: l.sdl, ll: l.ll };
    }
  }
  const overrides: MemberOverrides = {};
  if (Object.keys(size).length) overrides.size = size;
  if (Object.keys(load).length) overrides.load = load;
  return { ...p, overrides: Object.keys(overrides).length ? overrides : undefined };
}
