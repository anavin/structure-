// ค่าร่วมระหว่างหน้า 2D และ 3D (โปรเจกต์เดียวกัน) — เก็บใน localStorage และแจ้งข้ามแท็บผ่าน event "storage"
// ใช้ร่วม: ชื่อ/ข้อมูลโครงการ, วัสดุ (fc', fy, fyt), ตั้งค่าออกแบบพื้นฐาน, ตั้งค่าฐานราก, แรงลม, หน่วยที่แสดง
// ไม่ใช้ร่วม: เรขาคณิต/ชิ้นส่วน/น้ำหนักบรรทุก (2D และ 3D ยังเป็นคนละโมเดล), ระยะห่างโครงสำหรับแรงลม 2D

import type { DesignCode } from "../design/rcBeam.ts";
import { defaultFoundation, type FoundationSettings } from "../design/footing.ts";
import { defaultWind, type WindSettings } from "../loads/windTH.ts";

export interface ProjectInfo { owner: string; location: string; engineer: string; license: string; company: string }
export const emptyInfo: ProjectInfo = { owner: "", location: "", engineer: "", license: "", company: "" };

export interface SharedDesign { code: DesignCode; cover: number; stirrupDia: number; stirrupLegs: number }
export type UnitSys = "kN" | "tf";

export interface SharedProject {
  name: string;
  info: ProjectInfo;
  material: { fc: number; fy: number; fyt: number }; // ksc
  design: SharedDesign;
  foundation: FoundationSettings;
  /** แรงลม (ไม่รวมระยะห่างโครง ซึ่งเป็นค่าเฉพาะโครง 2D) */
  wind: Omit<WindSettings, "spacing">;
  units: UnitSys;
}

export const SHARED_KEY = "structlab.shared.v1";

export const defaultShared: SharedProject = {
  name: "", info: { ...emptyInfo },
  material: { fc: 240, fy: 4000, fyt: 2400 },
  design: { code: "EIT", cover: 40, stirrupDia: 9, stirrupLegs: 2 },
  foundation: { ...defaultFoundation },
  wind: (({ spacing: _s, ...w }) => w)(defaultWind),
  units: "kN",
};

/** อ่านค่าร่วม (null ถ้ายังไม่เคยบันทึก หรือไม่มี storage) */
export function loadShared(): SharedProject | null {
  try {
    const raw = localStorage.getItem(SHARED_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw).data as Partial<SharedProject>;
    return {
      ...defaultShared, ...o,
      info: { ...emptyInfo, ...(o.info ?? {}) },
      material: { ...defaultShared.material, ...(o.material ?? {}) },
      design: { ...defaultShared.design, ...(o.design ?? {}) },
      foundation: { ...defaultFoundation, ...(o.foundation ?? {}) },
      wind: { ...defaultShared.wind, ...(o.wind ?? {}) },
    };
  } catch { return null; }
}

/** บันทึกค่าร่วม — เขียนเฉพาะเมื่อข้อมูลเปลี่ยน (กันวนแจ้งเตือนไปมา) คืนค่า true ถ้าเขียนจริง */
export function saveShared(data: SharedProject, from: "2d" | "3d"): boolean {
  try {
    const cur = localStorage.getItem(SHARED_KEY);
    if (cur && JSON.stringify(JSON.parse(cur).data) === JSON.stringify(data)) return false;
    localStorage.setItem(SHARED_KEY, JSON.stringify({ data, from, t: Date.now() }));
    return true;
  } catch { return false; }
}

/** เรียก cb เมื่ออีกแท็บ/อีกหน้าเปลี่ยนค่าร่วม
 *  - event "storage" (อีกแท็บ)
 *  - กลับมาที่หน้านี้ด้วยปุ่มย้อนกลับ (bfcache: pageshow persisted) หรือสลับแท็บกลับมา (visibilitychange)
 *    ซึ่งไม่มี event storage — เทียบกับค่าปัจจุบันของหน้า (current) แล้วเรียก cb เมื่อไม่ตรงกัน */
export function onSharedChange(cb: (data: SharedProject) => void, current?: () => SharedProject) {
  window.addEventListener("storage", (e) => {
    if (e.key !== SHARED_KEY || !e.newValue) return;
    const d = loadShared();
    if (d) cb(d);
  });
  const resync = () => {
    const d = loadShared();
    if (d && (!current || !sameJSON(current(), d))) cb(d);
  };
  window.addEventListener("pageshow", (e) => { if (e.persisted) resync(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resync(); });
}

/** เทียบเฉพาะส่วน (ใช้ตัดสินว่าต้องวิเคราะห์ใหม่หรือแค่ออกแบบใหม่) */
export const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
