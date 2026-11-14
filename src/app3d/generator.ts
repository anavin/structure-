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
  return dz.map((_, k) => {
    const roof = k === dz.length - 1;
    const sdl = roof ? p.sdlRoof : p.sdl, ll = roof ? p.llRoof : p.ll;
    const cols = wCol * (dz[k] / 2 + (roof ? 0 : dz[k + 1] / 2));
    return (wBeam + sdl + llFraction * ll) * Lbeam + cols;
  });
}

export function generateBuilding(p: GridParams): { model: Model3; wind: WindLevel3[]; seismic: Seismic3 | null } {
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
  // มีคานคอดิน → ฐานหมุนได้รอบแกนนอน (โมเมนต์ที่ฐานไปที่คานคอดิน) · ไม่มี → ยึดแน่น
  const supports = [];
  for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) supports.push({ node: nid(i, j, 0), ux: true, uy: true, uz: true, rx: !tie.enabled, ry: !tie.enabled, rz: true });

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
    zs.slice(1).map((_, k) => model.diaphragms?.[k]?.id ?? nid(0, 0, k + 1)));
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
    const el = (dir: "X" | "Y"): LoadCase3 => ({
      id: `E${dir}`, name: `แผ่นดินไหว มยผ.1301/1302 (+${dir})`, selfWeight: false, lateral: true,
      loads: levels.map((l) => ({ type: "nodal" as const, node: l.id, fx: dir === "X" ? +l.F.toFixed(3) : 0, fy: dir === "Y" ? +l.F.toFixed(3) : 0, fz: 0, mx: 0, my: 0, mz: +(dir === "X" ? l.MzX : l.MzY).toFixed(3) })),
    });
    model.loadCases.push(el("X"), el("Y"));
  }
  const c = (id: string, name: string, f: Record<string, number>): Combo3 => ({ id, name, factors: f });
  model.combos = [
    c("U1", "1.4D + 1.7L", { DL: 1.4, LL: 1.7 }),
    c("U2", "0.75(1.4D + 1.7L + 1.7WX)", { DL: 1.05, LL: 1.275, WX: 1.275 }),
    c("U3", "0.75(1.4D + 1.7L − 1.7WX)", { DL: 1.05, LL: 1.275, WX: -1.275 }),
    c("U4", "0.75(1.4D + 1.7L + 1.7WY)", { DL: 1.05, LL: 1.275, WY: 1.275 }),
    c("U5", "0.75(1.4D + 1.7L − 1.7WY)", { DL: 1.05, LL: 1.275, WY: -1.275 }),
    c("U6", "0.9D + 1.3WX", { DL: 0.9, WX: 1.3 }),
    c("U7", "0.9D − 1.3WX", { DL: 0.9, WX: -1.3 }),
    c("U8", "0.9D + 1.3WY", { DL: 0.9, WY: 1.3 }),
    c("U9", "0.9D − 1.3WY", { DL: 0.9, WY: -1.3 }),
  ];
  if (seismic) {
    // วสท. 1008-38: U = 0.75(1.4D + 1.7L ± 1.87E), U = 0.9D ± 1.43E
    let n = 10;
    for (const d of ["X", "Y"] as const) for (const sg of [1, -1]) {
      model.combos.push(c(`U${n++}`, `0.75(1.4D + 1.7L ${sg > 0 ? "+" : "−"} 1.87E${d})`, { DL: 1.05, LL: 1.275, [`E${d}`]: sg * 1.4025 }));
    }
    for (const d of ["X", "Y"] as const) for (const sg of [1, -1]) {
      model.combos.push(c(`U${n++}`, `0.9D ${sg > 0 ? "+" : "−"} 1.43E${d}`, { DL: 0.9, [`E${d}`]: sg * 1.43 }));
    }
  }
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
const MEMBER_RE = /^(C|BX|BY)-([A-Z])(\d+)-(\d+)$/;

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
    return n[1] === t && (t === "BX" ? n[2] === J : n[3] === I);
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
  return { sdl: roof ? p.sdlRoof : p.sdl, ll: roof ? p.llRoof : p.ll };
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
