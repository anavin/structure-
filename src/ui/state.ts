// สถานะของแอปและการคำนวณใหม่อัตโนมัติเมื่อโมเดลเปลี่ยน

import { applyWindLinked } from "../shared/frameFrom3d.ts";
import { sanitizeAny } from "../shared/sanitize.ts";
import { runAll, type RunResult } from "../core/combos.ts";
import type { Model } from "../core/model.ts";
import { designRcBeam, type BeamDesignResult, type DesignCode } from "../design/rcBeam.ts";
import { designRcColumn, type ColumnDemand, type ColumnDesignResult } from "../design/rcColumn.ts";
import { swayAnalysis, type SwayResult } from "../design/sway.ts";
import { defaultFoundation, designFooting, type FootingResult, type FoundationSettings } from "../design/footing.ts";
import { analyzeCombo } from "../core/combos.ts";
import { isLateralCase, type Combo } from "../core/model.ts";
import { sampleModel } from "./sample.ts";
import { concreteE } from "../core/model.ts";
import { emptyInfo, loadShared, saveShared, type SharedProject } from "../shared/shared.ts";
import { applyWind, defaultWind } from "../loads/windTH.ts";
import { units } from "../app3d/units.ts";
import { pushFrameTo3D } from "../shared/frameFrom3d.ts";

export type Display = "model" | "deformed" | "N" | "V" | "M" | "reactions";
export type Selection = { kind: "node" | "member"; id: string } | null;

export interface DesignSettings { code: DesignCode; cover: number; stirrupDia: number; stirrupLegs: number; colK: number; betaDns: number; betaDs: number; sway: boolean }

const STORAGE_KEY = "structlab.project.v1";

/** โมเดล 2D จากไฟล์/storage: ทำความสะอาดข้อความ เติมรายการที่ขาดเป็น [] และตรวจโครงสร้างขั้นต่ำ — ไม่ผ่านโยน Error */
export function normalizeModel(raw: unknown): Model {
  const o = sanitizeAny(raw) as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object" || !Array.isArray(o.nodes) || !Array.isArray(o.members)) throw new Error("ไม่ใช่ไฟล์โปรเจกต์ 2D (ไม่มี nodes/members)");
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);
  const m = { ...o, name: typeof o.name === "string" ? o.name : "โครงข้อแข็ง", nodes: arr("nodes"), members: arr("members"), supports: arr("supports"), materials: arr("materials"), sections: arr("sections"), loadCases: arr("loadCases"), combos: arr("combos") } as unknown as Model;
  const ids = new Set<string>();
  for (const n of m.nodes) { if (typeof n?.id !== "string" || !Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error("จุดต่อในไฟล์ไม่ถูกต้อง"); ids.add(n.id); }
  for (const x of m.members) if (typeof x?.id !== "string" || !ids.has(x.i) || !ids.has(x.j)) throw new Error(`ชิ้นส่วน ${String(x?.id ?? "?")} อ้างจุดต่อที่ไม่มี`);
  for (const lc of m.loadCases) if (!Array.isArray(lc.loads)) (lc as { loads: unknown[] }).loads = [];
  return m;
}

function loadSaved(): Model | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeModel(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const saved = loadSaved();
/** ยังไม่เคยมีโมเดล 2D ที่บันทึกไว้ (เปิดครั้งแรก) */
export const freshStart = !saved;

export const app = {
  model: saved ?? sampleModel(),
  run: null as RunResult | null,
  error: null as string | null,
  designs: {} as Record<string, BeamDesignResult>,
  colDesigns: {} as Record<string, ColumnDesignResult>,
  footings: {} as Record<string, FootingResult>,
  footingError: null as string | null,
  selection: null as Selection,
  mode: "select" as "select" | "draw",
  display: "model" as Display,
  resultKey: "combo:U1",
  activeCase: "DL",
  scale: 1,
  showLabels: true,
  grid: 0.5,
  drawSection: { beam: "", column: "" },
  design: { code: "EIT", cover: 40, stirrupDia: 9, stirrupLegs: 2, colK: 1, betaDns: 0.6, betaDs: 0, sway: true } as DesignSettings,
  sway: null as SwayResult | null,
};

// ---------- ค่าร่วมกับหน้า 3D ----------
// ชื่อโครงที่ตัดจาก 3D = "ชื่อโครงการ — โครงแนวกริด …" → ส่วนท้ายเป็นของหน้า 2D เท่านั้น
const FRAME_SUFFIX = / — โครงแนวกริด.*$/;
const baseName = (n: string) => n.replace(FRAME_SUFFIX, "").replace(/( — โครงแนวกริด[^—]*)+$/, "");
const frameSuffix = (n: string) => n.match(FRAME_SUFFIX)?.[0] ?? "";
export function sharedFrom2D(): SharedProject {
  const m = app.model;
  const mat = m.materials.find((x) => x.fc) ?? m.materials[0];
  const { spacing: _sp, ...wind } = { ...defaultWind, ...(m.wind ?? {}) };
  return {
    name: baseName(m.name), info: { ...emptyInfo, ...(m.info ?? {}) },
    // โมเดลที่ไม่มีคอนกรีต (ไม่มี fc') ไม่ส่งค่าวัสดุทับของหน้า 3D
    material: mat?.fc ? { fc: mat.fc, fy: mat.fy ?? 4000, fyt: mat.fyt ?? 2400 } : (loadShared()?.material ?? { fc: 240, fy: 4000, fyt: 2400 }),
    design: { code: app.design.code, cover: app.design.cover, stirrupDia: app.design.stirrupDia, stirrupLegs: app.design.stirrupLegs },
    foundation: { ...defaultFoundation, ...(m.foundation ?? {}) }, wind, units: units.sys,
  };
}

/** นำค่าร่วมมาใช้กับโมเดล 2D: วัสดุคอนกรีตทุกชนิดที่มี fc', ตั้งค่าออกแบบ, ฐานราก, แรงลม (สร้าง WX/WXN ใหม่ถ้ามีอยู่แล้ว) */
export function applyShared2D(sh: SharedProject) {
  const m = app.model;
  if (sh.name) m.name = baseName(sh.name) + frameSuffix(m.name);
  m.info = { ...sh.info };
  for (const mat of m.materials) {
    if (!mat.fc) continue;
    mat.fc = sh.material.fc; mat.fy = sh.material.fy; mat.fyt = sh.material.fyt;
    mat.E = concreteE(sh.material.fc);
    // ชื่อวัสดุแบบอัตโนมัติ ("คอนกรีต fc' 240 ksc") ให้ตรงกับค่าใหม่ — ชื่อที่ผู้ใช้ตั้งเองไม่แตะ
    if (/^คอนกรีต fc' [\d.]+ ksc$/.test(mat.name)) mat.name = `คอนกรีต fc' ${sh.material.fc} ksc`;
  }
  app.design = { ...app.design, ...sh.design };
  m.foundation = { ...sh.foundation };
  const prevWind = JSON.stringify(m.wind ?? null);
  m.wind = { ...defaultWind, ...(m.wind ?? {}), ...sh.wind };
  if (prevWind !== JSON.stringify(m.wind) && m.loadCases.some((c) => c.id === "WX")) applyWindLinked(m, m.wind);
  units.set(sh.units);
}
{
  const sh = loadShared();
  if (sh) applyShared2D(sh);
}

type Listener = () => void;
const listeners: Listener[] = [];
export function subscribe(fn: Listener) { listeners.push(fn); }
function notify() { for (const l of listeners) l(); }

export function recompute() {
  const m = app.model;
  try {
    app.run = runAll(m);
    app.error = null;
  } catch (e) {
    app.run = null;
    app.error = (e as Error).message;
  }
  app.designs = {};
  app.colDesigns = {};
  app.footings = {};
  app.footingError = null;
  app.sway = null;
  if (app.run) {
    const run = app.run;
    const secondOrder = !!m.analysis?.pDelta;
    if (app.design.sway && m.combos.length && !secondOrder) {
      try { app.sway = swayAnalysis(m, m.combos, app.design.betaDs); } catch { app.sway = null; }
    }
    const source = m.combos.length
      ? m.combos.map((c) => ({ key: c.name, r: run.combos[c.id] }))
      : m.loadCases.map((c) => ({ key: c.name, r: run.cases[c.id] }));
    for (const mem of m.members) {
      const sec = m.sections.find((s) => s.id === mem.section);
      const mat = sec && m.materials.find((x) => x.id === sec.material);
      if (!sec || !mat || !mat.fc || !mat.fy) continue;
      if (mem.kind === "column") {
        const sw = app.sway?.columns[mem.id];
        const demands: ColumnDemand[] = sw
          ? sw.combos.map((c) => ({ combo: c.combo, Pu: c.Pu, Mtop: c.Mtop, Mbot: c.Mbot, Vu: c.Vu, deltaS: c.deltaS, Q: c.Q, swayNote: c.note }))
          : source.map(({ key, r }) => {
            const mr = r.members[mem.id];
            const st = mr.stations;
            // Mtop/Mbot ตามระดับจริง (ปลาย i อาจอยู่ด้านบน)
            const ni = m.nodes.find((n) => n.id === mem.i)!, nj = m.nodes.find((n) => n.id === mem.j)!;
            const iBot = ni.y <= nj.y;
            const Mi = st[0].M, Mj = st[st.length - 1].M;
            return { combo: key, Pu: -mr.minN, Mbot: iBot ? Mi : Mj, Mtop: iBot ? Mj : Mi, Vu: mr.maxAbsV, Mmax: Math.max(mr.maxM, -mr.minM) };
          });
        const L = run.cases[m.loadCases[0]?.id]?.members[mem.id]?.L ?? source[0]?.r.members[mem.id].L ?? 3;
        app.colDesigns[mem.id] = designRcColumn(
          {
            code: app.design.code, b: sec.b * 1000, h: sec.h * 1000, cover: app.design.cover, tieDia: app.design.stirrupDia,
            fcKsc: mat.fc, fyKsc: mat.fy, fytKsc: mat.fyt ?? 2400,
          },
          demands,
          { Lu: L * 1000, k: app.design.colK, betaDns: app.design.betaDns, secondOrder },
        );
        continue;
      }
      if (mem.kind !== "beam") continue;
      const env = app.run.envelope[mem.id];
      app.designs[mem.id] = designRcBeam({
        code: app.design.code,
        b: sec.b * 1000, h: sec.h * 1000,
        cover: app.design.cover,
        fcKsc: mat.fc, fyKsc: mat.fy, fytKsc: mat.fyt ?? 2400,
        stirrupDia: app.design.stirrupDia, stirrupLegs: app.design.stirrupLegs,
        MuPos: Math.max(0, env.maxM), MuNeg: Math.max(0, -env.minM), Vu: env.maxAbsV,
      });
    }
  }
  if (app.run) {
    try { designFootings(); } catch (e) { app.footingError = (e as Error).message; app.footings = {}; }
  }
  saveShared(sharedFrom2D(), "2d");
  // ให้ตัวเลือกผลลัพธ์ยังชี้ไปที่ case/combo ที่มีอยู่
  const valid = [...m.combos.map((c) => `combo:${c.id}`), ...m.loadCases.map((c) => `case:${c.id}`)];
  if (!valid.includes(app.resultKey)) app.resultKey = valid[0] ?? "";
  if (!m.loadCases.some((c) => c.id === app.activeCase)) app.activeCase = m.loadCases[0]?.id ?? "";
  if (!m.sections.some((s) => s.id === app.drawSection.beam)) app.drawSection.beam = m.sections[0]?.id ?? "";
  if (!m.sections.some((s) => s.id === app.drawSection.column)) app.drawSection.column = m.sections[1]?.id ?? m.sections[0]?.id ?? "";
}

/** เรียกหลังแก้ไขโมเดล: คำนวณใหม่ บันทึก และวาดใหม่ */
export function modelChanged() {
  // โครงที่เชื่อมกับ 3D: ส่งหน้าตัด/น้ำหนักบนคานที่แก้กลับไปอาคาร 3D
  if (app.model.link3d) pushFrameTo3D(app.model);
  recompute();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(app.model)); } catch { /* ไม่มี storage ก็ทำงานต่อได้ */ }
  notify();
}

/** เรียกเมื่อเปลี่ยนแค่การแสดงผล */
export function viewChanged() { notify(); }

export function setModel(m: Model) {
  app.model = m;
  app.selection = null;
  modelChanged();
}

export function nextId(prefix: string, existing: { id: string }[]): string {
  let n = existing.length + 1;
  const ids = new Set(existing.map((e) => e.id));
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function currentResult() {
  if (!app.run) return null;
  const [kind, id] = app.resultKey.split(":");
  return (kind === "combo" ? app.run.combos[id] : app.run.cases[id]) ?? null;
}

export function resultLabel(key: string): string {
  const [kind, id] = key.split(":");
  if (kind === "combo") return app.model.combos.find((c) => c.id === id)?.name ?? id;
  return app.model.loadCases.find((c) => c.id === id)?.name ?? id;
}


export function foundationSettings(): FoundationSettings {
  return { ...defaultFoundation, ...(app.model.foundation ?? {}) };
}

/** แรงใช้งาน: ΣG (×1.0) และ ΣG ± แรงด้านข้างแต่ละกรณี (×1.0, เพิ่มค่ายอมให้ได้) */
export function serviceCombos(): { combo: Combo; wind: boolean }[] {
  const m = app.model;
  const grav = m.loadCases.filter((c) => !isLateralCase(c));
  const lat = m.loadCases.filter((c) => isLateralCase(c));
  const g = Object.fromEntries(grav.map((c) => [c.id, 1]));
  const gName = grav.map((c) => c.id).join(" + ") || "0";
  const out: { combo: Combo; wind: boolean }[] = [{ combo: { id: "S1", name: gName, factors: g }, wind: false }];
  lat.forEach((c, k) => {
    out.push({ combo: { id: `S${2 + 2 * k}`, name: `${gName} + ${c.id}`, factors: { ...g, [c.id]: 1 } }, wind: true });
    out.push({ combo: { id: `S${3 + 2 * k}`, name: `${gName} − ${c.id}`, factors: { ...g, [c.id]: -1 } }, wind: true });
  });
  return out;
}

function designFootings() {
  const m = app.model;
  const run = app.run!;
  const st = foundationSettings();
  const svc = serviceCombos().map(({ combo, wind }) => ({ name: combo.name, wind, r: analyzeCombo(m, combo, undefined, {}) }));
  const strength = m.combos.length
    ? m.combos.map((c) => ({ name: c.name, r: run.combos[c.id] }))
    : m.loadCases.map((c) => ({ name: c.name, r: run.cases[c.id] }));
  for (const sup of m.supports) {
    if (!sup.uy) continue;
    const col = m.members.find((x) => x.kind === "column" && (x.i === sup.node || x.j === sup.node));
    if (!col) continue;
    const sec = m.sections.find((s) => s.id === col.section);
    const mat = sec && m.materials.find((x) => x.id === sec.material);
    if (!sec || !mat?.fc || !mat.fy) continue;
    // แรงที่เสากระทำต่อฐาน = −(แรงปฏิกิริยา); P อัดลงเป็นบวก
    app.footings[sup.node] = designFooting({
      code: app.design.code, c1: sec.h, c2: sec.b, fcKsc: mat.fc, fyKsc: mat.fy, settings: st,
      service: svc.map(({ name, wind, r }) => {
        const re = r.reactions[sup.node];
        return { name, wind, P: re.fy, M: -re.mz, H: -re.fx };
      }),
      strength: strength.map(({ name, r }) => {
        const re = r.reactions[sup.node];
        return { name, Pu: re.fy, Mu: -re.mz, Hu: -re.fx };
      }),
    });
  }
}
