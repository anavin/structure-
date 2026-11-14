// ตัววิเคราะห์โครงข้อแข็ง 3 มิติ (12 DOF ต่อชิ้นส่วน) ด้วยวิธีความแข็งโดยตรง
// - ตัวแก้สมการ skyline LDLᵀ + เรียงลำดับจุดต่อแบบ RCM
// - ปลดแรงปลายชิ้นส่วน (บิด/โมเมนต์ 2 แกน) ด้วย static condensation
// - แรงแผ่/แรงจุดบนชิ้นส่วนในแกน global หรือ local, น้ำหนักตัวเอง (−Z)
// อนุสัญญาแรงภายใน (แกน local):
//   N ดึงเป็นบวก, Vy = dMz/dx, Vz = dMy/dx, T = แรงบิด
//   Mz: ดัดในระนาบ 1-2 (v'' = Mz/EIz), My: ดัดในระนาบ 1-3 (w'' = My/EIy)
//   สำหรับคาน (แกน 2 ชี้ขึ้น) Mz บวก = ท้องช้าง (sagging) เหมือนตัววิเคราะห์ 2D

import { factorize, reverseCuthillMcKee, SkylineMatrix, SkylineSingularError, solveFactored } from "./skyline.ts";
import { memberAxes, sectionProps3, type Dir3, type EndRelease, type Load3, type Member3, type Model3, type Vec3 } from "./model3d.ts";

export interface Disp3 { ux: number; uy: number; uz: number; rx: number; ry: number; rz: number }
export interface Reaction3 { fx: number; fy: number; fz: number; mx: number; my: number; mz: number }
export interface Station3 { x: number; N: number; Vy: number; Vz: number; T: number; My: number; Mz: number; v: number; w: number }

export interface MemberResult3 {
  id: string;
  L: number;
  axes: { ex: Vec3; ey: Vec3; ez: Vec3 };
  /** แรงปลายในแกน local ที่จุดต่อกระทำต่อชิ้นส่วน [N,Vy,Vz,T,My,Mz]ᵢ + [..]ⱼ */
  endForces: number[];
  stations: Station3[];
  maxAbs: { N: number; Vy: number; Vz: number; T: number; My: number; Mz: number };
  minN: number; maxN: number;
}

export interface AnalysisResult3 {
  disp: Record<string, Disp3>;
  reactions: Record<string, Reaction3>;
  members: Record<string, MemberResult3>;
  /** การเคลื่อนตัวของจุดอ้างอิง diaphragm */
  diaphragms: Record<string, { x: number; y: number; z: number; ux: number; uy: number; rz: number }>;
  appliedTotal: { fx: number; fy: number; fz: number };
  info: { neq: number; profile: number; autoRestrained: string[]; ms: number; iterations: number; pDelta: boolean };
}

interface LocalLoads { wx: number; wy: number; wz: number; points: { a: number; px: number; py: number; pz: number }[] }

// ---------- เมทริกซ์ชิ้นส่วน ----------
export function localK12(E: number, G: number, A: number, Iy: number, Iz: number, J: number, L: number): number[][] {
  const k = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const set = (i: number, j: number, v: number) => { k[i][j] = v; k[j][i] = v; };
  const EA = (E * A) / L, GJ = (G * J) / L;
  set(0, 0, EA); set(0, 6, -EA); set(6, 6, EA);
  set(3, 3, GJ); set(3, 9, -GJ); set(9, 9, GJ);
  // ระนาบ 1-2 (v, θz) ใช้ Iz
  const a = (12 * E * Iz) / L ** 3, b = (6 * E * Iz) / L ** 2, c = (4 * E * Iz) / L, d = (2 * E * Iz) / L;
  set(1, 1, a); set(1, 5, b); set(1, 7, -a); set(1, 11, b);
  set(5, 5, c); set(5, 7, -b); set(5, 11, d);
  set(7, 7, a); set(7, 11, -b); set(11, 11, c);
  // ระนาบ 1-3 (w, θy) ใช้ Iy — θy = −dw/dx
  const e = (12 * E * Iy) / L ** 3, g = (6 * E * Iy) / L ** 2, h = (4 * E * Iy) / L, q = (2 * E * Iy) / L;
  set(2, 2, e); set(2, 4, -g); set(2, 8, -e); set(2, 10, -g);
  set(4, 4, h); set(4, 8, g); set(4, 10, q);
  set(8, 8, e); set(8, 10, g); set(10, 10, h);
  return k;
}

function equivalent12(ll: LocalLoads, L: number): number[] {
  const f = new Array<number>(12).fill(0);
  f[0] += (ll.wx * L) / 2; f[6] += (ll.wx * L) / 2;
  f[1] += (ll.wy * L) / 2; f[5] += (ll.wy * L * L) / 12; f[7] += (ll.wy * L) / 2; f[11] -= (ll.wy * L * L) / 12;
  f[2] += (ll.wz * L) / 2; f[4] -= (ll.wz * L * L) / 12; f[8] += (ll.wz * L) / 2; f[10] += (ll.wz * L * L) / 12;
  for (const p of ll.points) {
    const a = p.a, b = L - a;
    f[0] += (p.px * b) / L; f[6] += (p.px * a) / L;
    const s1 = (b * b * (3 * a + b)) / L ** 3, s2 = (a * b * b) / L ** 2, s3 = (a * a * (a + 3 * b)) / L ** 3, s4 = (a * a * b) / L ** 2;
    f[1] += p.py * s1; f[5] += p.py * s2; f[7] += p.py * s3; f[11] -= p.py * s4;
    f[2] += p.pz * s1; f[4] -= p.pz * s2; f[8] += p.pz * s3; f[10] += p.pz * s4;
  }
  return f;
}

function releasedIdx(ri?: EndRelease, rj?: EndRelease): number[] {
  const r: number[] = [];
  if (ri?.t) r.push(3); if (ri?.m2) r.push(4); if (ri?.m3) r.push(5);
  if (rj?.t) r.push(9); if (rj?.m2) r.push(10); if (rj?.m3) r.push(11);
  return r;
}

function condense(k: number[][], feq: number[], rs: number[]) {
  let K = k.map((r) => [...r]);
  let f = [...feq];
  for (const r of rs) {
    const krr = K[r][r];
    if (Math.abs(krr) < 1e-14) continue;
    const Kn = K.map((row, a) => row.map((v, b) => v - (K[a][r] * K[r][b]) / krr));
    const fn = f.map((v, a) => v - (K[a][r] * f[r]) / krr);
    for (let a = 0; a < 12; a++) { Kn[r][a] = 0; Kn[a][r] = 0; }
    fn[r] = 0;
    K = Kn; f = fn;
  }
  return { k: K, feq: f };
}

/** หาการเคลื่อนตัวที่ DOF ที่ถูกปลด จากเงื่อนไขแรงปลาย = 0 (แก้ระบบเล็กด้วย Gauss) */
function solveReleased(k: number[][], feq: number[], d: number[], rs: number[]) {
  const out = [...d];
  const n = rs.length;
  if (!n) return out;
  const A = rs.map((r) => rs.map((c) => k[r][c]));
  const b = rs.map((r) => { let s = feq[r]; for (let c = 0; c < 12; c++) if (!rs.includes(c)) s -= k[r][c] * d[c]; return s; });
  for (let p = 0; p < n; p++) {
    let piv = p;
    for (let r = p + 1; r < n; r++) if (Math.abs(A[r][p]) > Math.abs(A[piv][p])) piv = r;
    [A[p], A[piv]] = [A[piv], A[p]]; [b[p], b[piv]] = [b[piv], b[p]];
    if (Math.abs(A[p][p]) < 1e-14) continue;
    for (let r = p + 1; r < n; r++) {
      const m = A[r][p] / A[p][p];
      for (let c = p; c < n; c++) A[r][c] -= m * A[p][c];
      b[r] -= m * b[p];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let p = n - 1; p >= 0; p--) {
    let s = b[p];
    for (let c = p + 1; c < n; c++) s -= A[p][c] * x[c];
    x[p] = Math.abs(A[p][p]) < 1e-14 ? 0 : s / A[p][p];
  }
  rs.forEach((r, i) => { out[r] = x[i]; });
  return out;
}

// การแปลงแกน: d_local = T d_global, T = blockdiag(R, R, R, R), R = [ex; ey; ez]
function toLocal12(R: Vec3[], g: ArrayLike<number>): number[] {
  const o = new Array<number>(12);
  for (let blk = 0; blk < 4; blk++) for (let r = 0; r < 3; r++) {
    o[blk * 3 + r] = R[r][0] * g[blk * 3] + R[r][1] * g[blk * 3 + 1] + R[r][2] * g[blk * 3 + 2];
  }
  return o;
}
function toGlobal12(R: Vec3[], l: number[]): number[] {
  const o = new Array<number>(12).fill(0);
  for (let blk = 0; blk < 4; blk++) for (let c = 0; c < 3; c++) {
    o[blk * 3 + c] = R[0][c] * l[blk * 3] + R[1][c] * l[blk * 3 + 1] + R[2][c] * l[blk * 3 + 2];
  }
  return o;
}
/** Tᵀ k T */
function kToGlobal(R: Vec3[], k: number[][]): number[][] {
  // kT = k · T  (คูณขวาทีละบล็อก)
  const kT = k.map((row) => {
    const o = new Array<number>(12).fill(0);
    for (let blk = 0; blk < 4; blk++) for (let c = 0; c < 3; c++) {
      o[blk * 3 + c] = row[blk * 3] * R[0][c] + row[blk * 3 + 1] * R[1][c] + row[blk * 3 + 2] * R[2][c];
    }
    return o;
  });
  // Tᵀ · kT
  const out = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  for (let blk = 0; blk < 4; blk++) for (let r = 0; r < 3; r++) for (let j = 0; j < 12; j++) {
    out[blk * 3 + r][j] = R[0][r] * kT[blk * 3][j] + R[1][r] * kT[blk * 3 + 1][j] + R[2][r] * kT[blk * 3 + 2][j];
  }
  return out;
}

function dirVector(dir: Dir3, R: Vec3[]): Vec3 {
  // คืนองค์ประกอบในแกน local ของแรงหนึ่งหน่วยตามทิศที่กำหนด
  if (dir === "L1") return [1, 0, 0];
  if (dir === "L2") return [0, 1, 0];
  if (dir === "L3") return [0, 0, 1];
  const g: Vec3 = dir === "GX" ? [1, 0, 0] : dir === "GY" ? [0, 1, 0] : [0, 0, 1];
  return [R[0][0] * g[0] + R[0][1] * g[1] + R[0][2] * g[2], R[1][0] * g[0] + R[1][1] * g[1] + R[1][2] * g[2], R[2][0] * g[0] + R[2][1] * g[1] + R[2][2] * g[2]];
}

const DOF_NAMES = ["ux", "uy", "uz", "rx", "ry", "rz"];

export function validateModel3(m: Model3): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const n of m.nodes) { if (ids.has(n.id)) errs.push(`จุดต่อ ${n.id} ซ้ำ`); ids.add(n.id); }
  const secs = new Map(m.sections.map((s) => [s.id, s]));
  const mats = new Set(m.materials.map((x) => x.id));
  for (const mem of m.members) {
    if (!ids.has(mem.i) || !ids.has(mem.j)) errs.push(`ชิ้นส่วน ${mem.id}: ไม่พบจุดต่อ`);
    const s = secs.get(mem.section);
    if (!s) errs.push(`ชิ้นส่วน ${mem.id}: ไม่พบหน้าตัด ${mem.section}`);
    else if (!mats.has(s.material)) errs.push(`หน้าตัด ${s.id}: ไม่พบวัสดุ ${s.material}`);
  }
  if (!m.supports.length) errs.push("ยังไม่มีจุดรองรับ");
  return errs;
}

export interface Analyze3Options {
  /** วิเคราะห์อันดับสอง P-Delta (Kg วนซ้ำ + P-δ ตามความยาว) */
  pDelta?: boolean;
  /** ตัวคูณโมเมนต์ความเฉื่อย Iy, Iz (เช่น หน้าตัดแตกร้าว เสา 0.70 / คาน 0.35) */
  iFactor?: (m: Member3) => number;
  /** ตัวคูณค่าคงที่การบิด J (ความแข็งบิดหลังแตกร้าว) */
  jFactor?: (m: Member3) => number;
  maxIter?: number;
  tol?: number;
}

/** เมทริกซ์ความแข็งเรขาคณิต 12×12 (consistent) ในแกน local — N แรงดึงเป็นบวก (ไม่รวมผลต่อการบิด) */
export function localKg12(N: number, L: number): number[][] {
  const k = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const set = (i: number, j: number, v: number) => { k[i][j] = v; k[j][i] = v; };
  const a = N / L;
  const A = (6 / 5) * a, B = (L / 10) * a, C = ((2 * L * L) / 15) * a, D = ((L * L) / 30) * a;
  // ระนาบ 1-2 (v, θz)
  set(1, 1, A); set(1, 5, B); set(1, 7, -A); set(1, 11, B);
  set(5, 5, C); set(5, 7, -B); set(5, 11, -D);
  set(7, 7, A); set(7, 11, -B); set(11, 11, C);
  // ระนาบ 1-3 (w, θy) — เครื่องหมายพจน์ร่วมกลับข้างตาม θy = −dw/dx
  set(2, 2, A); set(2, 4, -B); set(2, 8, -A); set(2, 10, -B);
  set(4, 4, C); set(4, 8, B); set(4, 10, -D);
  set(8, 8, A); set(8, 10, B); set(10, 10, C);
  return k;
}

export function analyze3d(model: Model3, loads: Load3[], selfWeightFactor = 0, opts: Analyze3Options = {}): AnalysisResult3 {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const errs = validateModel3(model);
  if (errs.length) throw new Error(errs.join("\n"));
  const nn = model.nodes.length;
  const nodeIdx = new Map(model.nodes.map((n, k) => [n.id, k]));
  const nodes = model.nodes;
  const secs = new Map(model.sections.map((s) => [s.id, s]));
  const mats = new Map(model.materials.map((x) => [x.id, x]));

  // ---------- เตรียมชิ้นส่วน ----------
  type El = { m: Member3; ii: number; jj: number; L: number; R: Vec3[]; k: number[][]; kt: number[][]; ll: LocalLoads; rs: number[]; EIy: number; EIz: number };
  const els: El[] = model.members.map((m) => {
    const ii = nodeIdx.get(m.i)!, jj = nodeIdx.get(m.j)!;
    const ax = memberAxes(nodes[ii], nodes[jj], m.beta);
    const sec = secs.get(m.section)!;
    const mat = mats.get(sec.material)!;
    const p0 = sectionProps3(sec);
    const fI = opts.iFactor ? opts.iFactor(m) : 1;
    const fJ = opts.jFactor ? opts.jFactor(m) : 1;
    const p = { ...p0, Iy: p0.Iy * fI, Iz: p0.Iz * fI, J: p0.J * fJ };
    const G = mat.E / (2 * (1 + mat.nu));
    const k = localK12(mat.E, G, p.A, p.Iy, p.Iz, p.J, ax.L);
    const R = [ax.ex, ax.ey, ax.ez];
    const ll: LocalLoads = { wx: 0, wy: 0, wz: 0, points: [] };
    if (selfWeightFactor) {
      const v = dirVector("GZ", R), w = -mat.gamma * p.A * selfWeightFactor;
      ll.wx += v[0] * w; ll.wy += v[1] * w; ll.wz += v[2] * w;
    }
    return { m, ii, jj, L: ax.L, R, k, kt: k, ll, rs: releasedIdx(m.releaseI, m.releaseJ), EIy: mat.E * p.Iy, EIz: mat.E * p.Iz };
  });
  const elById = new Map(els.map((e) => [e.m.id, e]));

  // ---------- แรงกระทำ ----------
  // ---------- diaphragm ----------
  const dias = (model.diaphragms ?? []).filter((d) => d.nodes.length >= 2);
  const blocked = new Set(model.supports.filter((s) => s.ux || s.uy || s.rz).map((s) => s.node));
  const slaveOf = new Int32Array(nn).fill(-1);
  const diaInfo = dias.map((d, di) => {
    const ks = d.nodes.map((id) => {
      const k = nodeIdx.get(id);
      if (k === undefined) throw new Error(`diaphragm ${d.id}: ไม่พบจุดต่อ ${id}`);
      return k;
    }).filter((k) => !blocked.has(nodes[k].id));
    for (const k of ks) {
      if (slaveOf[k] >= 0) throw new Error(`จุดต่อ ${nodes[k].id} อยู่ในหลาย diaphragm`);
      slaveOf[k] = di;
    }
    const xm = d.x ?? ks.reduce((a, k) => a + nodes[k].x, 0) / ks.length;
    const ym = d.y ?? ks.reduce((a, k) => a + nodes[k].y, 0) / ks.length;
    const zm = ks.reduce((a, k) => a + nodes[k].z, 0) / ks.length;
    return { id: d.id, ks, xm, ym, zm };
  });
  const diaIdx = new Map(diaInfo.map((d, i) => [d.id, i]));
  const Fdia = diaInfo.map(() => [0, 0, 0]); // fx, fy, mz ที่จุดอ้างอิง

  const Fnode = new Float64Array(nn * 6);
  const app = { fx: 0, fy: 0, fz: 0 };
  for (const ld of loads) {
    if (ld.type === "nodal") {
      const di = diaIdx.get(ld.node);
      if (di !== undefined && !nodeIdx.has(ld.node)) {
        Fdia[di][0] += ld.fx; Fdia[di][1] += ld.fy; Fdia[di][2] += ld.mz;
        app.fx += ld.fx; app.fy += ld.fy;
        continue;
      }
      const k = nodeIdx.get(ld.node);
      if (k === undefined) throw new Error(`แรงที่จุดต่อ ${ld.node}: ไม่พบจุดต่อ`);
      const v = [ld.fx, ld.fy, ld.fz, ld.mx, ld.my, ld.mz];
      for (let c = 0; c < 6; c++) Fnode[k * 6 + c] += v[c];
      app.fx += ld.fx; app.fy += ld.fy; app.fz += ld.fz;
      continue;
    }
    const e = elById.get(ld.member);
    if (!e) throw new Error(`แรงบนชิ้นส่วน ${ld.member}: ไม่พบชิ้นส่วน`);
    const v = dirVector(ld.dir, e.R);
    if (ld.type === "udl") { e.ll.wx += v[0] * ld.w; e.ll.wy += v[1] * ld.w; e.ll.wz += v[2] * ld.w; }
    else {
      if (ld.a < 0 || ld.a > e.L) throw new Error(`แรงจุดบน ${ld.member}: a = ${ld.a} อยู่นอกชิ้นส่วน (L = ${e.L.toFixed(3)})`);
      e.ll.points.push({ a: ld.a, px: v[0] * ld.P, py: v[1] * ld.P, pz: v[2] * ld.P });
    }
  }
  for (const e of els) {
    const toG = (l: Vec3): Vec3 => [0, 1, 2].map((c) => e.R[0][c] * l[0] + e.R[1][c] * l[1] + e.R[2][c] * l[2]) as Vec3;
    const wd = toG([e.ll.wx, e.ll.wy, e.ll.wz]);
    app.fx += wd[0] * e.L; app.fy += wd[1] * e.L; app.fz += wd[2] * e.L;
    for (const p of e.ll.points) { const g = toG([p.px, p.py, p.pz]); app.fx += g[0]; app.fy += g[1]; app.fz += g[2]; }
  }

  // ---------- เมทริกซ์ชิ้นส่วนหลังปลดแรง (global) — รับแรงตามแกนสำหรับ Kg ----------
  const feqs = els.map((e) => equivalent12(e.ll, e.L));
  const elemGlobal = (e: El, n: number, N: number) => {
    let kt = e.k;
    if (N !== 0) { const kg = localKg12(N, e.L); kt = e.k.map((r, a) => r.map((v, b) => v + kg[a][b])); }
    e.kt = kt;
    const { k: kc, feq: fc } = condense(kt, feqs[n], e.rs);
    return { kG: kToGlobal(e.R, kc), fG: toGlobal12(e.R, fc) };
  };
  let kgs = els.map((e, n) => elemGlobal(e, n, 0));

  // ---------- การยึดรั้ง ----------
  const restrained = new Uint8Array(nn * 6);
  const supported = new Uint8Array(nn * 6);
  const connected = new Uint8Array(nn);
  for (const e of els) { connected[e.ii] = 1; connected[e.jj] = 1; }
  for (let k = 0; k < nn; k++) if (!connected[k]) for (let c = 0; c < 6; c++) restrained[k * 6 + c] = 1;
  for (const s of model.supports) {
    const k = nodeIdx.get(s.node);
    if (k === undefined) throw new Error(`จุดรองรับอ้างถึงจุดต่อ ${s.node} ที่ไม่มีอยู่`);
    [s.ux, s.uy, s.uz, s.rx, s.ry, s.rz].forEach((v, c) => { if (v) { restrained[k * 6 + c] = 1; supported[k * 6 + c] = 1; } });
  }
  // DOF แนวราบของจุดต่อใน diaphragm (ux, uy, rz) ถูกแทนด้วย DOF ของจุดอ้างอิง
  const isSlaveDof = (d: number) => slaveOf[Math.floor(d / 6)] >= 0 && [0, 1, 5].includes(d % 6);
  // DOF ที่ไม่มีความแข็งเลย (เช่น การหมุนที่จุดต่อโครงถัก) → ยึดอัตโนมัติ
  const diag = new Float64Array(nn * 6);
  els.forEach((e, n) => {
    const dofs = [...Array(6).keys()].map((c) => e.ii * 6 + c).concat([...Array(6).keys()].map((c) => e.jj * 6 + c));
    dofs.forEach((d, a) => { diag[d] += Math.abs(kgs[n].kG[a][a]); });
  });
  let maxDiag = 0;
  for (const v of diag) if (v > maxDiag) maxDiag = v;
  const autoRestrained: string[] = [];
  for (let d = 0; d < nn * 6; d++) {
    if (!restrained[d] && !isSlaveDof(d) && connected[Math.floor(d / 6)] && diag[d] <= maxDiag * 1e-12) {
      restrained[d] = 1;
      autoRestrained.push(`${nodes[Math.floor(d / 6)].id}.${DOF_NAMES[d % 6]}`);
    }
  }

  // ---------- เลขสมการตามลำดับ RCM (จุดอ้างอิง diaphragm ได้เลขสมการต่อจากจุดต่อสุดท้ายของชุด) ----------
  const order = reverseCuthillMcKee(nn, els.map((e) => [e.ii, e.jj] as [number, number]));
  const pos = new Int32Array(nn);
  order.forEach((k, i) => { pos[k] = i; });
  const lastOf = diaInfo.map((d) => d.ks.reduce((a, k) => (pos[k] > pos[a] ? k : a), d.ks[0]));
  const eq = new Int32Array(nn * 6).fill(-1);
  const masterEq = diaInfo.map(() => [-1, -1, -1]);
  let neq = 0;
  for (const k of order) {
    for (let c = 0; c < 6; c++) if (!restrained[k * 6 + c] && !isSlaveDof(k * 6 + c)) eq[k * 6 + c] = neq++;
    diaInfo.forEach((_, di) => { if (lastOf[di] === k) masterEq[di] = [neq++, neq++, neq++]; });
  }
  // แผนที่ DOF จุดต่อ → [(สมการ, สัมประสิทธิ์)]
  const dofMap: [number, number][][] = Array.from({ length: nn * 6 }, (_, d) => (eq[d] >= 0 ? [[eq[d], 1]] : []));
  diaInfo.forEach((di, i) => {
    const [qx, qy, qr] = masterEq[i];
    for (const k of di.ks) {
      const dx = nodes[k].x - di.xm, dy = nodes[k].y - di.ym;
      dofMap[k * 6] = [[qx, 1], [qr, -dy]];
      dofMap[k * 6 + 1] = [[qy, 1], [qr, dx]];
      dofMap[k * 6 + 5] = [[qr, 1]];
    }
  });

  const first = new Int32Array(neq);
  for (let i = 0; i < neq; i++) first[i] = i;
  const elMaps = els.map((e) => {
    const maps = [...Array(6).keys()].map((c) => dofMap[e.ii * 6 + c]).concat([...Array(6).keys()].map((c) => dofMap[e.jj * 6 + c]));
    const all = maps.flat().map(([q]) => q);
    if (all.length) { const mn = Math.min(...all); for (const q of all) if (mn < first[q]) first[q] = mn; }
    return maps;
  });

  const Fbase = new Float64Array(neq);
  for (let d = 0; d < nn * 6; d++) if (Fnode[d]) for (const [q, c] of dofMap[d]) Fbase[q] += c * Fnode[d];
  diaInfo.forEach((_, i) => { for (let c = 0; c < 3; c++) if (masterEq[i][c] >= 0) Fbase[masterEq[i][c]] += Fdia[i][c]; });

  let profile = 0;
  const solveWith = (secondOrder: boolean) => {
    const K = new SkylineMatrix(first);
    profile = K.size;
    const F = new Float64Array(Fbase);
    els.forEach((_, n) => {
      const maps = elMaps[n];
      const { kG, fG } = kgs[n];
      for (let a = 0; a < 12; a++) {
        const ma = maps[a];
        if (!ma.length) continue;
        for (const [p, ca] of ma) F[p] += ca * fG[a];
        for (let b = 0; b < 12; b++) {
          const v = kG[a][b];
          if (v === 0) continue;
          for (const [p, ca] of ma) for (const [q, cb] of maps[b]) if (p <= q) K.add(p, q, ca * cb * v);
        }
      }
    });
    try {
      factorize(K);
    } catch (e) {
      if (e instanceof SkylineSingularError) {
        if (secondOrder) throw new Error("การวิเคราะห์ P-Delta ไม่ลู่เข้า: แรงอัดเกินกำลังโก่งเดาะของโครง (K + Kg ไม่เป็นบวกแน่นอน)");
        const di = masterEq.findIndex((m) => m.includes(e.eq));
        if (di >= 0) throw new Error(`โครงสร้างไม่มีเสถียรภาพในแนวราบที่ diaphragm ${diaInfo[di].id}`);
        const d = eq.indexOf(e.eq);
        throw new Error(`โครงสร้างไม่มีเสถียรภาพ: ตรวจการยึดรั้ง/การต่อที่จุดต่อ ${nodes[Math.floor(d / 6)].id} (${DOF_NAMES[d % 6]})`);
      }
      throw e;
    }
    const X = solveFactored(K, F);
    const D = new Float64Array(nn * 6);
    for (let d = 0; d < nn * 6; d++) for (const [q, c] of dofMap[d]) D[d] += c * X[q];
    return { X, D };
  };
  const axialOf = (e: El, n: number, D: Float64Array) => {
    const dg = [...Array(6).keys()].map((c) => D[e.ii * 6 + c]).concat([...Array(6).keys()].map((c) => D[e.jj * 6 + c]));
    const dl = solveReleased(e.kt, feqs[n], toLocal12(e.R, dg), e.rs);
    const f0 = e.kt[0].reduce((s, v, b) => s + v * dl[b], 0) - feqs[n][0];
    const f6 = e.kt[6].reduce((s, v, b) => s + v * dl[b], 0) - feqs[n][6];
    return (f6 - f0) / 2; // แรงตามแกนเฉลี่ย (ดึงบวก)
  };

  let { X, D } = solveWith(false);
  let iterations = 1;
  if (opts.pDelta) {
    const maxIter = opts.maxIter ?? 30, tol = opts.tol ?? 1e-6;
    let converged = false;
    for (let it = 0; it < maxIter; it++) {
      const Ns = els.map((e, n) => axialOf(e, n, D));
      kgs = els.map((e, n) => elemGlobal(e, n, Ns[n]));
      const next = solveWith(true);
      iterations++;
      let num = 0, den = 0;
      for (let k = 0; k < D.length; k++) { num = Math.max(num, Math.abs(next.D[k] - D[k])); den = Math.max(den, Math.abs(next.D[k])); }
      X = next.X; D = next.D;
      if (num <= tol * Math.max(den, 1e-12)) { converged = true; break; }
    }
    if (!converged) throw new Error("การวิเคราะห์ P-Delta ไม่ลู่เข้าภายในจำนวนรอบที่กำหนด — โครงใกล้โก่งเดาะ");
  }
  const diaphragms: AnalysisResult3["diaphragms"] = {};
  diaInfo.forEach((di, i) => {
    diaphragms[di.id] = { x: di.xm, y: di.ym, z: di.zm, ux: X[masterEq[i][0]], uy: X[masterEq[i][1]], rz: X[masterEq[i][2]] };
  });

  // ---------- ผลลัพธ์ ----------
  const disp: Record<string, Disp3> = {};
  nodes.forEach((n, k) => {
    const o = k * 6;
    disp[n.id] = { ux: D[o], uy: D[o + 1], uz: D[o + 2], rx: D[o + 3], ry: D[o + 4], rz: D[o + 5] };
  });

  const nodeForce = new Float64Array(nn * 6); // Σ แรงปลายชิ้นส่วน (global)
  const members: Record<string, MemberResult3> = {};
  for (const e of els) {
    const dg = [...Array(6).keys()].map((c) => D[e.ii * 6 + c]).concat([...Array(6).keys()].map((c) => D[e.jj * 6 + c]));
    const feq = equivalent12(e.ll, e.L);
    const dl = solveReleased(e.kt, feq, toLocal12(e.R, dg), e.rs);
    const f = e.kt.map((row, a) => row.reduce((s, v, b) => s + v * dl[b], 0) - feq[a]);
    for (const r of e.rs) f[r] = 0;
    const fgl = toGlobal12(e.R, f);
    for (let c = 0; c < 6; c++) { nodeForce[e.ii * 6 + c] += fgl[c]; nodeForce[e.jj * 6 + c] += fgl[6 + c]; }
    const stations = internal3(f, e.ll, e.L, e.EIy, e.EIz, dl, !!opts.pDelta);
    const mx = { N: 0, Vy: 0, Vz: 0, T: 0, My: 0, Mz: 0 };
    let minN = Infinity, maxN = -Infinity;
    for (const s of stations) {
      mx.N = Math.max(mx.N, Math.abs(s.N)); mx.Vy = Math.max(mx.Vy, Math.abs(s.Vy)); mx.Vz = Math.max(mx.Vz, Math.abs(s.Vz));
      mx.T = Math.max(mx.T, Math.abs(s.T)); mx.My = Math.max(mx.My, Math.abs(s.My)); mx.Mz = Math.max(mx.Mz, Math.abs(s.Mz));
      minN = Math.min(minN, s.N); maxN = Math.max(maxN, s.N);
    }
    members[e.m.id] = { id: e.m.id, L: e.L, axes: { ex: e.R[0], ey: e.R[1], ez: e.R[2] }, endForces: f, stations, maxAbs: mx, minN, maxN };
  }

  const reactions: Record<string, Reaction3> = {};
  for (const s of model.supports) {
    const k = nodeIdx.get(s.node)!;
    const r = [0, 0, 0, 0, 0, 0].map((_, c) => (supported[k * 6 + c] ? nodeForce[k * 6 + c] - Fnode[k * 6 + c] : 0));
    reactions[s.node] = { fx: r[0], fy: r[1], fz: r[2], mx: r[3], my: r[4], mz: r[5] };
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { disp, reactions, members, diaphragms, appliedTotal: app, info: { neq, profile, autoRestrained, ms: t1 - t0, iterations, pDelta: !!opts.pDelta } };
}

function internal3(f: number[], ll: LocalLoads, L: number, EIy: number, EIz: number, dl: number[], secondOrder = false): Station3[] {
  const NSEG = 40, EPS = 1e-9;
  const xs = new Set<number>();
  for (let k = 0; k <= NSEG; k++) xs.add((L * k) / NSEG);
  for (const p of ll.points) { if (p.a > EPS) xs.add(p.a - EPS); xs.add(p.a); if (p.a < L - EPS) xs.add(p.a + EPS); }
  const st: Station3[] = [...xs].sort((a, b) => a - b).map((x) => {
    let N = -(f[0] + ll.wx * x);
    let Vy = f[1] + ll.wy * x, Vz = f[2] + ll.wz * x;
    let Mz = -f[5] + f[1] * x + (ll.wy * x * x) / 2;
    let My = f[4] + f[2] * x + (ll.wz * x * x) / 2;
    for (const p of ll.points) {
      if (p.a < x || (p.a === x && x === L)) {
        N -= p.px; Vy += p.py; Vz += p.pz;
        Mz += p.py * (x - p.a); My += p.pz * (x - p.a);
      }
    }
    return { x, N, Vy, Vz, T: -f[3], My, Mz, v: 0, w: 0 };
  });
  // การโก่งตัวในแกน local: v'' = Mz/EIz (v'(0) = θz), w'' = My/EIy (w'(0) = −θy)
  const integ = (key: "v" | "w", M: "Mz" | "My", EI: number, y0: number, s0: number, yL: number) => {
    let y = y0, s = s0;
    st[0][key] = y0;
    for (let k = 1; k < st.length; k++) {
      const h = st[k].x - st[k - 1].x;
      const k0 = st[k - 1][M] / EI, k1 = st[k][M] / EI;
      y += s * h + (h * h * (2 * k0 + k1)) / 6;
      s += ((k0 + k1) / 2) * h;
      st[k][key] = y;
    }
    const err = st[st.length - 1][key] - yL;
    for (const p of st) p[key] -= (err * p.x) / L;
  };
  integ("v", "Mz", EIz, dl[1], dl[5], dl[7]);
  integ("w", "My", EIy, dl[2], -dl[4], dl[8]);
  if (secondOrder) {
    // P-δ ตามความยาว: M(x) = M_สถิต(x) − f₀·(δ(x) − δ₁) ทั้งสองระนาบ แล้ววนซ้ำกับการโก่งตัว
    const Mz0 = st.map((p) => p.Mz), My0 = st.map((p) => p.My);
    for (let it = 0; it < 6; it++) {
      st.forEach((p, k) => { p.Mz = Mz0[k] - f[0] * (p.v - dl[1]); p.My = My0[k] - f[0] * (p.w - dl[2]); });
      integ("v", "Mz", EIz, dl[1], dl[5], dl[7]);
      integ("w", "My", EIy, dl[2], -dl[4], dl[8]);
    }
  }
  return st;
}
