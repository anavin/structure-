import { concreteE, type Model } from "../core/model.ts";

/** ตัวอย่าง: โครง ค.ส.ล. 2 ชั้น 2 ช่วง (ฐานยึดแน่น) */
export function sampleModel(): Model {
  const xs = [0, 5, 9];
  const ys = [0, 3.5, 6.5];
  const nodes = [] as Model["nodes"];
  let k = 1;
  const id: Record<string, string> = {};
  for (const y of ys) for (const x of xs) {
    const nid = `N${k++}`;
    nodes.push({ id: nid, x, y });
    id[`${x},${y}`] = nid;
  }
  const members = [] as Model["members"];
  let c = 1, b = 1;
  for (let yi = 0; yi < ys.length - 1; yi++) for (const x of xs) {
    members.push({ id: `C${c++}`, i: id[`${x},${ys[yi]}`], j: id[`${x},${ys[yi + 1]}`], section: "C30", kind: "column" });
  }
  for (let yi = 1; yi < ys.length; yi++) for (let xi = 0; xi < xs.length - 1; xi++) {
    members.push({ id: `B${b++}`, i: id[`${xs[xi]},${ys[yi]}`], j: id[`${xs[xi + 1]},${ys[yi]}`], section: "B2550", kind: "beam" });
  }
  const floorBeams = ["B1", "B2"], roofBeams = ["B3", "B4"];
  return {
    name: "อาคาร ค.ส.ล. 2 ชั้น (ตัวอย่าง)",
    nodes,
    supports: xs.map((x) => ({ node: id[`${x},0`], ux: true, uy: true, rz: true })),
    materials: [{ id: "C240", name: "คอนกรีต fc' 240 ksc", E: concreteE(240), gamma: 24, fc: 240, fy: 4000, fyt: 2400 }],
    sections: [
      { id: "B2550", name: "คาน 25×50", material: "C240", b: 0.25, h: 0.5 },
      { id: "C30", name: "เสา 30×30", material: "C240", b: 0.3, h: 0.3 },
    ],
    members,
    loadCases: [
      {
        id: "DL", name: "น้ำหนักบรรทุกคงที่", selfWeight: true, loads: [
          ...floorBeams.map((m) => ({ type: "udl" as const, member: m, dir: "globalY" as const, w: -12 })),
          ...roofBeams.map((m) => ({ type: "udl" as const, member: m, dir: "globalY" as const, w: -8 })),
        ],
      },
      {
        id: "LL", name: "น้ำหนักบรรทุกจร", selfWeight: false, loads: [
          ...floorBeams.map((m) => ({ type: "udl" as const, member: m, dir: "globalY" as const, w: -6 })),
          ...roofBeams.map((m) => ({ type: "udl" as const, member: m, dir: "globalY" as const, w: -2 })),
        ],
      },
      {
        id: "WL", name: "แรงลม (+X)", selfWeight: false, loads: [
          { type: "nodal", node: id["0,3.5"], fx: 6, fy: 0, mz: 0 },
          { type: "nodal", node: id["0,6.5"], fx: 4, fy: 0, mz: 0 },
        ],
      },
    ],
    combos: [
      { id: "U1", name: "1.4D + 1.7L", factors: { DL: 1.4, LL: 1.7, WL: 0 } },
      { id: "U2", name: "0.75(1.4D + 1.7L + 1.7W)", factors: { DL: 1.05, LL: 1.275, WL: 1.275 } },
      { id: "U3", name: "0.75(1.4D + 1.7L − 1.7W)", factors: { DL: 1.05, LL: 1.275, WL: -1.275 } },
      { id: "U4", name: "0.9D + 1.3W", factors: { DL: 0.9, LL: 0, WL: 1.3 } },
      { id: "U5", name: "0.9D − 1.3W", factors: { DL: 0.9, LL: 0, WL: -1.3 } },
    ],
  };
}
