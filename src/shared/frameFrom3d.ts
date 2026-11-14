// โครง 2D ที่เชื่อมกับอาคาร 3D ตามแนวกริด (สองทาง)
//   3D → 2D: ตัดโครงตามแนวกริดของชิ้นที่เลือก คงชื่อจุดต่อ/ชิ้นส่วนเดิม และสร้างใหม่อัตโนมัติเมื่ออาคาร 3D เปลี่ยน
//   2D → 3D: แก้ขนาดหน้าตัดของชิ้น หรือน้ำหนักแผ่บนคาน (DL/LL) ในโครง 2D → บันทึกเป็นค่าปรับรายชิ้นของอาคาร 3D
//   แรงลม = มยผ. 1311-50 ด้วยความกว้างรับลม = ครึ่งช่วงสองข้างของแนวกริด
//   แรงแผ่นดินไหว (ถ้าเปิด) = แรงรายชั้นของอาคาร × ความกว้างรับแรง / ความกว้างอาคาร (ไม่รวมแรงบิด)
//   ไม่ส่งกลับ: การแก้รูปทรง (ย้าย/เพิ่ม/ลบจุดต่อหรือชิ้นส่วน), แรงชนิดอื่น, load case/ชุดผสมที่เพิ่มเอง

import { concreteE, type Model } from "../core/model.ts";
import { applyWind } from "../loads/windTH.ts";
import { defaultSeismic } from "../loads/seismicTH.ts";
import { defaultGrid, defaultLoad, defaultSize, defaultTie, generateBuilding, parseSpacing, sizeSecId, sizeSecName, type GridParams, type MemberOverrides } from "../app3d/generator.ts";

export const PARAMS3D_KEY = "structlab.3d.params.v1";
export const FRAME_KEY = "structlab.frame3d.v1";
export const BACKUP_KEY = "structlab.project.backup.v1";

export type FrameDir = "X" | "Y";
export interface FrameRef { dir: FrameDir; line: number }
export interface FramePayload { model: Model; select: string; label: string; t: number }

const cumsum = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);
const gridLetter = (j: number) => String.fromCharCode(65 + j);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** พารามิเตอร์อาคาร 3D ที่บันทึกไว้ (เติมค่าตั้งต้น) */
export function parseParams3D(raw: string | null): GridParams {
  if (!raw) return structuredClone(defaultGrid);
  const p = JSON.parse(raw);
  return { ...defaultGrid, ...p, wind: { ...defaultGrid.wind, ...(p.wind ?? {}) }, seismic: { ...defaultSeismic, ...(p.seismic ?? {}) }, tieBeam: { ...defaultTie, ...(p.tieBeam ?? {}) } };
}
export function readParams3DRaw(): string | null {
  try { return localStorage.getItem(PARAMS3D_KEY); } catch { return null; }
}

/** หาแนวโครงจากชื่อชิ้นส่วน 3D (BX-B2-1, BY-A3-2, C-C1-0) — เสาใช้ทิศที่ระบุ (ค่าตั้งต้น X) */
export function frameOfMember(id: string, colDir: FrameDir = "X"): FrameRef | null {
  const m = id.match(/^(BX|BY|C)-([A-Z])(\d+)-\d+$/);
  if (!m) return null;
  const j = m[2].charCodeAt(0) - 65, i = +m[3] - 1;
  const dir: FrameDir = m[1] === "BX" ? "X" : m[1] === "BY" ? "Y" : colDir;
  return dir === "X" ? { dir, line: j } : { dir, line: i };
}

export const frameLabel = (f: FrameRef) => (f.dir === "X" ? `แนวกริด ${gridLetter(f.line)} (ตามแกน X)` : `แนวกริด ${f.line + 1} (ตามแกน Y)`);

/** ขนาดหน้าตัดในโครง 2D ↔ 3D: เสาในโครงแนว Y สลับ b/h (เสา 3D มี h ตามแกน X) */
const to2D = (dir: FrameDir, kind: string, s: { b: number; h: number }) => (kind === "column" && dir === "Y" ? { b: s.h, h: s.b } : s);
const to3D = to2D; // สลับกลับแบบเดียวกัน

export function frameFrom3D(p: GridParams, f: FrameRef, sig = ""): Model {
  const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing), dz = parseSpacing(p.storeys);
  const xs = cumsum(dx), ys = cumsum(dy), zs = cumsum(dz);
  const along = f.dir === "X" ? xs : ys;
  const perp = f.dir === "X" ? dy : dx;
  const nPerp = perp.length + 1;
  if (f.line < 0 || f.line >= nPerp) throw new Error(`ไม่มี${frameLabel(f)}ในอาคาร 3D แล้ว`);
  const trib = ((perp[f.line - 1] ?? 0) + (perp[f.line] ?? 0)) / 2;
  const Bperp = perp.reduce((a, v) => a + v, 0);
  const nid = (a: number, k: number) => (f.dir === "X" ? `${gridLetter(f.line)}${a + 1}-${k}` : `${gridLetter(a)}${f.line + 1}-${k}`);
  const ov = p.overrides ?? {};

  const sections: Model["sections"] = [];
  const secFor = (memberId: string, kind: "column" | "beam") => {
    const s3 = ov.size?.[memberId] ?? defaultSize(p, memberId);
    const s2 = to2D(f.dir, kind, s3);
    const id = sizeSecId(kind, s2.b, s2.h);
    if (!sections.some((s) => s.id === id)) sections.push({ id, name: sizeSecName(kind, s2.b, s2.h), material: "CONC", b: s2.b, h: s2.h });
    return id;
  };

  const nodes: Model["nodes"] = [];
  for (let k = 0; k < zs.length; k++) for (let a = 0; a < along.length; a++) nodes.push({ id: nid(a, k), x: along[a], y: zs[k] });
  const members: Model["members"] = [];
  for (let k = 0; k < dz.length; k++) for (let a = 0; a < along.length; a++) {
    const id = `C-${nid(a, k)}`;
    members.push({ id, i: nid(a, k), j: nid(a, k + 1), section: secFor(id, "column"), kind: "column" });
  }
  const tie = { ...defaultTie, ...(p.tieBeam ?? {}) };
  const beams: { id: string }[] = [];
  for (let k = tie.enabled ? 0 : 1; k < zs.length; k++) for (let a = 0; a < along.length - 1; a++) {
    const id = `B${f.dir}-${nid(a, k)}`;
    beams.push({ id });
    members.push({ id, i: nid(a, k), j: nid(a + 1, k), section: secFor(id, "beam"), kind: "beam" });
  }
  const udl = (key: "sdl" | "ll") => beams.map((b) => {
    const w = ov.load?.[b.id]?.[key] ?? defaultLoad(p, b.id)[key];
    return { type: "udl" as const, member: b.id, dir: "globalY" as const, w: -w };
  }).filter((l) => l.w !== 0);
  const m: Model = {
    name: `${p.name.replace(/ — โครงแนวกริด.*$/, "")} — โครง${frameLabel(f)}`,
    info: p.info,
    nodes, members,
    // มีคานคอดิน → ฐานหมุนได้ (โมเมนต์ไปที่คานคอดิน)
    supports: along.map((_, a) => ({ node: nid(a, 0), ux: true, uy: true, rz: !tie.enabled })),
    materials: [{ id: "CONC", name: `คอนกรีต fc' ${p.fcKsc} ksc`, E: concreteE(p.fcKsc), gamma: 24, fc: p.fcKsc, fy: p.fyKsc, fyt: p.fytKsc ?? 2400 }],
    sections,
    loadCases: [
      { id: "DL", name: "น้ำหนักคงที่ (รวมน้ำหนักตัวเอง)", selfWeight: true, loads: udl("sdl") },
      { id: "LL", name: "น้ำหนักจร", selfWeight: false, loads: udl("ll") },
    ],
    combos: [],
    analysis: { pDelta: p.pDelta, cracked: p.cracked },
    link3d: { dir: f.dir, line: f.line, sig },
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

/** 2D → 3D: ค่าปรับรายชิ้นจากโครง 2D (หน้าตัดของชิ้น + น้ำหนักแผ่บนคานใน DL/LL) รวมกับค่าปรับเดิมของแนวอื่น */
export function overridesFrom2D(p: GridParams, m: Model): MemberOverrides {
  const size = { ...(p.overrides?.size ?? {}) };
  const load = { ...(p.overrides?.load ?? {}) };
  const dir = m.link3d?.dir ?? "X";
  const secs = new Map(m.sections.map((s) => [s.id, s]));
  for (const mem of m.members) {
    if (!/^(BX|BY|C)-[A-Z]\d+-\d+$/.test(mem.id)) continue;
    const kind = mem.kind === "column" ? "column" : "beam";
    const sec = secs.get(mem.section);
    if (sec) {
      const s3 = to3D(dir, kind, { b: r4(sec.b), h: r4(sec.h) });
      const def = defaultSize(p, mem.id);
      if (Math.abs(s3.b - def.b) < 1e-6 && Math.abs(s3.h - def.h) < 1e-6) delete size[mem.id];
      else size[mem.id] = s3;
    }
    if (kind === "beam") {
      const sum = (caseId: string) => r4(-(m.loadCases.find((c) => c.id === caseId)?.loads ?? [])
        .filter((l) => l.type === "udl" && l.member === mem.id && l.dir === "globalY")
        .reduce((a, l) => a + (l.type === "udl" ? l.w : 0), 0));
      const sdl = sum("DL"), ll = sum("LL");
      const { sdl: dS, ll: dL } = defaultLoad(p, mem.id);
      if (Math.abs(sdl - dS) < 1e-6 && Math.abs(ll - dL) < 1e-6) delete load[mem.id];
      else load[mem.id] = { sdl, ll };
    }
  }
  const out: MemberOverrides = {};
  if (Object.keys(size).length) out.size = size;
  if (Object.keys(load).length) out.load = load;
  return out;
}

/** หน้า 2D: ส่งการแก้ไขของโครงที่เชื่อมอยู่กลับไปอาคาร 3D (คืนค่า true ถ้าเขียนจริง) */
export function pushFrameTo3D(m: Model): boolean {
  if (!m.link3d) return false;
  const raw = readParams3DRaw();
  const p = parseParams3D(raw);
  const next = overridesFrom2D(p, m);
  if (JSON.stringify(next) === JSON.stringify(p.overrides ?? {})) { m.link3d.sig = raw ?? ""; return false; }
  const p2: GridParams = { ...p, overrides: next };
  const s = JSON.stringify(p2);
  try { localStorage.setItem(PARAMS3D_KEY, s); } catch { return false; }
  m.link3d.sig = s;
  return true;
}

/** เทียบรูปทรงสองโมเดล (จุดต่อ + ชิ้นส่วน) */
export function sameGeometry(a: Model, b: Model) {
  const g = (m: Model) => JSON.stringify([m.nodes.map((n) => [n.id, r4(n.x), r4(n.y)]).sort(), m.members.map((x) => [x.id, x.i, x.j]).sort()]);
  return g(a) === g(b);
}

/** หน้า 2D: ถ้าอาคาร 3D เปลี่ยนตั้งแต่สร้างโครงนี้ → คืนโครงใหม่ (null = ไม่เปลี่ยน) */
export function refreshFrameFrom3D(m: Model): { model: Model } | { error: string } | null {
  if (!m.link3d) return null;
  const raw = readParams3DRaw();
  if ((raw ?? "") === m.link3d.sig) return null;
  try {
    const next = frameFrom3D(parseParams3D(raw), m.link3d, raw ?? "");
    return { model: next };
  } catch (e) { return { error: (e as Error).message }; }
}

/** หน้า 3D: เก็บโครงที่ตัดไว้ให้หน้า 2D เปิด */
export function sendFrameTo2D(p: GridParams, memberId: string, colDir: FrameDir = "X"): boolean {
  const f = frameOfMember(memberId, colDir);
  if (!f) return false;
  const raw = JSON.stringify(p);
  try { localStorage.setItem(PARAMS3D_KEY, raw); } catch { /* ไม่มี storage */ }
  const payload: FramePayload = { model: frameFrom3D(p, f, raw), select: memberId.startsWith("C-") || memberId.startsWith(`B${f.dir}-`) ? memberId : "", label: frameLabel(f), t: Date.now() };
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
