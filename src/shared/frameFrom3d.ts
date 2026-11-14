// ตัดโครง 2D จากอาคาร 3D ตามแนวกริดของชิ้นส่วนที่เลือก (เพื่อเปิดแก้ไข/ตรวจในหน้า 2D)
//   คาน BX-… → โครงแนว X ที่กริดแถวนั้น, คาน BY-… → โครงแนว Y ที่กริดคอลัมน์นั้น, เสา → เลือกแนว X หรือ Y
//   คงชื่อจุดต่อ/ชิ้นส่วนเดิมของ 3D เพื่อให้หาชิ้นที่เลือกได้ทันที
//   น้ำหนักบนคาน = ค่าเดียวกับ 3D, แรงลม = มยผ. 1311-50 ด้วยความกว้างรับลม = ครึ่งช่วงสองข้างของแนวกริด
//   แรงแผ่นดินไหว (ถ้าเปิด) = แรงรายชั้นของอาคาร × ความกว้างรับแรง / ความกว้างอาคาร (ไม่รวมแรงบิด)

import { concreteE, type Model } from "../core/model.ts";
import { applyWind } from "../loads/windTH.ts";
import { generateBuilding, parseSpacing, type GridParams } from "../app3d/generator.ts";

export const FRAME_KEY = "structlab.frame3d.v1";
export const BACKUP_KEY = "structlab.project.backup.v1";

export type FrameDir = "X" | "Y";
export interface FrameRef { dir: FrameDir; line: number }
export interface FramePayload { model: Model; select: string; label: string; t: number }

const cumsum = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);
const gridLetter = (j: number) => String.fromCharCode(65 + j);

/** หาแนวโครงจากชื่อชิ้นส่วน 3D (BX-B2-1, BY-A3-2, C-C1-0) — เสาใช้ทิศที่ระบุ (ค่าตั้งต้น X) */
export function frameOfMember(id: string, colDir: FrameDir = "X"): FrameRef | null {
  const m = id.match(/^(BX|BY|C)-([A-Z])(\d+)-\d+$/);
  if (!m) return null;
  const j = m[2].charCodeAt(0) - 65, i = +m[3] - 1;
  const dir: FrameDir = m[1] === "BX" ? "X" : m[1] === "BY" ? "Y" : colDir;
  return dir === "X" ? { dir, line: j } : { dir, line: i };
}

export const frameLabel = (f: FrameRef) => (f.dir === "X" ? `แนวกริด ${gridLetter(f.line)} (ตามแกน X)` : `แนวกริด ${f.line + 1} (ตามแกน Y)`);

export function frameFrom3D(p: GridParams, f: FrameRef): Model {
  const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing), dz = parseSpacing(p.storeys);
  const xs = cumsum(dx), ys = cumsum(dy), zs = cumsum(dz);
  const along = f.dir === "X" ? xs : ys;
  const perp = f.dir === "X" ? dy : dx;
  const nPerp = perp.length + 1;
  if (f.line < 0 || f.line >= nPerp) throw new Error("แนวกริดไม่ถูกต้อง");
  // ความกว้างรับน้ำหนักด้านข้าง = ครึ่งช่วงสองข้าง
  const trib = ((perp[f.line - 1] ?? 0) + (perp[f.line] ?? 0)) / 2;
  const Bperp = perp.reduce((a, v) => a + v, 0);
  const nid = (a: number, k: number) => (f.dir === "X" ? `${gridLetter(f.line)}${a + 1}-${k}` : `${gridLetter(a)}${f.line + 1}-${k}`);

  const nodes: Model["nodes"] = [];
  for (let k = 0; k < zs.length; k++) for (let a = 0; a < along.length; a++) nodes.push({ id: nid(a, k), x: along[a], y: zs[k] });
  const members: Model["members"] = [];
  for (let k = 0; k < dz.length; k++) for (let a = 0; a < along.length; a++) members.push({ id: `C-${nid(a, k)}`, i: nid(a, k), j: nid(a, k + 1), section: "COL", kind: "column" });
  const beamIds: string[][] = [];
  for (let k = 1; k < zs.length; k++) {
    const row: string[] = [];
    for (let a = 0; a < along.length - 1; a++) {
      const id = `B${f.dir}-${nid(a, k)}`;
      row.push(id);
      members.push({ id, i: nid(a, k), j: nid(a + 1, k), section: "BEAM", kind: "beam" });
    }
    beamIds.push(row);
  }
  const top = beamIds.length - 1;
  const udl = (floor: number, roof: number) => beamIds.flatMap((row, l) => row.map((m) => ({ type: "udl" as const, member: m, dir: "globalY" as const, w: -(l === top ? roof : floor) })));
  // หน้าตัด: เสา 3D มี h ตามแกน X → โครงแนว Y ใช้ด้าน b เป็นความลึก
  const colB = f.dir === "X" ? p.col.b : p.col.h, colH = f.dir === "X" ? p.col.h : p.col.b;
  const cm = (v: number) => Math.round(v * 100);
  const m: Model = {
    name: `${p.name} — โครง${frameLabel(f)}`,
    info: p.info,
    nodes, members,
    supports: along.map((_, a) => ({ node: nid(a, 0), ux: true, uy: true, rz: true })),
    materials: [{ id: "CONC", name: `คอนกรีต fc' ${p.fcKsc} ksc`, E: concreteE(p.fcKsc), gamma: 24, fc: p.fcKsc, fy: p.fyKsc, fyt: p.fytKsc ?? 2400 }],
    sections: [
      { id: "BEAM", name: `คาน ${cm(p.beam.b)}×${cm(p.beam.h)}`, material: "CONC", b: p.beam.b, h: p.beam.h },
      { id: "COL", name: `เสา ${cm(colB)}×${cm(colH)}`, material: "CONC", b: colB, h: colH },
    ],
    loadCases: [
      { id: "DL", name: "น้ำหนักคงที่ (รวมน้ำหนักตัวเอง)", selfWeight: true, loads: udl(p.sdl, p.sdlRoof) },
      { id: "LL", name: "น้ำหนักจร", selfWeight: false, loads: udl(p.ll, p.llRoof) },
    ],
    combos: [],
    analysis: { pDelta: p.pDelta, cracked: p.cracked },
  };
  applyWind(m, { ...p.wind, spacing: +trib.toFixed(3) });
  const c = (id: string, name: string, factors: Record<string, number>) => ({ id, name, factors });
  m.combos = [
    c("U1", "1.4D + 1.7L", { DL: 1.4, LL: 1.7 }),
    c("U2", "0.75(1.4D + 1.7L + 1.7W)", { DL: 1.05, LL: 1.275, WX: 1.275 }),
    c("U3", "0.75(1.4D + 1.7L − 1.7W)", { DL: 1.05, LL: 1.275, WXN: 1.275 }),
    c("U4", "0.9D + 1.3W", { DL: 0.9, WX: 1.3 }),
    c("U5", "0.9D − 1.3W", { DL: 0.9, WXN: 1.3 }),
  ];
  const eq = p.seismic?.enabled ? generateBuilding(p).seismic : null;
  if (eq) {
    const share = Bperp > 0 ? trib / Bperp : 0;
    m.loadCases.push({
      id: "EX", name: `แผ่นดินไหว (ส่วนของโครงนี้ ${(share * 100).toFixed(1)}%)`, selfWeight: false, lateral: true,
      loads: eq.levels.map((l, k) => ({ type: "nodal" as const, node: nid(0, k + 1), fx: +(l.F * share).toFixed(3), fy: 0, mz: 0 })),
    });
    m.combos.push(
      c("U6", "0.75(1.4D + 1.7L + 1.87E)", { DL: 1.05, LL: 1.275, EX: 1.4025 }),
      c("U7", "0.75(1.4D + 1.7L − 1.87E)", { DL: 1.05, LL: 1.275, EX: -1.4025 }),
      c("U8", "0.9D + 1.43E", { DL: 0.9, EX: 1.43 }),
      c("U9", "0.9D − 1.43E", { DL: 0.9, EX: -1.43 }),
    );
  }
  return m;
}

/** หน้า 3D: เก็บโครงที่ตัดไว้ให้หน้า 2D เปิด */
export function sendFrameTo2D(p: GridParams, memberId: string, colDir: FrameDir = "X"): boolean {
  const f = frameOfMember(memberId, colDir);
  if (!f) return false;
  const payload: FramePayload = { model: frameFrom3D(p, f), select: memberId.startsWith("C-") || memberId.startsWith(`B${f.dir}-`) ? memberId : "", label: frameLabel(f), t: Date.now() };
  try { localStorage.setItem(FRAME_KEY, JSON.stringify(payload)); return true; } catch { return false; }
}

/** หน้า 2D: รับโครงจาก 3D (ครั้งเดียว) */
export function takeFrameFrom3D(): FramePayload | null {
  try {
    const raw = localStorage.getItem(FRAME_KEY);
    if (!raw) return null;
    localStorage.removeItem(FRAME_KEY);
    return JSON.parse(raw) as FramePayload;
  } catch { return null; }
}
