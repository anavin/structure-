// ตัวอย่างโครงข้อแข็ง 2D 3 แบบ (โหมด 2D)
import { concreteE, type Model } from "../core/model.ts";
import { sampleModel } from "./sample.ts";

interface FrameSpec {
  name: string; xs: number[]; ys: number[];
  col: [number, number]; beam: [number, number]; fc: number;
  floor: [number, number]; roof: [number, number]; // [DL, LL] kN/m บนคาน
  wind: number[]; // แรงลมที่จุดซ้ายสุดของแต่ละชั้น (kN) ล่าง → บน
  analysis?: Model["analysis"];
}

function frameModel(s: FrameSpec): Model {
  const nodes: Model["nodes"] = [];
  const id: Record<string, string> = {};
  let k = 1;
  for (const y of s.ys) for (const x of s.xs) { const n = `N${k++}`; nodes.push({ id: n, x, y }); id[`${x},${y}`] = n; }
  const members: Model["members"] = [];
  let c = 1, b = 1;
  for (let yi = 0; yi < s.ys.length - 1; yi++) for (const x of s.xs) members.push({ id: `C${c++}`, i: id[`${x},${s.ys[yi]}`], j: id[`${x},${s.ys[yi + 1]}`], section: "COL", kind: "column" });
  const beamsAt: string[][] = [];
  for (let yi = 1; yi < s.ys.length; yi++) {
    const row: string[] = [];
    for (let xi = 0; xi < s.xs.length - 1; xi++) { const mid = `B${b++}`; row.push(mid); members.push({ id: mid, i: id[`${s.xs[xi]},${s.ys[yi]}`], j: id[`${s.xs[xi + 1]},${s.ys[yi]}`], section: "BEAM", kind: "beam" }); }
    beamsAt.push(row);
  }
  const top = beamsAt.length - 1;
  const udl = (lvl: number, w: number) => beamsAt[lvl].map((m) => ({ type: "udl" as const, member: m, dir: "globalY" as const, w: -w }));
  const cm = (v: number) => Math.round(v * 100);
  return {
    name: s.name, nodes, members,
    supports: s.xs.map((x) => ({ node: id[`${x},${s.ys[0]}`], ux: true, uy: true, rz: true })),
    materials: [{ id: "CONC", name: `คอนกรีต fc' ${s.fc} ksc`, E: concreteE(s.fc), gamma: 24, fc: s.fc, fy: 4000, fyt: 2400 }],
    sections: [
      { id: "BEAM", name: `คาน ${cm(s.beam[0])}×${cm(s.beam[1])}`, material: "CONC", b: s.beam[0], h: s.beam[1] },
      { id: "COL", name: `เสา ${cm(s.col[0])}×${cm(s.col[1])}`, material: "CONC", b: s.col[0], h: s.col[1] },
    ],
    loadCases: [
      { id: "DL", name: "น้ำหนักบรรทุกคงที่", selfWeight: true, loads: beamsAt.flatMap((_, l) => udl(l, l === top ? s.roof[0] : s.floor[0])) },
      { id: "LL", name: "น้ำหนักบรรทุกจร", selfWeight: false, loads: beamsAt.flatMap((_, l) => udl(l, l === top ? s.roof[1] : s.floor[1])) },
      { id: "WL", name: "แรงลม (+X)", selfWeight: false, lateral: true, loads: s.wind.map((F, l) => ({ type: "nodal" as const, node: id[`${s.xs[0]},${s.ys[l + 1]}`], fx: F, fy: 0, mz: 0 })) },
    ],
    combos: [
      { id: "U1", name: "1.4D + 1.7L", factors: { DL: 1.4, LL: 1.7, WL: 0 } },
      { id: "U2", name: "0.75(1.4D + 1.7L + 1.7W)", factors: { DL: 1.05, LL: 1.275, WL: 1.275 } },
      { id: "U3", name: "0.75(1.4D + 1.7L − 1.7W)", factors: { DL: 1.05, LL: 1.275, WL: -1.275 } },
      { id: "U4", name: "0.9D + 1.3W", factors: { DL: 0.9, LL: 0, WL: 1.3 } },
      { id: "U5", name: "0.9D − 1.3W", factors: { DL: 0.9, LL: 0, WL: -1.3 } },
    ],
    analysis: s.analysis,
  };
}

export interface Example2D { id: string; label: string; desc: string; make: () => Model }

export const EXAMPLES_2D: Example2D[] = [
  { id: "frame2", label: "อาคาร 2 ชั้น 2 ช่วง", desc: "ตัวอย่างพื้นฐาน ฐานยึดแน่น", make: sampleModel },
  {
    id: "portal", label: "โครงหลังคาช่วงกว้าง 12 m", desc: "ชั้นเดียว สูง 5 m คานลึก 80 cm",
    make: () => frameModel({ name: "โครงหลังคาช่วงกว้าง 12 m (ตัวอย่าง)", xs: [0, 12], ys: [0, 5], col: [0.4, 0.4], beam: [0.3, 0.8], fc: 280, floor: [10, 3], roof: [10, 3], wind: [10] }),
  },
  {
    id: "frame5", label: "อาคาร 5 ชั้น 3 ช่วง", desc: "P-Δ + หน้าตัดแตกร้าว แรงลมทุกชั้น",
    make: () => frameModel({
      name: "อาคาร 5 ชั้น 3 ช่วง (ตัวอย่าง)", xs: [0, 6, 12, 18], ys: [0, 4, 7.5, 11, 14.5, 18],
      col: [0.45, 0.45], beam: [0.3, 0.6], fc: 320, floor: [20, 10], roof: [10, 3], wind: [8, 9, 10, 11, 6],
      analysis: { pDelta: true, cracked: true },
    }),
  },
];
