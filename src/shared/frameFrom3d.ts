// โครง 2D ที่เชื่อมกับอาคาร 3D ตามแนวกริด (สองทาง)
//   3D → 2D: ตัดโครงตามแนวกริดของชิ้นที่เลือก คงชื่อจุดต่อ/ชิ้นส่วนเดิม และสร้างใหม่อัตโนมัติเมื่ออาคาร 3D เปลี่ยน
//   2D → 3D: แก้ขนาดหน้าตัดของชิ้น หรือน้ำหนักแผ่บนคาน (DL/LL) ในโครง 2D → บันทึกเป็นค่าปรับรายชิ้นของอาคาร 3D
//   แรงลม = มยผ. 1311-50 ด้วยความกว้างรับลม = ครึ่งช่วงสองข้างของแนวกริด
//   แรงแผ่นดินไหว (ถ้าเปิด) = แรงรายชั้นของอาคาร × ความกว้างรับแรง / ความกว้างอาคาร (ไม่รวมแรงบิด)
//   ไม่ส่งกลับ: การแก้รูปทรง (ย้าย/เพิ่ม/ลบจุดต่อหรือชิ้นส่วน), แรงชนิดอื่น, load case/ชุดผสมที่เพิ่มเอง

import { loadShared } from "./shared.ts";
import { oneOf, sanitizeLike } from "./sanitize.ts";
import { defaultStair } from "../design/stair.ts";
import { ZONES, IMPORTANCE, type WindZone, type Importance } from "../loads/windTH.ts";
import { emptyInfo } from "./shared.ts";
import { concreteE, type Model } from "../core/model.ts";
import { applyWind, type WindSettings } from "../loads/windTH.ts";
import { defaultSeismic } from "../loads/seismicTH.ts";
import { buildTruss, defaultRoof, roofGeom, roofLoads, type RoofSettings } from "../design/roof.ts";
import { analyze3d, type AnalysisResult3 } from "../core3d/frame3d.ts";
import { modelOptions3, scaleLoad3 } from "../core3d/combos3d.ts";
import { cm, defaultGrid, shapeArea, slabShape, slabLineLoad, wallBeamId, wallId, defaultLoad, defaultSize, defaultSlab, defaultTie, generateBuilding, parseSpacing, sizeSecId, sizeSecName, type GridParams, type MemberOverrides } from "../app3d/generator.ts";

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
  return cleanParams3D(JSON.parse(raw));
}
/** พารามิเตอร์อาคารจากภายนอก (ไฟล์/ลิงก์/storage): ทำความสะอาดตามชนิดค่าตั้งต้น + ตรวจค่าที่ต้องอยู่ในรายการ */
export function cleanParams3D(raw: unknown): GridParams {
  const p0 = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tpl: GridParams = { ...defaultGrid, wind: { ...defaultGrid.wind }, seismic: { ...defaultSeismic }, tieBeam: { ...defaultTie }, slab: { ...defaultSlab },
    ...(p0.info ? { info: { ...emptyInfo } } : {}), ...(p0.roof ? { roof: { ...defaultRoof } } : {}), ...(p0.stair ? { stair: { ...defaultStair } } : {}) };
  const p = sanitizeLike(tpl, p0);
  const w = p.wind;
  w.zone = oneOf(w.zone, Object.keys(ZONES) as WindZone[], defaultGrid.wind.zone);
  w.importance = oneOf(w.importance, Object.keys(IMPORTANCE) as Importance[], defaultGrid.wind.importance);
  w.exposure = oneOf(w.exposure, ["A", "B"] as const, defaultGrid.wind.exposure);
  if (p.seismic) { p.seismic.site = oneOf(p.seismic.site, ["A", "B", "C", "D", "E"] as const, defaultSeismic.site); p.seismic.method = oneOf(p.seismic.method, ["ELF", "RSA"] as const, "ELF"); }
  if (p.roof) {
    p.roof.type = oneOf(p.roof.type, ["gable", "hip", "shed"] as const, "gable"); p.roof.ridge = oneOf(p.roof.ridge, ["X", "Y"] as const, "X");
    p.roof.covering = oneOf(p.roof.covering, ["metal", "tile"] as const, "metal"); p.roof.openings = oneOf(p.roof.openings, ["closed", "open"] as const, "closed");
  }
  if (p.stair) p.stair.support = oneOf(p.stair.support, ["simple", "continuous"] as const, "simple");
  // ค่าน้ำหนักรายชิ้นรุ่นเก่ารวมน้ำหนักพื้นเทียบเท่าโมเมนต์ไว้ → หักออก (พื้นคิดแยกตามรูปจริงแล้ว) กันนับซ้ำ
  if (p.overrides?.load && p.overrides.loadBasis !== "beam") {
    const load: Record<string, { sdl: number; ll: number }> = {};
    const r3 = (v: number) => Math.round(Math.max(0, v) * 1000) / 1000;
    for (const [id, l] of Object.entries(p.overrides.load)) { const s = slabLineLoad(p, id); load[id] = { sdl: r3(l.sdl - s.sdl), ll: r3(l.ll - s.ll) }; }
    p.overrides = { ...p.overrides, load, loadBasis: "beam" };
  }
  return p;
}
export function readParams3DRaw(): string | null {
  try { return localStorage.getItem(PARAMS3D_KEY); } catch { return null; }
}

/** หาแนวโครงจากชื่อชิ้นส่วน 3D (BX-B2-1, BY-A3-2, C-C1-0) — เสาใช้ทิศที่ระบุ (ค่าตั้งต้น X) */
export function frameOfMember(id: string, colDir: FrameDir = "X"): FrameRef | null {
  const m = id.match(/^(BX|BY|KX|KY|WX|WY|C)-([A-Z])(\d+)-\d+$/);
  if (!m) return null;
  const j = m[2].charCodeAt(0) - 65, i = +m[3] - 1;
  const dir: FrameDir = m[1].endsWith("X") ? "X" : m[1].endsWith("Y") ? "Y" : colDir;
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
  // คานยื่นในแนวโครงนี้ (ด้าน x0/x1 สำหรับโครงแนว X, y0/y1 สำหรับโครงแนว Y)
  for (const cv of p.layout?.cantilevers ?? []) {
    if (!(cv.length > 0) || (f.dir === "X") !== cv.side.startsWith("x")) continue;
    const a = cv.side.endsWith("0") ? 0 : along.length - 1, sg = cv.side.endsWith("0") ? -1 : 1;
    for (let k = Math.max(1, cv.fromLevel || 1); k < zs.length; k++) {
      const base = nid(a, k), tip = `${base}-${cv.side}`, id = `K${f.dir}-${base}`;
      nodes.push({ id: tip, x: along[a] + sg * cv.length, y: zs[k] });
      beams.push({ id });
      members.push({ id, i: base, j: tip, section: secFor(id, "beam"), kind: "beam" });
    }
  }
  // ผนังรับแรงเฉือนในแนวนี้: เสากว้าง (t × Lw) ที่กึ่งกลางผนัง + แขนแข็งถึงปลายผนังทุกชั้น · แทนคานช่วงนั้น (เหมือน 3D)
  const wallsHere = (p.layout?.walls ?? []).filter((w) => w.dir === f.dir && w.line === f.line && w.span >= 0 && w.span < along.length - 1);
  const linkOf = new Map<string, string>(); // แขนแข็ง → คานที่ผนังแทน (รับน้ำหนักบนคานนั้น)
  const wallSupports: Model["supports"] = [];
  for (const w of wallsHere) {
    const a0 = w.span, a1 = w.span + 1, Lw = along[a1] - along[a0], xm = (along[a0] + along[a1]) / 2;
    const secId = `WALL${cm(w.t)}x${cm(Lw)}`;
    if (!sections.some((s) => s.id === secId)) sections.push({ id: secId, name: `ผนัง ${cm(w.t)}×${cm(Lw)}`, material: "CONC", b: w.t, h: Lw });
    if (!sections.some((s) => s.id === "RIGID")) sections.push({ id: "RIGID", name: "แขนแข็ง", material: "RIGIDMAT", b: 0.5, h: 1.5 });
    const mid = (k: number) => `${nid(a0, k)}-w${f.dir}`;
    for (let k = 0; k < zs.length; k++) nodes.push({ id: mid(k), x: xm, y: zs[k] });
    wallSupports.push({ node: mid(0), ux: true, uy: true, rz: true });
    for (let k = 0; k < dz.length; k++) members.push({ id: wallId(w, k), i: mid(k), j: mid(k + 1), section: secId, kind: "other" });
    for (let k = 1; k < zs.length; k++) {
      const beamId = wallBeamId(w, k);
      const q = members.findIndex((x) => x.id === beamId); if (q >= 0) members.splice(q, 1);
      const qb = beams.findIndex((x) => x.id === beamId); if (qb >= 0) beams.splice(qb, 1);
      for (const [suf, a] of [["a", a0], ["b", a1]] as const) {
        const lid = `L${f.dir}-${nid(a0, k)}-${suf}`;
        members.push({ id: lid, i: mid(k), j: nid(a, k), section: "RIGID", kind: "other" });
        linkOf.set(lid, beamId);
      }
    }
  }
  // ชิ้นที่ลบในอาคาร 3D และจุดต่อที่ไม่มีชิ้นส่วนต่อ
  const removed = new Set(p.layout?.removed ?? []);
  for (let q = members.length - 1; q >= 0; q--) if (removed.has(members[q].id)) members.splice(q, 1);
  for (let q = beams.length - 1; q >= 0; q--) if (removed.has(beams[q].id)) beams.splice(q, 1);
  const used = new Set(members.flatMap((m) => [m.i, m.j]));
  for (let q = nodes.length - 1; q >= 0; q--) if (!used.has(nodes[q].id)) nodes.splice(q, 1);
  const udl = (key: "sdl" | "ll"): Model["loadCases"][number]["loads"] => {
    const out: Model["loadCases"][number]["loads"] = [...beams.map((b) => b.id), ...linkOf.keys()].map((id) => {
      const src = linkOf.get(id) ?? id; // แขนแข็งรับน้ำหนักของคานที่ผนังแทน
      const w = ov.load?.[src]?.[key] ?? defaultLoad(p, src)[key];
      return { type: "udl" as const, member: id, dir: "globalY" as const, w: -w };
    }).filter((l) => l.w !== 0);
    // น้ำหนักจากพื้นตามรูปจริง (เหมือน 3D) · แขนแข็งรับค่าเฉลี่ยของคานที่ผนังแทน
    for (const id of [...beams.map((b) => b.id), ...linkOf.keys()]) {
      const src = linkOf.get(id) ?? id;
      const sh = slabShape(p, src);
      const w = sh ? (key === "sdl" ? sh.wD : sh.wL) : 0;
      if (!sh || !w) continue;
      if (linkOf.has(id)) { const Lb = sh.pts[sh.pts.length - 1][0]; if (Lb > 0) out.push({ type: "udl", member: id, dir: "globalY", w: -(w * shapeArea(sh.pts)) / Lb }); }
      else out.push({ type: "dist", member: id, dir: "globalY", pts: sh.pts.map(([x, k]) => [x, -w * k] as [number, number]) });
    }
    return out;
  };
  const m: Model = {
    name: `${p.name.replace(/ — โครงแนวกริด.*$/, "")} — โครง${frameLabel(f)}`,
    info: p.info,
    nodes, members,
    // มีคานคอดิน → ฐานหมุนได้ (โมเมนต์ไปที่คานคอดิน)
    supports: [...along.map((_, a) => ({ node: nid(a, 0), ux: true, uy: true, rz: !tie.enabled })), ...wallSupports].filter((s) => used.has(s.node)),
    materials: [{ id: "CONC", name: `คอนกรีต fc' ${p.fcKsc} ksc`, E: concreteE(p.fcKsc), gamma: 24, fc: p.fcKsc, fy: p.fyKsc, fyt: p.fytKsc ?? 2400 },
      ...(wallsHere.length ? [{ id: "RIGIDMAT", name: "แขนแข็ง (ไม่มีน้ำหนัก)", E: concreteE(p.fcKsc) * 10, gamma: 0 }] : [])],
    sections,
    loadCases: [
      { id: "DL", name: "น้ำหนักคงที่ (รวมน้ำหนักตัวเอง)", selfWeight: true, loads: udl("sdl") },
      { id: "LL", name: "น้ำหนักจร", selfWeight: false, loads: udl("ll") },
    ],
    combos: [],
    analysis: { pDelta: p.pDelta, cracked: p.cracked },
    link3d: { dir: f.dir, line: f.line, sig },
  };
  // คานขวาง (ตั้งฉากกับโครง) ที่มาต่อจุดต่อของโครงนี้: แรงปฏิกิริยาช่วงเดี่ยว wL/2 (DL รวมน้ำหนักคาน, LL)
  //   ไม่มีส่วนนี้ เสาในโครง 2D จะได้แรงอัดน้อยกว่าในอาคาร 3D มาก (พื้นและคานแนวขวางส่งน้ำหนักลงเสาผ่านคานขวาง)
  {
    const perpDir = f.dir === "X" ? "Y" : "X";
    const g3 = (i: number, j: number, k: number) => `${gridLetter(j)}${i + 1}-${k}`;
    const ids = new Set(nodes.map((n) => n.id));
    for (let k = tie.enabled ? 0 : 1; k < zs.length; k++) for (let a = 0; a < along.length; a++) {
      const node = nid(a, k);
      if (!ids.has(node)) continue;
      let D = 0, Lv = 0;
      for (const side of [-1, 0]) {
        const q = f.line + side; // ช่วงขวาง q → q+1
        if (q < 0 || q >= perp.length) continue;
        const [i, j] = f.dir === "X" ? [a, q] : [q, a];
        const id = `B${perpDir}-${g3(i, j, k)}`;
        if (removed.has(id)) continue;
        const L = perp[q];
        const w = ov.load?.[id] ?? defaultLoad(p, id);
        const sz = ov.size?.[id] ?? defaultSize(p, id);
        const sh = slabShape(p, id), area = sh ? shapeArea(sh.pts) : 0; // น้ำหนักพื้นบนคานขวาง (รูปสมมาตร → ครึ่งหนึ่งต่อปลาย)
        D += ((w.sdl + 24 * sz.b * sz.h) * L + (sh ? sh.wD * area : 0)) / 2;
        Lv += (w.ll * L + (sh ? sh.wL * area : 0)) / 2;
      }
      if (D) m.loadCases[0].loads.push({ type: "nodal", node, fx: 0, fy: -+D.toFixed(3), mz: 0 });
      if (Lv) m.loadCases[1].loads.push({ type: "nodal", node, fx: 0, fy: -+Lv.toFixed(3), mz: 0 });
    }
  }
  // หลังคาโครงเหล็ก: แรงที่หัวเสาริม (รหัสจุดต่อเดียวกับ 3D) — แรงลมยก/ลมบนหลังคาไม่ส่งเข้าโครง 2D
  const rs = { ...defaultRoof, ...(p.roof ?? {}) };
  if (rs.enabled) {
    const top = zs.length - 1;
    const rf = roofLoads(roofGeom(dx, dy, zs[top], rs), rs, p.wind);
    const ids = new Set(nodes.map((n) => n.id));
    const g3 = (i: number, j: number) => `${gridLetter(j)}${i + 1}-${top}`;
    for (const t of rf.perTruss) {
      const ends = rs.ridge === "X" ? [g3(t.line, 0), g3(t.line, dy.length)] : [g3(0, t.line), g3(dx.length, t.line)];
      for (const n of ends) if (ids.has(n)) {
        m.loadCases[0].loads.push({ type: "nodal", node: n, fx: 0, fy: -+t.D.toFixed(3), mz: 0 });
        m.loadCases[1].loads.push({ type: "nodal", node: n, fx: 0, fy: -+t.L.toFixed(3), mz: 0 });
      }
    }
    m.roof2d = roofOutline2D(rs, dx, dy, zs[top], f);
  }
  applyWind(m, { ...p.wind, spacing: +trib.toFixed(3) });
  // แรงด้านข้างตามที่โครงนี้รับจริงในอาคาร 3D (พื้นแข็งกระจายตามความแข็ง + แรงบิด) — แทนการแบ่งตามความกว้างรับลม
  const lat = lateralShare3D(p, f);
  const levelNode = (k: number, last = false) => { const ids = along.map((_, a) => nid(a, k)).filter((id) => used.has(id)); return last ? ids[ids.length - 1] : ids[0]; };
  if (lat) {
    const setCase = (id: string, F: number[], sign: 1 | -1, name?: string) => {
      const lc = m.loadCases.find((c) => c.id === id);
      if (!lc) return;
      lc.loads = F.map((v, s) => ({ type: "nodal" as const, node: levelNode(s + 1, sign < 0), fx: +(sign * v).toFixed(3), fy: 0, mz: 0 })).filter((l) => l.node && l.fx !== 0);
      if (name) lc.name = name;
    };
    setCase("WX", lat.wind, 1, `ลม (+) — ส่วนที่โครงนี้รับในอาคาร 3D`);
    setCase("WXN", lat.wind, -1, `ลม (−) — ส่วนที่โครงนี้รับในอาคาร 3D`);
  }
  const c = (id: string, name: string, factors: Record<string, number>) => ({ id, name, factors });
  // ชุดผสมตามมาตรฐานที่ใช้ร่วมกับหน้า 3D (ACI: ลม มยผ. ระดับใช้งาน → 1.6W, แผ่นดินไหวระดับกำลัง → 1.0E)
  const code = loadShared()?.design.code ?? "EIT";
  m.combos = code === "ACI" ? [
    c("U1", "1.4D", { DL: 1.4 }),
    c("U2", "1.2D + 1.6L", { DL: 1.2, LL: 1.6 }),
    c("U3", "1.2D + 1.0L + 1.6W", { DL: 1.2, LL: 1.0, WX: 1.6 }),
    c("U4", "1.2D + 1.0L − 1.6W", { DL: 1.2, LL: 1.0, WXN: 1.6 }),
    c("U5", "0.9D + 1.6W", { DL: 0.9, WX: 1.6 }),
    c("U6", "0.9D − 1.6W", { DL: 0.9, WXN: 1.6 }),
  ] : [
    c("U1", "1.4D + 1.7L", { DL: 1.4, LL: 1.7 }),
    c("U2", "0.75(1.4D + 1.7L + 1.7W)", { DL: 1.05, LL: 1.275, WX: 1.275 }),
    c("U3", "0.75(1.4D + 1.7L − 1.7W)", { DL: 1.05, LL: 1.275, WXN: 1.275 }),
    c("U4", "0.9D + 1.3W", { DL: 0.9, WX: 1.3 }),
    c("U5", "0.9D − 1.3W", { DL: 0.9, WXN: 1.3 }),
  ];
  const eq = p.seismic?.enabled ? generateBuilding(p).seismic : null;
  if (eq) {
    const share = Bperp > 0 ? trib / Bperp : 0;
    const Feq = lat?.eq ?? eq.levels.map((l) => l.F * share);
    m.loadCases.push({
      id: "EX", name: lat?.eq ? "แผ่นดินไหว — ส่วนที่โครงนี้รับในอาคาร 3D (รวมแรงบิดโดยบังเอิญ)" : `แผ่นดินไหว (ส่วนของโครงนี้ ${(share * 100).toFixed(1)}%)`, selfWeight: false, lateral: true,
      loads: Feq.map((v, k) => ({ type: "nodal" as const, node: levelNode(k + 1) ?? nid(0, k + 1), fx: +v.toFixed(3), fy: 0, mz: 0 })).filter((l) => l.fx !== 0),
    });
    const n = m.combos.length;
    m.combos.push(...(code === "ACI" ? [
      c(`U${n + 1}`, "1.2D + 1.0L + 1.0E", { DL: 1.2, LL: 1.0, EX: 1 }),
      c(`U${n + 2}`, "1.2D + 1.0L − 1.0E", { DL: 1.2, LL: 1.0, EX: -1 }),
      c(`U${n + 3}`, "0.9D + 1.0E", { DL: 0.9, EX: 1 }),
      c(`U${n + 4}`, "0.9D − 1.0E", { DL: 0.9, EX: -1 }),
    ] : [
      c(`U${n + 1}`, "0.75(1.4D + 1.7L + 1.87E)", { DL: 1.05, LL: 1.275, EX: 1.4025 }),
      c(`U${n + 2}`, "0.75(1.4D + 1.7L − 1.87E)", { DL: 1.05, LL: 1.275, EX: -1.4025 }),
      c(`U${n + 3}`, "0.9D + 1.43E", { DL: 0.9, EX: 1.43 }),
      c(`U${n + 4}`, "0.9D − 1.43E", { DL: 0.9, EX: -1.43 }),
    ]));
  }
  return m;
}

/**
 * แรงด้านข้างรายชั้นที่โครงแนวนี้รับในอาคาร 3D (kN, ชั้น 1 → บนสุด)
 *   วิเคราะห์อาคาร 3D เชิงเส้น (load case ลม / แผ่นดินไหว ± แรงบิด) → แรงเฉือนชั้นในเสา/ผนังของแนวนี้ Vf → แรงที่ชั้น F = Vf(k) − Vf(k+1)
 *   แผ่นดินไหว: ซองของ E + T และ E − T (แรงบิดโดยบังเอิญทั้งสองทิศ) · ใช้แรงสถิตเทียบเท่าแม้เลือก RSA (ปลอดภัยกว่า)
 */
export function lateralShare3D(p: GridParams, f: FrameRef): { wind: number[]; eq: number[] | null } | null {
  try {
    const code = loadShared()?.design.code ?? "EIT";
    const { model } = generateBuilding(p, code);
    const n = parseSpacing(p.storeys).length;
    const comp = f.dir === "X" ? "Vy" : "Vz"; // แกน 2 ของเสา = +X
    const nid = (a: number, k: number) => (f.dir === "X" ? `${gridLetter(f.line)}${a + 1}-${k}` : `${gridLetter(a)}${f.line + 1}-${k}`);
    const nAlong = parseSpacing(f.dir === "X" ? p.xSpacing : p.ySpacing).length + 1;
    const walls = (p.layout?.walls ?? []).filter((w) => w.dir === f.dir && w.line === f.line);
    const inFrame = (s: number) => [...Array.from({ length: nAlong }, (_, a) => `C-${nid(a, s)}`), ...walls.map((w) => wallId(w, s))];
    const vertAt = (s: number) => model.members.filter((x) => (x.kind === "column" || x.kind === "wall") && /-(\d+)$/.exec(x.id)?.[1] === String(s)).map((x) => x.id);
    const shears = (r: AnalysisResult3) => Array.from({ length: n }, (_, s) => {
      const sum = (ids: string[]) => ids.reduce((a, id) => a + (r.members[id]?.stations[0][comp] ?? 0), 0);
      const tot = sum(vertAt(s));
      return { frame: sum(inFrame(s)) * (tot < 0 ? -1 : 1), total: Math.abs(tot) };
    });
    const toForces = (V: number[]) => V.map((v, s) => v - (V[s + 1] ?? 0));
    const has = (id: string) => model.loadCases.some((c) => c.id === id);
    const W = `W${f.dir}`, E = `E${f.dir}`, T = `T${f.dir}`;
    const lin = (factors: Record<string, number>) => analyze3d(model, model.loadCases.flatMap((c) => (factors[c.id] ? c.loads.map((l) => scaleLoad3(l, factors[c.id])) : [])), 0, { ...modelOptions3(model), pDelta: false });
    const wind = has(W) ? toForces(shears(lin({ [W]: 1 })).map((x) => x.frame)) : [];
    let eqF: number[] | null = null;
    if (has(E)) {
      const a = shears(lin({ [E]: 1, ...(has(T) ? { [T]: 1 } : {}) })), b = has(T) ? shears(lin({ [E]: 1, [T]: -1 })) : a;
      eqF = toForces(a.map((x, s) => Math.max(Math.abs(x.frame), Math.abs(b[s].frame))));
    }
    return { wind, eq: eqF };
  } catch { return null; }
}

/** ภาพหลังคาในระนาบโครง: โครงขนานช่วงโครงถัก → รูปโครงถัก · โครงขนานสัน → รูปด้านหลังคา (ขอบชายคา–สัน + แป) */
export function roofOutline2D(rsIn: RoofSettings, dx: number[], dy: number[], zTop: number, f: FrameRef): { lines: number[][]; note: string } {
  const rs = { ...defaultRoof, ...rsIn };
  const g = roofGeom(dx, dy, zTop, rs);
  const t = Math.tan((g.theta * Math.PI) / 180), ov = rs.overhang;
  const zE = zTop - ov * t, zR = zTop + g.rise;
  const lines: number[][] = [];
  const typeName = rs.type === "gable" ? "จั่ว" : rs.type === "hip" ? "ปั้นหยา" : "เพิงหมาแหงน";
  if (f.dir === g.across) {
    // ระนาบโครงถัก (ทุกแนวกริดมีโครงถัก)
    const tr = g.trusses.find((x) => x.line === f.line) ?? g.trusses[0];
    const tm = buildTruss(g.W, g.theta, rs.type, rs.purlinMax);
    const cap = rs.type === "hip" ? Math.min(tr.pos, g.Lr - tr.pos) * t : Infinity;
    for (const mem of tm.members) {
      const A = tm.nodes[mem.i], B = tm.nodes[mem.j];
      lines.push([A.x, zTop + Math.min(A.y, cap), B.x, zTop + Math.min(B.y, cap)]);
    }
    // ชายคาสองข้าง (ต่อคอร่าบนออกไป)
    const hR = rs.type === "shed" ? Math.min(g.rise, cap) : 0;
    lines.push([-ov, zE, 0, zTop], [g.W, zTop + hR, g.W + ov, zTop + hR + (rs.type === "shed" ? ov * t : -ov * t)]);
    return { lines, note: `หลังคา${typeName} — โครงถัก ช่วง ${g.W.toFixed(2)} m` };
  }
  // ระนาบขนานสัน: รูปด้านหลังคา
  const a0 = -ov, a1 = g.Lr + ov;
  const c = (f.dir === "X" ? dy : dx).slice(0, f.line).reduce((s, v) => s + v, 0); // ตำแหน่งแนวโครงตามช่วงโครงถัก
  if (rs.type === "hip") {
    const r0 = Math.min(g.W / 2, g.Lr / 2), r1 = Math.max(g.Lr - g.W / 2, g.Lr / 2), zr = zTop + (Math.min(g.W, g.Lr) / 2) * t;
    lines.push([a0, zE, a1, zE], [a1, zE, r1, zr], [r1, zr, r0, zr], [r0, zr, a0, zE]);
  } else {
    const zHi = rs.type === "shed" ? zR + ov * t : zR;
    lines.push([a0, zE, a1, zE], [a1, zE, a1, zHi], [a1, zHi, a0, zHi], [a0, zHi, a0, zE]);
  }
  // แนวสันหรือขอบสูงเทียบกับแนวโครงนี้ (ความสูงหลังคาเหนือแนวนี้)
  const hHere = rs.type === "shed" ? c * t : Math.min(c, g.W - c) * t;
  if (hHere > 1e-6) lines.push([0, zTop + hHere, g.Lr, zTop + hHere]);
  if (hHere > 1e-6) for (const tr of g.trusses) lines.push([tr.pos, zTop, tr.pos, zTop + Math.min(hHere, rs.type === "hip" ? Math.min(tr.pos, g.Lr - tr.pos) * t : Infinity)]);
  return { lines, note: `หลังคา${typeName} (รูปด้าน)` };
}

/** 2D → 3D: ค่าปรับรายชิ้นจากโครง 2D (หน้าตัดของชิ้น + น้ำหนักแผ่บนคานใน DL/LL) รวมกับค่าปรับเดิมของแนวอื่น */
export function overridesFrom2D(p: GridParams, m: Model): MemberOverrides {
  const size = { ...(p.overrides?.size ?? {}) };
  const load = { ...(p.overrides?.load ?? {}) };
  const dir = m.link3d?.dir ?? "X";
  const secs = new Map(m.sections.map((s) => [s.id, s]));
  for (const mem of m.members) {
    if (!/^(BX|BY|KX|KY|C)-[A-Z]\d+-\d+$/.test(mem.id)) continue;
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
  if (Object.keys(load).length) { out.load = load; out.loadBasis = "beam"; }
  return out;
}

/** หน้า 2D: ส่งการแก้ไขของโครงที่เชื่อมอยู่กลับไปอาคาร 3D (คืนค่า true ถ้าเขียนจริง) */
export function pushFrameTo3D(m: Model): boolean {
  if (!m.link3d) return false;
  const raw = readParams3DRaw();
  // อาคาร 3D เปลี่ยนหลังสร้างโครงนี้ (เช่น กลับมาด้วยปุ่ม Back) → โครง 2D ล้าสมัย ห้ามส่งค่าทับ ให้ refreshLinkedFrame สร้างใหม่ก่อน
  if (m.link3d.sig && (raw ?? "") !== m.link3d.sig) return false;
  let p: GridParams;
  try { p = parseParams3D(raw); } catch { return false; } // ข้อมูล 3D เสีย — ไม่ส่ง (ไม่ให้การแก้ 2D พังทุกครั้ง)
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

/** แนวกริดทั้งหมดของอาคาร (แนว X = แถว A, B, …; แนว Y = แนว 1, 2, …) */
export function listFrames(p: GridParams): FrameRef[] {
  const nx = parseSpacing(p.xSpacing).length + 1, ny = parseSpacing(p.ySpacing).length + 1;
  return [
    ...Array.from({ length: ny }, (_, line) => ({ dir: "X" as const, line })),
    ...Array.from({ length: nx }, (_, line) => ({ dir: "Y" as const, line })),
  ];
}
/** โครงตั้งต้น: แนวกริดกลางตามแกน X (โครงภายในที่รับน้ำหนักมากที่สุดโดยทั่วไป) */
export function defaultFrame(p: GridParams): FrameRef {
  const ny = parseSpacing(p.ySpacing).length + 1;
  return { dir: "X", line: Math.floor((ny - 1) / 2) };
}
export const frameKey = (f: FrameRef) => `${f.dir}:${f.line}`;

/** หน้า 3D: เก็บโครงที่ตัดไว้ให้หน้า 2D เปิด (select = ชิ้นที่จะเลือกไว้) */
export function sendFrameRefTo2D(p: GridParams, f: FrameRef, select = ""): boolean {
  const raw = JSON.stringify(p);
  try { localStorage.setItem(PARAMS3D_KEY, raw); } catch { /* ไม่มี storage */ }
  const payload: FramePayload = { model: frameFrom3D(p, f, raw), select, label: frameLabel(f), t: Date.now() };
  try { localStorage.setItem(FRAME_KEY, JSON.stringify(payload)); return true; } catch { return false; }
}
export function sendFrameTo2D(p: GridParams, memberId: string, colDir: FrameDir = "X"): boolean {
  const f = frameOfMember(memberId, colDir);
  if (!f) return false;
  return sendFrameRefTo2D(p, f, memberId.startsWith("C-") || memberId.startsWith(`B${f.dir}-`) || memberId.startsWith(`K${f.dir}-`) ? memberId : "");
}
/** หน้า 3D: โมเดล 2D ที่บันทึกไว้เชื่อมกับอาคาร 3D อยู่แล้วหรือไม่ */
export function saved2DIsLinked(): boolean {
  try { return !!(JSON.parse(localStorage.getItem("structlab.project.v1") ?? "null") as Model | null)?.link3d; } catch { return false; }
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

/**
 * สร้างแรงลมในโครง 2D: โครงที่เชื่อมกับ 3D ใช้ส่วนที่โครงนี้รับในอาคาร 3D (ตามความแข็ง) ด้วยค่าลม w
 * โครงทั่วไปใช้วิธีความกว้างรับลม (applyWind)
 */
export function applyWindLinked(m: Model, w: WindSettings): void {
  applyWind(m, w);
  if (!m.link3d) return;
  let p: GridParams;
  try { p = parseParams3D(readParams3DRaw()); } catch { return; }
  const { spacing: _s, ...wind } = w;
  const lat = lateralShare3D({ ...p, wind: { ...p.wind, ...wind } }, { dir: m.link3d.dir, line: m.link3d.line });
  if (!lat?.wind.length) return;
  const levels = [...new Set(m.nodes.filter((n) => /^[A-Z]\d+-\d+$/.test(n.id) && n.y > 1e-9).map((n) => +n.y.toFixed(6)))].sort((a, b) => a - b);
  const at = (y: number, last: boolean) => { const ns = m.nodes.filter((n) => /^[A-Z]\d+-\d+$/.test(n.id) && Math.abs(n.y - y) < 1e-6).sort((a, b) => a.x - b.x); return (last ? ns[ns.length - 1] : ns[0])?.id; };
  for (const [id, sg] of [["WX", 1], ["WXN", -1]] as const) {
    const lc = m.loadCases.find((c) => c.id === id);
    if (!lc) continue;
    lc.loads = lat.wind.map((v, s) => ({ type: "nodal" as const, node: at(levels[s], sg < 0) ?? "", fx: +(sg * v).toFixed(3), fy: 0, mz: 0 })).filter((l) => l.node && l.fx !== 0);
    lc.name = `ลม (${sg > 0 ? "+" : "−"}) — ส่วนที่โครงนี้รับในอาคาร 3D`;
  }
}

