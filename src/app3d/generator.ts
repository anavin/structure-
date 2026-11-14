// สร้างโมเดลอาคาร 3D จากกริด: เสา คาน diaphragm น้ำหนักบรรทุก แรงลม 2 ทิศ และชุดผสม
// แรงลมใช้ มยผ. 1311-50 วิธีอย่างง่าย (เดียวกับโหมด 2D) กระทำที่จุดอ้างอิง diaphragm ของแต่ละชั้น

import { concreteE } from "../core/model.ts";
import { autoDiaphragms, type Combo3, type LoadCase3, type Model3 } from "../core3d/model3d.ts";
import { defaultWind, exposureFactor, refPressure, type WindSettings } from "../loads/windTH.ts";

export interface GridParams {
  name: string;
  xSpacing: string; // เช่น "3@5" หรือ "5,4,5"
  ySpacing: string;
  storeys: string; // เช่น "4,3@3.5" (ชั้นล่างสุดก่อน)
  col: { b: number; h: number };
  beam: { b: number; h: number };
  fcKsc: number; fyKsc: number;
  /** น้ำหนักบรรทุกคงที่เพิ่มเติมบนคาน (kN/m) และน้ำหนักจร (kN/m) */
  sdl: number; ll: number;
  /** หลังคา (ชั้นบนสุด) */
  sdlRoof: number; llRoof: number;
  wind: WindSettings;
  diaphragm: boolean;
  /** วิเคราะห์อันดับสอง P-Delta + หน้าตัดแตกร้าว */
  pDelta: boolean;
  cracked: boolean;
}

export const defaultGrid: GridParams = {
  name: "อาคาร ค.ส.ล. 3D (ตัวอย่าง)",
  xSpacing: "3@5", ySpacing: "2@4.5", storeys: "4,3@3.5",
  col: { b: 0.4, h: 0.4 }, beam: { b: 0.25, h: 0.5 },
  fcKsc: 280, fyKsc: 4000,
  sdl: 15, ll: 8, sdlRoof: 8, llRoof: 2,
  wind: { ...defaultWind },
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

export function generateBuilding(p: GridParams): { model: Model3; wind: WindLevel3[] } {
  const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing), dz = parseSpacing(p.storeys);
  const xs = cumsum(dx), ys = cumsum(dy), zs = cumsum(dz);
  const nid = (i: number, j: number, k: number) => `${String.fromCharCode(65 + j)}${i + 1}-${k}`; // กริด A1-0 …
  const nodes: Model3["nodes"] = [];
  for (let k = 0; k < zs.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) nodes.push({ id: nid(i, j, k), x: xs[i], y: ys[j], z: zs[k] });
  const members: Model3["members"] = [];
  for (let k = 0; k < dz.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
    members.push({ id: `C-${nid(i, j, k)}`, i: nid(i, j, k), j: nid(i, j, k + 1), section: "COL", kind: "column" });
  }
  for (let k = 1; k < zs.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
    if (i < dx.length) members.push({ id: `BX-${nid(i, j, k)}`, i: nid(i, j, k), j: nid(i + 1, j, k), section: "BEAM", kind: "beam" });
    if (j < dy.length) members.push({ id: `BY-${nid(i, j, k)}`, i: nid(i, j, k), j: nid(i, j + 1, k), section: "BEAM", kind: "beam" });
  }
  const supports = [];
  for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) supports.push({ node: nid(i, j, 0), ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });

  const model: Model3 = {
    name: p.name, nodes, members, supports,
    materials: [{ id: "CONC", name: `คอนกรีต fc' ${p.fcKsc} ksc`, E: concreteE(p.fcKsc), nu: 0.2, gamma: 24, fc: p.fcKsc, fy: p.fyKsc, fyt: 2400 }],
    sections: [
      { id: "COL", name: `เสา ${p.col.b * 100}×${p.col.h * 100}`, material: "CONC", b: p.col.b, h: p.col.h },
      { id: "BEAM", name: `คาน ${p.beam.b * 100}×${p.beam.h * 100}`, material: "CONC", b: p.beam.b, h: p.beam.h },
    ],
    loadCases: [], combos: [],
  };
  if (p.diaphragm) model.diaphragms = autoDiaphragms(model);
  model.analysis = { pDelta: p.pDelta ?? false, cracked: p.cracked ?? false };

  const top = zs.length - 1;
  const beamLoads = (floor: number, roof: number) => members.filter((m) => m.kind === "beam").map((m) => {
    const lvl = +m.i.split("-")[1];
    return { type: "udl" as const, member: m.id, dir: "GZ" as const, w: -(lvl === top ? roof : floor) };
  });
  const wind = windStoreys(zs.slice(1), xs[xs.length - 1], ys[ys.length - 1], p.wind,
    zs.slice(1).map((_, k) => model.diaphragms?.[k]?.id ?? nid(0, 0, k + 1)));
  // ถ้าไม่มี diaphragm ใส่แรงลมที่มุมกริด A1 ของแต่ละชั้น
  const wl = (dir: "X" | "Y"): LoadCase3 => ({
    id: `W${dir}`, name: `ลม มยผ.1311-50 (+${dir})`, selfWeight: false, lateral: true,
    loads: wind.map((l) => ({ type: "nodal" as const, node: l.id, fx: dir === "X" ? +l.FX.toFixed(3) : 0, fy: dir === "Y" ? +l.FY.toFixed(3) : 0, fz: 0, mx: 0, my: 0, mz: 0 })),
  });
  model.loadCases = [
    { id: "DL", name: "น้ำหนักคงที่ (รวมน้ำหนักตัวเอง)", selfWeight: true, loads: beamLoads(p.sdl, p.sdlRoof) },
    { id: "LL", name: "น้ำหนักจร", selfWeight: false, loads: beamLoads(p.ll, p.llRoof) },
    wl("X"), wl("Y"),
  ];
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
  return { model, wind };
}
