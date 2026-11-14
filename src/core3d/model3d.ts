// โมเดลโครงข้อแข็ง 3 มิติ — หน่วย kN, m · แกน global: X, Y แนวราบ, Z ขึ้น (แรงโน้มถ่วง −Z)
//
// แกน local ของชิ้นส่วน (คล้าย SAP2000/ETABS)
//  - แกน 1 (x): จากจุดต่อ i ไป j
//  - ชิ้นส่วนไม่ตั้งดิ่ง: แกน 3 (z) = x × Z_global (แนวราบ), แกน 2 (y) = z × x (ชี้ขึ้น) → คานมี y ชี้ขึ้น
//  - ชิ้นส่วนตั้งดิ่ง: แกน 2 (y) = +X_global, แกน 3 (z) = x × y
//  - มุม beta (องศา) หมุนแกน 2 และ 3 รอบแกน 1
// หน้าตัดสี่เหลี่ยม: h ตามแกน 2, b ตามแกน 3 → Iz = b·h³/12 (ดัดในระนาบ 1-2), Iy = h·b³/12 (ดัดในระนาบ 1-3)

export interface Node3 { id: string; x: number; y: number; z: number }

export interface Support3 {
  node: string;
  ux: boolean; uy: boolean; uz: boolean;
  rx: boolean; ry: boolean; rz: boolean;
}

export interface Material3 { id: string; name: string; E: number; nu: number; gamma: number; fc?: number; fy?: number; fyt?: number }

export interface Section3 { id: string; name: string; material: string; b: number; h: number }

/** การปลดแรงที่ปลายชิ้นส่วน (แกน local): t = บิด, m2 = โมเมนต์รอบแกน 2, m3 = โมเมนต์รอบแกน 3 */
export interface EndRelease { t?: boolean; m2?: boolean; m3?: boolean }

/** wall = ผนังรับแรงเฉือน (แบบเสากว้างที่แนวศูนย์กลางผนัง), link = แขนแข็งเชื่อมผนังกับจุดต่อ (ไม่ออกแบบ) */
export type MemberKind3 = "beam" | "column" | "brace" | "other" | "wall" | "link";

export interface Member3 {
  id: string;
  i: string; j: string;
  section: string;
  kind: MemberKind3;
  beta?: number;
  releaseI?: EndRelease;
  releaseJ?: EndRelease;
}

export type Dir3 = "GX" | "GY" | "GZ" | "L1" | "L2" | "L3";

export interface NodalLoad3 { type: "nodal"; node: string; fx: number; fy: number; fz: number; mx: number; my: number; mz: number }
/** แรงแผ่สม่ำเสมอต่อความยาวชิ้นส่วน (kN/m) */
export interface MemberUDL3 { type: "udl"; member: string; dir: Dir3; w: number }
export interface MemberPoint3 { type: "point"; member: string; dir: Dir3; P: number; a: number }
export type Load3 = NodalLoad3 | MemberUDL3 | MemberPoint3;

export interface LoadCase3 { id: string; name: string; selfWeight: boolean; loads: Load3[]; lateral?: boolean }
export interface Combo3 { id: string; name: string; factors: Record<string, number> }

export interface Model3 {
  name: string;
  nodes: Node3[];
  supports: Support3[];
  materials: Material3[];
  sections: Section3[];
  members: Member3[];
  loadCases: LoadCase3[];
  combos: Combo3[];
  diaphragms?: Diaphragm3[];
  /** ตัวเลือกการวิเคราะห์: อันดับสอง P-Delta และหน้าตัดแตกร้าว (ACI 6.6.3.1.1: เสา 0.70Ig, คาน 0.35Ig) */
  analysis?: { pDelta: boolean; cracked: boolean };
  /** แผ่นดินไหวแบบสเปกตรัมการตอบสนอง: แทนผลของ load case EX/EY ด้วยผล RSA (ปรับขนาดเทียบวิธีสถิต) */
  rsa?: RsaSettings3;
}

export interface RsaSettings3 {
  /** น้ำหนักรายชั้น (kN) ตามลำดับพื้นล่าง → บน และขนาดผัง (m) สำหรับมวลบิด */
  weights: number[]; Bx: number; By: number;
  SDS: number; SD1: number; T0: number; Ts: number; Ie: number; R: number;
  /** แรงเฉือนฐานจากวิธีสถิตเทียบเท่า (kN) และสัดส่วนต่ำสุดที่ต้องปรับให้ถึง (เช่น 0.85) */
  Vstatic: number; minScale: number;
}

/**
 * พื้นแข็งในระนาบ (rigid diaphragm): จุดต่อในชุดเคลื่อนที่ในแนวราบไปด้วยกัน
 *   ux = uxm − (y − ym)·rzm,  uy = uym + (x − xm)·rzm,  rz = rzm
 * จุดอ้างอิง (master) อยู่ที่ (x, y) ที่กำหนด หรือจุดศูนย์กลางเรขาคณิตของจุดต่อ
 * แรงที่จุดอ้างอิงใส่ได้ด้วย nodal load ที่ node = id ของ diaphragm (ใช้ fx, fy, mz)
 */
export interface Diaphragm3 { id: string; nodes: string[]; x?: number; y?: number }

/** สร้าง diaphragm อัตโนมัติ: หนึ่งชุดต่อระดับ z ที่มีจุดต่อ ≥ 2 จุด (ไม่รวมจุดที่ถูกยึดในแนวราบ/การหมุนรอบ Z) */
export function autoDiaphragms(m: Model3, tol = 1e-3): Diaphragm3[] {
  const blocked = new Set(m.supports.filter((s) => s.ux || s.uy || s.rz).map((s) => s.node));
  const connected = new Set(m.members.flatMap((x) => [x.i, x.j]));
  const groups = new Map<number, string[]>();
  for (const n of m.nodes) {
    if (blocked.has(n.id) || !connected.has(n.id)) continue;
    const key = Math.round(n.z / tol);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n.id);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).filter(([, ns]) => ns.length >= 2)
    .map(([key, ns]) => ({ id: `D${(key * tol).toFixed(2)}`, nodes: ns }));
}

/** ค่าคงที่การบิด J ของหน้าตัดสี่เหลี่ยมตัน (Roark): a ≥ b */
export function torsionJ(b: number, h: number): number {
  const a = Math.max(b, h), c = Math.min(b, h);
  return a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
}

export function sectionProps3(s: Section3) {
  return {
    A: s.b * s.h,
    Iz: (s.b * s.h ** 3) / 12, // ดัดในระนาบ 1-2 (รอบแกน 3)
    Iy: (s.h * s.b ** 3) / 12, // ดัดในระนาบ 1-3 (รอบแกน 2)
    J: torsionJ(s.b, s.h),
  };
}

export type Vec3 = [number, number, number];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** แกน local [x, y, z] ของชิ้นส่วน (แต่ละแกนเป็นเวกเตอร์หนึ่งหน่วยใน global) */
export function memberAxes(ni: Node3, nj: Node3, betaDeg = 0): { L: number; ex: Vec3; ey: Vec3; ez: Vec3 } {
  const d: Vec3 = [nj.x - ni.x, nj.y - ni.y, nj.z - ni.z];
  const L = Math.hypot(...d);
  if (L < 1e-9) throw new Error("ชิ้นส่วนความยาวเป็นศูนย์");
  const ex = norm(d);
  let ey: Vec3, ez: Vec3;
  if (Math.abs(ex[2]) > 0.9999) {
    ey = [1, 0, 0];
    ez = norm(cross(ex, ey));
    ey = cross(ez, ex);
  } else {
    ez = norm(cross(ex, [0, 0, 1]));
    ey = cross(ez, ex);
  }
  if (betaDeg) {
    const b = (betaDeg * Math.PI) / 180, c = Math.cos(b), s = Math.sin(b);
    const y2: Vec3 = [c * ey[0] + s * ez[0], c * ey[1] + s * ez[1], c * ey[2] + s * ez[2]];
    const z2: Vec3 = [-s * ey[0] + c * ez[0], -s * ey[1] + c * ez[1], -s * ey[2] + c * ez[2]];
    ey = y2; ez = z2;
  }
  return { L, ex, ey, ez };
}
