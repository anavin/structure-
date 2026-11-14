// ออกแบบพื้นสองทาง ค.ส.ล. — วิธีสัมประสิทธิ์โมเมนต์ "วิธีที่ 2" (ACI 318-63 Method 2 ที่ วสท. 1008 ใช้)
//   M = C·wu·S² ต่อความกว้าง 1 m · S = ช่วงสั้น, L = ช่วงยาว, m = S/L (ประมาณค่าเชิงเส้นระหว่างคอลัมน์ตาราง)
//   กรณี 1–5 = จำนวนขอบที่ไม่ต่อเนื่อง 0–4 · m < 0.5 → พื้นทางเดียว (ACI สัมประสิทธิ์ 1/10, 1/11, 1/14, 1/16, 1/24)
//   ความหนาต่ำสุด = เส้นรอบรูป/180 ≥ 80 mm · เหล็กต่ำสุด 0.0025 (SR24) / 0.0020 (SD30) / 0.0018 (SD40) · ระยะห่าง ≤ 2t ≤ 450 mm
//   แรงเฉือน Vu = wu·S/2 ต่อเมตร (แถบช่วงสั้น — ปลอดภัย) ตรวจกับ φVc = φ·0.17√fc'·b·d
// ตารางสัมประสิทธิ์ต้องตรวจกับมาตรฐานฉบับจริงก่อนใช้งาน (แสดงไว้ในรายการคำนวณ)

import { KSC_TO_MPA } from "../core/model.ts";
import type { DesignCode, Step } from "./rcBeam.ts";
import { defaultSlab, KG_M2, parseSpacing, type GridParams } from "../app3d/generator.ts";

export const M_COLS = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5];
type Row = number[] | null;
/** [กรณี] → ช่วงสั้น {ลบขอบต่อเนื่อง, ลบขอบไม่ต่อเนื่อง, บวกกลางช่วง} ตาม m, ช่วงยาว (ทุกค่า m) */
export const METHOD2: Record<1 | 2 | 3 | 4 | 5, { short: { negC: Row; negD: Row; pos: number[] }; long: { negC: number | null; negD: number | null; pos: number } }> = {
  1: { short: { negC: [0.033, 0.040, 0.048, 0.055, 0.063, 0.083], negD: null, pos: [0.025, 0.030, 0.036, 0.041, 0.047, 0.062] }, long: { negC: 0.033, negD: null, pos: 0.025 } },
  2: { short: { negC: [0.041, 0.048, 0.055, 0.062, 0.069, 0.085], negD: [0.021, 0.024, 0.027, 0.031, 0.035, 0.042], pos: [0.031, 0.036, 0.041, 0.047, 0.052, 0.064] }, long: { negC: 0.041, negD: 0.021, pos: 0.031 } },
  3: { short: { negC: [0.049, 0.057, 0.064, 0.071, 0.078, 0.090], negD: [0.025, 0.028, 0.032, 0.036, 0.039, 0.045], pos: [0.037, 0.043, 0.048, 0.054, 0.059, 0.068] }, long: { negC: 0.049, negD: 0.025, pos: 0.037 } },
  4: { short: { negC: [0.058, 0.066, 0.074, 0.082, 0.090, 0.098], negD: [0.029, 0.033, 0.037, 0.041, 0.045, 0.049], pos: [0.044, 0.050, 0.056, 0.062, 0.068, 0.074] }, long: { negC: 0.058, negD: 0.029, pos: 0.044 } },
  5: { short: { negC: null, negD: [0.033, 0.038, 0.043, 0.047, 0.053, 0.055], pos: [0.050, 0.057, 0.064, 0.072, 0.080, 0.083] }, long: { negC: null, negD: 0.033, pos: 0.050 } },
};

export function coef(row: number[], m: number): number {
  if (m >= M_COLS[0]) return row[0];
  if (m <= M_COLS[M_COLS.length - 1]) return row[row.length - 1];
  for (let k = 0; k < M_COLS.length - 1; k++) {
    const a = M_COLS[k], b = M_COLS[k + 1];
    if (m <= a && m >= b) return row[k] + ((row[k + 1] - row[k]) * (a - m)) / (a - b);
  }
  return row[row.length - 1];
}

/** ขอบแผ่น: ต่อเนื่องกับแผ่นข้างเคียงหรือไม่ (x0/x1 = ขอบตั้งฉากแกน X ที่ซ้าย/ขวา, y0/y1 = ล่าง/บน) */
export interface PanelEdges { x0: boolean; x1: boolean; y0: boolean; y1: boolean }

export interface SlabInput {
  code: DesignCode; Lx: number; Ly: number; t: number; edges: PanelEdges;
  /** น้ำหนักบรรทุกคงที่รวมน้ำหนักแผ่นพื้นแล้ว / น้ำหนักจร (kN/m²) */
  wD: number; wL: number;
  fcKsc: number; fyKsc: number; cover?: number;
}
export interface SlabBar { dia: number; s: number; As: number; AsReq: number; Mu: number; label: string }
export interface SlabResult {
  S: number; L: number; m: number; oneWay: boolean; caseNo: number; wu: number; tMin: number;
  /** ทิศสั้น/ยาว: ล่างกลางช่วง, บนที่ขอบต่อเนื่อง, บนที่ขอบไม่ต่อเนื่อง */
  short: { pos: SlabBar; negC: SlabBar | null; negD: SlabBar | null };
  long: { pos: SlabBar; negC: SlabBar | null; negD: SlabBar | null };
  shear: { Vu: number; phiVc: number; ok: boolean };
  ok: boolean; message: string; steps: Step[];
}

const f = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "-");
export const rhoMin = (fyKsc: number) => (fyKsc <= 2400 ? 0.0025 : fyKsc <= 3000 ? 0.002 : 0.0018);
const barName = (d: number) => (d <= 9 ? `RB${d}` : `DB${d}`);

/** เลือกเหล็ก: ขนาดเล็กสุดที่ระยะห่าง ≥ 100 mm (ปัดลงทีละ 25 mm, ไม่เกิน smax) */
export function pickBar(As: number, smax: number, fyKsc: number): { dia: number; s: number; As: number } {
  const dias = fyKsc <= 2400 ? [9, 12, 15] : [10, 12, 16];
  for (const d of dias) {
    const Ab = (Math.PI * d * d) / 4;
    const s = Math.min(Math.floor((1000 * Ab) / As / 25) * 25, smax);
    if (s >= 100) return { dia: d, s, As: (1000 * Ab) / s };
  }
  const d = dias[dias.length - 1], Ab = (Math.PI * d * d) / 4;
  return { dia: d, s: 100, As: (1000 * Ab) / 100 };
}

export function designSlab(inp: SlabInput): SlabResult {
  const fc = inp.fcKsc * KSC_TO_MPA, fy = inp.fyKsc * KSC_TO_MPA;
  const cover = inp.cover ?? 20;
  const tmm = inp.t * 1000;
  const shortX = inp.Lx <= inp.Ly;
  const S = Math.min(inp.Lx, inp.Ly), L = Math.max(inp.Lx, inp.Ly), m = S / L;
  // ขอบที่รองรับช่วงสั้น = ขอบยาว (ตั้งฉากกับทิศสั้น)
  const sEdges = shortX ? [inp.edges.x0, inp.edges.x1] : [inp.edges.y0, inp.edges.y1];
  const lEdges = shortX ? [inp.edges.y0, inp.edges.y1] : [inp.edges.x0, inp.edges.x1];
  const nDisc = [...sEdges, ...lEdges].filter((c) => !c).length;
  const caseNo = (nDisc + 1) as 1 | 2 | 3 | 4 | 5;
  const wu = inp.code === "ACI" ? 1.2 * inp.wD + 1.6 * inp.wL : 1.4 * inp.wD + 1.7 * inp.wL;
  const oneWay = m < 0.5;
  const phi = 0.9;
  const amin = rhoMin(inp.fyKsc) * 1000 * tmm;
  const steps: Step[] = [];

  const bar = (Mu: number, d: number, smax: number, label: string): SlabBar => {
    const Rn = (Mu * 1e6) / (phi * 1000 * d * d);
    const inner = 1 - (2 * Rn) / (0.85 * fc);
    const rho = inner > 0 ? ((0.85 * fc) / fy) * (1 - Math.sqrt(inner)) : Infinity;
    const AsReq = Math.max(rho * 1000 * d, amin);
    const p = pickBar(AsReq, smax, inp.fyKsc);
    return { dia: p.dia, s: p.s, As: p.As, AsReq, Mu, label: `${barName(p.dia)} @ ${(p.s / 1000).toFixed(3)}` };
  };
  const dS = tmm - cover - 6, dL = tmm - cover - 12 - 6; // เหล็กทิศสั้นอยู่ชั้นล่างสุด
  const smaxMain = Math.min(2 * tmm, 450);

  let short: SlabResult["short"], long: SlabResult["long"];
  if (!oneWay) {
    const C = METHOD2[caseNo];
    const csPos = coef(C.short.pos, m), csC = C.short.negC ? coef(C.short.negC, m) : 0, csD = C.short.negD ? coef(C.short.negD, m) : 0;
    const MS = (c: number) => c * wu * S * S, ML = (c: number) => c * wu * S * S;
    const anyC = (e: boolean[]) => e.some((x) => x), anyD = (e: boolean[]) => e.some((x) => !x);
    short = {
      pos: bar(MS(csPos), dS, smaxMain, "ล่าง"),
      negC: anyC(sEdges) && csC ? bar(MS(csC), dS, smaxMain, "บนขอบต่อเนื่อง") : null,
      negD: anyD(sEdges) && csD ? bar(MS(csD), dS, smaxMain, "บนขอบไม่ต่อเนื่อง") : null,
    };
    long = {
      pos: bar(ML(C.long.pos), dL, smaxMain, "ล่าง"),
      negC: anyC(lEdges) && C.long.negC ? bar(ML(C.long.negC), dL, smaxMain, "บนขอบต่อเนื่อง") : null,
      negD: anyD(lEdges) && C.long.negD ? bar(ML(C.long.negD), dL, smaxMain, "บนขอบไม่ต่อเนื่อง") : null,
    };
    steps.push({ label: "กรณี (วิธีที่ 2)", expr: `ขอบไม่ต่อเนื่อง ${nDisc} ด้าน`, value: `กรณี ${caseNo}` });
    steps.push({ label: "สัมประสิทธิ์ทิศสั้น", expr: `m = ${f(m, 3)}: ลบต่อเนื่อง / ลบไม่ต่อเนื่อง / บวก`, value: `${f(csC, 4)} / ${f(csD, 4)} / ${f(csPos, 4)}` });
    steps.push({ label: "สัมประสิทธิ์ทิศยาว", expr: "ลบต่อเนื่อง / ลบไม่ต่อเนื่อง / บวก", value: `${f(C.long.negC ?? 0, 3)} / ${f(C.long.negD ?? 0, 3)} / ${f(C.long.pos, 3)}` });
  } else {
    // พื้นทางเดียว (ช่วงสั้น): สัมประสิทธิ์ ACI 6.5.2
    const cont = sEdges.filter((x) => x).length;
    const kPos = cont === 2 ? 1 / 16 : 1 / 14, kNegC = cont === 1 ? 1 / 10 : 1 / 11, kNegD = 1 / 24;
    const M = (k: number) => k * wu * S * S;
    short = {
      pos: bar(M(kPos), dS, Math.min(3 * tmm, 450), "ล่าง"),
      negC: cont ? bar(M(kNegC), dS, Math.min(3 * tmm, 450), "บนขอบต่อเนื่อง") : null,
      negD: cont < 2 ? bar(M(kNegD), dS, Math.min(3 * tmm, 450), "บนขอบไม่ต่อเนื่อง") : null,
    };
    long = { pos: bar(0, dL, Math.min(5 * tmm, 450), "เหล็กกันร้าว"), negC: null, negD: null };
    steps.push({ label: "พื้นทางเดียว", expr: `m = ${f(m, 3)} < 0.5 — สัมประสิทธิ์ ACI: บวก 1/${Math.round(1 / kPos)}, ลบต่อเนื่อง 1/${Math.round(1 / kNegC)}, ลบไม่ต่อเนื่อง 1/24`, value: "ทิศยาวใช้เหล็กกันร้าว" });
  }
  const tMin = Math.max((2 * (inp.Lx + inp.Ly) * 1000) / 180, 80);
  const tOk = oneWay ? tmm >= Math.max(((S * 1000) / (sEdges.every((x) => x) ? 28 : sEdges.some((x) => x) ? 24 : 20)), 80) : tmm >= tMin - 1e-6;
  const phiV = inp.code === "ACI" ? 0.75 : 0.85;
  // แรงเฉือนต่อเมตรที่ขอบยาว: แถบกว้าง 1 m ช่วง S (ค่าสูงสุด ปลอดภัย) — ทางเดียวคูณ 1.15 ที่ฐานรองรับในตัวแรก
  const Vu = (oneWay ? 1.15 : 1) * wu * S / 2;
  const phiVc = (phiV * 0.17 * Math.sqrt(fc) * 1000 * dS) / 1000;
  const shear = { Vu, phiVc, ok: Vu <= phiVc };
  const all = [short.pos, short.negC, short.negD, long.pos, long.negC, long.negD].filter((x): x is SlabBar => !!x);
  const steelOk = all.every((b) => Number.isFinite(b.AsReq) && b.As >= b.AsReq - 1e-6);
  const ok = tOk && shear.ok && steelOk;

  steps.unshift(
    { label: "ขนาดแผ่น", expr: `S × L (m = S/L)`, value: `${f(S)} × ${f(L)} m (m = ${f(m, 3)})${oneWay ? " — ทางเดียว" : ""}` },
    { label: "น้ำหนักประลัย", expr: inp.code === "ACI" ? "wu = 1.2D + 1.6L" : "wu = 1.4D + 1.7L", value: `${f(wu)} kN/m²` },
    { label: "ความหนา", expr: oneWay ? "t ≥ S/20…28 ≥ 80 mm" : "t ≥ เส้นรอบรูป/180 ≥ 80 mm", value: `${f(tmm, 0)} mm ${tOk ? "≥" : "<"} ${f(oneWay ? Math.max((S * 1000) / 24, 80) : tMin, 0)} mm`, ok: tOk },
  );
  const row = (dir: string, b: SlabBar | null) => b && steps.push({ label: `${dir} ${b.label}`, expr: `Mu = ${f(b.Mu)} kN·m/m, As ≥ ${f(b.AsReq, 0)} mm²/m`, value: `${b.label} (${f(b.As, 0)} mm²/m)`, ok: Number.isFinite(b.AsReq) && b.As >= b.AsReq - 1e-6 });
  row("ทิศสั้น", short.pos); row("ทิศสั้น", short.negC); row("ทิศสั้น", short.negD);
  row("ทิศยาว", long.pos); row("ทิศยาว", long.negC); row("ทิศยาว", long.negD);
  steps.push({ label: "แรงเฉือน", expr: "Vu ≤ φ·0.17√fc'·b·d", value: `${f(Vu)} ≤ ${f(phiVc)} kN/m`, ok: shear.ok });

  return {
    S, L, m, oneWay, caseNo, wu, tMin, short, long, shear, ok,
    message: ok ? `${barName(short.pos.dia)}@${short.pos.s / 1000}` : !tOk ? "พื้นบางเกินไป" : !shear.ok ? "แรงเฉือนเกิน — เพิ่มความหนา" : "เหล็กเสริมไม่พอ — เพิ่มความหนา",
    steps,
  };
}

// ---------- แผ่นพื้นทั้งอาคาร ----------

export interface SlabType {
  mark: string; result: SlabResult; Lx: number; Ly: number; edges: PanelEdges; roof: boolean;
  /** แผ่นทั้งหมดของแบบนี้: ระดับ k, ช่องกริด i (X), j (Y) */
  panels: { k: number; i: number; j: number }[];
}

/** ออกแบบทุกแผ่น (ทุกช่องกริดทุกชั้น ยกเว้นระดับฐาน) แล้วรวมแผ่นที่ผลเหมือนกันเป็นแบบ S-1, S-2 … เรียงตามจำนวน */
export function designBuildingSlabs(p: GridParams, code: DesignCode): SlabType[] {
  const s = { ...defaultSlab, ...(p.slab ?? {}) };
  if (!s.enabled) return [];
  const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing), nz = parseSpacing(p.storeys).length;
  const groups = new Map<string, SlabType>();
  for (let k = 1; k <= nz; k++) {
    const roof = k === nz;
    const wD = 24 * s.t + (roof ? s.sdlRoof : s.sdl) * KG_M2, wL = (roof ? s.llRoof : s.ll) * KG_M2;
    for (let j = 0; j < dy.length; j++) for (let i = 0; i < dx.length; i++) {
      const edges = { x0: i > 0, x1: i < dx.length - 1, y0: j > 0, y1: j < dy.length - 1 };
      const key = `${dx[i]}|${dy[j]}|${+edges.x0}${+edges.x1}${+edges.y0}${+edges.y1}|${roof}`;
      let g = groups.get(key);
      if (!g) {
        const result = designSlab({ code, Lx: dx[i], Ly: dy[j], t: s.t, edges, wD, wL, fcKsc: p.fcKsc, fyKsc: p.fyKsc });
        g = { mark: "", result, Lx: dx[i], Ly: dy[j], edges, roof, panels: [] };
        groups.set(key, g);
      }
      g.panels.push({ k, i, j });
    }
  }
  // รวมแผ่นที่ได้เหล็กเหมือนกันทุกตำแหน่งเป็นแบบเดียว
  const sig = (r: SlabResult) => [r.short.pos, r.short.negC, r.short.negD, r.long.pos, r.long.negC, r.long.negD].map((b) => (b ? b.label : "-")).join("|");
  const merged = new Map<string, SlabType>();
  for (const g of groups.values()) {
    const kk = `${Math.min(g.Lx, g.Ly)}x${Math.max(g.Lx, g.Ly)}|${sig(g.result)}|${g.result.ok}`;
    const m = merged.get(kk);
    if (m) {
      m.panels.push(...g.panels);
      // แสดงผลคำนวณของกรณีวิกฤต (wu มากสุด) ของแบบนั้น
      if (g.result.wu > m.result.wu) { m.result = g.result; m.roof = g.roof; m.edges = g.edges; m.Lx = g.Lx; m.Ly = g.Ly; }
    } else merged.set(kk, { ...g, panels: [...g.panels] });
  }
  return [...merged.values()].sort((a, b) => b.panels.length - a.panels.length).map((g, n) => ({ ...g, mark: `S-${n + 1}` }));
}

export const panelName = (q: { k: number; i: number; j: number }) => `ชั้น ${q.k} ช่อง ${String.fromCharCode(65 + q.j)}${q.i + 1}`;
