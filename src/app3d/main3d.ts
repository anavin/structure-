import "../style.css";
import "./style3d.css";
import { Scene3D, type Display3, type Projection, type ViewDir } from "./scene.ts";
import { defaultSlab, defaultTie, parseOpenings, type Side, type WallSpec } from "./generator.ts";
import { applyOverride, effectiveLoad, effectiveSize, membersInScope, scopeLabel, type EditScope } from "./generator.ts";
import { encodeShare, decodeShare } from "./share.ts";
import { defaultGrid, EXAMPLES_3D, generateBuilding, overrideCount, type GridParams, type Seismic3, type WindLevel3 } from "./generator.ts";
import { defaultSeismic, type SiteClass } from "../loads/seismicTH.ts";
import { runAll3, storeyDrifts, type Run3 } from "../core3d/combos3d.ts";
import type { Model3 } from "../core3d/model3d.ts";
import { IMPORTANCE, ZONES, type Importance, type WindZone } from "../loads/windTH.ts";
import { defaultDesign3, design3d, type Design3Settings, type MemberDesign3 } from "../design/design3d.ts";
import { totalBarsBiax } from "../design/rcColumnBiaxial.ts";
import { defaultFoundation, type FoundationSettings } from "../design/footing.ts";
import { designFoundations3 } from "../design/foundation3d.ts";
import type { FootingResult3 } from "../design/footing3d.ts";
import { footingPlanSvg3 } from "./plan3d.ts";
import { growSizes, type DesignStatus } from "../design/autosize3d.ts";
import { checkDrifts, type DriftCheck } from "../design/drift3d.ts";
import { boq3d, boqCost, defaultPrices, type Boq } from "../design/boq3d.ts";
import { designBuildingSlabs, type SlabType } from "../design/slab3d.ts";
import { defaultStair, designStair, type StairInput } from "../design/stair.ts";
import { dominantPeriods, modalAnalysis, modeShapeResult, type ModalResult } from "../core3d/modal3d.ts";
import { pushover, type Hinge, type PushoverResult } from "../design/pushover3d.ts";
import { modalTimeHistory, thResultAt, type TimeHistoryResult } from "../core3d/timeHistory3d.ts";
import { syntheticMotion } from "../loads/groundMotion.ts";
import { Sa, seismicForces, spectrum } from "../loads/seismicTH.ts";
import type { AnalysisResult3 } from "../core3d/frame3d.ts";
import type { RsaInfo, RsaResult3 } from "../core3d/rsa3d.ts";
import { panelExists, parseSpacing, storeyWeights } from "./generator.ts";
import { buildDxf, parseDxfGrid, spacingText } from "./dxf.ts";
import { openReport3, type Report3Scope } from "./report3d.ts";
import type { WorkerIn, WorkerOut } from "./worker3d.ts";
import { convertDom, units, type UnitSys } from "./units.ts";
import { emptyInfo, type ProjectInfo } from "./generator.ts";
import { defaultFrame, frameOfMember, frameLabel, parseParams3D, saved2DIsLinked, sendFrameRefTo2D, sendFrameTo2D, type FrameDir } from "../shared/frameFrom3d.ts";
import { loadShared, onSharedChange, sameJSON, saveShared, type SharedProject } from "../shared/shared.ts";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (v: number, dp = 2) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * 10 ** -dp ? (0).toFixed(dp) : v.toFixed(dp)) : "-");
const KEY = "structlab.3d.params.v1";
const SET_KEY = "structlab.3d.settings.v1"; // ตั้งค่าออกแบบ + ฐานราก (แยกจากหน้า 2D)
/** อัตราส่วน drift แบบ 1/n (ไม่แสดงเมื่อเล็กกว่า 1/100,000 ซึ่งเป็นเศษทศนิยม) */
const ratio = (d: number) => (Math.abs(d) < 1e-5 ? "–" : `1/${Math.round(1 / Math.abs(d)).toLocaleString()}`);

function loadParams(): GridParams {
  try { return parseParams3D(localStorage.getItem(KEY)); } catch { return structuredClone(defaultGrid); }
}

interface ViewPrefs { proj: Projection; solid: boolean; axes: boolean; concrete: boolean; values: boolean; units: UnitSys; slabs?: boolean; loads?: boolean }
const defaultPrefs: ViewPrefs = { proj: "perspective", solid: false, axes: true, concrete: false, values: true, units: "kN", slabs: true, loads: false };
function loadSettings(): { dset: Design3Settings; fset: FoundationSettings; prefs: ViewPrefs } {
  try {
    const raw = localStorage.getItem(SET_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return { dset: { ...defaultDesign3, ...(o.dset ?? {}) }, fset: { ...defaultFoundation, ...(o.fset ?? {}) }, prefs: { ...defaultPrefs, ...(o.prefs ?? {}) } };
    }
  } catch { /* ไม่มี storage */ }
  return { dset: { ...defaultDesign3 }, fset: { ...defaultFoundation }, prefs: { ...defaultPrefs } };
}
// ---------- ค่าร่วมกับหน้า 2D ----------
function sharedFrom3D(): SharedProject {
  const { spacing: _sp, ...wind } = st.params.wind;
  return {
    name: st.params.name, info: { ...emptyInfo, ...(st.params.info ?? {}) },
    material: { fc: st.params.fcKsc, fy: st.params.fyKsc, fyt: st.params.fytKsc ?? 2400 },
    design: { code: st.dset.code, cover: st.dset.cover, stirrupDia: st.dset.stirrupDia, stirrupLegs: st.dset.stirrupLegs },
    foundation: { ...st.fset }, wind, units: units.sys,
  };
}
function applyShared3D(sh: SharedProject) {
  st.params = {
    ...st.params, name: (sh.name || st.params.name).replace(/ — โครงแนวกริด.*$/, ""), info: { ...sh.info },
    fcKsc: sh.material.fc, fyKsc: sh.material.fy, fytKsc: sh.material.fyt,
    wind: { ...st.params.wind, ...sh.wind },
  };
  st.dset = { ...st.dset, ...sh.design };
  st.fset = { ...sh.foundation };
  units.set(sh.units);
}
function pushShared() { saveShared(sharedFrom3D(), "3d"); }

function saveSettings() {
  pushShared();
  const prefs: ViewPrefs = { proj: scene.projection, solid: scene.solidView, axes: scene.axesVisible, concrete: scene.concreteColor, values: scene.showValues, units: units.sys, slabs: showSlabs, loads: showLoads };
  try { localStorage.setItem(SET_KEY, JSON.stringify({ dset: st.dset, fset: st.fset, prefs })); } catch { /* ไม่มี storage */ }
}
const saved = loadSettings();
/** แสดงแผ่นพื้น / น้ำหนักบรรทุกในภาพ 3D */
let showSlabs = saved.prefs.slabs ?? true;
let showLoads = saved.prefs.loads ?? false;

const st = {
  params: loadParams(),
  model: null as Model3 | null,
  wind: [] as WindLevel3[],
  seismic: null as Seismic3 | null,
  run: null as Run3 | null,
  error: null as string | null,
  display: "model" as Display3,
  resultKey: "combo:U1",
  scale: 1,
  selection: null as string | null,
  level: null as number | null,
  dset: saved.dset,
  fset: saved.fset,
  design: null as Record<string, MemberDesign3> | null,
  footings: null as Record<string, FootingResult3> | null,
  footSel: null as string | null,
};

const scene = new Scene3D($("#view3d"));
units.set(saved.prefs.units);
{
  const sh = loadShared();
  if (sh) applyShared3D(sh); // ค่าร่วมจากหน้า 2D/3D ล่าสุดมีผลเหนือค่าที่จำไว้ของหน้านี้
}
scene.setProjection(saved.prefs.proj);
scene.setConcrete(saved.prefs.concrete);
scene.setSolid(saved.prefs.solid);
scene.setShowAxes(saved.prefs.axes);
scene.showValues = saved.prefs.values;
scene.valueFormat = (v) => { const x = units.F(v); return x.toFixed(Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2); };

// ---------- สร้างโมเดลและวิเคราะห์ ----------
// ---------- ย้อนกลับ / ทำซ้ำ (ประวัติพารามิเตอร์อาคาร) ----------
const hist = { past: [] as string[], future: [] as string[], cur: "", restoring: false };
function recordHistory() {
  const s = JSON.stringify(st.params);
  if (!hist.cur) { hist.cur = s; return; }
  if (s === hist.cur) return;
  hist.past.push(hist.cur);
  if (hist.past.length > 60) hist.past.shift();
  hist.future = [];
  hist.cur = s;
}
function syncUndo() {
  const u = document.querySelector<HTMLButtonElement>("#btn-undo"), r = document.querySelector<HTMLButtonElement>("#btn-redo");
  if (u) u.disabled = !hist.past.length;
  if (r) r.disabled = !hist.future.length;
}
function stepHistory(dir: -1 | 1) {
  const from = dir < 0 ? hist.past : hist.future, to = dir < 0 ? hist.future : hist.past;
  const s = from.pop();
  if (!s) return;
  to.push(hist.cur);
  hist.cur = s;
  st.params = parseParams3D(s);
  hist.restoring = true;
  rebuild(true);
}

/** สร้างโมเดลใหม่และวิเคราะห์ — keep = คงชิ้นที่เลือกและมุมกล้อง (ใช้ตอนแก้ไขรายชิ้น) */
function rebuild(keep = false) {
  if (!hist.restoring) recordHistory();
  hist.restoring = false;
  const prevSel = st.selection;
  if (!autoRunning) autoMsg = null;
  try {
    const { model, wind, seismic } = generateBuilding(st.params, st.dset.code);
    st.model = model; st.wind = wind; st.seismic = seismic; st.error = null;
  } catch (e) {
    st.error = (e as Error).message;
    renderAll();
    return;
  }
  try { localStorage.setItem(KEY, JSON.stringify(st.params)); } catch { /* ไม่มี storage */ }
  pushShared();
  stopModeAnim(false);
  stopPushover(false);
  stopTH(false);
  modal = null;
  po = null;
  th = null;
  st.selection = keep && prevSel && st.model.members.some((m) => m.id === prevSel) ? prevSel : null;
  st.footSel = null;
  st.footings = null;
  st.run = null;
  scene.setModel(st.model, st.level);
  if (!keep) scene.setView("iso");
  renderAll();
  startAnalysis();
}

// ---------- คำนวณเบื้องหลัง (Web Worker) พร้อมแถบความคืบหน้า; ถ้าใช้ Worker ไม่ได้จะคำนวณบนหน้าหลัก ----------
let worker: Worker | null = null;
let seq = 0;
try {
  worker = new Worker(new URL("./worker3d.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => onWorker(e.data);
  worker.onerror = () => { worker = null; };
} catch { worker = null; }

function busy(phase: string | null, done = 0, total = 1) {
  const b = $("#busy");
  if (phase === null) { b.hidden = true; return; }
  b.hidden = false;
  (b.querySelector(".busy-text") as HTMLElement).textContent = (autoRound ? `ปรับขนาดอัตโนมัติ รอบ ${autoRound} · ` : "") + (total > 1 ? `กำลัง${phase}… ${done}/${total}` : `กำลัง${phase}…`);
  (b.querySelector(".fill") as HTMLElement).style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
}

function onWorker(m: WorkerOut) {
  if (m.seq !== seq) return; // ผลเก่าที่ถูกแทนแล้ว
  if (m.type === "progress") busy(m.phase, m.done, m.total);
  else if (m.type === "analyzed") { st.run = m.run; st.error = null; renderAll(); runDesign(); }
  else if (m.type === "designed") {
    st.design = m.design; st.footings = m.footings;
    if (m.footError) st.error = `ฐานราก: ${m.footError}`;
    busy(null); renderAll(); designSettled();
  } else if (m.type === "error") { st.error = m.message; busy(null); renderAll(); designSettled(); }
}

function startAnalysis() {
  seq++;
  busy("วิเคราะห์", 0, (st.model?.loadCases.length ?? 0) + (st.model?.combos.length ?? 0));
  if (worker) { worker.postMessage({ type: "analyze", seq, model: st.model! } satisfies WorkerIn); return; }
  setTimeout(() => {
    try { st.run = runAll3(st.model!); st.error = null; } catch (e) { st.error = (e as Error).message; }
    renderAll();
    runDesign();
  }, 30);
}

function runDesign() {
  st.design = null;
  st.footings = null;
  saveSettings();
  if (!st.run || !st.model) { busy(null); designSettled(); return; }
  busy("ออกแบบ", 0, 2);
  if (worker) { seq++; worker.postMessage({ type: "design", seq, dset: st.dset, fset: st.fset } satisfies WorkerIn); return; }
  setTimeout(() => {
    try { st.design = design3d(st.model!, st.run!, st.dset); } catch (e) { st.error = (e as Error).message; }
    try { st.footings = designFoundations3(st.model!, st.run!, st.fset, st.dset.code).footings; } catch (e) { st.error = `ฐานราก: ${(e as Error).message}`; }
    busy(null);
    renderAll();
    designSettled();
  }, 20);
}

// ---------- ปรับขนาดชิ้นที่ไม่ผ่านอัตโนมัติ (วนวิเคราะห์ → ออกแบบ → ขยาย) ----------
let designWaiter: (() => void) | null = null;
function designSettled() { const w = designWaiter; designWaiter = null; w?.(); }
const nextDesign = () => new Promise<void>((res) => { designWaiter = res; });
let autoMsg: string | null = null;
let autoRunning = false;
let autoRound = 0;
async function autoSize(maxIter = 8) {
  if (autoRunning || !st.design) return;
  autoRunning = true;
  const touched = new Set<string>();
  let capped: string[] = [];
  let it = 0;
  try {
    for (; it < maxIter; it++) {
      const fails = Object.values(st.design ?? {}).filter((d) => !d.ok).length;
      const drift = driftFailures();
      if (!fails && !drift.size) break;
      const status: Record<string, DesignStatus> = Object.fromEntries(Object.entries(st.design ?? {}).map(([id, d]) => {
        if (d.kind !== "beam") return [id, d];
        const msg = `${d.result.bottom.message ?? ""} ${d.result.top.message ?? ""}`;
        return [id, { ...d, width: /ชั้นเดียวไม่พอ/.test(msg), depth: /ρ เกิน/.test(msg), torsion: !d.torsionOk }];
      }));
      // drift เกิน: เพิ่มเสาของชั้นนั้น — drift ∝ 1/I ∝ 1/h⁴ → ขนาด × (Δ/ยอมให้)^¼ (ส่งเป็น ratio² ของ √ ในกติกาเสา)
      for (const [storey, over] of drift) for (const mm of st.model?.members ?? []) {
        if (mm.kind !== "column" || !mm.id.endsWith(`-${storey - 1}`)) continue;
        const cur = status[mm.id];
        const rd = Math.sqrt(over);
        status[mm.id] = { kind: "column", ok: false, ratio: Math.max(cur && !cur.ok ? cur.ratio : 0, rd) };
      }
      const r = growSizes(st.params, status);
      capped = r.capped;
      if (!r.changed.length) break;
      r.changed.forEach((id) => touched.add(id));
      st.params = r.params;
      const wait = nextDesign();
      autoRound = it + 1;
      rebuild(true);
      await wait;
      if (!st.design) break; // วิเคราะห์ไม่สำเร็จ
    }
  } finally { autoRunning = false; autoRound = 0; }
  const left = Object.entries(st.design ?? {}).filter(([, d]) => !d.ok).map(([id]) => id);
  const dLeft = driftFailures().size;
  autoMsg = `ขยาย ${touched.size} ชิ้นใน ${it} รอบ — ` + (dLeft ? `drift ยังไม่ผ่าน ${dLeft} ชั้น · ` : "") + (left.length ? `ยังไม่ผ่าน ${left.length} ชิ้น${capped.length ? ` (ถึงขนาดสูงสุด 1.50 m: ${capped.slice(0, 6).join(", ")}${capped.length > 6 ? " …" : ""})` : ""} ควรพิจารณาระบบโครงสร้าง/วัสดุ` : "คานและเสาผ่านทั้งหมด")
    + (() => { const n = Object.values(st.footings ?? {}).filter((x) => !x.ok).length; return n ? ` · ฐานรากไม่ผ่าน ${n} ฐาน (ดูสาเหตุในการ์ดฐานราก — ไม่ปรับอัตโนมัติ)` : ""; })();
  renderAll();
}

const current = () => st.run?.results[st.resultKey] ?? null;

// ---------- แผ่นพื้นและน้ำหนักในภาพ 3D ----------
const SLAB_COLORS = ["#4cc9f0", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#fb923c", "#2dd4bf", "#c084fc", "#facc15"];
function drawSlabsAndLoads() {
  const p = st.params;
  const inLevel = (z: number) => st.level === null || Math.abs(z - st.level) < 1e-3;
  // แผ่นพื้น
  const panels: Parameters<typeof scene.setSlabs>[0] = [];
  if (showSlabs && st.model) {
    const types = currentSlabs();
    const cum = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);
    const xs = cum(parseSpacing(p.xSpacing)), ys = cum(parseSpacing(p.ySpacing)), zs = cum(parseSpacing(p.storeys));
    const total = types.reduce((a, t) => a + t.panels.length, 0);
    types.forEach((t, n) => {
      const color = t.result.ok ? SLAB_COLORS[n % SLAB_COLORS.length] : "#ef4444";
      for (const q of t.panels) {
        if (!inLevel(zs[q.k])) continue;
        panels.push({ x0: xs[q.i], x1: xs[q.i + 1], y0: ys[q.j], y1: ys[q.j + 1], z: zs[q.k], color, label: total <= 140 || st.level !== null ? t.mark : undefined });
      }
    });
  }
  scene.setSlabs(panels);
  // น้ำหนักบรรทุกของ load case / ชุดผสมที่เลือก
  if (!showLoads || !st.model) { scene.setLoads(null); return; }
  const m = st.model;
  const [kind, id] = st.resultKey.split(":");
  const factors: Record<string, number> = kind === "combo" ? (m.combos.find((c) => c.id === id)?.factors ?? {}) : { [id]: 1 };
  const nodes = new Map(m.nodes.map((n) => [n.id, n]));
  const mems = new Map(m.members.map((x) => [x.id, x]));
  const udl = new Map<string, { w: number; dir: number[] }>();
  const nodal = new Map<string, number[]>();
  for (const [cid, fac] of Object.entries(factors)) {
    const lc = m.loadCases.find((c) => c.id === cid);
    if (!lc || !fac) continue;
    for (const l of lc.loads) {
      if (l.type === "udl") {
        const dir = l.dir === "GX" ? [1, 0, 0] : l.dir === "GY" ? [0, 1, 0] : [0, 0, 1];
        const key = `${l.member}|${dir.join()}`;
        const o = udl.get(key) ?? { w: 0, dir };
        o.w += fac * l.w; udl.set(key, o);
      } else if (l.type === "nodal") {
        const o = nodal.get(l.node) ?? [0, 0, 0];
        o[0] += fac * l.fx; o[1] += fac * l.fy; o[2] += fac * l.fz; nodal.set(l.node, o);
      }
    }
  }
  const pt = (nid: string) => { const n = nodes.get(nid); return n ? [n.x, n.y, n.z] : null; };
  const dia = new Map((m.diaphragms ?? []).map((d) => [d.id, d]));
  const at = (nid: string) => {
    const d = dia.get(nid);
    if (!d) return pt(nid);
    const ps = d.nodes.map((x) => nodes.get(x)!).filter(Boolean);
    return [ps.reduce((a, q) => a + q.x, 0) / ps.length, ps.reduce((a, q) => a + q.y, 0) / ps.length, ps[0].z];
  };
  scene.setLoads({
    udl: [...udl.entries()].map(([key, u]) => { const mem = mems.get(key.split("|")[0]); const a = mem && pt(mem.i), b = mem && pt(mem.j); return a && b && inLevel(a[2]) && Math.abs(u.w) > 1e-9 ? { a, b, w: u.w, dir: u.dir } : null; }).filter((x): x is NonNullable<typeof x> => !!x),
    nodal: [...nodal.entries()].map(([nid, f3]) => { const p3 = at(nid); return p3 && inLevel(p3[2]) ? { p: p3, f: f3 } : null; }).filter((x): x is NonNullable<typeof x> => !!x),
    label: (v) => `${units.F(v).toFixed(units.sys === "tf" ? 2 : 1)}`,
  });
}

// ---------- วิเคราะห์การสั่นอิสระ ----------
let modal: ModalResult | null = null;
let modalErr: string | null = null;
let modeAnim: { n: number; res: AnalysisResult3; t0: number; raf: number } | null = null;
function stopModeAnim(render = true) {
  if (!modeAnim) return;
  cancelAnimationFrame(modeAnim.raf);
  modeAnim = null;
  if (render) renderAll();
}
function playMode(n: number) {
  if (!modal) return;
  stopModeAnim(false);
  const mode = modal.modes.find((m) => m.n === n)!;
  const res = modeShapeResult(modal, mode);
  st.display = "deformed";
  modeAnim = { n, res, t0: performance.now(), raf: 0 };
  renderAll();
  const tick = (t: number) => {
    if (!modeAnim) return;
    const ph = ((t - modeAnim.t0) / 1400) * 2 * Math.PI;
    scene.setResult(modeAnim.res, "deformed", st.scale * 1.6 * Math.sin(ph));
    modeAnim.raf = requestAnimationFrame(tick);
  };
  modeAnim.raf = requestAnimationFrame(tick);
}
function runModal() {
  if (!st.model) return;
  modalErr = null;
  busy("วิเคราะห์การสั่น");
  setTimeout(() => {
    try {
      const p = st.params;
      const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing), dz = parseSpacing(p.storeys);
      const W = st.seismic ? st.seismic.levels.map((l) => l.W) : storeyWeights(p, dx, dy, dz, p.seismic?.llFraction ?? 0.25);
      modal = modalAnalysis(st.model!, W, { Bx: dx.reduce((a, v) => a + v, 0), By: dy.reduce((a, v) => a + v, 0) });
    } catch (e) { modal = null; modalErr = (e as Error).message; }
    busy(null);
    renderRight(); convertDom($("#right-body"));
  }, 30);
}
function modalCard(): string {
  if (!modal) return `<div class="card"><div class="card-h">การสั่นอิสระ (Modal)</div>
    <p class="muted small">หาคาบธรรมชาติ รูปร่างการสั่น และมวลประสิทธิผล — มวลจากน้ำหนักอาคาร (D + ${Math.round((st.params.seismic?.llFraction ?? 0.25) * 100)}%L) ที่จุดอ้างอิงพื้นแต่ละชั้น</p>
    ${modalErr ? `<p class="warn">${esc(modalErr)}</p>` : ""}<button id="btn-modal" class="wide"${st.params.diaphragm ? "" : " disabled title=\"ต้องเปิดพื้นแข็ง\""}>〰 วิเคราะห์การสั่น</button></div>`;
  let cx = 0, cy = 0;
  const rows = modal.modes.map((m) => { cx += m.mx; cy += m.my; return `<tr class="${modeAnim?.n === m.n ? "sel" : ""}"><td><button class="ib-s" data-mode="${m.n}" title="แสดงรูปร่างการสั่น">▶ ${m.n}</button></td><td>${f(m.T, 3)}</td><td>${m.dir === "R" ? "บิด" : m.dir}</td><td>${f(m.mx * 100, 1)}</td><td>${f(m.my * 100, 1)}</td><td>${f(m.mr * 100, 1)}</td><td>${f(cx * 100, 0)} / ${f(cy * 100, 0)}</td></tr>`; }).join("");
  const { Tx, Ty } = dominantPeriods(modal);
  const H = parseSpacing(st.params.storeys).reduce((a, v) => a + v, 0);
  const Tcap = 1.4 * 0.02 * H, Tuse = Math.min(Tx, Ty, Tcap);
  return `<div class="card modal"><div class="card-h">การสั่นอิสระ (Modal) ${modeAnim ? `<button id="btn-modal-stop" class="ib-s">■ หยุด</button>` : ""}</div>
    <table class="mini"><thead><tr><th>โหมด</th><th>T (s)</th><th>ทิศ</th><th>%X</th><th>%Y</th><th>%บิด</th><th>สะสม X/Y</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">คาบหลัก Tx = ${f(Tx, 3)} s · Ty = ${f(Ty, 3)} s · สูตรประมาณ 0.02H = ${f(0.02 * H, 3)} s</p>
    ${st.params.seismic?.enabled ? `<button id="btn-modal-T" class="wide" title="ตั้ง T = min(Tx, Ty) แต่ไม่เกิน 1.4 × 0.02H (Cu·Ta) แล้ววิเคราะห์ใหม่">ใช้ T = ${f(Tuse, 3)} s กับแรงแผ่นดินไหว${Tuse < Math.min(Tx, Ty) - 1e-9 ? " (จำกัดที่ Cu·Ta)" : ""}</button>` : ""}
    <p class="muted small">ใช้ความแข็งของการวิเคราะห์${st.params.cracked ? " (หน้าตัดแตกร้าว)" : ""} ไม่รวม P-Δ · มวลรวมที่จุดอ้างอิงพื้น (บิด: J = M(Bx²+By²)/12) · กด ▶ เพื่อดูการสั่น</p></div>`;
}
function bindModal() {
  document.querySelector<HTMLButtonElement>("#btn-modal")?.addEventListener("click", runModal);
  document.querySelector<HTMLButtonElement>("#btn-modal-stop")?.addEventListener("click", () => stopModeAnim());
  for (const b of document.querySelectorAll<HTMLButtonElement>("#right-body [data-mode]")) b.onclick = () => { playMode(+b.dataset.mode!); };
  document.querySelector<HTMLButtonElement>("#btn-modal-T")?.addEventListener("click", () => {
    if (!modal) return;
    const { Tx, Ty } = dominantPeriods(modal);
    const H = parseSpacing(st.params.storeys).reduce((a, v) => a + v, 0);
    const T = Math.round(Math.min(Tx, Ty, 1.4 * 0.02 * H) * 1000) / 1000;
    st.params = { ...st.params, seismic: { ...defaultSeismic, ...(st.params.seismic ?? {}), Tuser: T } };
    rebuild(true);
  });
}
// ช่องทางสำหรับสคริปต์ (ถ่ายภาพคู่มือ/ทดสอบอัตโนมัติ): เลือกชิ้นส่วนตามรหัส
Object.assign(window, { structlab3d: { select(id: string | null) { st.selection = id; st.footSel = null; renderAll(); return !!(id && st.model?.members.some((m) => m.id === id)); } } });

// ---------- จำลองการพัง (Pushover) ----------
let po: PushoverResult | null = null;
let poErr: string | null = null;
let poOpt: { dir: "X" | "Y"; pattern: "seismic" | "wind" } = { dir: "X", pattern: "seismic" };
let poAnim: { raf: number; t0: number; s: number; done: boolean } | null = null;
const PO_SHAKE_MS = 650, PO_COLLAPSE_MS = 2200;
/** เวลาต่อขั้น: ทั้งลำดับใช้เวลาราว 9 วินาที */
const poStepMs = () => Math.min(320, Math.max(35, 9000 / Math.max(1, po?.steps.length ?? 1)));
function stopPushover(render = true) {
  if (!poAnim) return;
  cancelAnimationFrame(poAnim.raf);
  poAnim = null;
  scene.setMarkers([]);
  if (render) renderAll();
}
function runPushover() {
  if (!st.model || !st.design) return;
  poErr = null;
  stopModeAnim(false); stopPushover(false);
  busy("จำลองการพัง (Pushover)");
  setTimeout(() => {
    try {
      const p = st.params;
      const n = (st.model!.diaphragms ?? []).length;
      let forces: number[], Vdesign: number;
      if (poOpt.pattern === "wind") {
        forces = st.wind.map((l) => (poOpt.dir === "X" ? l.FX : l.FY));
        Vdesign = forces.reduce((a, v) => a + v, 0);
      } else if (st.seismic) {
        forces = st.seismic.levels.map((l) => l.F);
        Vdesign = st.seismic.result.V;
      } else {
        // ไม่ได้เปิดแผ่นดินไหว: รูปแบบสามเหลี่ยมกลับหัวตามน้ำหนักชั้น
        const dz = parseSpacing(p.storeys), W = storeyWeights(p, parseSpacing(p.xSpacing), parseSpacing(p.ySpacing), dz, 0.25);
        let z = 0;
        forces = W.map((w, k) => { z += dz[k]; return w * z; });
        Vdesign = 0;
      }
      po = pushover(st.model!, st.design!, { dir: poOpt.dir, pattern: poOpt.pattern, forces: forces.slice(0, n), Vdesign });
    } catch (e) { po = null; poErr = (e as Error).message; }
    busy(null);
    renderRight(); convertDom($("#right-body"));
    if (po) playPushover();
  }, 30);
}
/** ตำแหน่งจุดหมุนบนรูปเสียรูป (ห่างจากปลาย 12% ของความยาว) */
function hingeMarkers(res: AnalysisResult3, k: number, upTo: number, collapse: boolean) {
  const m = st.model!, nodes = new Map(m.nodes.map((n) => [n.id, n])), mems = new Map(m.members.map((x) => [x.id, x]));
  return po!.hinges.filter((h) => h.step <= upTo).map((h) => {
    const mem = mems.get(h.member)!, a = nodes.get(h.end === "i" ? mem.i : mem.j)!, b = nodes.get(h.end === "i" ? mem.j : mem.i)!;
    const da = res.disp[a.id], db = res.disp[b.id];
    const t = 0.12, P = (q: "x" | "y" | "z", u: "ux" | "uy" | "uz") => a[q] + (b[q] - a[q]) * t + k * ((da?.[u] ?? 0) * (1 - t) + (db?.[u] ?? 0) * t);
    const color = h.type === "shear" ? "#c026d3" : h.kind === "column" ? "#ef4444" : collapse ? "#f97316" : "#facc15";
    return { x: P("x", "ux"), y: P("y", "uy"), z: P("z", "uz"), color, big: h.type === "shear" || h.kind === "column" };
  });
}
function showPushoverStep(s: number, shake: number, grow = 1) {
  if (!po) return;
  const stp = po.steps[Math.min(po.steps.length - 1, Math.max(0, Math.floor(s)))];
  const last = po.steps[po.steps.length - 1];
  const amp = Math.abs(last.roof) > 1e-12 ? stp.roof / last.roof : 1;
  const scale = st.scale * 3 * amp * shake * grow;
  scene.setResult(stp.result, "deformed", scale);
  scene.setMarkers(hingeMarkers(stp.result, scene.deformFactor(stp.result, scale), stp.step, grow > 1));
  renderLegend();
}
function playPushover() {
  if (!po) return;
  st.display = "deformed";
  poAnim = { raf: 0, t0: performance.now(), s: 0, done: false };
  syncToolbar();
  const N = po.steps.length;
  const tick = (t: number) => {
    if (!poAnim || !po) return;
    const stepMs = poStepMs();
    const el = Math.max(0, t - poAnim.t0), ramp = N * stepMs; // เฟรมแรกอาจมีเวลาก่อน t0
    const shake = Math.sin((el / PO_SHAKE_MS) * 2 * Math.PI);
    if (el < ramp) { poAnim.s = el / stepMs; showPushoverStep(poAnim.s, shake); }
    else if (el < ramp + PO_COLLAPSE_MS) {
      poAnim.s = N - 1; poAnim.done = true;
      const g = 1 + 1.5 * ((el - ramp) / PO_COLLAPSE_MS) ** 2; // ช่วงพัง: แกว่งแรงขึ้น
      showPushoverStep(N - 1, po.end === "drift" || po.end === "limit" ? shake : 0.5 + 0.5 * shake, po.end === "drift" || po.end === "limit" ? 1 : g);
    } else { showPushoverStep(N - 1, 1, po.end === "drift" || po.end === "limit" ? 1 : 2.5); poAnim.done = true; renderRight(); convertDom($("#right-body")); return; }
    poAnim.raf = requestAnimationFrame(tick);
  };
  poAnim.raf = requestAnimationFrame(tick);
}
function capacityCurveSvg(r: PushoverResult): string {
  const W = 300, H = 170, pl = 44, pr = 10, pt = 10, pb = 30;
  const xs = r.steps.map((s) => Math.abs(s.drift) * 100), ys = r.steps.map((s) => s.V);
  const xm = Math.max(...xs, 0.1) * 1.05, ym = Math.max(...ys, r.Vdesign, 1) * 1.12;
  const X = (v: number) => pl + (v / xm) * (W - pl - pr), Y = (v: number) => H - pb - (v / ym) * (H - pt - pb);
  const pts = r.steps.map((s, k) => `${X(xs[k]).toFixed(1)},${Y(ys[k]).toFixed(1)}`).join(" ");
  const dots = r.steps.filter((s) => s.hinges.length).map((s) => { const h = s.hinges[0]; return `<circle cx="${X(Math.abs(s.drift) * 100)}" cy="${Y(s.V)}" r="2.6" fill="${h.type === "shear" ? "#c026d3" : h.kind === "column" ? "#ef4444" : "#f59e0b"}"/>`; }).join("");
  const cur = poAnim ? r.steps[Math.min(r.steps.length - 1, Math.max(0, Math.floor(poAnim.s)))] : null;
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => ym / 1.12 * f);
  return `<svg class="po-curve" viewBox="0 0 ${W} ${H}" width="100%">
    ${ticksY.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="${pl - 4}" y="${Y(v) + 3}" text-anchor="end">${v.toFixed(0)}</text>`).join("")}
    <line x1="${pl}" x2="${pl}" y1="${pt}" y2="${H - pb}" class="ax"/><line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" class="ax"/>
    ${[0.25, 0.5, 0.75, 1].map((f) => `<text x="${X(xm / 1.05 * f)}" y="${H - pb + 12}" text-anchor="middle">${(xm / 1.05 * f).toFixed(2)}</text>`).join("")}
    ${r.Vdesign > 0 ? `<line x1="${pl}" x2="${W - pr}" y1="${Y(r.Vdesign)}" y2="${Y(r.Vdesign)}" class="vd"/><text x="${W - pr}" y="${Y(r.Vdesign) - 3}" text-anchor="end" class="vdt">V ออกแบบ</text>` : ""}
    <polyline points="${pts}" class="cv"/>${dots}
    ${cur ? `<circle cx="${X(Math.abs(cur.drift) * 100)}" cy="${Y(cur.V)}" r="4.5" class="cur"/>` : ""}
    <text x="${(W + pl) / 2}" y="${H - 3}" text-anchor="middle">การเคลื่อนตัวยอด (% ความสูง)</text>
    <text x="10" y="${(H - pb) / 2}" transform="rotate(-90 10 ${(H - pb) / 2})" text-anchor="middle">แรงเฉือนฐาน (kN)</text>
  </svg>`;
}
function pushoverCard(): string {
  const sel = (id: string, opts: [string, string][], v: string) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const head = `<div class="card pushover"><div class="card-h">จำลองการพัง (Pushover)${poAnim && !poAnim.done ? ` <button id="po-stop" class="ib-s">■ หยุด</button>` : ""}</div>
    <div class="form g3">
      <label>ทิศ${sel("po-dir", [["X", "แกน X"], ["Y", "แกน Y"]], poOpt.dir)}</label>
      <label class="span2">รูปแบบแรง${sel("po-pat", [["seismic", "แผ่นดินไหว (Cvx)"], ["wind", "แรงลมรายชั้น"]], poOpt.pattern)}</label>
    </div>
    <button id="po-run" class="primary wide"${st.params.diaphragm ? "" : " disabled title=\"ต้องเปิดพื้นแข็ง\""}>💥 ${po ? "จำลองใหม่" : "เริ่มจำลองการพัง"}</button>
    ${poErr ? `<p class="warn">${esc(poErr)}</p>` : ""}`;
  if (!po) return `${head}<p class="muted small">ผลักอาคารด้านข้างทีละขั้นจนพัง ดูว่าคาน/เสาตัวไหนครากก่อน (จุดหมุนพลาสติก) และอาคารพังแบบใด — ภาพจะสั่นแรงขึ้นเรื่อย ๆ ตามขั้น</p></div>`;
  const r = po;
  const fy = r.firstYield, last = r.steps[r.steps.length - 1];
  const kindName = (h: Hinge) => (h.type === "shear" ? "คาน (เฉือน)" : h.kind === "column" ? "เสา" : "คาน");
  const warn: string[] = [];
  if (r.end === "shear") warn.push("⚠ พังแบบเปราะจากแรงเฉือน — ควรเพิ่มเหล็กปลอกให้คานครากด้วยการดัดก่อน");
  if (r.columnFirst) warn.push("⚠ เสาเกิดจุดหมุนก่อนคาน (เสาอ่อน–คานแข็ง) — ควรเพิ่มขนาด/เหล็กเสา");
  const nCol = r.hinges.filter((h) => h.kind === "column").length;
  if (!r.columnFirst && nCol > r.hinges.length / 2) warn.push(`⚠ จุดหมุนส่วนใหญ่อยู่ที่เสา (${nCol}/${r.hinges.length}) — ควรให้เสาแข็งแรงกว่าคาน (strong column – weak beam)`);
  if (r.softStorey) warn.push(`⚠ ชั้นอ่อน: เสาชั้น ${r.softStorey} เกิดจุดหมุนบน–ล่างครบ (กลไกชั้นเดียว)`);
  if (r.Vdesign > 0 && r.Vmax < r.Vdesign) warn.push("⚠ กำลังสูงสุดต่ำกว่าแรงออกแบบ");
  if (!warn.length && r.end === "mechanism") warn.push("✓ เกิดกลไกแบบคานครากก่อน (พึงประสงค์)");
  const mu = fy && Math.abs(fy.drift) > 0 ? Math.abs(last.drift / fy.drift) : NaN;
  return `${head}
    ${capacityCurveSvg(r)}
    <div class="legend po-lg"><span class="sw" style="background:#facc15"></span>จุดหมุนคาน <span class="sw" style="background:#ef4444"></span>จุดหมุนเสา <span class="sw" style="background:#c026d3"></span>เฉือน</div>
    <table class="mini"><tbody>
      <tr><td>เริ่มคราก (จุดหมุนแรก)</td><td>${fy ? `V = ${f(fy.V, 0)} kN${r.Vdesign ? ` (${f(fy.V / r.Vdesign, 2)}×V ออกแบบ)` : ""} · ${esc(fy.hinges[0].member)}` : "-"}</td></tr>
      <tr><td>กำลังสูงสุด</td><td>V = ${f(r.Vmax, 0)} kN${r.Vdesign ? ` · Ω = ${f(r.Vmax / r.Vdesign, 2)}` : ""}</td></tr>
      <tr><td>ยอดเคลื่อนตัว</td><td>${f(Math.abs(last.roof) * 1000, 0)} mm (${f(Math.abs(last.drift) * 100, 2)}% H)${Number.isFinite(mu) ? ` · μ ≈ ${f(mu, 1)}` : ""}</td></tr>
      <tr><td>จบเพราะ</td><td><b>${esc(r.endNote)}</b></td></tr>
      <tr><td>จุดหมุน</td><td>${r.hinges.length} จุด (คาน ${r.hinges.filter((h) => h.kind === "beam").length}, เสา ${r.hinges.filter((h) => h.kind === "column").length})</td></tr>
    </tbody></table>
    ${warn.map((w) => `<p class="${w.startsWith("✓") ? "ok-msg" : "warn"} small">${esc(w)}</p>`).join("")}
    <details><summary class="small">ลำดับการเกิดจุดหมุน (${r.hinges.length})</summary><table class="mini"><thead><tr><th>#</th><th>ชิ้น/ปลาย</th><th>ชนิด</th><th>V (kN)</th><th>ชั้น z</th></tr></thead><tbody>
      ${r.hinges.slice(0, 40).map((h, k) => `<tr><td>${k + 1}</td><td><a href="#" data-pomem="${esc(h.member)}">${esc(h.member)}</a>.${h.end}</td><td>${kindName(h)}</td><td>${f(r.steps[h.step].V, 0)}</td><td>${f(h.z)}</td></tr>`).join("")}
    </tbody></table></details>
    <button id="po-play" class="wide">▶ เล่นภาพจำลองอีกครั้ง</button>
    <p class="muted small">ประมาณ: กำลังออกแบบ φMn, ไม่คิด P-Δ/การเสื่อมกำลัง/วัฏจักร · ผนังคิดยืดหยุ่น · น้ำหนัก D + 0.25L · ใช้ดูลำดับการคราก จุดอ่อน และกลไกการพัง ไม่ใช่การประเมินตามมาตรฐาน (ASCE 41)</p></div>`;
}
function bindPushover() {
  const host = document.querySelector<HTMLElement>(".pushover");
  if (!host) return;
  host.querySelector<HTMLSelectElement>("#po-dir")!.onchange = (e) => { poOpt = { ...poOpt, dir: (e.target as HTMLSelectElement).value as "X" | "Y" }; };
  host.querySelector<HTMLSelectElement>("#po-pat")!.onchange = (e) => { poOpt = { ...poOpt, pattern: (e.target as HTMLSelectElement).value as "seismic" | "wind" }; };
  host.querySelector<HTMLButtonElement>("#po-run")!.onclick = runPushover;
  host.querySelector<HTMLButtonElement>("#po-play")?.addEventListener("click", () => { stopPushover(false); playPushover(); });
  host.querySelector<HTMLButtonElement>("#po-stop")?.addEventListener("click", () => stopPushover());
  for (const a of host.querySelectorAll<HTMLAnchorElement>("[data-pomem]")) a.onclick = (e) => { e.preventDefault(); stopPushover(false); st.selection = a.dataset.pomem!; renderAll(); };
}

// ---------- ประวัติเวลา (คลื่นแผ่นดินไหวสังเคราะห์) ----------
let th: TimeHistoryResult | null = null;
let thErr: string | null = null;
let thOpt: { dir: "X" | "Y"; duration: number } = { dir: "X", duration: 20 };
let thMeta: { pga: number; Vstatic: number; Vrsa: number | null; R: number; Ie: number; Cd: number } | null = null;
let thAnim: { raf: number; t0: number; i: number } | null = null;
function stopTH(render = true) {
  if (!thAnim) return;
  cancelAnimationFrame(thAnim.raf);
  thAnim = null;
  if (render) renderAll();
}
function runTH() {
  if (!st.model) return;
  thErr = null;
  stopModeAnim(false); stopPushover(false); stopTH(false);
  busy("สร้างคลื่นและวิเคราะห์ประวัติเวลา");
  setTimeout(() => {
    try {
      const p = st.params;
      const dx = parseSpacing(p.xSpacing), dy = parseSpacing(p.ySpacing), dz = parseSpacing(p.storeys);
      const eq = { ...defaultSeismic, ...(p.seismic ?? {}) };
      const W = st.seismic ? st.seismic.levels.map((l) => l.W) : storeyWeights(p, dx, dy, dz, eq.llFraction);
      const nDia = st.model!.diaphragms?.length ?? 0;
      if (!nDia) throw new Error("ต้องเปิดพื้นแข็ง");
      const md = modal && modal.modes.length === 3 * nDia ? modal : modalAnalysis(st.model!, W, { Bx: dx.reduce((a, v) => a + v, 0), By: dy.reduce((a, v) => a + v, 0) }, 3 * nDia);
      const spec = spectrum(eq);
      const gm = syntheticMotion((T) => Sa(spec, T), { duration: thOpt.duration });
      th = modalTimeHistory(md, gm, thOpt.dir);
      const rsa = (st.run?.results[`case:E${thOpt.dir}`] as RsaResult3 | undefined)?.rsa;
      thMeta = { pga: gm.pga, Vstatic: st.seismic?.result.V ?? seismicForces(eq, W.map((w, k) => ({ z: dz.slice(0, k + 1).reduce((a, v) => a + v, 0), W: w }))).V, Vrsa: rsa ? rsa.V / rsa.scale : null, R: eq.R, Ie: eq.Ie, Cd: eq.Cd ?? 2.5 };
    } catch (e) { th = null; thErr = (e as Error).message; }
    busy(null);
    renderRight(); convertDom($("#right-body"));
    if (th) playTH();
  }, 30);
}
function showTH(i: number) {
  if (!th) return;
  const r = thResultAt(th, i);
  const amp = th.max.roof > 0 ? Math.abs(th.roof[i]) / th.max.roof : 0;
  scene.setResult(r, "deformed", st.scale * 4 * amp);
  // เส้นบอกเวลาในกราฟ
  for (const ln of document.querySelectorAll<SVGLineElement>(".th-cursor")) { const x = 30 + (i / (th.n - 1)) * 262; ln.setAttribute("x1", String(x)); ln.setAttribute("x2", String(x)); }
  renderLegend();
}
function playTH() {
  if (!th) return;
  st.display = "deformed";
  thAnim = { raf: 0, t0: performance.now(), i: 0 };
  syncToolbar();
  const tick = (t: number) => {
    if (!thAnim || !th) return;
    const i = Math.floor(Math.max(0, t - thAnim.t0) / 1000 / th.dt);
    if (i >= th.n) { thAnim.i = th.n - 1; showTH(th.n - 1); thAnim = null; renderLegend(); return; }
    thAnim.i = i;
    showTH(i);
    thAnim.raf = requestAnimationFrame(tick);
  };
  thAnim.raf = requestAnimationFrame(tick);
}
function thPlot(vals: number[], color: string, label: string, unit: string, fmt: (v: number) => string): string {
  const W = 300, H = 70, pl = 30, pr = 8;
  const m = Math.max(...vals.map((v) => Math.abs(v)), 1e-12);
  const step = Math.max(1, Math.floor(vals.length / 600));
  const pts: string[] = [];
  for (let i = 0; i < vals.length; i += step) pts.push(`${(pl + (i / (vals.length - 1)) * (W - pl - pr)).toFixed(1)},${(H / 2 - (vals[i] / m) * (H / 2 - 8)).toFixed(1)}`);
  return `<svg class="th-plot" viewBox="0 0 ${W} ${H}" width="100%"><line x1="${pl}" x2="${W - pr}" y1="${H / 2}" y2="${H / 2}" class="ax"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.1"/>
    <text x="2" y="10">${label}</text><text x="2" y="${H - 3}">±${fmt(m)} ${unit}</text>
    <line class="th-cursor" x1="${pl}" x2="${pl}" y1="2" y2="${H - 2}"/></svg>`;
}
function thCard(): string {
  const sel = (id: string, opts: [string, string][], v: string) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const head = `<div class="card thcard"><div class="card-h">ประวัติเวลา (คลื่นแผ่นดินไหว)${thAnim ? ` <button id="th-stop" class="ib-s">■ หยุด</button>` : ""}</div>
    <div class="form g3"><label>ทิศ${sel("th-dir", [["X", "แกน X"], ["Y", "แกน Y"]], thOpt.dir)}</label><label class="span2">ความยาวคลื่น${sel("th-dur", [["15", "15 วินาที"], ["20", "20 วินาที"], ["30", "30 วินาที"]], String(thOpt.duration))}</label></div>
    <button id="th-run" class="primary wide"${st.params.diaphragm ? "" : " disabled"}>🌊 ${th ? "จำลองใหม่" : "สร้างคลื่นและจำลองการสั่น"}</button>
    ${thErr ? `<p class="warn">${esc(thErr)}</p>` : ""}`;
  if (!th || !thMeta) return `${head}<p class="muted small">สร้างคลื่นแผ่นดินไหวสังเคราะห์ที่สเปกตรัมตรงกับสเปกตรัมออกแบบ แล้วดูอาคารสั่นตามเวลาจริง พร้อมค่าสูงสุดของการเคลื่อนตัวและแรงเฉือนฐาน</p></div>`;
  const m = thMeta, Vd = th.max.V * m.Ie / m.R;
  const drifts = th.driftMax.map((d, k) => d / th!.storeyH[k]);
  const dmax = Math.max(...drifts), ks = drifts.indexOf(dmax);
  return `${head}
    ${thPlot(th.ag, "#f59e0b", "ความเร่งพื้นดิน", "g", (v) => v.toFixed(3))}
    ${thPlot(th.roof, "#4d8dff", "การเคลื่อนตัวยอด", "mm", (v) => (v * 1000).toFixed(1))}
    ${thPlot(th.V, "#ef4444", "แรงเฉือนฐาน (ยืดหยุ่น)", "kN", (v) => v.toFixed(0))}
    <table class="mini"><tbody>
      <tr><td>PGA</td><td>${f(m.pga, 3)} g · ${th.n} ขั้น (Δt ${th.dt} s) · ${th.q.length} โหมด</td></tr>
      <tr><td>ยอดเคลื่อนตัวสูงสุด</td><td>${f(th.max.roof * 1000, 1)} mm ที่ t = ${f(th.max.tRoof, 2)} s (ยืดหยุ่น)</td></tr>
      <tr><td>แรงเฉือนฐานสูงสุด</td><td>${f(th.max.V, 0)} kN ยืดหยุ่น → ×Ie/R = <b>${f(Vd, 0)} kN</b></td></tr>
      <tr><td>เทียบ</td><td>สถิตเทียบเท่า ${f(m.Vstatic, 0)} kN${m.Vrsa != null ? ` · RSA ${f(m.Vrsa, 0)} kN` : ""}</td></tr>
      <tr><td>drift สูงสุด</td><td>ชั้น ${ks + 1}: ${f(dmax * 100, 3)}% (ยืดหยุ่น) → ×Cd/R = ${f(dmax * m.Cd / m.R * 100, 3)}%</td></tr>
    </tbody></table>
    <button id="th-play" class="wide">▶ เล่นการสั่นอีกครั้ง (เวลาจริง)</button>
    <p class="muted small">คลื่นสังเคราะห์ (ไม่ใช่บันทึกจริง) สเปกตรัมสอดคล้องสเปกตรัมออกแบบ ζ 5% · วิเคราะห์เชิงเส้นรวมทุกโหมด (Newmark) · ภาพขยายเกินจริง · ใช้ดูพฤติกรรมการสั่น ไม่ใช้แทนการออกแบบตามมาตรฐาน</p></div>`;
}
function bindTH() {
  const host = document.querySelector<HTMLElement>(".thcard");
  if (!host) return;
  host.querySelector<HTMLSelectElement>("#th-dir")!.onchange = (e) => { thOpt = { ...thOpt, dir: (e.target as HTMLSelectElement).value as "X" | "Y" }; };
  host.querySelector<HTMLSelectElement>("#th-dur")!.onchange = (e) => { thOpt = { ...thOpt, duration: +(e.target as HTMLSelectElement).value }; };
  host.querySelector<HTMLButtonElement>("#th-run")!.onclick = runTH;
  host.querySelector<HTMLButtonElement>("#th-play")?.addEventListener("click", () => { stopTH(false); stopPushover(false); stopModeAnim(false); playTH(); });
  host.querySelector<HTMLButtonElement>("#th-stop")?.addEventListener("click", () => stopTH());
}

// หยุดภาพเคลื่อนไหวเมื่อเปลี่ยนการแสดงผล/ผลลัพธ์
document.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-display]")) { stopModeAnim(false); stopPushover(false); stopTH(false); } }, true);
document.addEventListener("change", (e) => { if ((e.target as HTMLElement).id === "sel-result") stopModeAnim(false); }, true);

// ---------- ออกแบบพื้นสองทาง ----------
let slabCache: { key: string; types: SlabType[] } | null = null;
function currentSlabs(): SlabType[] {
  const key = JSON.stringify([st.params.slab, st.params.xSpacing, st.params.ySpacing, st.params.storeys, st.params.fcKsc, st.params.fyKsc, st.dset.code]);
  if (slabCache?.key !== key) slabCache = { key, types: designBuildingSlabs(st.params, st.dset.code) };
  return slabCache.types;
}
function slabCard(): string {
  const types = currentSlabs();
  if (!types.length) return "";
  const n = types.reduce((a, t) => a + t.panels.length, 0), bad = types.filter((t) => !t.result.ok);
  const b = (x: { label: string } | null) => (x ? x.label : "–");
  return `<div class="card"><div class="card-h">พื้นสองทาง (วิธีที่ 2) <span class="tag ${bad.length ? "hot" : ""}">${bad.length ? `ไม่ผ่าน ${bad.reduce((a, t) => a + t.panels.length, 0)} แผ่น` : "ผ่านทั้งหมด"}</span></div>
    <table class="mini slab"><thead><tr><th>แบบ</th><th>S×L (m)</th><th>กรณี</th><th>ทิศสั้น ล่าง / บน</th><th>ทิศยาว ล่าง / บน</th><th>แผ่น</th></tr></thead><tbody>
    ${types.map((t) => { const r = t.result; return `<tr class="${r.ok ? "" : "bad"}" title="${esc(r.message)}"><td><b>${t.mark}</b>${t.roof ? " ↑" : ""}</td><td>${f(r.S)}×${f(r.L)}</td><td>${r.oneWay ? "ทางเดียว" : r.caseNo}</td><td>${b(r.short.pos)} / ${b(r.short.negC ?? r.short.negD)}</td><td>${b(r.long.pos)} / ${b(r.long.negC ?? r.long.negD)}</td><td>${t.panels.length}</td></tr>`; }).join("")}
    </tbody></table>
    <p class="muted small">${n} แผ่น · t = ${st.params.slab?.t} m · ↑ = หลังคา · ขอบต่อเนื่องดูจากแผ่นข้างเคียงในกริด · ตารางสัมประสิทธิ์วิธีที่ 2 (ACI 318-63) ต้องตรวจกับมาตรฐานฉบับจริง${bad.length ? ` · ไม่ผ่าน: ${esc(bad[0].result.message)}` : ""}</p></div>`;
}

// ---------- ปริมาณวัสดุ (BOQ) ----------
function currentBoq(): Boq | null {
  if (!st.model || !st.design) return null;
  const sb = { ...defaultSlab, ...(st.params.slab ?? {}) };
  return boq3d(st.model, st.design, st.footings, { cover: st.dset.cover, slabT: sb.enabled ? sb.t : 0, slabs: currentSlabs() });
}
const baht = (v: number) => Math.round(v).toLocaleString("th-TH");
function boqCard(): string {
  const b = currentBoq();
  if (!b) return "";
  const pr = { ...defaultPrices, ...(st.dset.prices ?? {}) };
  const cost = boqCost(b, pr);
  const kg = (r: Record<number, number>) => Object.values(r).reduce((a, v) => a + v, 0);
  const dias = Object.keys(b.total.steel).map(Number).sort((a, c) => a - c);
  const bar = (d: number) => (d <= 9 ? `RB${d}` : `DB${d}`);
  return `<div class="card boq"><div class="card-h">ปริมาณวัสดุโดยประมาณ (BOQ) <button id="boq-csv" class="ib-s" title="ดาวน์โหลดตารางเป็น CSV (เปิดใน Excel)">CSV</button></div>
    <table class="mini"><thead><tr><th></th><th>จำนวน</th><th>คอนกรีต m³</th><th>แบบหล่อ m²</th><th>เหล็ก kg</th></tr></thead><tbody>
    ${b.rows.map((r) => `<tr><td>${r.group}</td><td>${r.count}</td><td>${f(r.conc, 2)}</td><td>${f(r.form, 1)}</td><td>${f(kg(r.steel), 0)}</td></tr>`).join("")}
    <tr class="tot"><td><b>รวม</b></td><td></td><td><b>${f(b.total.conc, 2)}</b></td><td><b>${f(b.total.form, 1)}</b></td><td><b>${f(b.total.steelKg, 0)}</b></td></tr>
    </tbody></table>
    <p class="small">เหล็กแยกขนาด: ${dias.map((d) => `${bar(d)} ${f(b.total.steel[d], 0)} kg`).join(" · ")} · เฉลี่ย ${f(b.total.steelKg / Math.max(b.total.conc, 1e-9), 0)} kg/m³${b.piles ? ` · เสาเข็ม ${b.piles} ต้น` : ""}</p>
    <div class="form g3 boq-price">
      <label>คอนกรีต (บาท/m³)<input id="pr-conc" type="number" step="50" min="0" value="${pr.conc}"/></label>
      <label>แบบหล่อ (บาท/m²)<input id="pr-form" type="number" step="10" min="0" value="${pr.form}"/></label>
      <label>เหล็ก (บาท/kg)<input id="pr-steel" type="number" step="0.5" min="0" value="${pr.steel}"/></label>
    </div>
    <table class="mini"><tbody>
      <tr><td>คอนกรีต</td><td>${baht(cost.conc)} บาท</td></tr><tr><td>แบบหล่อ</td><td>${baht(cost.form)} บาท</td></tr><tr><td>เหล็กเสริม</td><td>${baht(cost.steel)} บาท</td></tr>
      <tr class="tot"><td><b>รวมโครงสร้าง</b></td><td><b>${baht(cost.total)} บาท</b></td></tr>
    </tbody></table>
    <p class="muted small">${b.note.join(" · ")} · ราคาต่อหน่วยเป็นค่าตั้งต้นโดยประมาณ (วัสดุ + ค่าแรง) ควรแก้ตามราคาจริงในพื้นที่${b.piles ? " · ยังไม่รวมค่าเสาเข็ม" : ""}</p></div>`;
}
function bindBoq() {
  const setP = () => {
    const v = (id: string, d: number) => { const x = parseFloat(document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? ""); return Number.isFinite(x) && x >= 0 ? x : d; };
    const pr = { ...defaultPrices, ...(st.dset.prices ?? {}) };
    st.dset = { ...st.dset, prices: { conc: v("pr-conc", pr.conc), form: v("pr-form", pr.form), steel: v("pr-steel", pr.steel) } };
    saveSettings();
    renderRight();
    convertDom($("#right-body"));
  };
  for (const id of ["pr-conc", "pr-form", "pr-steel"]) document.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("change", setP);
  document.querySelector<HTMLButtonElement>("#boq-csv")?.addEventListener("click", () => {
    const b = currentBoq(); if (!b) return;
    const pr = { ...defaultPrices, ...(st.dset.prices ?? {}) };
    const cost = boqCost(b, pr);
    const dias = Object.keys(b.total.steel).map(Number).sort((a, c) => a - c);
    const lines = [
      ["รายการ", "จำนวน", "คอนกรีต (m3)", "แบบหล่อ (m2)", ...dias.map((d) => `เหล็ก ${d} มม. (kg)`), "เหล็กรวม (kg)"],
      ...b.rows.map((r) => [r.group, r.count, r.conc.toFixed(3), r.form.toFixed(2), ...dias.map((d) => (r.steel[d] ?? 0).toFixed(1)), Object.values(r.steel).reduce((a, v) => a + v, 0).toFixed(1)]),
      ["รวม", "", b.total.conc.toFixed(3), b.total.form.toFixed(2), ...dias.map((d) => b.total.steel[d].toFixed(1)), b.total.steelKg.toFixed(1)],
      [],
      ["ราคาต่อหน่วย", "", pr.conc, pr.form, ...dias.map(() => ""), pr.steel],
      ["ค่าใช้จ่าย (บาท)", "", cost.conc.toFixed(0), cost.form.toFixed(0), ...dias.map(() => ""), cost.steel.toFixed(0)],
      ["รวมโครงสร้าง (บาท)", cost.total.toFixed(0)],
      [],
      ...b.note.map((n) => [n]),
    ];
    const csv = "\ufeff" + lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${(st.params.name || "structlab").replace(/[\\/:*?"<>|]+/g, "_")} - BOQ.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// ---------- ตรวจการเคลื่อนตัวด้านข้าง ----------
function driftSettings() {
  const eq = { ...defaultSeismic, ...(st.params.seismic ?? {}) };
  return { windLimit: 1 / (st.dset.windDriftDen ?? 500), eqLimit: 0.02, Cd: eq.Cd ?? 2.5, Ie: eq.Ie };
}
/** ชั้นที่ drift ไม่ผ่าน → อัตราส่วนเกินสูงสุด (Δ/ยอมให้ หรือ θ/θmax) */
function driftFailures(): Map<number, number> {
  const out = new Map<number, number>();
  const c = driftCheck();
  if (!c) return out;
  const lim = driftSettings().windLimit;
  for (const r of c.wind) if (!r.ok) out.set(r.storey, Math.max(r.dx, r.dy) / lim);
  for (const r of c.eq) if (!r.ok) out.set(r.storey, Math.max(out.get(r.storey) ?? 0, Math.max(r.DX, r.DY) / r.limit, Math.max(r.thetaX, r.thetaY) / r.thetaMax));
  return out;
}
function driftCheck() {
  if (!st.model || !st.run) return null;
  try { return checkDrifts(st.model, st.run, driftSettings()); } catch { return null; }
}
function driftCard(c: DriftCheck): string {
  const s = driftSettings();
  const mark = (ok: boolean) => (ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');
  const wind = c.wind.length ? `<table class="mini drift"><thead><tr><th>ชั้น</th><th>Δ/h WX</th><th>Δ/h WY</th><th></th></tr></thead><tbody>
    ${c.wind.map((r) => `<tr><td>${r.storey}</td><td>${ratio(r.dx)}</td><td>${ratio(r.dy)}</td><td>${mark(r.ok)}</td></tr>`).reverse().join("")}
    </tbody></table><p class="muted small">แรงลม: เกณฑ์ Δ/h ≤ 1/${st.dset.windDriftDen ?? 500}</p>` : "";
  const eq = c.eq.length ? `<table class="mini drift"><thead><tr><th>ชั้น</th><th>Δx (mm)</th><th>Δy (mm)</th><th>ยอมให้</th><th>θ</th><th></th></tr></thead><tbody>
    ${c.eq.map((r) => `<tr><td>${r.storey}</td><td>${f(r.DX * 1000, 1)}</td><td>${f(r.DY * 1000, 1)}</td><td>${f(r.limit * 1000, 0)}</td><td>${f(Math.max(r.thetaX, r.thetaY), 3)}</td><td>${mark(r.ok)}</td></tr>`).reverse().join("")}
    </tbody></table><p class="muted small">แผ่นดินไหว: Δ = Cd·δe/Ie (Cd ${s.Cd}, Ie ${s.Ie}) ≤ 0.020h · θ = PΔIe/(VhCd) ≤ ${f(Math.min(0.5 / s.Cd, 0.25), 3)}</p>` : "";
  return `<div class="card"><div class="card-h">ตรวจการเคลื่อนตัวรายชั้น <span class="tag ${c.ok ? "" : "hot"}">${c.ok ? "ผ่านทั้งหมด" : "ไม่ผ่าน"}</span></div>${wind}${eq}
    <p class="muted small">ที่จุดอ้างอิงพื้นแข็ง${st.params.cracked ? " ด้วยความแข็งแตกร้าว (สูงกว่าใช้งานจริง — ปลอดภัย)" : ""}</p></div>`;
}

// ---------- แก้ไขรายชิ้น (หน้าตัด / น้ำหนักบนคาน) ----------
let editScope: EditScope = "member";
function editCard(id: string): string {
  if (!/^(C|BX|BY|KX|KY)-[A-Z]\d+-\d+$/.test(id) || !st.model) return "";
  const p = st.params, col = id.startsWith("C-");
  const s = effectiveSize(p, id), l = effectiveLoad(p, id);
  const ids = st.model.members.map((m) => m.id);
  const sized = !!p.overrides?.size?.[id], loaded = !!p.overrides?.load?.[id];
  const opt = (sc: EditScope) => `<option value="${sc}" ${sc === editScope ? "selected" : ""}>${scopeLabel(id, sc)} (${membersInScope(ids, id, sc).length})</option>`;
  return `<div class="card edit3d"><div class="card-h">แก้ไข${col ? "เสา" : "คาน"} ${(sized || loaded) ? '<span class="tag hot">ปรับรายชิ้น</span>' : '<span class="tag">ตามทั้งอาคาร</span>'}</div>
    <div class="form g${col ? 2 : 3}">
      <label title="${col ? "ด้านตามแกน Y" : "ความกว้างคาน"}">b (m)<input id="ed-b" type="number" step="0.05" min="0.1" value="${s.b}"/></label>
      <label title="${col ? "ด้านตามแกน X" : "ความลึกคาน"}">h (m)<input id="ed-h" type="number" step="0.05" min="0.1" value="${s.h}"/></label>
      ${col ? "" : `<span></span>
      <label title="น้ำหนักบรรทุกคงที่เพิ่มบนคาน (ไม่รวมน้ำหนักตัวเอง)">SDL (kN/m)<input id="ed-sdl" type="number" step="1" min="0" value="${l.sdl}"/></label>
      <label>LL (kN/m)<input id="ed-ll" type="number" step="1" min="0" value="${l.ll}"/></label><span></span>`}
      <label class="span${col ? 2 : 3}">ใช้กับ<select id="ed-scope">${opt("member")}${opt("floor")}${opt("line")}</select></label>
    </div>
    <div class="ed-btns"><button id="ed-apply" class="primary">ใช้ค่านี้</button><button id="ed-reset" title="กลับไปใช้ขนาด/น้ำหนักตามการ์ดสร้างอาคาร">คืนค่าทั้งอาคาร</button></div>
    ${/^B[XY]-[A-Z]\d+-[1-9]\d*$/.test(id) ? `<div class="ed-wall"><label>ผนัง t (m)<input id="ed-wt" type="number" step="0.05" min="0.1" value="0.2"/></label><button id="ed-wall" type="button" title="เปลี่ยนช่วงนี้เป็นผนังรับแรงเฉือนตลอดความสูงอาคาร (แทนคานช่วงนี้ทุกชั้น)">🧱 เปลี่ยนช่วงนี้เป็นผนัง ค.ส.ล. (ทุกชั้น)</button></div>` : ""}
    <button id="ed-del" class="wide danger" title="ลบชิ้นส่วนตามขอบเขตที่เลือก (คืนได้ในการ์ดสร้างอาคาร — รูปทรงอาคาร)">🗑 ลบ${id.startsWith("C-") ? "เสา" : "คาน"}ตามขอบเขตที่เลือก</button>
    <p class="muted small">มีผลกับอาคาร 3D และโครง 2D ที่เชื่อมอยู่ · ขนาด/น้ำหนักทั้งอาคารแก้ได้ในการ์ดสร้างอาคารด้านซ้าย</p></div>`;
}
function wallEditCard(id: string): string {
  return `<div class="card"><div class="card-h">ผนังรับแรงเฉือน</div>
    <p class="muted small">ผนังตลอดความสูงอาคาร แทนคานในช่วงนี้ · แบบจำลองเสากว้าง + แขนแข็ง</p>
    <button id="wall-del" class="wide danger" data-wall="${esc(id)}">ลบผนังนี้ (คืนเป็นคาน)</button></div>`;
}
function bindWallCard() {
  const b = document.querySelector<HTMLButtonElement>("#wall-del");
  if (!b) return;
  b.onclick = () => {
    const m = (b.dataset.wall ?? "").match(/^W([XY])-([A-Z])(\d+)-\d+$/);
    if (!m) return;
    const j = m[2].charCodeAt(0) - 65, i = +m[3] - 1;
    const key = m[1] === "X" ? { dir: "X", line: j, span: i } : { dir: "Y", line: i, span: j };
    st.params = { ...st.params, layout: { ...(st.params.layout ?? {}), walls: (st.params.layout?.walls ?? []).filter((w) => !(w.dir === key.dir && w.line === key.line && w.span === key.span)) } };
    st.selection = null;
    rebuild(true);
  };
}
function bindEditCard() {
  bindWallCard();
  const apply = document.querySelector<HTMLButtonElement>("#ed-apply");
  if (!apply || !st.selection || !st.model) return;
  const id = st.selection;
  const sc = $<HTMLSelectElement>("#ed-scope");
  sc.onchange = () => { editScope = sc.value as EditScope; };
  const targets = () => membersInScope(st.model!.members.map((m) => m.id), id, sc.value as EditScope);
  const val = (sel: string) => parseFloat(document.querySelector<HTMLInputElement>(sel)?.value ?? "");
  apply.onclick = () => {
    const b = val("#ed-b"), h = val("#ed-h");
    if (!(b >= 0.1 && h >= 0.1)) { alert("ขนาดหน้าตัดต้องไม่น้อยกว่า 0.10 m"); return; }
    const patch: Parameters<typeof applyOverride>[2] = { size: { b, h } };
    if (!id.startsWith("C-")) {
      const sdl = val("#ed-sdl"), ll = val("#ed-ll");
      if (!(sdl >= 0 && ll >= 0)) { alert("น้ำหนักต้องไม่ติดลบ"); return; }
      patch.load = { sdl, ll };
    }
    st.params = applyOverride(st.params, targets(), patch);
    rebuild(true);
  };
  document.querySelector<HTMLButtonElement>("#ed-wall")?.addEventListener("click", () => {
    const m = id.match(/^B([XY])-([A-Z])(\d+)-\d+$/);
    const t = parseFloat(document.querySelector<HTMLInputElement>("#ed-wt")?.value ?? "0.2");
    if (!m || !(t >= 0.1)) return;
    const j = m[2].charCodeAt(0) - 65, i = +m[3] - 1;
    const w: WallSpec = m[1] === "X" ? { dir: "X", line: j, span: i, t } : { dir: "Y", line: i, span: j, t };
    const walls = (st.params.layout?.walls ?? []).filter((x) => !(x.dir === w.dir && x.line === w.line && x.span === w.span));
    st.params = { ...st.params, layout: { ...(st.params.layout ?? {}), walls: [...walls, w] } };
    st.selection = null;
    rebuild(true);
  });
  $<HTMLButtonElement>("#ed-del").onclick = () => {
    const ids = targets();
    if (ids.length > 1 && !confirm(`ลบ ${ids.length} ชิ้น?`)) return;
    const removed = [...new Set([...(st.params.layout?.removed ?? []), ...ids])];
    st.params = { ...st.params, layout: { ...(st.params.layout ?? {}), removed } };
    st.selection = null;
    rebuild(true);
  };
  $<HTMLButtonElement>("#ed-reset").onclick = () => {
    st.params = applyOverride(st.params, targets(), { size: null, load: null });
    rebuild(true);
  };
}

// ---------- เปิดโครงของชิ้นที่เลือกในหน้า 2D ----------
function to2dButtons(id: string) {
  const dirs: FrameDir[] = id.startsWith("C-") ? ["X", "Y"] : [/^[BKW]X-/.test(id) ? "X" : "Y"];
  if (!frameOfMember(id, dirs[0])) return ""; // เช่น แขนแข็งของผนัง
  const btns = dirs.map((d) => { const fr = frameOfMember(id, d)!; return `<button class="wide" data-to2d="${esc(id)}" data-dir="${d}" title="ตัดโครง 2D ตามแนวกริดนี้ไปเปิดในหน้า 2D (โมเดล 2D เดิมสำรองไว้ กู้คืนได้)">✎ แก้ไขในโครง 2D ${esc(frameLabel(fr))}</button>`; });
  return `<div class="to2d">${btns.join("")}</div>`;
}
function openIn2D(id: string, dir: FrameDir = "X") {
  try {
    if (sendFrameTo2D(st.params, id, dir)) location.href = "./index.html#from3d";
  } catch (e) { alert(`ตัดโครง 2D ไม่ได้: ${(e as Error).message}`); }
}
// ลิงก์ "โหมด 2D": ถ้าเลือกชิ้นส่วนไว้ เปิดโครงของชิ้นนั้น (เสาใช้แนว X)
{
  const link = $<HTMLAnchorElement>("a.btn-link");
  link.addEventListener("click", (e) => {
    if (st.selection && frameOfMember(st.selection)) { e.preventDefault(); openIn2D(st.selection, "X"); return; }
    // ไม่ได้เลือกชิ้น: ถ้าหน้า 2D เชื่อมกับอาคารนี้อยู่แล้วให้เปิดโครงเดิม (จะอัปเดตตาม 3D เอง) ไม่งั้นเปิดโครงแนวกลาง
    try { localStorage.setItem(KEY, JSON.stringify(st.params)); } catch { /* ไม่มี storage */ }
    if (saved2DIsLinked()) return;
    e.preventDefault();
    try { if (sendFrameRefTo2D(st.params, defaultFrame(st.params))) location.href = "./index.html#from3d"; }
    catch (err) { alert(`ตัดโครง 2D ไม่ได้: ${(err as Error).message}`); }
  });
}
function syncTo2dLink() {
  const link = $<HTMLAnchorElement>("a.btn-link");
  const fr = st.selection ? frameOfMember(st.selection) : null;
  link.textContent = fr ? `← 2D: ${st.selection}` : "← โหมด 2D";
  link.title = fr ? `เปิดโครง${frameLabel(fr)} ที่มี ${st.selection} ในหน้า 2D` : "เปิดโครง 2D ของอาคารนี้ (แนวกริดที่เชื่อมไว้ หรือแนวกลางตามแกน X) — คลิกชิ้นส่วนก่อนเพื่อเปิดแนวของชิ้นนั้น";
  link.classList.toggle("hot", !!fr);
}

function renderAll() {
  syncToolbar();
  syncTo2dLink();
  renderLeft();
  renderRight();
  convertDom($("#left-body"));
  convertDom($("#right-body"));
  renderLegend();
  renderStatus();
  if (!modeAnim && !poAnim && !thAnim) scene.setResult(current(), st.display, st.scale);
  if (!poAnim) scene.setMarkers([]);
  scene.setRatioColors(st.display === "design" && st.design ? Object.fromEntries(Object.entries(st.design).map(([k, v]) => [k, v.ratio])) : null);
  scene.setSelection(st.selection);
  scene.setFootings(st.footings ? Object.entries(st.footings).map(([node, ft]) => ({ node, L: ft.L, B: ft.B, t: ft.t, ok: ft.ok, piles: ft.piles?.coords ?? null, D: st.fset.pileSize })) : [], st.footSel);
  drawSlabsAndLoads();
}

// ---------- แถบเครื่องมือ ----------
function syncToolbar() {
  syncUndo();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-proj]")) b.classList.toggle("active", b.dataset.proj === scene.projection);
  $("#btn-solid").classList.toggle("active", scene.solidView);
  $("#btn-axes").classList.toggle("active", scene.axesVisible);
  $("#btn-concrete").classList.toggle("active", scene.concreteColor);
  $("#btn-values").classList.toggle("active", scene.showValues);
  $("#btn-slabs").classList.toggle("active", showSlabs);
  $("#btn-loads").classList.toggle("active", showLoads);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-units]")) b.classList.toggle("active", b.dataset.units === units.sys);
  $<HTMLButtonElement>("#btn-report3d").disabled = !st.design;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-display]")) b.classList.toggle("active", b.dataset.display === st.display);
  // สเกลมีผลเฉพาะการเสียรูปและแผนภาพ
  const scaleOn = !["model", "design"].includes(st.display);
  const sc = $<HTMLInputElement>("#scale");
  sc.disabled = !scaleOn;
  sc.closest("label")!.classList.toggle("off", !scaleOn);
  sc.closest("label")!.title = scaleOn ? "ขยาย/ย่อ แผนภาพหรือการเสียรูป" : "สเกลใช้กับ การเสียรูป และแผนภาพ M33/M22/N/T — เลือกปุ่มเหล่านั้นก่อน";
  const m = st.model;
  const sel = $<HTMLSelectElement>("#sel-result");
  const opts = m ? [...m.combos.map((c) => [`combo:${c.id}`, `ชุดผสม: ${c.name}`]), ...m.loadCases.map((c) => [`case:${c.id}`, `Load case: ${c.name}`])] : [];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === st.resultKey ? "selected" : ""}>${esc(l)}</option>`).join("");
  const lv = $<HTMLSelectElement>("#sel-level");
  const zs = m ? [...new Set(m.nodes.map((n) => +n.z.toFixed(3)))].sort((a, b) => a - b).slice(1) : [];
  lv.innerHTML = `<option value="">ทั้งหมด</option>` + zs.map((z, k) => `<option value="${z}" ${st.level === z ? "selected" : ""}>ชั้น ${k + 1} (z = ${f(z)})</option>`).join("");
}

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-display]")) {
  b.onclick = () => { st.display = b.dataset.display as Display3; renderAll(); };
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) b.onclick = () => scene.setView(b.dataset.view as ViewDir);
$("#btn-axes").onclick = () => { scene.setShowAxes(!scene.axesVisible); saveSettings(); syncToolbar(); };
$("#btn-solid").onclick = () => { scene.setSolid(!scene.solidView); saveSettings(); renderAll(); };
$("#btn-concrete").onclick = () => { scene.setConcrete(!scene.concreteColor); if (!scene.solidView) scene.setSolid(true); saveSettings(); renderAll(); };
$("#btn-values").onclick = () => { scene.showValues = !scene.showValues; saveSettings(); renderAll(); };
$("#btn-slabs").onclick = () => { showSlabs = !showSlabs; saveSettings(); renderAll(); };
$("#btn-loads").onclick = () => { showLoads = !showLoads; saveSettings(); renderAll(); };
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-units]")) {
  b.onclick = () => { units.set(b.dataset.units as UnitSys); saveSettings(); renderAll(); };
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-proj]")) {
  b.onclick = () => { scene.setProjection(b.dataset.proj as Projection); saveSettings(); syncToolbar(); };
}
$<HTMLSelectElement>("#sel-result").onchange = (e) => { st.resultKey = (e.target as HTMLSelectElement).value; renderAll(); };
$<HTMLInputElement>("#scale").oninput = (e) => { st.scale = parseFloat((e.target as HTMLInputElement).value); scene.setResult(current(), st.display, st.scale); };
$<HTMLSelectElement>("#sel-level").onchange = (e) => {
  const v = (e.target as HTMLSelectElement).value;
  st.level = v === "" ? null : parseFloat(v);
  if (st.model) scene.setModel(st.model, st.level);
  renderAll();
};

// คลิกเลือก (แยกจากการลากหมุนกล้อง)
let down: { x: number; y: number } | null = null;
const canvas = scene.renderer.domElement;
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  st.selection = scene.pick(e);
  st.footSel = st.selection ? null : scene.pickFooting(e);
  renderAll();
});

// ---------- แผงซ้าย: ตัวสร้างโมเดล ----------
function renderLeft() {
  const p = st.params;
  const w = p.wind;
  const eq = { ...defaultSeismic, ...(p.seismic ?? {}) };
  const tb = { ...defaultTie, ...(p.tieBeam ?? {}) };
  const sb = { ...defaultSlab, ...(p.slab ?? {}) };
  const dis = sb.enabled ? "" : "disabled";
  const cv = (side: Side) => p.layout?.cantilevers?.find((c) => c.side === side)?.length ?? 0;
  const opt = <T extends string>(cur: T, list: [T, string][]) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
  $("#left-body").innerHTML = `
    <div class="card"><div class="card-h">สร้างอาคารจากกริด</div>
      <div class="form g3">
        <label class="span3">ชื่อโปรเจกต์<input id="g-name" type="text" value="${esc(p.name)}"/></label>
        <label title="เช่น 3@5 หรือ 5,4,5">ช่วงแกน X (m)<input id="g-x" type="text" value="${esc(p.xSpacing)}"/></label>
        <label>ช่วงแกน Y (m)<input id="g-y" type="text" value="${esc(p.ySpacing)}"/></label>
        <label title="ความสูงชั้น ล่างสุดก่อน เช่น 4,3@3.5">ความสูงชั้น (m)<input id="g-z" type="text" value="${esc(p.storeys)}"/></label>
        <label>เสา b (m)<input id="g-cb" type="number" step="0.05" value="${p.col.b}"/></label>
        <label>เสา h (m)<input id="g-ch" type="number" step="0.05" value="${p.col.h}"/></label>
        <label>fc' (ksc)<input id="g-fc" type="number" step="10" value="${p.fcKsc}"/></label>
        <label>คาน b (m)<input id="g-bb" type="number" step="0.05" value="${p.beam.b}"/></label>
        <label>คาน h (m)<input id="g-bh" type="number" step="0.05" value="${p.beam.h}"/></label>
        <label>fy (ksc)<input id="g-fy" type="number" step="100" value="${p.fyKsc}"/></label>
        <label class="span3" title="กำลังครากเหล็กปลอก">fyt เหล็กปลอก (ksc)<input id="g-fyt" type="number" step="100" value="${p.fytKsc ?? 2400}"/></label>
      </div>
      <div class="sub-h">พื้นสองทาง (น้ำหนักต่อพื้นที่)</div>
      <div class="form g3">
        <label class="span2" title="กระจายน้ำหนักแผ่นพื้นลงคานรอบแผ่นด้วยเส้น 45° เป็นน้ำหนักแผ่สม่ำเสมอเทียบเท่า: ด้านสั้น wS/3, ด้านยาว wS/3·(3−m²)/2"><span><input id="s-on" type="checkbox" ${sb.enabled ? "checked" : ""}/> คิดน้ำหนักจากพื้น</span></label>
        <label title="ความหนาแผ่นพื้น (น้ำหนักตัวเอง 2,400 kg/m³)">t (m)<input id="s-t" type="number" step="0.01" min="0.05" value="${sb.t}" ${dis}/></label>
        <label title="วัสดุปูผิว ฝ้า งานระบบ">SDL (kg/m²)<input id="s-sdl" type="number" step="10" min="0" value="${sb.sdl}" ${dis}/></label>
        <label>LL (kg/m²)<input id="s-ll" type="number" step="10" min="0" value="${sb.ll}" ${dis}/></label>
        <span></span>
        <label>SDL หลังคา<input id="s-sdlr" type="number" step="10" min="0" value="${sb.sdlRoof}" ${dis}/></label>
        <label>LL หลังคา<input id="s-llr" type="number" step="10" min="0" value="${sb.llRoof}" ${dis}/></label>
      </div>
      <div class="sub-h">${sb.enabled ? "น้ำหนักเพิ่มเติมบนคาน เช่น ผนัง (kN/m)" : "น้ำหนักบนคาน (kN/m)"}</div>
      <div class="form g3">
        <label>SDL พื้น<input id="g-sdl" type="number" step="1" value="${p.sdl}"/></label>
        <label>LL พื้น<input id="g-ll" type="number" step="1" value="${p.ll}"/></label>
        <label><span><input id="g-dia" type="checkbox" ${p.diaphragm ? "checked" : ""}/> พื้นแข็ง</span></label>
        <label>SDL หลังคา<input id="g-sdlr" type="number" step="1" value="${p.sdlRoof}"/></label>
        <label>LL หลังคา<input id="g-llr" type="number" step="1" value="${p.llRoof}"/></label>
      </div>
      <div class="sub-h">รูปทรงอาคาร</div>
      <div class="form g3">
        <label class="span3" title="ช่องที่ไม่มีแผ่นพื้น เช่น ช่องบันได/ลิฟต์ — รูปแบบ ชั้น:ช่อง (ช่อง = แถว A,B,… + ช่องตามแกน X 1,2,…) คั่นด้วย , · *:B1 = ทุกชั้น">ช่องเปิดพื้น<input id="g-open" type="text" placeholder="เช่น *:B2, 3:A1" value="${esc((p.layout?.openings ?? []).join(", "))}"/></label>
        <label title="คานยื่นจากขอบด้านซ้าย (−X) ยาว (m), 0 = ไม่มี">ยื่น −X (m)<input id="g-cx0" type="number" step="0.25" min="0" value="${cv("x0")}"/></label>
        <label title="ด้านขวา (+X)">ยื่น +X (m)<input id="g-cx1" type="number" step="0.25" min="0" value="${cv("x1")}"/></label>
        <label title="ยื่นตั้งแต่ชั้นนี้ขึ้นไป">ตั้งแต่ชั้น<input id="g-cfrom" type="number" step="1" min="1" value="${p.layout?.cantilevers?.[0]?.fromLevel ?? 2}"/></label>
        <label title="ด้านหน้า (−Y)">ยื่น −Y (m)<input id="g-cy0" type="number" step="0.25" min="0" value="${cv("y0")}"/></label>
        <label title="ด้านหลัง (+Y)">ยื่น +Y (m)<input id="g-cy1" type="number" step="0.25" min="0" value="${cv("y1")}"/></label>
        <span></span>
      </div>
      ${p.layout?.walls?.length ? `<p class="ovr">🧱 ผนังรับแรงเฉือน ${p.layout.walls.length} ช่วง <button id="g-nowalls" type="button" title="ลบผนังทั้งหมด (คืนเป็นคาน)">ลบทั้งหมด</button></p>` : `<p class="muted small">ใส่ผนังรับแรงเฉือน: คลิกคาน → การ์ดแก้ไข → 🧱 เปลี่ยนช่วงนี้เป็นผนัง</p>`}
      ${p.layout?.removed?.length ? `<p class="ovr">🗑 ลบชิ้นส่วนไว้ ${p.layout.removed.length} ชิ้น <button id="g-unremove" type="button" title="คืนชิ้นที่ลบทั้งหมด">คืนทั้งหมด</button></p>` : `<p class="muted small">ลบเสา/คาน: คลิกชิ้นส่วน → การ์ดแก้ไข → ลบ (เช่น เสาที่ไม่ต่อลงล่าง ชั้นบนที่ถอยร่น)</p>`}
      <div class="sub-h">คานคอดิน</div>
      <div class="form g3">
        <label class="span3" title="คานที่ระดับฐานเชื่อมโคนเสาทุกแนว ฐานเสาหมุนได้ → โมเมนต์ที่ฐานไปที่คานคอดิน (ออกแบบเป็นคาน) ฐานรากรับแรงตามแกน + แรงเฉือน"><span><input id="g-tie" type="checkbox" ${tb.enabled ? "checked" : ""}/> มีคานคอดิน (ฐานเสาหมุนได้)</span></label>
        <label>b (m)<input id="g-tb" type="number" step="0.05" value="${tb.b}" ${tb.enabled ? "" : "disabled"}/></label>
        <label>h (m)<input id="g-th" type="number" step="0.05" value="${tb.h}" ${tb.enabled ? "" : "disabled"}/></label>
        <label title="น้ำหนักผนังชั้นล่างหรือน้ำหนักอื่นบนคานคอดิน (ไม่รวมน้ำหนักตัวเอง)">ผนัง (kN/m)<input id="g-tw" type="number" step="1" min="0" value="${tb.sdl}" ${tb.enabled ? "" : "disabled"}/></label>
      </div>
      <div class="sub-h">แรงลม มยผ. 1311-50 (วิธีอย่างง่าย)</div>
      <div class="form g3">
        <label class="span2">พื้นที่<select id="g-zone">${opt(w.zone, Object.entries(ZONES).map(([k, v]) => [k as WindZone, v.label]))}</select></label>
        <label>ภูมิประเทศ<select id="g-exp">${opt(w.exposure, [["A", "A โล่ง"], ["B", "B เมือง"]])}</select></label>
        <label class="span2">ความสำคัญ<select id="g-imp">${opt(w.importance, Object.entries(IMPORTANCE).map(([k, v]) => [k as Importance, v.label]))}</select></label>
        <label>Cg<input id="g-cg" type="number" step="0.1" value="${w.Cg}"/></label>
      </div>
      <div class="sub-h">แรงแผ่นดินไหว มยผ. 1301/1302-61 (สถิตเทียบเท่า)</div>
      <div class="form g3">
        <label class="span3"><span><input id="e-on" type="checkbox" ${eq.enabled ? "checked" : ""}/> คิดแรงแผ่นดินไหว (สร้าง EX, EY + ชุดผสม)</span></label>
        <label title="ความเร่งตอบสนองเชิงสเปกตรัมที่คาบ 0.2 s จากแผนที่ (g)">Ss (g)<input id="e-ss" type="number" step="0.01" value="${eq.Ss}"/></label>
        <label title="ที่คาบ 1.0 s (g)">S1 (g)<input id="e-s1" type="number" step="0.01" value="${eq.S1}"/></label>
        <label>ชั้นดิน<select id="e-site">${opt(eq.site, [["A", "A หินแข็ง"], ["B", "B หิน"], ["C", "C ดินแน่น"], ["D", "D ดินแข็ง"], ["E", "E ดินอ่อน"]])}</select></label>
        <label title="ตัวประกอบความสำคัญ">Ie<input id="e-ie" type="number" step="0.25" value="${eq.Ie}"/></label>
        <label title="ตัวประกอบปรับผลตอบสนอง ตามระบบโครงสร้าง (โครงต้านแรงดัดธรรมดา ค.ส.ล. = 3)">R<input id="e-r" type="number" step="0.5" value="${eq.R}"/></label>
        <label title="0 = ใช้ T = 0.02H">T (s)<input id="e-t" type="number" step="0.05" min="0" value="${eq.Tuser}"/></label>
        <label title="ตัวประกอบขยายการเคลื่อนตัว (โครงต้านแรงดัด ค.ส.ล. ธรรมดา = 2.5) ใช้ตรวจ Δ = Cd·δe/Ie ≤ 0.020h">Cd<input id="e-cd" type="number" step="0.25" min="1" value="${eq.Cd ?? 2.5}"/></label>
        <label title="สัดส่วนน้ำหนักจรที่รวมในน้ำหนักอาคาร">%LL<input id="e-ll" type="number" step="5" min="0" max="100" value="${Math.round(eq.llFraction * 100)}"/></label>
        <label class="span2" title="สถิตเทียบเท่า: กระจายแรงตามสูตร · สเปกตรัมการตอบสนอง (RSA): ใช้รูปร่างการสั่นจริงทุกโหมด รวม CQC (ต้องเปิดพื้นแข็ง)">วิธีวิเคราะห์<select id="e-method"><option value="ELF" ${eq.method !== "RSA" ? "selected" : ""}>สถิตเทียบเท่า</option><option value="RSA" ${eq.method === "RSA" ? "selected" : ""}>สเปกตรัมการตอบสนอง (RSA)</option></select></label>
        <label title="RSA: ปรับแรงเฉือนฐานให้ไม่น้อยกว่า % ของวิธีสถิต">RSA ≥ %V<input id="e-rsa" type="number" step="5" min="0" max="100" value="${Math.round((eq.rsaMinScale ?? 0.85) * 100)}" ${eq.method === "RSA" ? "" : "disabled"}/></label>
      </div>
      <div class="sub-h">การวิเคราะห์</div>
      <div class="form g3">
        <label title="วิเคราะห์อันดับสอง (P-Δ ทั้งอาคาร + P-δ ตามความยาวชิ้นส่วน) — ACI 6.7"><span><input id="g-pd" type="checkbox" ${p.pDelta ? "checked" : ""}/> P-Δ</span></label>
        <label class="span2" title="ACI 6.6.3.1.1: เสา 0.70Ig, คาน 0.35Ig · ความแข็งบิดคาน 0.10J (แรงบิดแบบสอดคล้อง)"><span><input id="g-cr" type="checkbox" ${p.cracked ? "checked" : ""}/> หน้าตัดแตกร้าว</span></label>
      </div>
      ${overrideCount(p.overrides) ? `<p class="ovr">✎ ปรับรายชิ้น ${overrideCount(p.overrides)} ชิ้น (หน้าตัด/น้ำหนักบนคาน จากแผงแก้ไขหรือโครง 2D) <button id="g-ovclear" type="button" title="ใช้ขนาดและน้ำหนักชุดเดียวทั้งอาคาร">ล้าง</button></p>` : ""}
      <button id="g-build" class="primary wide">วิเคราะห์ใหม่</button>
      <p class="muted small">แก้ช่องใดก็วิเคราะห์ใหม่ให้อัตโนมัติ และส่งค่าที่ใช้ร่วม (ชื่อ วัสดุ แรงลม) ไปหน้า 2D ทันที</p>
      ${st.error ? `<p class="warn">${esc(st.error)}</p>` : ""}
    </div>
    ${projectInfoCard()}
    ${combosCard()}
    ${stairCard()}
    <div class="card"><div class="card-h">ตั้งค่าการออกแบบ</div><div class="form g3">
      <label class="span2">มาตรฐาน<select id="d-code"><option value="EIT" ${st.dset.code === "EIT" ? "selected" : ""}>วสท. 1008-38</option><option value="ACI" ${st.dset.code === "ACI" ? "selected" : ""}>ACI 318-19</option></select></label>
      <label>หุ้ม (mm)<input id="d-cover" type="number" value="${st.dset.cover}"/></label>
      <label>ปลอก Ø<select id="d-sd">${[6, 9, 10, 12].map((d) => `<option ${d === st.dset.stirrupDia ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label>จำนวนขา<input id="d-legs" type="number" min="2" value="${st.dset.stirrupLegs}"/></label>
      <label class="span2" title="เกณฑ์การเคลื่อนตัวรายชั้นจากแรงลม (load case WX/WY)">drift ลม Δ/h ≤ 1/<input id="d-wdrift" type="number" step="50" min="100" value="${st.dset.windDriftDen ?? 500}"/></label>
    </div></div>
    ${foundationCard()}
    ${st.wind.length ? `<div class="card"><div class="card-h">แรงลมรายชั้น</div>
      <table class="mini"><thead><tr><th>ชั้น</th><th>z (m)</th><th>WX (kN)</th><th>WY (kN)</th></tr></thead><tbody>
      ${st.wind.map((l, k) => `<tr><td>${k + 1}</td><td>${f(l.z)}</td><td>${f(l.FX)}</td><td>${f(l.FY)}</td></tr>`).join("")}
      <tr><td colspan="2"><b>แรงเฉือนฐาน</b></td><td><b>${f(st.wind.reduce((a, l) => a + l.FX, 0))}</b></td><td><b>${f(st.wind.reduce((a, l) => a + l.FY, 0))}</b></td></tr>
      </tbody></table>
      <p class="muted small">กระทำที่จุดอ้างอิงพื้นแข็งแต่ละชั้น (ยังไม่คิดการเยื้องศูนย์โดยบังเอิญ)</p></div>` : ""}
    ${st.seismic ? seismicCard(st.seismic) : ""}`;

  const setD = (patch: Partial<Design3Settings>) => { st.dset = { ...st.dset, ...patch }; runDesign(); };
  // เปลี่ยนมาตรฐาน → ชุดผสมน้ำหนักเปลี่ยนตาม จึงต้องวิเคราะห์ใหม่
  $<HTMLSelectElement>("#d-code").onchange = (e) => { st.dset = { ...st.dset, code: (e.target as HTMLSelectElement).value as "EIT" | "ACI" }; saveSettings(); rebuild(true); };
  $<HTMLInputElement>("#d-cover").onchange = (e) => setD({ cover: parseFloat((e.target as HTMLInputElement).value) || 40 });
  $<HTMLSelectElement>("#d-sd").onchange = (e) => setD({ stirrupDia: parseFloat((e.target as HTMLSelectElement).value) });
  $<HTMLInputElement>("#d-legs").onchange = (e) => setD({ stirrupLegs: Math.max(2, parseInt((e.target as HTMLInputElement).value) || 2) });
  $<HTMLInputElement>("#d-wdrift").onchange = (e) => { st.dset = { ...st.dset, windDriftDen: Math.max(100, parseFloat((e.target as HTMLInputElement).value) || 500) }; saveSettings(); renderAll(); };
  bindFoundation();
  bindProjectInfo();
  bindStair();
  bindCombos();
  const num = (id: string) => parseFloat($<HTMLInputElement>(`#${id}`).value);
  // อ่านค่าจากการ์ดสร้างอาคาร — ค่าลมที่ไม่มีช่องในหน้านี้ (V₅₀, TF, Iw, Cp …) คงไว้ เว้นแต่เปลี่ยนพื้นที่/ความสำคัญ
  const readForm = (): GridParams => {
    const z = $<HTMLSelectElement>("#g-zone").value as WindZone;
    const imp = $<HTMLSelectElement>("#g-imp").value as Importance;
    const w0 = st.params.wind;
    return {
      ...st.params,
      name: $<HTMLInputElement>("#g-name").value,
      xSpacing: $<HTMLInputElement>("#g-x").value, ySpacing: $<HTMLInputElement>("#g-y").value, storeys: $<HTMLInputElement>("#g-z").value,
      col: { b: num("g-cb"), h: num("g-ch") }, beam: { b: num("g-bb"), h: num("g-bh") },
      fcKsc: num("g-fc"), fyKsc: num("g-fy"), fytKsc: num("g-fyt"),
      sdl: num("g-sdl"), ll: num("g-ll"), sdlRoof: num("g-sdlr"), llRoof: num("g-llr"),
      diaphragm: $<HTMLInputElement>("#g-dia").checked,
      slab: (() => {
        const on = $<HTMLInputElement>("#s-on").checked;
        const v = (id: string, d: number) => { const x = num(id); return Number.isFinite(x) && x >= 0 ? x : d; };
        return { enabled: on, t: v("s-t", sb.t) || sb.t, sdl: v("s-sdl", sb.sdl), ll: v("s-ll", sb.ll), sdlRoof: v("s-sdlr", sb.sdlRoof), llRoof: v("s-llr", sb.llRoof) };
      })(),
      layout: (() => {
        const from = Math.max(1, Math.round(num("g-cfrom") || 1));
        const cants = (["x0", "x1", "y0", "y1"] as Side[]).map((side) => ({ side, length: Math.max(0, num(`g-c${side}`) || 0), fromLevel: from })).filter((c) => c.length > 0);
        return { ...(st.params.layout ?? {}), openings: parseOpenings($<HTMLInputElement>("#g-open").value), cantilevers: cants };
      })(),
      tieBeam: {
        enabled: $<HTMLInputElement>("#g-tie").checked,
        b: num("g-tb") > 0 ? num("g-tb") : tb.b, h: num("g-th") > 0 ? num("g-th") : tb.h, sdl: Math.max(0, num("g-tw") || 0),
      },
      seismic: {
        ...eq, enabled: $<HTMLInputElement>("#e-on").checked,
        Ss: num("e-ss") || 0, S1: num("e-s1") || 0, site: $<HTMLSelectElement>("#e-site").value as SiteClass,
        Ie: num("e-ie") || 1, R: num("e-r") || 1, Tuser: Math.max(0, num("e-t") || 0), method: $<HTMLSelectElement>("#e-method").value as "ELF" | "RSA", rsaMinScale: Math.min(1, Math.max(0, (num("e-rsa") || 85) / 100)), Cd: num("e-cd") >= 1 ? num("e-cd") : 2.5, llFraction: Math.min(1, Math.max(0, (num("e-ll") || 0) / 100)),
      },
      pDelta: $<HTMLInputElement>("#g-pd").checked,
      cracked: $<HTMLInputElement>("#g-cr").checked,
      wind: {
        ...w0, zone: z, importance: imp, exposure: $<HTMLSelectElement>("#g-exp").value as "A" | "B", Cg: num("g-cg"),
        ...(z !== w0.zone ? { V50: ZONES[z].V50, TF: ZONES[z].TF } : {}),
        ...(imp !== w0.importance ? { Iw: IMPORTANCE[imp].Iw } : {}),
      },
    };
  };
  // แก้ช่องใดก็มีผลทันที: บันทึก + ส่งค่าร่วมให้หน้า 2D แล้ววิเคราะห์ใหม่ (หน่วงเล็กน้อยกันพิมพ์ต่อเนื่อง)
  const card = $("#g-build").closest(".card") as HTMLElement;
  for (const el of card.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
    el.addEventListener("change", () => {
      const next = readForm();
      const wasOn = !!st.params.slab?.enabled, isOn = !!next.slab?.enabled;
      if (!wasOn && isOn && next.sdl === defaultGrid.sdl && next.ll === defaultGrid.ll && next.sdlRoof === defaultGrid.sdlRoof && next.llRoof === defaultGrid.llRoof) {
        Object.assign(next, { sdl: 0, ll: 0, sdlRoof: 0, llRoof: 0 }); // น้ำหนักบนคานค่าตั้งต้นแทนพื้นอยู่แล้ว → กันนับซ้ำ
      }
      if ([next.fcKsc, next.fyKsc, next.col.b, next.col.h, next.beam.b, next.beam.h].some((v) => !(v > 0))) return; // ค่าไม่ถูกต้อง
      st.params = next;
      try { localStorage.setItem(KEY, JSON.stringify(st.params)); } catch { /* ไม่มี storage */ }
      pushShared();
      clearTimeout(autoTimer);
      autoTimer = setTimeout(rebuild, 350);
    });
  }
  $("#g-build").onclick = () => { st.params = readForm(); clearTimeout(autoTimer); rebuild(); };
  document.querySelector<HTMLButtonElement>("#g-nowalls")?.addEventListener("click", () => {
    if (!confirm("ลบผนังรับแรงเฉือนทั้งหมด?")) return;
    st.params = { ...st.params, layout: { ...(st.params.layout ?? {}), walls: [] } };
    rebuild();
  });
  document.querySelector<HTMLButtonElement>("#g-unremove")?.addEventListener("click", () => {
    st.params = { ...st.params, layout: { ...(st.params.layout ?? {}), removed: [] } };
    rebuild();
  });
  document.querySelector<HTMLButtonElement>("#g-ovclear")?.addEventListener("click", () => {
    if (!confirm("ล้างค่าปรับรายชิ้นทั้งหมด (หน้าตัด/น้ำหนักที่แก้จากโครง 2D)?")) return;
    st.params = { ...st.params, overrides: undefined };
    rebuild();
  });
}
let autoTimer: ReturnType<typeof setTimeout> | undefined;

function seismicCard(s: Seismic3) {
  const r = s.result, sp = r.spec;
  return `<div class="card"><div class="card-h">แรงแผ่นดินไหวรายชั้น</div>
    <table class="mini"><tbody>
      <tr><td>Fa / Fv</td><td>${f(sp.Fa, 2)} / ${f(sp.Fv, 2)}</td></tr>
      <tr><td>SDS / SD1</td><td>${f(sp.SDS, 3)} / ${f(sp.SD1, 3)} g</td></tr>
      <tr><td>T / Sa</td><td>${f(r.T, 3)} s / ${f(r.Sa, 3)} g</td></tr>
      <tr><td>Cs = Sa·Ie/R</td><td><b>${f(r.Cs, 4)}</b></td></tr>
      <tr><td>W / V</td><td>${f(r.W, 1)} kN / <b>${f(r.V, 1)} kN</b></td></tr>
    </tbody></table>
    <table class="mini"><thead><tr><th>ชั้น</th><th>z (m)</th><th>W (kN)</th><th>Cvx</th><th>F (kN)</th></tr></thead><tbody>
    ${s.levels.map((l, k) => `<tr><td>${k + 1}</td><td>${f(l.z)}</td><td>${f(l.W, 1)}</td><td>${f(l.Cvx, 3)}</td><td>${f(l.F)}</td></tr>`).join("")}
    </tbody></table>
    <p class="muted small">k = ${f(r.k, 2)} · เยื้องศูนย์โดยบังเอิญ ${f(100 * (st.params.seismic?.eccentricity ?? 0.05), 0)}% ของความกว้างอาคาร${st.params.diaphragm ? "" : " (ไม่คิด เพราะปิดพื้นแข็ง)"} · ค่า Ss, S1, Fa, Fv, R ต้องตรวจกับมาตรฐานฉบับจริง (กรุงเทพฯ ใช้สเปกตรัมเฉพาะ ยังไม่รองรับ)</p>${rsaSummary()}</div>`;
}
function rsaSummary(): string {
  const rx = (st.run?.results["case:EX"] as RsaResult3 | undefined)?.rsa, ry = (st.run?.results["case:EY"] as RsaResult3 | undefined)?.rsa;
  if (!rx && !ry) return st.params.seismic?.method === "RSA" ? `<p class="muted small">RSA: รอผลวิเคราะห์${st.params.diaphragm ? "" : " (ต้องเปิดพื้นแข็ง — ตอนนี้ใช้วิธีสถิต)"}</p>` : "";
  const row = (r: RsaInfo | undefined) => r ? `<tr><td>${r.dir}</td><td>${f(r.V / r.scale, 1)}</td><td>${f(r.Vstatic, 1)}</td><td>${f(r.scale, 3)}</td><td>${f(r.V, 1)}</td><td>${f(r.mass * 100, 0)}%</td></tr>` : "";
  return `<div class="sub-h">สเปกตรัมการตอบสนอง (RSA, CQC ${rx?.nModes ?? ry?.nModes} โหมด)</div>
    <table class="mini"><thead><tr><th>ทิศ</th><th>V RSA</th><th>V สถิต</th><th>ตัวคูณ</th><th>V ใช้</th><th>มวล</th></tr></thead><tbody>${row(rx)}${row(ry)}</tbody></table>
    <p class="muted small">ตัวคูณ = max(1, ${Math.round((st.params.seismic?.rsaMinScale ?? 0.85) * 100)}%·V สถิต / V RSA) · บวกผลแรงบิดจากการเยื้องศูนย์โดยบังเอิญ · drift ใช้ CQC รายชั้น (ไม่คูณตัวคูณแรง)</p>`;
}

// ---------- แผงขวา ----------
function renderRight() {
  const m = st.model, r = current();
  const parts: string[] = [];
  if (st.selection && m && r) {
    const mem = m.members.find((x) => x.id === st.selection)!;
    const mr = r.members[mem.id];
    const sec = m.sections.find((s) => s.id === mem.section);
    const ax = (v: number[]) => `(${v.map((x) => f(x, 2)).join(", ")})`;
    const end = (o: number) => mr.endForces.slice(o, o + 6);
    const [Ni, Vyi, Vzi, Ti, Myi, Mzi] = end(0), [Nj, Vyj, Vzj, Tj, Myj, Mzj] = end(6);
    parts.push(`<div class="card"><div class="card-h">${esc(mem.id)} <span class="tag">${mem.kind === "beam" ? "คาน" : mem.kind === "column" ? "เสา" : mem.kind}</span></div>
      <table class="mini"><tbody>
        <tr><td>จุดต่อ</td><td>${esc(mem.i)} → ${esc(mem.j)}</td></tr>
        <tr><td>หน้าตัด</td><td>${esc(sec?.name ?? "-")} (h ตามแกน 2)</td></tr>
        <tr><td>ความยาว</td><td>${f(mr.L)} m</td></tr>
        <tr><td>แกน 2 / แกน 3</td><td><small>${ax(mr.axes.ey)} / ${ax(mr.axes.ez)}</small></td></tr>
        <tr><td colspan="2" class="sub">ค่าสูงสุดตามความยาว</td></tr>
        <tr><td>|N| / |T|</td><td>${f(mr.maxAbs.N)} kN / ${f(mr.maxAbs.T)} kN·m</td></tr>
        <tr><td>|V2| / |V3|</td><td>${f(mr.maxAbs.Vy)} / ${f(mr.maxAbs.Vz)} kN</td></tr>
        <tr><td>|M33| / |M22|</td><td>${f(mr.maxAbs.Mz)} / ${f(mr.maxAbs.My)} kN·m</td></tr>
      </tbody></table>
      <table class="mini ends"><thead><tr><th></th><th>N kN</th><th>V2 kN</th><th>V3 kN</th><th>T kN·m</th><th>M22 kN·m</th><th>M33 kN·m</th></tr></thead><tbody>
        <tr><td>i</td><td>${f(-Ni)}</td><td>${f(Vyi)}</td><td>${f(Vzi)}</td><td>${f(-Ti)}</td><td>${f(Myi)}</td><td>${f(-Mzi)}</td></tr>
        <tr><td>j</td><td>${f(Nj)}</td><td>${f(-Vyj)}</td><td>${f(-Vzj)}</td><td>${f(Tj)}</td><td>${f(-Myj)}</td><td>${f(Mzj)}</td></tr>
      </tbody></table>
      <p class="muted small">แรงภายในที่ปลาย (N ดึงบวก, M33 บวก = ท้องช้างสำหรับคาน)</p>
      ${to2dButtons(mem.id)}</div>`);
    parts.push(editCard(mem.id));
    if (mem.kind === "wall") parts.push(wallEditCard(mem.id));
    const dz = st.design?.[mem.id];
    if (dz) parts.push(designCard(dz));
  }
  if (st.footSel && st.footings?.[st.footSel]) parts.push(footingCard(st.footSel, st.footings[st.footSel]));
  if (st.design) parts.push(designSummary(st.design));
  if (st.footings) parts.push(footingSummary(st.footings));
  if (st.model && st.run) parts.push(modalCard());
  if (st.model && st.design) parts.push(pushoverCard());
  if (st.model && st.run) parts.push(thCard());
  if (st.model) parts.push(slabCard());
  if (st.design && st.model) parts.push(boqCard());
  if (m && r) {
    const drifts = storeyDrifts(m, r);
    const Rx = Object.values(r.reactions).reduce((a, x) => a + x.fx, 0), Ry = Object.values(r.reactions).reduce((a, x) => a + x.fy, 0), Rz = Object.values(r.reactions).reduce((a, x) => a + x.fz, 0);
    parts.push(`<div class="card"><div class="card-h">แรงปฏิกิริยารวม</div><table class="mini"><tbody>
      <tr><td>ΣRx / ΣRy</td><td>${f(Rx)} / ${f(Ry)} kN</td></tr><tr><td>ΣRz</td><td>${f(Rz)} kN</td></tr>
      <tr><td>ตรวจสมดุล</td><td>${f(Math.abs(Rx + r.appliedTotal.fx) + Math.abs(Ry + r.appliedTotal.fy) + Math.abs(Rz + r.appliedTotal.fz), 6)} kN</td></tr>
    </tbody></table></div>`);
    const dc = driftCheck();
    if (dc) parts.push(driftCard(dc));
    if (drifts.length) {
      parts.push(`<div class="card"><div class="card-h">การเคลื่อนตัวรายชั้น</div><table class="mini drift"><thead><tr><th>ชั้น</th><th>ux (mm)</th><th>uy (mm)</th><th>Δ/h X</th><th>Δ/h Y</th></tr></thead><tbody>
        ${drifts.map((d, k) => `<tr><td>${k + 1}</td><td>${f(d.ux * 1000)}</td><td>${f(d.uy * 1000)}</td><td>${ratio(d.driftX)}</td><td>${ratio(d.driftY)}</td></tr>`).reverse().join("")}
      </tbody></table><p class="muted small">ที่จุดอ้างอิงพื้นแข็ง (ผลจากแรงประลัยถ้าเลือกชุดผสม — ตรวจ drift ด้วย load case ลมใช้งาน)</p></div>`);
    }
  }
  if (!st.selection && !st.footSel) parts.unshift(`<p class="muted">คลิกชิ้นส่วนหรือฐานรากเพื่อดูรายละเอียด · ลากเพื่อหมุน, คลิกขวาลากเพื่อเลื่อน, ล้อเมาส์เพื่อซูม</p>`);
  $("#right-body").innerHTML = parts.join("");
  for (const b of document.querySelectorAll<HTMLButtonElement>("#right-body [data-report]")) b.onclick = () => showReport(b.dataset.report as Report3Scope);
  bindEditCard();
  bindModal();
  bindPushover();
  bindTH();
  bindBoq();
  document.querySelector<HTMLButtonElement>("#btn-autosize")?.addEventListener("click", () => { autoMsg = null; void autoSize(); });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#right-body [data-to2d]")) b.onclick = () => openIn2D(b.dataset.to2d!, b.dataset.dir as FrameDir);
  for (const tr of document.querySelectorAll<HTMLTableRowElement>("#right-body tr[data-node]")) {
    tr.onclick = () => { st.footSel = tr.dataset.node!; st.selection = null; renderAll(); };
  }
}

const ratioCls = (r: number) => (r > 1 ? "badc" : r > 0.85 ? "warnc" : "okc");

function designCard(d: MemberDesign3): string {
  const warn = d.warnings.map((w) => `<p class="warn small">${esc(w)}</p>`).join("");
  if (d.kind === "beam") {
    const b = d.result;
    const bar = (x: typeof b.bottom) => (x.bars ? `${x.bars.n}DB${x.bars.dia}` : "—");
    return `<div class="card ${d.ok ? "ok" : "bad"}"><div class="card-h">ออกแบบคาน <span class="tag ${d.ok ? "ok" : "bad"}">${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
      <table class="mini"><tbody>
        <tr><td>เหล็กล่าง</td><td>${bar(b.bottom)} <small>(Mu+ ${f(b.bottom.Mu)} / φMn ${f(b.bottom.phiMn)})</small></td></tr>
        <tr><td>เหล็กบน</td><td>${bar(b.top)} <small>(Mu− ${f(b.top.Mu)} / φMn ${f(b.top.phiMn)})</small></td></tr>
        <tr><td>ปลอก</td><td>${esc(b.shear.message.replace("เหล็กปลอก ", ""))} <small>(Vu ${f(b.shear.Vu)} kN)</small></td></tr>
        <tr><td>แรงบิด</td><td>${f(d.Tu)} / เกณฑ์ ${f(d.Tth)} kN·m${d.torsion?.required ? (d.torsion.ok ? " — ออกแบบเหล็กรับแรงบิดแล้ว" : " — หน้าตัดเล็กเกิน") : ""}</td></tr>
        ${d.torsion?.required && d.torsion.ok ? `<tr><td>เหล็กรับบิด</td><td>${d.torsionBars?.top ? `บน +${d.torsionBars.top} เส้น ` : ""}${d.torsionBars?.bottom ? `ล่าง +${d.torsionBars.bottom} เส้น ` : ""}${d.torsion.side ? `ข้างละ ${d.torsion.side.n}-DB${d.torsion.side.dia}` : ""}${!d.torsionBars?.top && !d.torsionBars?.bottom && !d.torsion.side ? "เหล็กหลักพอ" : ""} <small>(Al ${f(d.torsion.Al, 0)} mm²)</small></td></tr>` : ""}
        <tr><td>อัตราส่วน</td><td><b class="${ratioCls(d.ratio)}">${f(d.ratio, 2)}</b></td></tr>
      </tbody></table>${warn}<button class="primary wide" data-report="member:${esc(st.selection ?? "")}">รายการคำนวณคานนี้</button></div>`;
  }
  if (d.kind === "wall") {
    const w = d.result;
    const bars = (b: typeof w.vertical) => (b ? `DB${b.dia} @ ${(b.s / 1000).toFixed(3)}${b.curtains === 2 ? " ×2 ชั้น" : ""} <small>(ρ ${f(b.rho * 100, 3)}%)</small>` : "—");
    return `<div class="card ${d.ok ? "ok" : "bad"}"><div class="card-h">ออกแบบผนังรับแรงเฉือน <span class="tag ${d.ok ? "ok" : "bad"}">${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
      <table class="mini"><tbody>
        <tr><td>ผนัง</td><td>${f(d.t, 0)} × ${f(d.Lw, 0)} mm · สูงรวม ${f(d.hw / 1000)} m</td></tr>
        <tr><td>แนวดิ่ง</td><td>${bars(w.vertical)} · P–M ${f(w.ratioPM, 2)} <small>(${esc(w.crit)})</small></td></tr>
        <tr><td>แนวนอน</td><td>${bars(w.horizontal)} · φVn ${f(w.phiVn)} kN</td></tr>
        <tr><td>อัตราส่วน</td><td><b class="${ratioCls(d.ratio)}">${f(d.ratio, 2)}</b></td></tr>
      </tbody></table>${warn}<button class="primary wide" data-report="member:${esc(st.selection ?? "")}">รายการคำนวณผนังนี้</button></div>`;
  }
  const c = d.result;
  return `<div class="card ${d.ok ? "ok" : "bad"}"><div class="card-h">ออกแบบเสา (P–M33–M22) <span class="tag ${d.ok ? "ok" : "bad"}">${d.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
    <table class="mini"><tbody>
      <tr><td>เหล็กยืน</td><td>${c.layout ? `${totalBarsBiax(c.layout)}DB${c.layout.dia} <small>(${c.layout.n2}×${c.layout.n3})</small>` : "—"}</td></tr>
      <tr><td>ρg</td><td>${f(c.rho * 100)} %</td></tr>
      <tr><td>ปลอก</td><td>${esc(d.ties)}</td></tr>
      ${c.crit ? `<tr><td>กรณีวิกฤต</td><td>${esc(c.crit.combo)} (ปลาย ${c.crit.end})</td></tr>
      <tr><td>Pu / M33 / M22</td><td>${f(c.crit.Pu)} / ${f(Math.abs(c.crit.M3))} / ${f(Math.abs(c.crit.M2))}</td></tr>
      <tr><td>φMn (ทิศเดียวกัน)</td><td>${f(c.crit.phiMn)} kN·m</td></tr>` : ""}
      <tr><td>อัตราส่วน</td><td><b class="${ratioCls(d.ratio)}">${f(d.ratio, 2)}</b></td></tr>
    </tbody></table>${warn}${c.ok ? "" : `<p class="warn">${esc(c.message)}</p>`}<button class="primary wide" data-report="member:${esc(st.selection ?? "")}">รายการคำนวณเสานี้</button></div>`;
}

function designSummary(ds: Record<string, MemberDesign3>): string {
  const v = Object.values(ds);
  const grp = (k: "beam" | "column" | "wall") => {
    const a = v.filter((x) => x.kind === k);
    return { n: a.length, fail: a.filter((x) => !x.ok).length, max: Math.max(0, ...a.map((x) => x.ratio)), warn: a.filter((x) => x.warnings.length).length };
  };
  const b = grp("beam"), c = grp("column"), wl = grp("wall");
  return `<div class="card"><div class="card-h">สรุปการออกแบบ</div><table class="mini"><thead><tr><th></th><th>จำนวน</th><th>ไม่ผ่าน</th><th>อัตราส่วนสูงสุด</th><th>เตือน</th></tr></thead><tbody>
    <tr><td>คาน</td><td>${b.n}</td><td>${b.fail}</td><td class="${ratioCls(b.max)}">${f(b.max, 2)}</td><td>${b.warn}</td></tr>
    <tr><td>เสา</td><td>${c.n}</td><td>${c.fail}</td><td class="${ratioCls(c.max)}">${f(c.max, 2)}</td><td>${c.warn}</td></tr>
    ${wl.n ? `<tr><td>ผนัง</td><td>${wl.n}</td><td>${wl.fail}</td><td class="${ratioCls(wl.max)}">${f(wl.max, 2)}</td><td>—</td></tr>` : ""}
  </tbody></table><div class="legend"><span class="sw ok"></span>≤ 0.5 <span class="sw mid"></span>≈ 0.85–1.0 <span class="sw bad"></span>&gt; 1.0</div>
  ${(() => { const nd = driftFailures().size; return b.fail + c.fail + nd ? `<button id="btn-autosize" class="primary wide" title="ขยายหน้าตัดเฉพาะชิ้นที่ไม่ผ่าน (ทีละ 5 cm ตามอัตราส่วนกำลัง) และเสาของชั้นที่ drift เกิน แล้ววิเคราะห์ซ้ำจนผ่าน — ย้อนกลับได้ด้วยปุ่ม ล้าง ในการ์ดสร้างอาคาร">⚙ ปรับขนาดอัตโนมัติ (${b.fail + c.fail} ชิ้น${nd ? ` + drift ${nd} ชั้น` : ""})</button>` : ""; })()}
  ${autoMsg ? `<p class="auto-msg">${esc(autoMsg)}</p>` : ""}
  <p class="muted small">กดปุ่ม "ออกแบบ" บนแถบเครื่องมือเพื่อระบายสีตามอัตราส่วนกำลัง</p></div>`;
}

// ---------- ชุดผสมน้ำหนัก ----------
function combosCard(): string {
  const m = st.model;
  if (!m) return "";
  const custom = !!st.params.combos?.length;
  const cases = m.loadCases.map((c) => c.id);
  const num = (v: number) => (Math.round(v * 10000) / 10000).toString();
  return `<details class="card info-card combos3d"${custom ? " open" : ""}><summary class="card-h">ชุดผสมน้ำหนัก (${m.combos.length}) <span class="tag ${custom ? "hot" : ""}">${custom ? "กำหนดเอง" : st.dset.code === "ACI" ? "ACI 318-19" : "วสท. 1008-38"}</span></summary>
    <div class="tbl-scroll"><table class="mini cb"><thead><tr><th>ชุด</th><th>ชื่อ</th>${cases.map((c) => `<th>${esc(c)}</th>`).join("")}<th></th></tr></thead><tbody>
    ${m.combos.map((c, i) => `<tr><td>${esc(c.id)}</td><td><input data-cb="${i}" data-k="name" type="text" value="${esc(c.name)}"/></td>${cases.map((k) => `<td><input data-cb="${i}" data-k="${esc(k)}" type="number" step="0.05" value="${num(c.factors[k] ?? 0)}"/></td>`).join("")}<td><button data-cbdel="${i}" title="ลบชุดนี้">×</button></td></tr>`).join("")}
    </tbody></table></div>
    <div class="ed-btns"><button id="cb-add" type="button">+ เพิ่มชุด</button><button id="cb-reset" type="button" ${custom ? "" : "disabled"} title="กลับไปใช้ชุดผสมตามมาตรฐานที่เลือก">คืนตามมาตรฐาน</button></div>
    <p class="muted small">ตัวคูณของแต่ละ load case (ค่าลบ = ทิศตรงข้าม) · แก้แล้ววิเคราะห์ใหม่ทันที · ชุดผสมตามมาตรฐานเปลี่ยนตามมาตรฐานที่เลือกในตั้งค่าการออกแบบ · ฐานรากตรวจหน่วยแรงใช้งานแยกต่างหาก (D + L ± W/0.7E)</p></details>`;
}
function bindCombos() {
  const host = document.querySelector<HTMLElement>(".combos3d");
  if (!host || !st.model) return;
  const current = () => structuredClone(st.params.combos?.length ? st.params.combos : st.model!.combos);
  const commit = (list: typeof st.model.combos) => { st.params = { ...st.params, combos: list.map((c, i) => ({ ...c, id: `U${i + 1}` })) }; rebuild(true); };
  for (const el of host.querySelectorAll<HTMLInputElement>("input[data-cb]")) {
    el.addEventListener("change", () => {
      const list = current(), c = list[+el.dataset.cb!], k = el.dataset.k!;
      if (!c) return;
      if (k === "name") c.name = el.value;
      else { const v = parseFloat(el.value); if (!Number.isFinite(v)) return; if (v) c.factors[k] = v; else delete c.factors[k]; }
      commit(list);
    });
  }
  for (const b of host.querySelectorAll<HTMLButtonElement>("[data-cbdel]")) b.onclick = () => { const list = current(); list.splice(+b.dataset.cbdel!, 1); if (list.length) commit(list); };
  host.querySelector<HTMLButtonElement>("#cb-add")!.onclick = () => { const list = current(); list.push({ id: "", name: "ชุดใหม่", factors: { DL: 1, LL: 1 } }); commit(list); };
  host.querySelector<HTMLButtonElement>("#cb-reset")!.onclick = () => { st.params = { ...st.params, combos: undefined }; rebuild(true); };
}

// ---------- บันได ----------
function stairCard(): string {
  const s = { ...defaultStair, ...(st.params.stair ?? {}) };
  const r = s.enabled ? designStair(s, st.params.fcKsc, st.params.fyKsc, st.dset.code) : null;
  const inp = (id: keyof typeof s, label: string, step: string, title = "") => `<label title="${title}">${label}<input data-stair="${id}" type="number" step="${step}" value="${s[id]}"/></label>`;
  return `<details class="card info-card"${s.enabled ? " open" : ""}><summary class="card-h">ออกแบบบันได ${r ? `<span class="tag ${r.ok ? "ok" : "bad"}">${r.ok ? "ผ่าน" : "ไม่ผ่าน"}</span>` : ""}</summary>
    <div class="form g3">
      <label class="span3"><span><input data-stair="enabled" type="checkbox" ${s.enabled ? "checked" : ""}/> ออกแบบบันไดท้องเรียบ (แสดงในรายการคำนวณ)</span></label>
      ${inp("Ln", "ช่วงราบ Ln (m)", "0.1", "ระยะราบระหว่างฐานรองรับ")}${inp("H", "ความสูง H (m)", "0.05", "ความสูงช่วงบันไดระหว่างชานพัก")}${inp("tread", "ลูกนอน (m)", "0.01")}
      ${inp("t", "ท้องบันได t (m)", "0.01")}${inp("width", "กว้าง (m)", "0.1")}
      <label>ฐานรองรับ<select data-stair="support"><option value="simple" ${s.support === "simple" ? "selected" : ""}>ธรรมดา</option><option value="continuous" ${s.support === "continuous" ? "selected" : ""}>ต่อเนื่อง</option></select></label>
      ${inp("sdl", "SDL (kg/m²)", "10")}${inp("ll", "LL (kg/m²)", "50")}
    </div>
    ${r ? `<table class="mini"><tbody>
      <tr><td>ขั้น</td><td>${r.n} ขั้น · ลูกตั้ง ${f(r.R * 1000, 0)} mm</td></tr>
      <tr><td>wu / Mu</td><td>${f(r.wu)} kN/m² · ${f(r.Mu)} kN·m/m</td></tr>
      <tr><td>เหล็กหลัก</td><td><b>${r.main.dia <= 9 ? "RB" : "DB"}${r.main.dia} @ ${(r.main.s / 1000).toFixed(3)}</b> · กันร้าว ${r.dist.dia <= 9 ? "RB" : "DB"}${r.dist.dia} @ ${(r.dist.s / 1000).toFixed(3)}</td></tr>
      <tr><td>ลงคานรองรับ</td><td>${f(r.reaction * s.width)} kN (${f(r.reaction)} kN/m)</td></tr>
    </tbody></table>${r.ok ? "" : `<p class="warn">${esc(r.message)}</p>`}` : ""}</details>`;
}
function bindStair() {
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#left-body [data-stair]")) {
    el.addEventListener("change", () => {
      const key = el.dataset.stair as keyof StairInput;
      const s = { ...defaultStair, ...(st.params.stair ?? {}) };
      const v = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el instanceof HTMLSelectElement ? el.value : parseFloat(el.value);
      if (typeof v === "number" && !(v > 0) && key !== "sdl" && key !== "ll") return;
      st.params = { ...st.params, stair: { ...s, [key]: v } as StairInput };
      try { localStorage.setItem(KEY, JSON.stringify(st.params)); } catch { /* ไม่มี storage */ }
      renderLeft(); convertDom($("#left-body"));
    });
  }
}

// ---------- ข้อมูลโครงการ (หน้าปกรายการคำนวณ) ----------
function projectInfoCard(): string {
  const i = { ...emptyInfo, ...(st.params.info ?? {}) };
  const fld = (id: keyof ProjectInfo, label: string, span = "") => `<label class="${span}">${label}<input data-info="${id}" type="text" value="${esc(i[id])}"/></label>`;
  return `<details class="card info-card"${i.engineer || i.owner ? "" : " open"}><summary class="card-h">ข้อมูลโครงการ</summary><div class="form g3">
    ${fld("owner", "เจ้าของโครงการ", "span3")}${fld("location", "สถานที่ก่อสร้าง", "span3")}${fld("company", "บริษัท / สำนักงาน", "span3")}
    ${fld("engineer", "วิศวกรผู้ออกแบบ", "span2")}${fld("license", "เลขใบอนุญาต")}
  </div><p class="muted small">แสดงบนหน้าปกรายการคำนวณ และบันทึกไปกับไฟล์โปรเจกต์</p></details>`;
}
function bindProjectInfo() {
  for (const el of document.querySelectorAll<HTMLInputElement>("#left-body [data-info]")) {
    el.onchange = () => {
      st.params = { ...st.params, info: { ...emptyInfo, ...(st.params.info ?? {}), [el.dataset.info!]: el.value } };
      try { localStorage.setItem(KEY, JSON.stringify(st.params)); } catch { /* ไม่มี storage */ }
      pushShared();
    };
  }
}

// ---------- แถบคำอธิบาย (มุมบนซ้ายของฉาก) ----------
function renderLegend() {
  const el = $("#legend3d");
  const r = current();
  const name: Record<string, string> = { Mz: "M33", My: "M22", N: "N", T: "T" };
  const mode = modeAnim && modal?.modes.find((m) => m.n === modeAnim!.n);
  if (thAnim && th) {
    const i = thAnim.i;
    el.innerHTML = `<div class="lg-title">🌊 ประวัติเวลา ทิศ ${th.dir} — t = ${(i * th.dt).toFixed(2)} s</div>
      <div class="lg-row"><span>ความเร่งพื้นดิน ${th.ag[i].toFixed(3)} g</span></div>
      <div class="lg-row"><span>ยอดเคลื่อนตัว ${(th.roof[i] * 1000).toFixed(1)} mm · V = ${units.F(th.V[i]).toFixed(0)} ${units.sys === "tf" ? "tf" : "kN"} (ยืดหยุ่น)</span></div>
      <div class="lg-row"><span>ภาพขยายเกินจริง · สูงสุด ${(th.max.roof * 1000).toFixed(1)} mm ที่ ${th.max.tRoof.toFixed(2)} s</span></div>`;
    el.hidden = false;
  } else if (poAnim && po) {
    const stp = po.steps[Math.min(po.steps.length - 1, Math.max(0, Math.floor(poAnim.s)))];
    const nh = po.hinges.filter((h) => h.step <= stp.step).length;
    el.innerHTML = `<div class="lg-title">${poAnim.done && po.end !== "drift" && po.end !== "limit" ? "💥 พัง — " : ""}จำลองการพัง (Pushover) ทิศ ${po.dir}</div>
      <div class="lg-row"><span>ขั้น ${stp.step}/${po.steps.length - 1} · V = ${units.F(stp.V).toFixed(0)} ${units.sys === "tf" ? "tf" : "kN"}${po.Vdesign ? ` (${(stp.V / po.Vdesign).toFixed(2)}×V ออกแบบ)` : ""}</span></div>
      <div class="lg-row"><span>ยอดเคลื่อน ${(Math.abs(stp.roof) * 1000).toFixed(0)} mm (${(Math.abs(stp.drift) * 100).toFixed(2)}% H) · จุดหมุน ${nh}</span></div>
      ${poAnim.done ? `<div class="lg-row"><span>${esc(po.endNote)}</span></div>` : ""}
      <div class="lg-row"><span style="color:#facc15">●</span> คาน <span style="color:#ef4444">●</span> เสา <span style="color:#c026d3">●</span> เฉือน · ภาพขยายเกินจริง</div>`;
    el.hidden = false;
  } else if (mode) {
    el.innerHTML = `<div class="lg-title">โหมดการสั่นที่ ${mode.n} (${mode.dir === "R" ? "บิด" : `ทิศ ${mode.dir}`})</div>
      <div class="lg-row"><span>T = ${mode.T.toFixed(3)} s · f = ${mode.f.toFixed(2)} Hz</span></div>
      <div class="lg-row"><span>มวล X ${(mode.mx * 100).toFixed(1)}% · Y ${(mode.my * 100).toFixed(1)}% · บิด ${(mode.mr * 100).toFixed(1)}%</span></div>`;
    el.hidden = false;
  } else if (st.display === "design" && st.design) {
    el.innerHTML = `<div class="lg-title">อัตราส่วนกำลัง (Demand / Capacity)</div><div class="lg-bar"></div>
      <div class="lg-ticks"><span>0</span><span>0.5</span><span>0.85</span><span>1.0</span><span>&gt;1</span></div>`;
    el.hidden = false;
  } else if (r && (st.display in name)) {
    const key = st.display as "Mz" | "My" | "N" | "T";
    let mx = 0, mn = 0, idMx = "", idMn = "";
    for (const [id, mr] of Object.entries(r.members)) for (const p of mr.stations) {
      if (p[key] > mx) { mx = p[key]; idMx = id; }
      if (p[key] < mn) { mn = p[key]; idMn = id; }
    }
    const u = key === "N" ? units.label.F() : units.label.M();
    el.innerHTML = `<div class="lg-title">${name[key]} (${u}) — ${esc(st.model?.combos.find((c) => `combo:${c.id}` === st.resultKey)?.name ?? st.resultKey.replace("case:", "Load case "))}</div>
      <div class="lg-row"><span>สูงสุด ${esc(idMx)}</span><b>${f(units.F(mx))}</b></div>
      <div class="lg-row"><span>ต่ำสุด ${esc(idMn)}</span><b>${f(units.F(mn))}</b></div>`;
    el.hidden = false;
  } else if (r && st.display === "deformed") {
    let best = { id: "", d: 0 };
    for (const [id, d] of Object.entries(r.disp)) { const m = Math.hypot(d.ux, d.uy, d.uz); if (m > best.d) best = { id, d: m }; }
    el.innerHTML = `<div class="lg-title">การเสียรูป (ขยายเพื่อให้เห็น)</div><div class="lg-row"><span>สูงสุดที่ ${esc(best.id)}</span><b>${f(best.d * 1000)} mm</b></div>`;
    el.hidden = false;
  } else el.hidden = true;
}

// ---------- ชี้เมาส์: เน้นชิ้นส่วนและแสดงข้อมูลย่อ ----------
let hoverId: string | null = null;
let hoverRaf = 0;
canvas.addEventListener("pointermove", (e) => {
  if (e.buttons) return; // กำลังหมุน/เลื่อนกล้อง
  cancelAnimationFrame(hoverRaf);
  hoverRaf = requestAnimationFrame(() => {
    const id = scene.pick(e);
    const tip = $("#tip3d");
    if (id !== hoverId) { hoverId = id; scene.setHover(id); }
    if (!id || !st.model) { tip.hidden = true; return; }
    const mem = st.model.members.find((m) => m.id === id)!;
    const sec = st.model.sections.find((x) => x.id === mem.section);
    const L = st.run?.results[Object.keys(st.run.results)[0]]?.members[id]?.L;
    const d = st.design?.[id];
    tip.innerHTML = `<b>${esc(id)}</b> · ${mem.kind === "beam" ? "คาน" : mem.kind === "column" ? "เสา" : mem.kind}<br/>${esc(sec?.name ?? "-")}${L ? ` · L = ${f(L)} m` : ""}${d ? `<br/>อัตราส่วนกำลัง ${f(d.ratio)} ${d.ok ? "✓" : "✗"}` : ""}`;
    const host = $("#view3d").getBoundingClientRect();
    tip.style.left = `${e.clientX - host.left + 14}px`;
    tip.style.top = `${e.clientY - host.top + 14}px`;
    tip.hidden = false;
  });
});
canvas.addEventListener("pointerleave", () => { $("#tip3d").hidden = true; hoverId = null; scene.setHover(null); });

// ---------- ฐานราก ----------
function foundationCard(): string {
  const fs = st.fset;
  return `<div class="card"><div class="card-h">ตั้งค่าฐานราก</div><div class="form g3">
    <label class="span2">ชนิด<select id="fd-type"><option value="spread" ${fs.type === "spread" ? "selected" : ""}>ฐานแผ่บนดิน</option><option value="pile" ${fs.type === "pile" ? "selected" : ""}>ฐานเสาเข็ม</option></select></label>
    <label title="ระดับท้องฐานจากผิวดิน">Df (m)<input id="fd-df" type="number" step="0.1" value="${fs.Df}"/></label>
    ${fs.type === "spread"
      ? `<label title="หน่วยแรงแบกทานยอมให้ (gross)">qa (t/m²)<input id="fd-qa" type="number" step="0.5" value="${fs.qaTon}"/></label>
         <label title="อัตราส่วน L/B (L ตามแกน X)">L/B<input id="fd-ratio" type="number" step="0.1" min="0.5" max="3" value="${fs.ratio}"/></label>`
      : `<label title="น้ำหนักบรรทุกปลอดภัยต่อต้น">Ra (ตัน)<input id="fd-pile" type="number" step="1" value="${fs.pileTon}"/></label>
         <label>ขนาดเข็ม (m)<input id="fd-psize" type="number" step="0.01" value="${fs.pileSize}"/></label>
         <label title="ระยะห่างเข็ม = k × ขนาดเข็ม">ระยะห่าง (×D)<input id="fd-psp" type="number" step="0.5" min="2.5" value="${fs.pileSpacingFactor}"/></label>`}
    <label title="หน่วยน้ำหนักดินถม">γดิน<input id="fd-gs" type="number" step="0.5" value="${fs.gammaSoil}"/></label>
    <label title="เพิ่มค่ายอมให้ 33% สำหรับกรณีที่มีแรงลม"><span><input id="fd-wind" type="checkbox" ${fs.windIncrease ? "checked" : ""}/> ลม ×1.33</span></label>
  </div></div>`;
}

function bindFoundation() {
  const set = (patch: Partial<FoundationSettings>) => { st.fset = { ...st.fset, ...patch }; renderLeft(); runDesign(); };
  const num = (id: string, key: keyof FoundationSettings, min = 0) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.onchange = () => { const v = parseFloat(el.value); if (Number.isFinite(v) && v > min) set({ [key]: v } as Partial<FoundationSettings>); };
  };
  $<HTMLSelectElement>("#fd-type").onchange = (e) => set({ type: (e.target as HTMLSelectElement).value as "spread" | "pile" });
  num("fd-df", "Df"); num("fd-qa", "qaTon"); num("fd-ratio", "ratio"); num("fd-pile", "pileTon");
  num("fd-psize", "pileSize"); num("fd-psp", "pileSpacingFactor", 2); num("fd-gs", "gammaSoil");
  $<HTMLInputElement>("#fd-wind").onchange = (e) => set({ windIncrease: (e.target as HTMLInputElement).checked });
}

function footingPlan(node: string, ft: FootingResult3): string {
  const col = st.model?.members.find((m) => (m.kind === "column" || m.kind === "wall") && (m.i === node || m.j === node));
  const sec = col && st.model?.sections.find((x) => x.id === col.section);
  return footingPlanSvg3(ft, sec?.h ?? 0.3, sec?.b ?? 0.3, st.fset.pileSize);
}

function footingCard(node: string, ft: FootingResult3): string {
  const worst = ft.service.reduce((a, s) => (s.qmax / s.allow > a.qmax / a.allow ? s : a), ft.service[0]);
  const unit = ft.type === "pile" ? "kN/ต้น" : "kN/m²";
  return `<div class="card ${ft.ok ? "ok" : "bad"}"><div class="card-h">ฐานราก${ft.type === "pile" ? "เสาเข็ม" : "แผ่"} ${esc(node)} <span class="tag ${ft.ok ? "ok" : "bad"}">${ft.ok ? "ผ่าน" : "ไม่ผ่าน"}</span></div>
    <div class="pm-wrap">${footingPlan(node, ft)}</div>
    <table class="mini"><tbody>
      <tr><td>ขนาด L×B×t</td><td>${f(ft.L)} × ${f(ft.B)} × ${f(ft.t)} m</td></tr>
      ${ft.piles ? `<tr><td>เสาเข็ม</td><td>${ft.piles.coords.length} ต้น (${ft.piles.nx}×${ft.piles.ny}) @ ${f(ft.piles.s)} m</td></tr>` : ""}
      ${worst ? `<tr><td>${ft.type === "pile" ? "แรงเข็มสูงสุด" : "qmax"}</td><td>${f(worst.qmax)} / ${f(worst.allow)} ${unit}</td></tr>
      <tr><td>กรณีวิกฤต</td><td>${esc(worst.name)}${worst.note ? ` <small>(${esc(worst.note)})</small>` : ""}</td></tr>` : ""}
      <tr><td>เฉือนทะลุ / ทางเดียว X / Y</td><td>${f(ft.crit.punch)} / ${f(ft.crit.oneWayX)} / ${f(ft.crit.oneWayY)}</td></tr>
      <tr><td>เหล็กแนว X</td><td>${esc(ft.barsX)}</td></tr>
      <tr><td>เหล็กแนว Y</td><td>${esc(ft.barsY)}</td></tr>
    </tbody></table>
    ${ft.ok ? "" : `<p class="warn">${esc(ft.message)}</p>`}
    <details class="steps3"><summary>ขั้นตอนคำนวณ</summary><table class="mini"><tbody>
      ${ft.steps.map((x) => `<tr class="${x.ok === false ? "bad" : ""}"><td>${esc(x.label)}<br/><small>${esc(x.expr)}</small></td><td>${esc(x.value)}</td></tr>`).join("")}
    </tbody></table></details>
    <button class="primary wide" data-report="footing:${esc(node)}">รายการคำนวณฐานรากนี้</button></div>`;
}

function footingSummary(fts: Record<string, FootingResult3>): string {
  const rows = Object.entries(fts);
  const fail = rows.filter(([, x]) => !x.ok).length;
  return `<div class="card"><div class="card-h">ฐานราก (${st.fset.type === "pile" ? "เสาเข็ม" : "แผ่"}) <span class="tag ${fail ? "bad" : "ok"}">${fail ? `ไม่ผ่าน ${fail}` : "ผ่านทั้งหมด"}</span></div>
    <table class="mini summary"><thead><tr><th>จุด</th><th>L×B×t (m)</th><th>${st.fset.type === "pile" ? "เข็ม" : "qmax/qa"}</th><th></th></tr></thead><tbody>
    ${rows.map(([id, ft]) => {
      const w = ft.service.reduce((a, s) => (s.qmax / s.allow > a.qmax / a.allow ? s : a), ft.service[0]);
      return `<tr data-node="${esc(id)}" class="${st.footSel === id ? "selected" : ""}"><td>${esc(id)}</td><td>${f(ft.L)}×${f(ft.B)}×${f(ft.t)}</td><td>${ft.piles ? `${ft.piles.coords.length} ต้น` : w ? f(w.qmax / w.allow, 2) : "-"}</td><td>${ft.ok ? "✓" : "✗"}</td></tr>`;
    }).join("")}
    </tbody></table><p class="muted small">คลิกแถวหรือกล่องฐานในฉาก 3D เพื่อดูแปลนและขั้นตอนคำนวณ</p></div>`;
}

// ---------- รายการคำนวณ ----------
function showReport(scope: Report3Scope) {
  if (!st.model || !st.run || !st.design) return;
  openReport3({ model: st.model, params: st.params, run: st.run, wind: st.wind, seismic: st.seismic, design: st.design, footings: st.footings, dset: st.dset, fset: st.fset }, scope);
}
$("#btn-report3d").onclick = () => showReport("summary");

// ---------- บันทึก / เปิดไฟล์โปรเจกต์ 3D ----------
// ---------- DXF (AutoCAD) ----------
async function importDxf(file: File) {
  try {
    const g = parseDxfGrid(await file.text());
    const sx = spacingText(g.xs), sy = spacingText(g.ys);
    if (!confirm(`พบเส้นกริดใน ${file.name}${g.layerHint ? ` (เลเยอร์ ${g.layerHint})` : ""}\nแกน X: ${g.xs.length} เส้น → ${sx} m\nแกน Y: ${g.ys.length} เส้น → ${sy} m\n(หน่วยในไฟล์: ${g.unit})\n\nใช้เป็นช่วงกริดของอาคาร? (ความสูงชั้น หน้าตัด น้ำหนัก คงเดิม · ล้างชิ้นที่ลบ/ค่าปรับรายชิ้น)`)) return;
    st.params = { ...st.params, xSpacing: sx, ySpacing: sy, layout: { ...(st.params.layout ?? {}), removed: [], openings: [] }, overrides: undefined };
    st.level = null;
    rebuild();
  } catch (e) { alert(`นำเข้า DXF ไม่ได้: ${(e as Error).message}`); }
}
function exportDxf() {
  if (!st.model) return;
  const p = st.params;
  const cum = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);
  const txt = buildDxf({
    name: p.name, model: st.model, design: st.design, footings: st.footings, slabs: currentSlabs(),
    xs: cum(parseSpacing(p.xSpacing)), ys: cum(parseSpacing(p.ySpacing)), zs: cum(parseSpacing(p.storeys)),
    openings: (k, i, j) => !!p.slab?.enabled && !panelExists(p, k, i, j), pileSize: st.fset.pileSize,
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "application/dxf" }));
  a.download = `${p.name.replace(/[\\/:*?"<>|]+/g, "_") || "structlab"}.dxf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#btn-dxf3d").onclick = () => { if (!st.design) { alert("รอผลออกแบบเสร็จก่อนส่งออก (ป้ายแบบคาน/เสามาจากผลออกแบบ)"); return; } exportDxf(); };

function saveProject() {
  const data = { app: "structlab-3d", version: 1, params: st.params, design: st.dset, foundation: st.fset };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${st.params.name.replace(/[\\/:*?"<>|]/g, "_") || "project"}.3d.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function openProject(file: File) {
  if (/\.dxf$/i.test(file.name)) { await importDxf(file); return; }
  try {
    applyProject(JSON.parse(await file.text()));
  } catch (e) {
    alert(`เปิดไฟล์ไม่ได้: ${(e as Error).message}`);
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyProject(o: any) {
  if (o?.app !== "structlab-3d" || !o.params) throw new Error("ไม่ใช่ไฟล์โปรเจกต์ 3D ของ StructLab");
  st.params = { ...defaultGrid, ...o.params, wind: { ...defaultGrid.wind, ...(o.params.wind ?? {}) }, seismic: { ...defaultSeismic, ...(o.params.seismic ?? {}) }, tieBeam: { ...defaultTie, ...(o.params.tieBeam ?? {}) }, slab: { ...defaultSlab, ...(o.params.slab ?? {}) } };
  st.dset = { ...defaultDesign3, ...(o.design ?? {}) };
  st.fset = { ...defaultFoundation, ...(o.foundation ?? {}) };
  st.level = null;
  saveSettings();
  rebuild();
}
// ---------- แชร์ด้วยลิงก์ ----------
async function shareProject() {
  const data = { app: "structlab-3d", version: 1, params: st.params, design: st.dset, foundation: st.fset };
  const url = `${location.origin}${location.pathname}#${await encodeShare(data)}`;
  try {
    await navigator.clipboard.writeText(url);
    alert(`คัดลอกลิงก์แชร์แล้ว (${url.length.toLocaleString()} ตัวอักษร)\nส่งลิงก์นี้ให้ผู้อื่น เปิดแล้วจะเห็นอาคารเดียวกันทันที — ข้อมูลอยู่ในลิงก์ ไม่ได้อัปโหลดไปที่ใด`);
  } catch {
    prompt("คัดลอกลิงก์แชร์นี้:", url);
  }
}
async function loadFromHash() {
  if (!location.hash.startsWith("#p=")) return;
  try {
    const o = await decodeShare(location.hash);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (o as any)?.params?.name ?? "";
    if (confirm(`เปิดโปรเจกต์จากลิงก์แชร์${name ? ` "${name}"` : ""} แทนโมเดลปัจจุบัน?\n(โมเดลเดิมสำรองไว้ — ย้อนกลับได้ด้วย Ctrl+Z)`)) applyProject(o);
  } catch (e) {
    alert(`ลิงก์แชร์เสียหายหรือไม่สมบูรณ์: ${(e as Error).message}`);
  }
  history.replaceState(null, "", location.pathname + location.search);
}
// ---------- อาคารตัวอย่าง ----------
{
  const sel = $<HTMLSelectElement>("#sel-example3d");
  sel.innerHTML += EXAMPLES_3D.map((e) => `<option value="${e.id}">${esc(e.label)} — ${esc(e.desc)}</option>`).join("");
  sel.onchange = () => {
    const ex = EXAMPLES_3D.find((e) => e.id === sel.value);
    sel.value = "";
    if (!ex || !confirm(`เปิดตัวอย่าง "${ex.label}" แทนโมเดลปัจจุบัน?\n(ชื่อโครงการ วัสดุ แรงลม และตั้งค่าฐานรากจะใช้ร่วมกับหน้า 2D ด้วย)`)) return;
    st.params = { ...structuredClone(ex.params), info: st.params.info };
    st.fset = { ...defaultFoundation, ...ex.foundation };
    st.level = null;
    saveSettings();
    rebuild();
  };
}
$("#btn-save3d").onclick = saveProject;
$("#btn-share3d").onclick = () => void shareProject();
$("#btn-undo").onclick = () => stepHistory(-1);
$("#btn-redo").onclick = () => stepHistory(1);
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const t = e.target;
  if (t instanceof Element && t.closest("input, textarea, select, [contenteditable]")) return; // ให้เบราว์เซอร์ย้อนข้อความในช่องกรอกเอง
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); stepHistory(-1); }
  else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); stepHistory(1); }
});
$("#btn-open3d").onclick = () => $<HTMLInputElement>("#file3d").click();
$<HTMLInputElement>("#file3d").onchange = (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void openProject(file);
  (e.target as HTMLInputElement).value = "";
};

function renderStatus() {
  const s = $("#status");
  const m = st.model;
  if (st.error) { s.className = "status error"; s.textContent = `⚠ ${st.error}`; return; }
  s.className = "status";
  if (!m) { s.textContent = ""; return; }
  const r = current();
  s.textContent = `จุดต่อ ${m.nodes.length} · ชิ้นส่วน ${m.members.length} · พื้นแข็ง ${m.diaphragms?.length ?? 0} ชั้น` +
    (st.run && r ? ` · ${r.info.neq.toLocaleString()} สมการ · วิเคราะห์ ${Object.keys(st.run.results).length} กรณีใน ${f(st.run.ms / 1000, 2)} s` +
      (r.info.pDelta ? ` · P-Δ ลู่เข้าใน ${r.info.iterations} รอบ` : " · อันดับหนึ่ง") + (m.analysis?.cracked ? " · หน้าตัดแตกร้าว" : "") : " · กำลังคำนวณ…");
}

// เมื่อหน้า 2D (หรืออีกแท็บ) เปลี่ยนค่าร่วม: วิเคราะห์ใหม่ถ้าวัสดุ/แรงลม/ชื่อเปลี่ยน, ออกแบบใหม่ถ้าตั้งค่าออกแบบ/ฐานรากเปลี่ยน
onSharedChange((sh) => {
  const before = sharedFrom3D();
  applyShared3D(sh);
  if (!sameJSON(before.material, sh.material) || !sameJSON(before.wind, sh.wind) || before.name !== sh.name) rebuild();
  else if (before.design.code !== sh.design.code) rebuild(true); // มาตรฐานเปลี่ยน → ชุดผสมเปลี่ยน
  else if (!sameJSON(before.design, sh.design) || !sameJSON(before.foundation, sh.foundation)) runDesign();
  else renderAll();
}, sharedFrom3D);

// โครง 2D ที่เชื่อมอยู่แก้หน้าตัด/น้ำหนัก → พารามิเตอร์อาคารเปลี่ยน → สร้างและวิเคราะห์ใหม่
function syncParamsFrom2D() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return; }
  if (!raw || raw === JSON.stringify(st.params)) return;
  const next = parseParams3D(raw);
  if (sameJSON(next, st.params)) return;
  st.params = next;
  rebuild();
}
window.addEventListener("storage", (e) => { if (e.key === KEY) syncParamsFrom2D(); });
window.addEventListener("pageshow", (e) => { if (e.persisted) syncParamsFrom2D(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncParamsFrom2D(); });

rebuild();
void loadFromHash();
window.addEventListener("hashchange", () => void loadFromHash());
