// DXF (AutoCAD) — ส่งออกแบบโครงสร้าง และนำเข้าเส้นกริดจากแปลน
//   ส่งออก: DXF R12 ASCII หน่วย mm · ข้อความภาษาไทยเขียนเป็นรหัส \U+XXXX (AutoCAD อ่านได้)
//     แปลนโครงสร้างทุกชั้น (กริด เสา คาน แบบพื้น ช่องเปิด) · แปลนฐานราก · ตารางหน้าตัดคาน/เสา
//   นำเข้า: อ่านเส้น LINE / LWPOLYLINE / POLYLINE แนวตั้งและแนวนอนที่ยาว (หรือในเลเยอร์ชื่อ GRID/AXIS/แกน)
//     → ตำแหน่งกริด X/Y → ช่วงกริด (หน่วย mm ถ้าขนาดรวม > 200 มิฉะนั้น m)

import type { Model3 } from "../core3d/model3d.ts";
import type { BeamDesign3, ColumnDesign3, MemberDesign3 } from "../design/design3d.ts";
import type { FootingResult3 } from "../design/footing3d.ts";
import type { SlabType } from "../design/slab3d.ts";
import { barPositions } from "../design/rcColumnBiaxial.ts";

// ---------- ตัวเขียน DXF ----------
const LAYERS: [string, number][] = [["GRID", 8], ["COLUMN", 1], ["BEAM", 5], ["SLAB", 3], ["FOOTING", 6], ["PILE", 6], ["REBAR", 1], ["TEXT", 7], ["DIM", 2], ["TITLE", 4]];

export class DxfWriter {
  private out: string[] = [];
  private add(code: number, v: string | number) { this.out.push(String(code), typeof v === "number" ? (Math.round(v * 1000) / 1000).toString() : v); }
  /** ข้อความ: อักขระนอก ASCII → \U+XXXX */
  static enc(s: string) { return s.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`); }
  line(layer: string, x1: number, y1: number, x2: number, y2: number) {
    this.add(0, "LINE"); this.add(8, layer); this.add(10, x1); this.add(20, y1); this.add(30, 0); this.add(11, x2); this.add(21, y2); this.add(31, 0);
  }
  rect(layer: string, x0: number, y0: number, x1: number, y1: number) {
    this.line(layer, x0, y0, x1, y0); this.line(layer, x1, y0, x1, y1); this.line(layer, x1, y1, x0, y1); this.line(layer, x0, y1, x0, y0);
  }
  circle(layer: string, x: number, y: number, r: number) { this.add(0, "CIRCLE"); this.add(8, layer); this.add(10, x); this.add(20, y); this.add(30, 0); this.add(40, r); }
  /** align: 0 ซ้าย, 1 กลาง, 2 ขวา (จุดอ้างอิงที่เส้นฐาน) */
  text(layer: string, x: number, y: number, h: number, s: string, align: 0 | 1 | 2 = 0, rot = 0) {
    this.add(0, "TEXT"); this.add(8, layer); this.add(10, x); this.add(20, y); this.add(30, 0); this.add(40, h); this.add(1, DxfWriter.enc(s));
    if (rot) this.add(50, rot);
    if (align) { this.add(72, align); this.add(11, x); this.add(21, y); this.add(31, 0); }
  }
  toString(): string {
    const head: string[] = [];
    const h = (c: number, v: string | number) => head.push(String(c), String(v));
    h(0, "SECTION"); h(2, "HEADER"); h(9, "$ACADVER"); h(1, "AC1009"); h(9, "$INSUNITS"); h(70, 4); h(0, "ENDSEC");
    h(0, "SECTION"); h(2, "TABLES"); h(0, "TABLE"); h(2, "LAYER"); h(70, LAYERS.length);
    for (const [n, c] of LAYERS) { h(0, "LAYER"); h(2, n); h(70, 0); h(62, c); h(6, "CONTINUOUS"); }
    h(0, "ENDTAB"); h(0, "ENDSEC");
    h(0, "SECTION"); h(2, "ENTITIES");
    return [...head, ...this.out, "0", "ENDSEC", "0", "EOF", ""].join("\r\n");
  }
}

// ---------- ป้ายแบบ (B-1, C-1 …) — กติกาเดียวกับตารางหน้าตัดในรายการคำนวณ ----------
export const beamKey = (d: BeamDesign3) => { const r = d.result; return `${r.input.b}x${r.input.h}|${r.top.bars?.n}-${r.top.bars?.dia}|${r.bottom.bars?.n}-${r.bottom.bars?.dia}|${r.shear.spacing}`; };
export const colKey = (d: ColumnDesign3) => `${d.section.b}x${d.section.h}|${d.result.layout?.dia}-${d.result.layout?.n2}-${d.result.layout?.n3}|${d.ties}`;
export function designMarks(design: Record<string, MemberDesign3>): { marks: Record<string, string>; beams: { mark: string; d: BeamDesign3; ids: string[] }[]; cols: { mark: string; d: ColumnDesign3; ids: string[] }[] } {
  const group = <T extends MemberDesign3>(kind: "beam" | "column", key: (d: T) => string, prefix: string) => {
    const g = new Map<string, { d: T; ids: string[] }>();
    for (const [id, d] of Object.entries(design)) if (d.kind === kind) { const k = key(d as T); const e = g.get(k); if (e) e.ids.push(id); else g.set(k, { d: d as T, ids: [id] }); }
    return [...g.values()].sort((a, b) => b.ids.length - a.ids.length).map((e, i) => ({ mark: `${prefix}-${i + 1}`, ...e }));
  };
  const beams = group<BeamDesign3>("beam", beamKey, "B"), cols = group<ColumnDesign3>("column", colKey, "C");
  const marks: Record<string, string> = {};
  for (const g of [...beams, ...cols]) for (const id of g.ids) marks[id] = g.mark;
  return { marks, beams, cols };
}

export interface DxfInput {
  name: string; model: Model3; design: Record<string, MemberDesign3> | null; footings: Record<string, FootingResult3> | null;
  slabs: SlabType[]; xs: number[]; ys: number[]; zs: number[]; openings: (k: number, i: number, j: number) => boolean; pileSize: number;
}

const bar = (d: number) => (d <= 9 ? `RB${d}` : `DB${d}`);

export function buildDxf(inp: DxfInput): string {
  const w = new DxfWriter();
  const M = 1000; // m → mm
  const { model, xs, ys, zs } = inp;
  const W = (xs[xs.length - 1] - xs[0]) * M, H = (ys[ys.length - 1] - ys[0]) * M;
  const gap = Math.max(W, 6000) + 9000;
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const secs = new Map(model.sections.map((s) => [s.id, s]));
  const marks = inp.design ? designMarks(inp.design) : null;
  const th = Math.max(150, Math.min(W, H) / 60); // ความสูงตัวอักษร
  const bub = th * 2.2;

  const grid = (ox: number, oy: number) => {
    const ext = 1500;
    xs.forEach((x, i) => {
      const X = ox + x * M;
      w.line("GRID", X, oy - ext, X, oy + H + ext);
      w.circle("GRID", X, oy + H + ext + bub, bub); w.text("GRID", X, oy + H + ext + bub - th / 2, th, String(i + 1), 1);
      if (i < xs.length - 1) w.text("DIM", ox + ((x + xs[i + 1]) / 2) * M, oy - ext - th * 1.6, th * 0.8, `${Math.round((xs[i + 1] - x) * M)}`, 1);
    });
    ys.forEach((y, j) => {
      const Y = oy + y * M;
      w.line("GRID", ox - ext, Y, ox + W + ext, Y);
      w.circle("GRID", ox - ext - bub, Y, bub); w.text("GRID", ox - ext - bub, Y - th / 2, th, String.fromCharCode(65 + j), 1);
      if (j < ys.length - 1) w.text("DIM", ox + W + ext + th * 1.2, oy + ((y + ys[j + 1]) / 2) * M, th * 0.8, `${Math.round((ys[j + 1] - y) * M)}`, 0, 90);
    });
  };

  // แปลนโครงสร้างแต่ละชั้น
  for (let k = 1; k < zs.length; k++) {
    const ox = (k - 1) * gap, oy = 0, z = zs[k];
    grid(ox, oy);
    w.text("TITLE", ox + W / 2, oy - 1500 - th * 5, th * 1.6, `แปลนโครงสร้างชั้น ${k} (ระดับ +${z.toFixed(2)})`, 1);
    // คาน (เส้นคู่ตามความกว้าง)
    for (const m of model.members) {
      if (m.kind !== "beam") continue;
      const a = nodes.get(m.i)!, b = nodes.get(m.j)!;
      if (Math.abs(a.z - z) > 1e-6 || Math.abs(b.z - z) > 1e-6) continue;
      const s = secs.get(m.section)!;
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      const nx = (-dy / L) * (s.b / 2), ny = (dx / L) * (s.b / 2);
      for (const sg of [1, -1]) w.line("BEAM", ox + (a.x + sg * nx) * M, oy + (a.y + sg * ny) * M, ox + (b.x + sg * nx) * M, oy + (b.y + sg * ny) * M);
      const mk = marks?.marks[m.id];
      if (mk) {
        const vert = Math.abs(dx) < 1e-9;
        w.text("TEXT", ox + ((a.x + b.x) / 2 + (vert ? -s.b : 0)) * M - (vert ? th * 0.4 : 0), oy + ((a.y + b.y) / 2) * M + (vert ? 0 : s.b * M / 2 + th * 0.4), th * 0.8, mk, 1, vert ? 90 : 0);
      }
    }
    // เสา (รอบชั้นที่ต่อขึ้นหรือลงจากระดับนี้)
    for (const m of model.members) {
      if (m.kind !== "column") continue;
      const a = nodes.get(m.i)!, b = nodes.get(m.j)!;
      if (Math.abs(b.z - z) > 1e-6) continue;
      const s = secs.get(m.section)!;
      w.rect("COLUMN", ox + (a.x - s.h / 2) * M, oy + (a.y - s.b / 2) * M, ox + (a.x + s.h / 2) * M, oy + (a.y + s.b / 2) * M);
      const mk = marks?.marks[m.id];
      if (mk) w.text("TEXT", ox + (a.x + s.h / 2) * M + th * 0.3, oy + (a.y + s.b / 2) * M + th * 0.3, th * 0.7, mk);
    }
    // แผ่นพื้น / ช่องเปิด
    for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
      const cx = ox + ((xs[i] + xs[i + 1]) / 2) * M, cy = oy + ((ys[j] + ys[j + 1]) / 2) * M;
      if (inp.openings(k, i, j)) {
        w.line("SLAB", ox + xs[i] * M + 300, oy + ys[j] * M + 300, ox + xs[i + 1] * M - 300, oy + ys[j + 1] * M - 300);
        w.line("SLAB", ox + xs[i] * M + 300, oy + ys[j + 1] * M - 300, ox + xs[i + 1] * M - 300, oy + ys[j] * M + 300);
        w.text("SLAB", cx, cy - th * 1.8, th * 0.8, "ช่องเปิด", 1);
        continue;
      }
      const ty = inp.slabs.find((t) => t.panels.some((q) => q.k === k && q.i === i && q.j === j));
      if (ty) { w.circle("SLAB", cx, cy, th * 1.6); w.text("SLAB", cx, cy - th * 0.45, th * 0.9, ty.mark, 1); }
    }
  }

  // แปลนฐานราก
  const fx = (zs.length - 1) * gap;
  grid(fx, 0);
  w.text("TITLE", fx + W / 2, -1500 - th * 5, th * 1.6, "แปลนฐานราก", 1);
  const fGroups = new Map<string, { mark: string; ft: FootingResult3; n: number }>();
  for (const [node, ft] of Object.entries(inp.footings ?? {})) {
    const n = nodes.get(node); if (!n) continue;
    const key = `${ft.L}x${ft.B}x${ft.t}|${ft.piles?.coords.length ?? 0}|${ft.barsX}|${ft.barsY}`;
    let g = fGroups.get(key);
    if (!g) { g = { mark: `F-${fGroups.size + 1}`, ft, n: 0 }; fGroups.set(key, g); }
    g.n++;
    w.rect("FOOTING", fx + (n.x - ft.L / 2) * M, (n.y - ft.B / 2) * M, fx + (n.x + ft.L / 2) * M, (n.y + ft.B / 2) * M);
    for (const p of ft.piles?.coords ?? []) w.circle("PILE", fx + (n.x + p.x) * M, (n.y + p.y) * M, (inp.pileSize / 2) * M);
    w.text("TEXT", fx + (n.x + ft.L / 2) * M + th * 0.3, (n.y - ft.B / 2) * M, th * 0.8, g.mark);
  }

  // ตารางหน้าตัด (ใต้แปลน)
  let sy = -1500 - th * 14;
  // ภาพตัดขยาย SX เท่า (ข้อความบอกขนาดจริง)
  const SX = 4;
  const sec = (x0: number, y0: number, bmm0: number, hmm0: number, title: string, lines: string[], bars: { x: number; y: number; d: number }[], cover0: number) => {
    const bmm = bmm0 * SX, hmm = hmm0 * SX, cover = cover0 * SX;
    w.rect("BEAM", x0, y0, x0 + bmm, y0 + hmm);
    w.rect("REBAR", x0 + cover, y0 + cover, x0 + bmm - cover, y0 + hmm - cover);
    for (const b of bars) w.circle("REBAR", x0 + b.x * SX, y0 + b.y * SX, (b.d / 2) * SX);
    w.text("TITLE", x0 + bmm / 2, y0 + hmm + th * 1.2, th, title, 1);
    lines.forEach((t, i) => w.text("TEXT", x0 + bmm / 2, y0 - th * (1.6 + 1.3 * i), th * 0.75, t, 1));
  };
  if (marks) {
    w.text("TITLE", 0, sy, th * 1.6, "ตารางหน้าตัดคาน (ภาพตัดขยาย 4 เท่า — ขนาดตามตัวเลข mm)");
    sy -= th * 4;
    let x = 0, rowH = 0;
    for (const g of marks.beams) {
      const r = g.d.result, i = r.input;
      const c = i.cover + i.stirrupDia;
      const row = (set: { n: number; dia: number } | null, yc: number) => set ? Array.from({ length: set.n }, (_, k) => ({ x: set.n === 1 ? i.b / 2 : c + set.dia / 2 + ((i.b - 2 * c - set.dia) * k) / (set.n - 1), y: yc, d: set.dia })) : [];
      const bars = [...row(r.bottom.bars, c + (r.bottom.bars?.dia ?? 0) / 2), ...row(r.top.bars, i.h - c - (r.top.bars?.dia ?? 0) / 2)];
      sec(x, sy - i.h * SX, i.b, i.h, `${g.mark} ${i.b}x${i.h}`, [`บน ${r.top.bars ? `${r.top.bars.n}-${bar(r.top.bars.dia)}` : "-"}`, `ล่าง ${r.bottom.bars ? `${r.bottom.bars.n}-${bar(r.bottom.bars.dia)}` : "-"}`, `ปลอก ${bar(i.stirrupDia)}@${r.shear.spacing ?? "-"}`, `${g.ids.length} ตัว`], bars, i.cover);
      x += Math.max(i.b * SX, th * 9) + th * 4; rowH = Math.max(rowH, i.h * SX);
      if (x > W + gap * 0.8) { x = 0; sy -= rowH + th * 10; rowH = 0; }
    }
    sy -= rowH + th * 12;
    w.text("TITLE", 0, sy, th * 1.6, "ตารางหน้าตัดเสา");
    sy -= th * 4;
    x = 0; rowH = 0;
    for (const g of marks.cols) {
      const s = g.d.section, lay = g.d.result.layout;
      const bars = lay ? barPositions(s, lay).map((p) => ({ x: s.h / 2 + p.u, y: s.b / 2 + p.w, d: lay.dia })) : [];
      sec(x, sy - s.b * SX, s.h, s.b, `${g.mark} ${s.b}x${s.h}`, [lay ? `${bars.length}-${bar(lay.dia)}` : "-", `ปลอก ${g.d.ties}`, `${g.ids.length} ต้น`], bars, s.cover);
      x += Math.max(s.h * SX, th * 9) + th * 4; rowH = Math.max(rowH, s.b * SX);
      if (x > W + gap * 0.8) { x = 0; sy -= rowH + th * 9; rowH = 0; }
    }
    sy -= rowH + th * 12;
  }
  if (fGroups.size) {
    w.text("TITLE", 0, sy, th * 1.6, "ตารางฐานราก");
    sy -= th * 3;
    for (const g of fGroups.values()) {
      const ft = g.ft;
      w.text("TEXT", 0, sy, th * 0.9, `${g.mark}: ${ft.L.toFixed(2)} x ${ft.B.toFixed(2)} x ${ft.t.toFixed(2)} m${ft.piles ? ` เข็ม ${ft.piles.coords.length} ต้น` : ""} · X ${ft.barsX} · Y ${ft.barsY} (${g.n} ฐาน)`);
      sy -= th * 1.8;
    }
  }
  w.text("TITLE", 0, sy - th * 3, th, `${inp.name} — StructLab 3D (หน่วย mm) · ตรวจสอบโดยวิศวกรผู้ออกแบบก่อนใช้งาน`);
  return w.toString();
}

// ---------- นำเข้าเส้นกริดจาก DXF ----------
export interface DxfGrid { xs: number[]; ys: number[]; unit: "mm" | "m"; lines: number; layerHint: string | null }

export function parseDxfGrid(text: string): DxfGrid {
  const rows = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < rows.length; i += 2) pairs.push([parseInt(rows[i].trim(), 10), rows[i + 1].trim()]);
  type Seg = { layer: string; x1: number; y1: number; x2: number; y2: number };
  const segs: Seg[] = [];
  let i = 0;
  // อ่านเฉพาะส่วน ENTITIES
  while (i < pairs.length && !(pairs[i][0] === 2 && pairs[i][1] === "ENTITIES")) i++;
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "ENDSEC") break;
    if (c === 0 && (v === "LINE" || v === "LWPOLYLINE" || v === "POLYLINE")) {
      const type = v;
      let layer = "0";
      const pts: { x: number; y: number }[] = [];
      let x1 = NaN, y1 = NaN, x2 = NaN, y2 = NaN, closed = false;
      let inVertex = type !== "POLYLINE"; // POLYLINE: พิกัดในหัวเป็นค่าหลอก อ่านเฉพาะใน VERTEX
      i++;
      // POLYLINE: จุดอยู่ใน VERTEX ต่อ ๆ ไปจนถึง SEQEND
      while (i < pairs.length && !(pairs[i][0] === 0 && (type !== "POLYLINE" || pairs[i][1] === "SEQEND"))) {
        const [cc, vv] = pairs[i];
        if (cc === 0 && vv === "VERTEX") { inVertex = true; i++; continue; }
        if (cc === 8 && layer === "0") layer = vv;
        const num = parseFloat(vv);
        if (type === "LINE") { if (cc === 10) x1 = num; else if (cc === 20) y1 = num; else if (cc === 11) x2 = num; else if (cc === 21) y2 = num; }
        else if (cc === 70 && !pts.length) closed = (parseInt(vv, 10) & 1) === 1;
        else if (inVertex) { if (cc === 10) pts.push({ x: num, y: NaN }); else if (cc === 20 && pts.length) pts[pts.length - 1].y = num; }
        i++;
      }
      if (type === "LINE" && [x1, y1, x2, y2].every(Number.isFinite)) segs.push({ layer, x1, y1, x2, y2 });
      else {
        const ps = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        for (let k = 0; k + 1 < ps.length; k++) segs.push({ layer, x1: ps[k].x, y1: ps[k].y, x2: ps[k + 1].x, y2: ps[k + 1].y });
        if (closed && ps.length > 2) segs.push({ layer, x1: ps[ps.length - 1].x, y1: ps[ps.length - 1].y, x2: ps[0].x, y2: ps[0].y });
      }
      continue;
    }
    i++;
  }
  if (!segs.length) throw new Error("ไม่พบเส้น (LINE/POLYLINE) ในไฟล์ DXF");
  // ใช้เลเยอร์กริดถ้ามี
  const gridLayer = [...new Set(segs.map((s) => s.layer))].find((l) => /grid|axis|แกน|กริด|center|cl/i.test(l)) ?? null;
  const use = gridLayer ? segs.filter((s) => s.layer === gridLayer) : segs;
  const minX = Math.min(...use.flatMap((s) => [s.x1, s.x2])), maxX = Math.max(...use.flatMap((s) => [s.x1, s.x2]));
  const minY = Math.min(...use.flatMap((s) => [s.y1, s.y2])), maxY = Math.max(...use.flatMap((s) => [s.y1, s.y2]));
  const spanX = maxX - minX, spanY = maxY - minY;
  const tolAng = 1e-3;
  const vx: number[] = [], hy: number[] = [];
  for (const s of use) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = Math.hypot(dx, dy);
    if (!L) continue;
    if (Math.abs(dx) / L < tolAng && Math.abs(dy) >= (gridLayer ? 0 : 0.6 * spanY)) vx.push((s.x1 + s.x2) / 2);
    if (Math.abs(dy) / L < tolAng && Math.abs(dx) >= (gridLayer ? 0 : 0.6 * spanX)) hy.push((s.y1 + s.y2) / 2);
  }
  const unit: "mm" | "m" = Math.max(spanX, spanY) > 200 ? "mm" : "m";
  const tol = unit === "mm" ? 20 : 0.02;
  const cluster = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b), out: number[] = [];
    for (const x of s) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
    return out;
  };
  const toM = (v: number) => (unit === "mm" ? v / 1000 : v);
  const xs = cluster(vx).map(toM), ys = cluster(hy).map(toM);
  if (xs.length < 2 || ys.length < 2) throw new Error(`พบเส้นกริดไม่พอ (แนวตั้ง ${xs.length}, แนวนอน ${ys.length}) — ควรมีเส้นกริดยาวทั้งสองทิศ หรือเลเยอร์ชื่อ GRID/AXIS`);
  return { xs, ys, unit, lines: use.length, layerHint: gridLayer };
}

/** ช่วงกริด [5, 5, 5, 4] → "3@5,4" */
export function spacingText(pos: number[]): string {
  const d = pos.slice(1).map((v, i) => Math.round((v - pos[i]) * 1000) / 1000).filter((v) => v > 0);
  const out: string[] = [];
  for (let i = 0; i < d.length;) {
    let j = i; while (j + 1 < d.length && Math.abs(d[j + 1] - d[i]) < 1e-6) j++;
    out.push(j > i ? `${j - i + 1}@${d[i]}` : `${d[i]}`);
    i = j + 1;
  }
  return out.join(",");
}
