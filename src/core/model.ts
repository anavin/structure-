import type { FoundationSettings } from "../design/footing.ts";
import type { WindSettings } from "../loads/windTH.ts";
import type { ProjectInfo } from "../shared/shared.ts";

// โมเดลโครงข้อแข็ง 2 มิติ — หน่วยภายใน: kN, m (E เป็น kN/m², A เป็น m², I เป็น m⁴)

export interface Node {
  id: string;
  x: number; // m
  y: number; // m
}

/** การยึดรั้งที่จุดต่อ: true = ยึด (ux, uy, rz) */
export interface Support {
  node: string;
  ux: boolean;
  uy: boolean;
  rz: boolean;
}

export interface Material {
  id: string;
  name: string;
  E: number; // kN/m²
  /** หน่วยน้ำหนัก kN/m³ ใช้คิดน้ำหนักตัวเอง */
  gamma: number;
  /** กำลังอัดคอนกรีต fc' (ksc) — ใช้ในการออกแบบ ค.ส.ล. */
  fc?: number;
  /** กำลังครากเหล็กเสริมหลัก fy (ksc) */
  fy?: number;
  /** กำลังครากเหล็กปลอก fyt (ksc) */
  fyt?: number;
}

/** หน้าตัดสี่เหลี่ยมผืนผ้า b×h (m) */
export interface Section {
  id: string;
  name: string;
  material: string;
  b: number; // m
  h: number; // m
}

export type MemberKind = "beam" | "column" | "other";

export interface Member {
  id: string;
  i: string; // node id ต้นชิ้นส่วน
  j: string; // node id ปลายชิ้นส่วน
  section: string;
  kind: MemberKind;
  /** ปลดโมเมนต์ (hinge) ที่ปลาย i / ปลาย j */
  releaseI?: boolean;
  releaseJ?: boolean;
}

export interface NodalLoad {
  type: "nodal";
  node: string;
  fx: number; // kN (global)
  fy: number; // kN (global)
  mz: number; // kN·m (ทวนเข็มเป็นบวก)
}

/** แรงแผ่สม่ำเสมอเต็มความยาวชิ้นส่วน (kN/m ต่อความยาวชิ้นส่วน) */
export interface MemberUDL {
  type: "udl";
  member: string;
  /** "globalY" = แนวดิ่ง (ลบ = ลง), "local" = ตั้งฉากแกนชิ้นส่วน */
  dir: "globalY" | "globalX" | "local";
  w: number;
}

/** แรงจุดบนชิ้นส่วนที่ระยะ a (m) จากจุดต้น */
export interface MemberPoint {
  type: "point";
  member: string;
  dir: "globalY" | "globalX" | "local";
  P: number;
  a: number;
}

export type Load = NodalLoad | MemberUDL | MemberPoint;

export interface LoadCase {
  id: string;
  name: string;
  /** คิดน้ำหนักตัวเองโครงสร้างใน load case นี้ */
  selfWeight: boolean;
  loads: Load[];
  /** แรงด้านข้างที่ทำให้โครงเซ (ลม/แผ่นดินไหว) — ไม่กำหนด = ตรวจจากแรงแนวราบอัตโนมัติ */
  lateral?: boolean;
}

/** load case นี้เป็นแรงด้านข้าง (sway) หรือไม่ */
export function isLateralCase(lc: LoadCase): boolean {
  if (lc.lateral !== undefined) return lc.lateral;
  return lc.loads.some((l) => (l.type === "nodal" ? Math.abs(l.fx) > 0 : l.dir === "globalX"));
}

export interface Combo {
  id: string;
  name: string;
  factors: Record<string, number>; // loadCaseId -> factor
}

export interface Model {
  name: string;
  nodes: Node[];
  supports: Support[];
  materials: Material[];
  sections: Section[];
  members: Member[];
  loadCases: LoadCase[];
  combos: Combo[];
  analysis?: AnalysisSettings;
  foundation?: FoundationSettings;
  wind?: WindSettings;
  /** ข้อมูลโครงการ (ใช้ร่วมกับหน้า 3D) */
  info?: ProjectInfo;
  /** โครงนี้ตัดมาจากอาคาร 3D (แนวกริด) — แก้หน้าตัด/น้ำหนักแล้วส่งกลับ 3D, 3D เปลี่ยนแล้วสร้างใหม่ */
  link3d?: { dir: "X" | "Y"; line: number; sig: string };
  /** ภาพหลังคาจากอาคาร 3D (แสดงอย่างเดียว ไม่เข้าการวิเคราะห์): เส้น [x1, y1, x2, y2] (m) */
  roof2d?: { lines: number[][]; note: string };
}

export interface AnalysisSettings {
  /** วิเคราะห์อันดับสอง P-Delta */
  pDelta: boolean;
  /** ใช้ความแข็งแตกร้าวตาม ACI 6.6.3.1.1 (เสา 0.70Ig, คาน 0.35Ig) */
  cracked: boolean;
}

// ---------- ค่าที่ได้จากหน้าตัด ----------
export function sectionProps(s: Section): { A: number; I: number } {
  return { A: s.b * s.h, I: (s.b * s.h ** 3) / 12 };
}

/** Ec ตาม วสท./ACI: 15,100√fc' (ksc) → kN/m² */
export function concreteE(fcKsc: number): number {
  const ecKsc = 15100 * Math.sqrt(fcKsc);
  return ecKsc * 98.0665; // 1 ksc = 98.0665 kN/m²
}

export const KSC_TO_MPA = 0.0980665;
