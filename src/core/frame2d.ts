// ตัววิเคราะห์โครงข้อแข็ง 2 มิติด้วยวิธีความแข็งโดยตรง (Direct Stiffness Method)
// สมมติฐาน: วัสดุยืดหยุ่นเชิงเส้น, การเสียรูปน้อย (first-order), Euler–Bernoulli beam
//
// อนุสัญญาเครื่องหมาย
//  - แกน global: X ขวา, Y ขึ้น, โมเมนต์ทวนเข็มนาฬิกาเป็นบวก
//  - แกน local ของชิ้นส่วน: x จาก i ไป j, y หมุนทวนเข็ม 90° จาก x
//  - แผนภาพแรงภายใน: N แรงดึงเป็นบวก, V ตามอนุสัญญาคาน, M โมเมนต์บวก (ท้องช้าง/sagging) เมื่อมองตามแกน local

import { choleskySolve } from "./linalg.ts";
import type { Load, Member, Model } from "./model.ts";
import { sectionProps } from "./model.ts";

export interface NodeDisp { ux: number; uy: number; rz: number }
export interface Reaction { fx: number; fy: number; mz: number }
export interface Station { x: number; N: number; V: number; M: number; v: number }

export interface MemberResult {
  id: string;
  L: number;
  c: number;
  s: number;
  /** แรงปลายชิ้นส่วนในแกน local ที่จุดต่อกระทำต่อชิ้นส่วน [Ni, Vi, Mi, Nj, Vj, Mj] */
  endForces: number[];
  stations: Station[];
  /** ค่าสุดขีดตามความยาว */
  maxM: number; minM: number; maxAbsV: number; maxN: number; minN: number;
}

export interface AnalysisResult {
  disp: Record<string, NodeDisp>;
  reactions: Record<string, Reaction>;
  members: Record<string, MemberResult>;
  /** ผลรวมแรงกระทำ global (ใช้ตรวจสมดุล) */
  appliedTotal: { fx: number; fy: number };
  info?: { pDelta: boolean; iterations: number; converged: boolean };
}

interface LocalLoads {
  wx: number; wy: number; // แรงแผ่ในแกน local (kN/m)
  points: { a: number; px: number; py: number }[];
}

const EPS_X = 1e-9;

export function memberGeometry(model: Model, m: Member) {
  const ni = model.nodes.find((n) => n.id === m.i);
  const nj = model.nodes.find((n) => n.id === m.j);
  if (!ni || !nj) throw new Error(`ชิ้นส่วน ${m.id}: ไม่พบจุดต่อ ${!ni ? m.i : m.j}`);
  const dx = nj.x - ni.x;
  const dy = nj.y - ni.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) throw new Error(`ชิ้นส่วน ${m.id}: ความยาวเป็นศูนย์`);
  return { L, c: dx / L, s: dy / L };
}

function memberStiffnessProps(model: Model, m: Member) {
  const sec = model.sections.find((s) => s.id === m.section);
  if (!sec) throw new Error(`ชิ้นส่วน ${m.id}: ไม่พบหน้าตัด ${m.section}`);
  const mat = model.materials.find((x) => x.id === sec.material);
  if (!mat) throw new Error(`หน้าตัด ${sec.id}: ไม่พบวัสดุ ${sec.material}`);
  const { A, I } = sectionProps(sec);
  return { E: mat.E, A, I, gamma: mat.gamma };
}

function localK(E: number, A: number, I: number, L: number): number[][] {
  const a = (E * A) / L;
  const b = (12 * E * I) / L ** 3;
  const c = (6 * E * I) / L ** 2;
  const d = (4 * E * I) / L;
  const e = (2 * E * I) / L;
  return [
    [a, 0, 0, -a, 0, 0],
    [0, b, c, 0, -b, c],
    [0, c, d, 0, -c, e],
    [-a, 0, 0, a, 0, 0],
    [0, -b, -c, 0, b, -c],
    [0, c, e, 0, -c, d],
  ];
}

/** แปลงเวกเตอร์ global (gx, gy) เป็น local */
function toLocal(c: number, s: number, gx: number, gy: number) {
  return { lx: c * gx + s * gy, ly: -s * gx + c * gy };
}

function loadVec(dir: "globalY" | "globalX" | "local", v: number, c: number, s: number) {
  if (dir === "local") return { lx: 0, ly: v };
  return dir === "globalY" ? toLocal(c, s, 0, v) : toLocal(c, s, v, 0);
}

/** แรงเทียบเท่าที่จุดต่อ (equivalent nodal loads) ในแกน local */
function equivalentLocal(ll: LocalLoads, L: number): number[] {
  const f = [0, 0, 0, 0, 0, 0];
  f[0] += (ll.wx * L) / 2;
  f[3] += (ll.wx * L) / 2;
  f[1] += (ll.wy * L) / 2;
  f[2] += (ll.wy * L * L) / 12;
  f[4] += (ll.wy * L) / 2;
  f[5] -= (ll.wy * L * L) / 12;
  for (const p of ll.points) {
    const a = p.a;
    const b = L - a;
    f[0] += (p.px * b) / L;
    f[3] += (p.px * a) / L;
    f[1] += (p.py * b * b * (3 * a + b)) / L ** 3;
    f[2] += (p.py * a * b * b) / L ** 2;
    f[4] += (p.py * a * a * (a + 3 * b)) / L ** 3;
    f[5] -= (p.py * a * a * b) / L ** 2;
  }
  return f;
}

/** ตรวจความถูกต้องของโมเดลเบื้องต้น คืนรายการข้อผิดพลาด */
export function validateModel(model: Model): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const n of model.nodes) {
    if (ids.has(n.id)) errs.push(`จุดต่อ ${n.id} ซ้ำ`);
    ids.add(n.id);
  }
  for (const m of model.members) {
    try {
      memberGeometry(model, m);
      memberStiffnessProps(model, m);
    } catch (e) {
      errs.push((e as Error).message);
    }
  }
  if (model.supports.length === 0) errs.push("ยังไม่มีจุดรองรับ");
  for (const s of model.supports) {
    if (!ids.has(s.node)) errs.push(`จุดรองรับอ้างถึงจุดต่อ ${s.node} ที่ไม่มีอยู่`);
  }
  return errs;
}

/**
 * วิเคราะห์โครงสร้างภายใต้ชุดแรงที่กำหนด
 * @param loads แรงกระทำ (คูณตัวคูณแล้ว)
 * @param selfWeightFactor ตัวคูณน้ำหนักตัวเอง (0 = ไม่คิด)
 */
export interface AnalyzeOptions {
  /** ตัวคูณโมเมนต์ความเฉื่อย เช่น หน้าตัดแตกร้าว (เสา 0.70, คาน 0.35) */
  iFactor?: (m: Member) => number;
  /** วิเคราะห์อันดับสอง P-Delta (เมทริกซ์ความแข็งเรขาคณิต วนซ้ำจนลู่เข้า) */
  pDelta?: boolean;
  maxIter?: number;
  tol?: number;
}

/** เมทริกซ์ความแข็งเรขาคณิต (consistent) ในแกน local — N แรงดึงเป็นบวก */
export function localKg(N: number, L: number): number[][] {
  const a = N / L;
  return [
    [0, 0, 0, 0, 0, 0],
    [0, (6 / 5) * a, (L / 10) * a, 0, (-6 / 5) * a, (L / 10) * a],
    [0, (L / 10) * a, ((2 * L * L) / 15) * a, 0, (-L / 10) * a, ((-L * L) / 30) * a],
    [0, 0, 0, 0, 0, 0],
    [0, (-6 / 5) * a, (-L / 10) * a, 0, (6 / 5) * a, (-L / 10) * a],
    [0, (L / 10) * a, ((-L * L) / 30) * a, 0, (-L / 10) * a, ((2 * L * L) / 15) * a],
  ];
}

/** ปลดโมเมนต์ที่ DOF r (2 = ปลาย i, 5 = ปลาย j) ด้วย static condensation */
function condense(k: number[][], feq: number[], rs: number[]): { k: number[][]; feq: number[] } {
  let K = k.map((r) => [...r]);
  let f = [...feq];
  for (const r of rs) {
    const krr = K[r][r];
    if (Math.abs(krr) < 1e-14) continue;
    const Kn = K.map((row, a) => row.map((v, b) => v - (K[a][r] * K[r][b]) / krr));
    const fn = f.map((v, a) => v - (K[a][r] * f[r]) / krr);
    for (let a = 0; a < 6; a++) { Kn[r][a] = 0; Kn[a][r] = 0; }
    fn[r] = 0;
    K = Kn; f = fn;
  }
  return { k: K, feq: f };
}

function releasedDofs(m: Member): number[] {
  const r: number[] = [];
  if (m.releaseI) r.push(2);
  if (m.releaseJ) r.push(5);
  return r;
}

/** หามุมหมุนที่ปลายที่ปลดโมเมนต์ จากเงื่อนไขโมเมนต์ปลาย = 0 */
function solveReleased(k: number[][], feq: number[], d: number[], rs: number[]): number[] {
  const out = [...d];
  if (!rs.length) return out;
  const rhs = rs.map((r) => {
    let s = feq[r];
    for (let c = 0; c < 6; c++) if (!rs.includes(c)) s -= k[r][c] * d[c];
    return s;
  });
  if (rs.length === 1) {
    out[rs[0]] = rhs[0] / k[rs[0]][rs[0]];
  } else {
    const [p, q] = rs;
    const a = k[p][p], b = k[p][q], c = k[q][p], dd = k[q][q];
    const det = a * dd - b * c;
    out[p] = (rhs[0] * dd - b * rhs[1]) / det;
    out[q] = (a * rhs[1] - c * rhs[0]) / det;
  }
  return out;
}

export function analyze(model: Model, loads: Load[], selfWeightFactor = 0, opts: AnalyzeOptions = {}): AnalysisResult {
  const errs = validateModel(model);
  if (errs.length) throw new Error(errs.join("\n"));

  // จุดต่อที่ไม่มีชิ้นส่วนมาต่อ จะถูกยึดทุก DOF อัตโนมัติ (ไม่ทำให้เมทริกซ์เอกฐาน)
  const connected = new Set(model.members.flatMap((m) => [m.i, m.j]));
  const nodeIndex = new Map(model.nodes.map((n, k) => [n.id, k]));
  const ndof = model.nodes.length * 3;
  const restrained = new Array<boolean>(ndof).fill(false);
  for (const n of model.nodes) if (!connected.has(n.id)) {
    const k = nodeIndex.get(n.id)! * 3;
    restrained[k] = restrained[k + 1] = restrained[k + 2] = true;
  }
  const supported = new Array<boolean>(ndof).fill(false);
  for (const s of model.supports) {
    const k = nodeIndex.get(s.node)! * 3;
    if (s.ux) restrained[k] = supported[k] = true;
    if (s.uy) restrained[k + 1] = supported[k + 1] = true;
    if (s.rz) restrained[k + 2] = supported[k + 2] = true;
  }
  // จุดต่อที่ทุกชิ้นส่วนปลดโมเมนต์ (เช่น จุดต่อโครงถัก) — มุมหมุนไม่มีความแข็ง จึงยึดไว้โดยไม่มีผลต่อแรง
  for (const n of model.nodes) {
    const ms = model.members.filter((m) => m.i === n.id || m.j === n.id);
    if (!ms.length) continue;
    const allReleased = ms.every((m) => (m.i === n.id ? m.releaseI : m.releaseJ));
    if (allReleased) restrained[nodeIndex.get(n.id)! * 3 + 2] = true;
  }

  // แรงบนชิ้นส่วนในแกน local
  const memberLoads = new Map<string, LocalLoads>();
  const geo = new Map<string, { L: number; c: number; s: number; E: number; A: number; I: number; gamma: number }>();
  for (const m of model.members) {
    const g = { ...memberGeometry(model, m), ...memberStiffnessProps(model, m) };
    if (opts.iFactor) g.I *= opts.iFactor(m);
    geo.set(m.id, g);
    const ll: LocalLoads = { wx: 0, wy: 0, points: [] };
    if (selfWeightFactor !== 0) {
      const v = loadVec("globalY", -g.gamma * g.A * selfWeightFactor, g.c, g.s);
      ll.wx += v.lx; ll.wy += v.ly;
    }
    memberLoads.set(m.id, ll);
  }

  const Fnodal = new Float64Array(ndof);
  let appFx = 0;
  let appFy = 0;
  for (const ld of loads) {
    if (ld.type === "nodal") {
      const k = nodeIndex.get(ld.node);
      if (k === undefined) throw new Error(`แรงที่จุดต่อ ${ld.node}: ไม่พบจุดต่อ`);
      Fnodal[k * 3] += ld.fx; Fnodal[k * 3 + 1] += ld.fy; Fnodal[k * 3 + 2] += ld.mz;
      appFx += ld.fx; appFy += ld.fy;
      continue;
    }
    const g = geo.get(ld.member);
    const ll = memberLoads.get(ld.member);
    if (!g || !ll) throw new Error(`แรงบนชิ้นส่วน ${ld.member}: ไม่พบชิ้นส่วน`);
    if (ld.type === "udl") {
      const v = loadVec(ld.dir, ld.w, g.c, g.s);
      ll.wx += v.lx; ll.wy += v.ly;
    } else {
      if (ld.a < 0 || ld.a > g.L) throw new Error(`แรงจุดบน ${ld.member}: ระยะ a=${ld.a} อยู่นอกชิ้นส่วน (L=${g.L.toFixed(3)})`);
      const v = loadVec(ld.dir, ld.P, g.c, g.s);
      ll.points.push({ a: ld.a, px: v.lx, py: v.ly });
    }
  }
  for (const m of model.members) {
    const g = geo.get(m.id)!;
    const ll = memberLoads.get(m.id)!;
    appFx += (g.c * ll.wx - g.s * ll.wy) * g.L;
    appFy += (g.s * ll.wx + g.c * ll.wy) * g.L;
    for (const p of ll.points) { appFx += g.c * p.px - g.s * p.py; appFy += g.s * p.px + g.c * p.py; }
  }

  const free: number[] = [];
  for (let d = 0; d < ndof; d++) if (!restrained[d]) free.push(d);
  const nf = free.length;

  type MData = { kt: number[][]; feq: number[]; ktC: number[][]; feqC: number[]; dofs: number[]; rs: number[] };
  const assemble = (axial: Map<string, number>) => {
    const K = new Float64Array(ndof * ndof);
    const F = new Float64Array(Fnodal);
    const data = new Map<string, MData>();
    for (const m of model.members) {
      const g = geo.get(m.id)!;
      let kt = localK(g.E, g.A, g.I, g.L);
      const N = axial.get(m.id) ?? 0;
      if (N !== 0) {
        const kg = localKg(N, g.L);
        kt = kt.map((r, a) => r.map((v, b) => v + kg[a][b]));
      }
      const feq = equivalentLocal(memberLoads.get(m.id)!, g.L);
      const rs = releasedDofs(m);
      const { k: ktC, feq: feqC } = condense(kt, feq, rs);
      const T = transform(g.c, g.s);
      const kG = mul(transpose(T), mul(ktC, T));
      const feqG = mulVec(transpose(T), feqC);
      const ii = nodeIndex.get(m.i)! * 3;
      const jj = nodeIndex.get(m.j)! * 3;
      const dofs = [ii, ii + 1, ii + 2, jj, jj + 1, jj + 2];
      for (let a = 0; a < 6; a++) {
        F[dofs[a]] += feqG[a];
        for (let b = 0; b < 6; b++) K[dofs[a] * ndof + dofs[b]] += kG[a][b];
      }
      data.set(m.id, { kt, feq, ktC, feqC, dofs, rs });
    }
    return { K, F, data };
  };

  const solve = (K: Float64Array, F: Float64Array, secondOrder: boolean) => {
    const Kff = new Float64Array(nf * nf);
    const Ff = new Float64Array(nf);
    for (let a = 0; a < nf; a++) {
      Ff[a] = F[free[a]];
      for (let b = 0; b < nf; b++) Kff[a * nf + b] = K[free[a] * ndof + free[b]];
    }
    const D = new Float64Array(ndof);
    if (nf === 0) return D;
    let xf: Float64Array;
    try {
      xf = choleskySolve(Kff, Ff, nf);
    } catch (e) {
      const dofIdx = (e as { dof?: number }).dof;
      if (dofIdx !== undefined) {
        if (secondOrder) throw new Error("การวิเคราะห์ P-Delta ไม่ลู่เข้า: แรงอัดเกินกำลังโก่งเดาะของโครง (K + Kg ไม่เป็นบวกแน่นอน)");
        const g = free[dofIdx];
        const node = model.nodes[Math.floor(g / 3)];
        const comp = ["ux", "uy", "rz"][g % 3];
        throw new Error(`โครงสร้างไม่มีเสถียรภาพ: ตรวจการยึดรั้ง/การต่อที่จุดต่อ ${node.id} (${comp})`);
      }
      throw e;
    }
    for (let a = 0; a < nf; a++) D[free[a]] = xf[a];
    return D;
  };

  const memberEnd = (m: Member, md: MData, D: Float64Array) => {
    const g = geo.get(m.id)!;
    const T = transform(g.c, g.s);
    const dl = solveReleased(md.kt, md.feq, mulVec(T, md.dofs.map((d) => D[d])), md.rs);
    const kd = mulVec(md.kt, dl);
    const endForces = kd.map((v, a) => v - md.feq[a]);
    for (const r of md.rs) endForces[r] = 0; // ปัดเศษให้เป็นศูนย์พอดี
    return { dl, endForces };
  };

  // ---------- วิเคราะห์อันดับหนึ่ง แล้ว (ถ้าเลือก) วนซ้ำ P-Delta ----------
  let axial = new Map<string, number>();
  let asm = assemble(axial);
  let D = solve(asm.K, asm.F, false);
  let iterations = 1;
  let converged = true;
  if (opts.pDelta) {
    converged = false;
    const maxIter = opts.maxIter ?? 30;
    const tol = opts.tol ?? 1e-6;
    for (let it = 0; it < maxIter; it++) {
      const next = new Map<string, number>();
      for (const m of model.members) {
        const { endForces } = memberEnd(m, asm.data.get(m.id)!, D);
        const N = -(endForces[0] - endForces[3]) / 2; // แรงตามแกนเฉลี่ย (ดึงเป็นบวก)
        next.set(m.id, N);
      }
      axial = next;
      asm = assemble(axial);
      const Dn = solve(asm.K, asm.F, true);
      iterations++;
      let num = 0, den = 0;
      for (let k = 0; k < ndof; k++) { num = Math.max(num, Math.abs(Dn[k] - D[k])); den = Math.max(den, Math.abs(Dn[k])); }
      D = Dn;
      if (num <= tol * Math.max(den, 1e-12)) { converged = true; break; }
    }
    if (!converged) throw new Error("การวิเคราะห์ P-Delta ไม่ลู่เข้าภายในจำนวนรอบที่กำหนด — โครงใกล้โก่งเดาะ");
  }
  const { K, F } = asm;

  // ผลลัพธ์
  const disp: Record<string, NodeDisp> = {};
  model.nodes.forEach((n, k) => { disp[n.id] = { ux: D[k * 3], uy: D[k * 3 + 1], rz: D[k * 3 + 2] }; });

  const reactions: Record<string, Reaction> = {};
  for (const s of model.supports) {
    const k = nodeIndex.get(s.node)! * 3;
    const r = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let sum = -F[k + c];
      for (let b = 0; b < ndof; b++) sum += K[(k + c) * ndof + b] * D[b];
      r[c] = supported[k + c] ? sum : 0;
    }
    reactions[s.node] = { fx: r[0], fy: r[1], mz: r[2] };
  }

  const members: Record<string, MemberResult> = {};
  for (const m of model.members) {
    const g = geo.get(m.id)!;
    const { dl, endForces } = memberEnd(m, asm.data.get(m.id)!, D);
    const stations = internalForces(endForces, memberLoads.get(m.id)!, g.L, g.E * g.I, dl, !!opts.pDelta);
    let maxM = -Infinity, minM = Infinity, maxAbsV = 0, maxN = -Infinity, minN = Infinity;
    for (const st of stations) {
      maxM = Math.max(maxM, st.M); minM = Math.min(minM, st.M);
      maxAbsV = Math.max(maxAbsV, Math.abs(st.V));
      maxN = Math.max(maxN, st.N); minN = Math.min(minN, st.N);
    }
    members[m.id] = { id: m.id, L: g.L, c: g.c, s: g.s, endForces, stations, maxM, minM, maxAbsV, maxN, minN };
  }

  return { disp, reactions, members, appliedTotal: { fx: appFx, fy: appFy }, info: { pDelta: !!opts.pDelta, iterations, converged } };
}

/** แรงภายใน N, V, M และการโก่งตัว v (local) ตามความยาวชิ้นส่วน */
function internalForces(f: number[], ll: LocalLoads, L: number, EI: number, dl: number[], secondOrder = false): Station[] {
  const NSEG = 40;
  const xs = new Set<number>();
  for (let k = 0; k <= NSEG; k++) xs.add((L * k) / NSEG);
  for (const p of ll.points) {
    if (p.a > EPS_X) xs.add(Math.max(0, p.a - EPS_X));
    xs.add(p.a);
    if (p.a < L - EPS_X) xs.add(Math.min(L, p.a + EPS_X));
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const st: Station[] = sorted.map((x) => {
    let N = -(f[0] + ll.wx * x);
    let V = f[1] + ll.wy * x;
    let M = -f[2] + f[1] * x + (ll.wy * x * x) / 2;
    for (const p of ll.points) {
      if (p.a < x || (p.a === x && x === L)) {
        N -= p.px;
        V += p.py;
        M += p.py * (x - p.a);
      }
    }
    return { x, N, V, M, v: 0 };
  });
  // การโก่งตัว: อินทิเกรต v'' = M/EI สองครั้ง (trapezoid) แล้วปรับเชิงเส้นให้ตรงกับการเคลื่อนตัวปลาย
  const v1 = dl[1], th1 = dl[2], v2 = dl[4];
  const Mfirst = st.map((s) => s.M);
  const integrate = () => {
    let slope = th1;
    let v = v1;
    st[0].v = v1;
    for (let k = 1; k < st.length; k++) {
      const h = st[k].x - st[k - 1].x;
      const k0 = st[k - 1].M / EI;
      const k1 = st[k].M / EI;
      v += slope * h + (h * h * (2 * k0 + k1)) / 6;
      slope += ((k0 + k1) / 2) * h;
      st[k].v = v;
    }
    const err = st[st.length - 1].v - v2;
    for (const s of st) s.v -= (err * s.x) / L;
  };
  integrate();
  if (secondOrder) {
    // P-δ ตามความยาว: M(x) = M_สถิต(x) − f₀·(v(x) − v₁) แล้ววนซ้ำกับการโก่งตัว
    for (let it = 0; it < 6; it++) {
      st.forEach((s, k) => { s.M = Mfirst[k] - f[0] * (s.v - v1); });
      integrate();
    }
  }
  return st;
}

// ---------- เมทริกซ์ขนาดเล็ก ----------
function transform(c: number, s: number): number[][] {
  return [
    [c, s, 0, 0, 0, 0],
    [-s, c, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, c, s, 0],
    [0, 0, 0, -s, c, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}
function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((r) => r[j]));
}
function mul(A: number[][], B: number[][]): number[][] {
  return A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
}
function mulVec(A: number[][], x: number[]): number[] {
  return A.map((r) => r.reduce((s, v, k) => s + v * x[k], 0));
}
