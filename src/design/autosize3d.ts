// ปรับขนาดหน้าตัดอัตโนมัติ: ขยายเฉพาะชิ้นที่ออกแบบไม่ผ่าน (เป็นค่าปรับรายชิ้นของอาคาร 3D)
//   คาน: เลือกตามสาเหตุ — เหล็กวางชั้นเดียวไม่พอ/แรงบิดเกิน → เพิ่ม b, กำลังดัด/เฉือนหรือ ρ เกิน → เพิ่ม h ≈ h·√ratio
//        (กำลังดัดแปรตาม d²) ปัดขึ้นทีละ 5 cm อย่างน้อย 5 cm และเพิ่ม b เมื่อ h/b > 3
//   เสา: เพิ่มทั้งสองด้าน ≈ ·√ratio (กำลังแปรตามพื้นที่) ปัดขึ้นทีละ 5 cm อย่างน้อย 5 cm
//   จำกัดขนาดสูงสุด (ค่าตั้งต้น 1.5 m) — ชิ้นที่ถึงขีดจำกัดแล้วรายงานให้ผู้ใช้แก้เอง

import { applyOverride, effectiveSize, type GridParams } from "../app3d/generator.ts";

export interface DesignStatus {
  kind: "beam" | "column"; ok: boolean; ratio: number;
  /** คาน: เหล็กวางชั้นเดียวไม่พอ (ต้องกว้างขึ้น) */
  width?: boolean;
  /** คาน: แรงบิดเกินเกณฑ์ */
  torsion?: boolean;
  /** คาน: ρ เกิน ρmax (ต้องลึกขึ้น) */
  depth?: boolean;
}

const STEP = 0.05;
const up = (v: number) => Math.ceil(v / STEP - 1e-9) * STEP;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function growSizes(p: GridParams, design: Record<string, DesignStatus>, maxDim = 1.5): { params: GridParams; changed: string[]; capped: string[] } {
  let out = p;
  const changed: string[] = [], capped: string[] = [];
  for (const [id, d] of Object.entries(design)) {
    if (d.ok) continue;
    const ratio = Number.isFinite(d.ratio) && d.ratio > 1 ? d.ratio : 1.5;
    const k = Math.sqrt(Math.min(ratio, 4)) * 1.03; // เผื่อเล็กน้อยให้ลู่เข้าเร็ว
    const s = effectiveSize(out, id);
    let b = s.b, h = s.h;
    if (d.kind === "beam") {
      const strength = Number.isFinite(d.ratio) && d.ratio > 1;
      const deepen = d.depth || strength || (!d.width && !d.torsion);
      if (d.width) b = Math.max(up(b * 1.2), b + STEP);
      if (d.torsion) b = Math.max(b, s.b + STEP);
      if (deepen) h = Math.max(up(h * k), h + STEP);
      if (h / b > 3) b = up(h / 3);
    } else {
      b = Math.max(up(b * k), b + STEP);
      h = Math.max(up(h * k), h + STEP);
    }
    b = r3(Math.min(b, maxDim)); h = r3(Math.min(h, maxDim));
    if (b === s.b && h === s.h) { capped.push(id); continue; }
    out = applyOverride(out, [id], { size: { b, h } });
    changed.push(id);
  }
  return { params: out, changed, capped };
}
