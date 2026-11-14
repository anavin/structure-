// ออกแบบฐานรากทุกจุดรองรับของโมเดล 3D จากแรงปฏิกิริยา
//  - แรงใช้งาน: Σ load case แนวดิ่ง (×1.0) และ ± แต่ละ load case แรงด้านข้าง (เพิ่มค่ายอมให้ได้)
//  - แรงประลัย: ทุกชุดผสม
//  - แรงที่เสากระทำต่อฐาน = −(แรงปฏิกิริยา): P = Rz, Mx = −mx, My = −my, Hx = −fx, Hy = −fy

import { analyzeCombo3, type Run3 } from "../core3d/combos3d.ts";
import type { AnalysisResult3 } from "../core3d/frame3d.ts";
import type { Model3 } from "../core3d/model3d.ts";
import type { FoundationSettings } from "./footing.ts";
import { designFooting3, type FootingLoad3, type FootingResult3 } from "./footing3d.ts";
import type { DesignCode } from "./rcBeam.ts";

export interface ServiceCombo3 { name: string; factors: Record<string, number>; wind: boolean }

export function serviceCombos3(model: Model3): ServiceCombo3[] {
  const grav = model.loadCases.filter((c) => !c.lateral);
  const lat = model.loadCases.filter((c) => c.lateral);
  const g = Object.fromEntries(grav.map((c) => [c.id, 1]));
  const gName = grav.map((c) => c.id).join(" + ") || "0";
  const out: ServiceCombo3[] = [{ name: gName, factors: g, wind: false }];
  for (const c of lat) {
    // แผ่นดินไหว (id ขึ้นต้น E): ใช้ 0.7E ในการตรวจหน่วยแรงใช้งาน
    const k = c.id.startsWith("E") ? 0.7 : 1;
    const t = k === 1 ? c.id : `${k}${c.id}`;
    out.push({ name: `${gName} + ${t}`, factors: { ...g, [c.id]: k }, wind: true });
    out.push({ name: `${gName} − ${t}`, factors: { ...g, [c.id]: -k }, wind: true });
  }
  return out;
}

const loadAt = (name: string, r: AnalysisResult3, node: string, wind?: boolean): FootingLoad3 => {
  const re = r.reactions[node];
  return { name, P: re.fz, Mx: -re.mx, My: -re.my, Hx: -re.fx, Hy: -re.fy, wind };
};

export interface Foundation3Result { footings: Record<string, FootingResult3>; service: { name: string; r: AnalysisResult3 }[] }

export function designFoundations3(model: Model3, run: Run3, settings: FoundationSettings, code: DesignCode): Foundation3Result {
  const service = serviceCombos3(model).map((c) => ({ name: c.name, wind: c.wind, r: analyzeCombo3(model, c.factors) }));
  const strength = model.combos.length
    ? model.combos.map((c) => ({ name: c.name, r: run.results[`combo:${c.id}`] }))
    : model.loadCases.map((c) => ({ name: c.name, r: run.results[`case:${c.id}`] }));
  const secs = new Map(model.sections.map((s) => [s.id, s]));
  const mats = new Map(model.materials.map((m) => [m.id, m]));
  const footings: Record<string, FootingResult3> = {};
  for (const sup of model.supports) {
    if (!sup.uz) continue;
    // เสา หรือผนัง (ฐานรากใต้ผนังใช้ขนาดผนัง t × Lw เป็นขนาด "เสา")
    const col = model.members.find((m) => (m.kind === "column" || m.kind === "wall") && (m.i === sup.node || m.j === sup.node));
    const sec = col && secs.get(col.section);
    const mat = sec && mats.get(sec.material);
    if (!sec || !mat?.fc || !mat.fy) continue;
    // ผนัง: สัดส่วนฐานตามรูปผนัง (ฐานแถบยาวตามแนวผนัง)
    const wallRatio = col!.kind === "wall" ? (sec.h + 0.6) / (sec.b + 0.6) : null;
    // เสาตั้งดิ่ง: แกน 2 = +X → h ตามแกน X (ไม่รองรับมุม beta ในตอนนี้)
    footings[sup.node] = designFooting3({
      code, cx: sec.h, cy: sec.b, fcKsc: mat.fc, fyKsc: mat.fy, settings: wallRatio ? { ...settings, ratio: wallRatio } : settings,
      service: service.map((s) => loadAt(s.name, s.r, sup.node, s.wind)),
      strength: strength.map((s) => loadAt(s.name, s.r, sup.node)),
    });
  }
  return { footings, service };
}
