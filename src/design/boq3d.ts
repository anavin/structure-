// ถอดปริมาณวัสดุ (BOQ) โดยประมาณจากผลออกแบบ 3D: คอนกรีต (m³), แบบหล่อ (m²), เหล็กเสริม (kg แยกขนาด)
// หลักการ (ประมาณ — ไม่รวมเหล็กเสริมทาบ/เหล็กเสริมพิเศษ/ค่าเผื่อสูญเสีย):
//   คาน: คอนกรีตช่วงสุทธิ (หักครึ่งเสาสองข้าง) ความลึกใต้พื้น (h − t ถ้ามีพื้น), แบบหล่อ 2 ข้าง + ท้อง
//        เหล็กล่าง/บนยาวตลอดช่วง L + งอฉาก 12d สองปลาย, ปลอก 2(b−2c)+2(h−2c)+ขอ 2×10d ที่ระยะ s
//   เสา: คอนกรีตเต็มความสูงชั้น (รวมจุดต่อ), แบบหล่อรอบเสาความสูงลบความลึกคาน, เหล็กยืน H + ทาบ 40d, ปลอกเหมือนคาน
//   ฐานราก: L·B·t, แบบหล่อขอบ, เหล็กตะแกรงสองทาง (หุ้ม 75 mm) — ไม่รวมเสาเข็ม (นับเป็นต้น)
//   พื้น: พื้นที่ × t, แบบหล่อท้องพื้น, เหล็กล่างเต็มแผ่นสองทิศ + เหล็กบนยื่น 0.25S จากขอบ (จากผลออกแบบพื้น)
// หน่วยน้ำหนักเหล็ก 0.00617·d² kg/m (d มม.)

import type { Model3 } from "../core3d/model3d.ts";
import type { MemberDesign3 } from "./design3d.ts";
import type { FootingResult3 } from "./footing3d.ts";
import { totalBarsBiax } from "./rcColumnBiaxial.ts";
import type { SlabBar, SlabType } from "./slab3d.ts";
import { detailBarLength } from "./beamDetail.ts";

export const barKgPerM = (d: number) => 0.00617 * d * d;

export type BoqGroup = "คาน" | "คานคอดิน" | "เสา" | "ฐานราก" | "พื้น";
export interface BoqRow { group: BoqGroup; count: number; conc: number; form: number; steel: Record<number, number> }
export interface BoqPrices { conc: number; form: number; steel: number }
export const defaultPrices: BoqPrices = { conc: 2600, form: 350, steel: 28 };
export interface Boq { rows: BoqRow[]; total: { conc: number; form: number; steelKg: number; steel: Record<number, number> }; piles: number; note: string[] }

const add = (o: Record<number, number>, d: number, kg: number) => { if (d > 0 && kg > 0) o[d] = (o[d] ?? 0) + kg; };
const tieLen = (b: number, h: number, c: number, d: number) => 2 * (b - 2 * c) + 2 * (h - 2 * c) + 2 * 10 * d; // mm

export function boq3d(model: Model3, design: Record<string, MemberDesign3>, footings: Record<string, FootingResult3> | null, opts: { cover: number; slabT?: number; slabs?: SlabType[] }): Boq {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const secs = new Map(model.sections.map((s) => [s.id, s]));
  const rows = new Map<BoqGroup, BoqRow>();
  const row = (g: BoqGroup) => { let r = rows.get(g); if (!r) { r = { group: g, count: 0, conc: 0, form: 0, steel: {} }; rows.set(g, r); } return r; };
  const len = (i: string, j: string) => { const a = nodes.get(i)!, b = nodes.get(j)!; return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); };
  // ขนาดเสาที่จุดต่อ (ตามแนวคาน) — ใช้หักช่วงสุทธิของคาน
  const colAt = new Map<string, { b: number; h: number }>();
  for (const m of model.members) if (m.kind === "column") {
    const s = secs.get(m.section); if (!s) continue;
    for (const n of [m.i, m.j]) { const c = colAt.get(n); if (!c || s.b * s.h > c.b * c.h) colAt.set(n, { b: s.b, h: s.h }); }
  }
  const c = opts.cover;
  const t = opts.slabT ?? 0;
  const beamDepthMap = new Map<string, number>(); // ความลึกคานที่หัวเสา (หักแบบหล่อเสา)
  for (const m of model.members) {
    const s = secs.get(m.section); if (!s) continue;
    const L = len(m.i, m.j);
    const d = design[m.id];
    if (m.kind === "beam") {
      const tie = /-0$/.test(m.id);
      const r = row(tie ? "คานคอดิน" : "คาน");
      const alongX = Math.abs(nodes.get(m.j)!.x - nodes.get(m.i)!.x) > 1e-6;
      const half = (n: string) => { const cc = colAt.get(n); return cc ? (alongX ? cc.h : cc.b) / 2 : 0; };
      const clear = Math.max(0, L - half(m.i) - half(m.j));
      const hb = tie ? s.h : Math.max(0, s.h - t);
      r.count++;
      r.conc += s.b * hb * clear;
      r.form += (2 * hb + s.b) * clear;
      for (const n of [m.i, m.j]) beamDepthMap.set(n, Math.max(beamDepthMap.get(n) ?? 0, s.h));
      if (d?.kind === "beam") {
        const inp = d.result.input;
        if (d.detail) for (const b of detailBarLength(d.detail)) add(r.steel, b.dia, b.m * barKgPerM(b.dia));
        else for (const bars of [d.result.bottom.bars, d.result.top.bars]) if (bars) add(r.steel, bars.dia, bars.n * (L + 2 * 12 * bars.dia / 1000) * barKgPerM(bars.dia));
        // เหล็กตามยาวรับแรงบิด: เส้นเพิ่มบน/ล่าง + เหล็กข้าง
        if (d.torsionBars) {
          const tb = d.result.top.bars, bb = d.result.bottom.bars;
          if (tb) add(r.steel, tb.dia, d.torsionBars.top * L * barKgPerM(tb.dia));
          if (bb) add(r.steel, bb.dia, d.torsionBars.bottom * L * barKgPerM(bb.dia));
        }
        if (d.torsion?.side) add(r.steel, d.torsion.side.dia, 2 * d.torsion.side.n * L * barKgPerM(d.torsion.side.dia));
        const sp = d.result.shear.spacing;
        if (sp) {
          const n = Math.ceil((clear * 1000) / sp) + 1;
          const legs = Math.max(2, inp.stirrupLegs);
          const one = tieLen(inp.b, inp.h, inp.cover, inp.stirrupDia) + (legs - 2) * (inp.h - 2 * inp.cover);
          add(r.steel, inp.stirrupDia, n * one / 1000 * barKgPerM(inp.stirrupDia));
        }
      }
    }
  }
  for (const m of model.members) {
    if (m.kind !== "column") continue;
    const s = secs.get(m.section); if (!s) continue;
    const H = len(m.i, m.j);
    const r = row("เสา");
    r.count++;
    r.conc += s.b * s.h * H;
    r.form += 2 * (s.b + s.h) * Math.max(0, H - (beamDepthMap.get(m.j) ?? 0));
    const d = design[m.id];
    if (d?.kind === "column" && d.result.layout) {
      const lay = d.result.layout;
      // เหล็กยืน: ความสูงชั้น + ระยะทาบเหนือพื้น (จากผลออกแบบ, ไม่มี → 40db)
      add(r.steel, lay.dia, totalBarsBiax(lay) * (H + (d.lap ? d.lap.mm / 1000 : 40 * lay.dia / 1000)) * barKgPerM(lay.dia));
      const sp = parseFloat(d.ties.match(/@\s*([\d.]+)/)?.[1] ?? "");
      if (sp > 0) {
        const n = Math.ceil(H / sp) + 1;
        add(r.steel, d.section.tieDia, n * tieLen(d.section.b, d.section.h, d.section.cover, d.section.tieDia) / 1000 * barKgPerM(d.section.tieDia));
      }
    }
  }
  let piles = 0;
  for (const ft of Object.values(footings ?? {})) {
    const r = row("ฐานราก");
    r.count++;
    r.conc += ft.L * ft.B * ft.t;
    r.form += 2 * (ft.L + ft.B) * ft.t;
    piles += ft.piles?.coords.length ?? 0;
    const bars = (txt: string, span: number) => {
      const m = txt.match(/(\d+)DB(\d+)/);
      if (m) add(r.steel, +m[2], +m[1] * Math.max(0, span - 0.15) * barKgPerM(+m[2]));
    };
    bars(ft.barsX, ft.L);
    bars(ft.barsY, ft.B);
  }
  if (t > 0) {
    // พื้น: พื้นที่ภายในขอบอาคารของแต่ละระดับที่มีคาน (ไม่รวมระดับฐาน)
    const levels = new Map<number, { x0: number; x1: number; y0: number; y1: number }>();
    for (const n of model.nodes) {
      if (n.z <= 1e-6) continue;
      const k = Math.round(n.z * 1000);
      const e = levels.get(k) ?? { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      e.x0 = Math.min(e.x0, n.x); e.x1 = Math.max(e.x1, n.x); e.y0 = Math.min(e.y0, n.y); e.y1 = Math.max(e.y1, n.y);
      levels.set(k, e);
    }
    const r = row("พื้น");
    if (opts.slabs?.length) {
      // พื้นที่จากแผ่นพื้นที่มีจริง (หักช่องเปิด)
      r.count = levels.size;
      for (const ty of opts.slabs) { const A = ty.Lx * ty.Ly * ty.panels.length; r.conc += A * t; r.form += A; }
    } else for (const e of levels.values()) {
      const A = (e.x1 - e.x0) * (e.y1 - e.y0);
      r.count++; r.conc += A * t; r.form += A;
    }
    // เหล็กพื้น: ล่างเต็มแผ่นสองทิศ, บนที่ขอบยาว 0.25S เข้าในแผ่น (นับต่อแผ่น)
    for (const ty of opts.slabs ?? []) {
      const S = Math.min(ty.Lx, ty.Ly), L = Math.max(ty.Lx, ty.Ly), res = ty.result;
      const kg = (b: SlabBar | null, len: number, width: number, times = 1) => (b ? times * (Math.floor((width * 1000) / b.s) + 1) * len * barKgPerM(b.dia) : 0);
      const one = (b: SlabBar | null, len: number, width: number, times = 1) => { if (b) add(r.steel, b.dia, ty.panels.length * kg(b, len, width, times)); };
      one(res.short.pos, S, L); one(res.long.pos, L, S);
      one(res.short.negC, 0.25 * S, L); one(res.short.negD, 0.25 * S, L);
      one(res.long.negC, 0.25 * S, S); one(res.long.negD, 0.25 * S, S);
    }
  }
  const order: BoqGroup[] = ["คาน", "คานคอดิน", "เสา", "ฐานราก", "พื้น"];
  const list = order.map((g) => rows.get(g)).filter((r): r is BoqRow => !!r);
  const steel: Record<number, number> = {};
  for (const r of list) for (const [d, kg] of Object.entries(r.steel)) add(steel, +d, kg);
  return {
    rows: list,
    total: { conc: list.reduce((a, r) => a + r.conc, 0), form: list.reduce((a, r) => a + r.form, 0), steelKg: Object.values(steel).reduce((a, v) => a + v, 0), steel },
    piles,
    note: ["ปริมาณโดยประมาณ ไม่รวมเหล็กทาบ/เหล็กเสริมพิเศษ/ค่าเผื่อสูญเสีย", "เหล็กคานตามจุดตัดเหล็กจากรายละเอียดเหล็ก", ...(t > 0 ? [opts.slabs?.length ? "เหล็กพื้น: ล่างเต็มแผ่น, บนยื่น 0.25S จากขอบ" : "ยังไม่รวมเหล็กเสริมพื้น"] : [])],
  };
}

export const boqCost = (b: Boq, p: BoqPrices) => ({ conc: b.total.conc * p.conc, form: b.total.form * p.form, steel: b.total.steelKg * p.steel, get total() { return this.conc + this.form + this.steel; } });
